import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
    });

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Unable to load notifications" });
  }
});

router.get("/:userId", requireAuth, async (req, res) => {
  try {
    const targetId = Number(req.params.userId);

    // Users can only fetch their own notifications
    if (req.user.role !== "ADMIN" && req.user.userId !== targetId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId: targetId },
      orderBy: { createdAt: "desc" },
    });

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Unable to load notifications" });
  }
});

router.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: Number(req.params.id) },
    });

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    if (req.user.role !== "ADMIN" && notification.userId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updated = await prisma.notification.update({
      where: { id: Number(req.params.id) },
      data: { isRead: true },
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: "Unable to update notification" });
  }
});

router.patch("/read-all", requireAuth, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: "Unable to mark notifications as read" });
  }
});

export default router;
