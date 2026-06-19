import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const templates = await prisma.emailTemplate.findMany({ orderBy: { createdAt: "desc" } });
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: "Unable to load templates" });
  }
});

router.post("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { name, category, subject, emailTitle, emailBody, buttonText, buttonLink } = req.body;
    if (!name || !subject || !emailTitle || !emailBody) {
      return res.status(400).json({ error: "name, subject, emailTitle and emailBody are required" });
    }
    const t = await prisma.emailTemplate.create({
      data: { name, category: category || "General", subject, emailTitle, emailBody, buttonText: buttonText || null, buttonLink: buttonLink || null },
    });
    res.status(201).json(t);
  } catch (e) {
    res.status(500).json({ error: "Unable to create template" });
  }
});

router.put("/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { name, category, subject, emailTitle, emailBody, buttonText, buttonLink } = req.body;
    const t = await prisma.emailTemplate.update({
      where: { id: Number(req.params.id) },
      data: { name, category, subject, emailTitle, emailBody, buttonText: buttonText || null, buttonLink: buttonLink || null },
    });
    res.json(t);
  } catch (e) {
    res.status(500).json({ error: "Unable to update template" });
  }
});

router.delete("/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    await prisma.emailTemplate.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Unable to delete template" });
  }
});

export default router;
