import express from "express";
import nodemailer from "nodemailer";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2080),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * GET /api/email/test
 * Quick browser/curl test
 */
router.get("/test", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.TEST_EMAIL,
      subject: "JPS Portal Email Test",
      html: `
        <h2>JPS Portal Email Test</h2>
        <p>Your SMTP setup is working successfully.</p>
      `,
    });

    res.json({
      success: true,
      message: "Test email sent successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to send test email",
      details: error.message,
    });
  }
});

/**
 * POST /api/email/test
 * Custom email test
 */
router.post("/test", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: req.body.to || process.env.TEST_EMAIL,
      subject: req.body.subject || "JPS Portal Email Test",
      html:
        req.body.html ||
        "<h2>JPS Portal Email Test</h2><p>Your SMTP setup is working.</p>",
    });

    res.json({
      success: true,
      message: "Test email sent",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to send email",
      details: error.message,
    });
  }
});

/**
 * POST /api/email/send-segment
 * Send campaign email to a user segment
 */
router.post("/send-segment", requireAuth, requireRole("ADMIN", "MARKETING"), async (req, res) => {
  try {
    const { segment, subject, html } = req.body;

    if (!segment || !subject || !html) {
      return res.status(400).json({
        error: "segment, subject, and html are required",
      });
    }

    const users = await prisma.user.findMany({
      where: {
        segment,
        status: "ACTIVE",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (users.length === 0) {
      return res.status(400).json({
        error: "No active recipients found for this segment",
      });
    }

    let successCount = 0;
    let failedCount = 0;

    for (const user of users) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: user.email,
          subject,
          html,
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to send to ${user.email}`, error);
        failedCount++;
      }
    }

    await prisma.campaignLog.create({
      data: {
        campaignName: req.body.campaignName || subject,
        segment,
        recipients: users.length,
        successCount,
        failedCount,
        status: "SENT",
      },
    });

    res.json({
      success: true,
      recipients: users.length,
      successCount,
      failedCount,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to send campaign",
      details: error.message,
    });
  }
});

export default router;