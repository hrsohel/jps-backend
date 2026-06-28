import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

// GET /api/settings — returns non-secret keys (masked secrets)
router.get("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const settings = await prisma.appSetting.findMany();
    const masked = settings.map((s) => ({
      key: s.key,
      value: s.key.toLowerCase().includes("secret") || s.key.toLowerCase().includes("key")
        ? "••••••••" + s.value.slice(-4)
        : s.value,
      updatedAt: s.updatedAt,
    }));
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — upsert a setting key-value
router.put("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });

    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
