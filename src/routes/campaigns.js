import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const MARKETING_ROLES = ["ADMIN", "MARKETING"];

const router = express.Router();

// Aggregated stats for the campaigns dashboard
router.get("/stats", requireAuth, requireRole(...MARKETING_ROLES), async (req, res) => {
  try {
    const [
      totalCampaigns,
      draftCampaigns,
      sentCampaigns,
      totalTemplates,
      logs,
      totalUsers,
      activeUsers,
    ] = await Promise.all([
      prisma.campaign.count(),
      prisma.campaign.count({ where: { status: "DRAFT" } }),
      prisma.campaign.count({ where: { status: "SENT" } }),
      prisma.emailTemplate.count(),
      prisma.campaignLog.findMany({ select: { recipients: true, successCount: true, failedCount: true } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "ACTIVE" } }),
    ]);

    const totalSent      = logs.reduce((s, l) => s + l.recipients, 0);
    const totalDelivered = logs.reduce((s, l) => s + l.successCount, 0);
    const totalFailed    = logs.reduce((s, l) => s + l.failedCount, 0);
    const successRate    = totalSent === 0 ? 0 : Math.round((totalDelivered / totalSent) * 100);

    res.json({
      totalCampaigns,
      draftCampaigns,
      sentCampaigns,
      totalTemplates,
      totalSent,
      totalDelivered,
      totalFailed,
      successRate,
      totalUsers,
      activeUsers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load stats" });
  }
});

router.get("/", requireAuth, requireRole(...MARKETING_ROLES), async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json(campaigns);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load campaigns" });
  }
});

router.post("/", requireAuth, requireRole(...MARKETING_ROLES), async (req, res) => {
  try {
    const campaign = await prisma.campaign.create({
      data: {
        name: req.body.name,
        segment: req.body.segment,
        subject: req.body.subject,
        emailTitle: req.body.emailTitle,
        emailBody: req.body.emailBody,
        buttonText: req.body.buttonText,
        buttonLink: req.body.buttonLink,
        bannerImage: req.body.bannerImage,
        status: "DRAFT",
      },
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to save campaign" });
  }
});

router.put("/:id", requireAuth, requireRole(...MARKETING_ROLES), async (req, res) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: Number(req.params.id) },
      data: {
        name: req.body.name,
        segment: req.body.segment,
        subject: req.body.subject,
        emailTitle: req.body.emailTitle,
        emailBody: req.body.emailBody,
        buttonText: req.body.buttonText,
        buttonLink: req.body.buttonLink,
        bannerImage: req.body.bannerImage,
      },
    });

    res.json(campaign);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to update campaign" });
  }
});

router.delete("/:id", requireAuth, requireRole(...MARKETING_ROLES), async (req, res) => {
  try {
    await prisma.campaign.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to delete campaign" });
  }
});

export default router;
