import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("ADMIN", "MARKETING"), async (req, res) => {
  try {
    const logs = await prisma.campaignLog.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load campaign logs" });
  }
});

export default router;
