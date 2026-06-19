import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role, userId, email } = req.user;
    const isAdmin = role === "ADMIN" || role === "STAFF";

    if (isAdmin) {
      const [projects, requests, invoices, notifications] = await Promise.all([
        prisma.project.count(),
        prisma.serviceRequest.count(),
        prisma.invoice.count(),
        prisma.notification.count({ where: { isRead: false } }),
      ]);

      const revenue = await prisma.invoice.aggregate({ _sum: { totalAmount: true } });

      return res.json({
        projects,
        requests,
        invoices,
        notifications,
        revenue: revenue._sum.totalAmount || 0,
      });
    }

    // Client-specific dashboard data
    const [projects, requests, invoices, notifications] = await Promise.all([
      prisma.project.count({ where: { clientUserId: userId } }),
      prisma.serviceRequest.count({ where: { email } }),
      prisma.invoice.count({ where: { clientEmail: email } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    const revenue = await prisma.invoice.aggregate({
      where: { clientEmail: email },
      _sum: { totalAmount: true },
    });

    res.json({
      projects,
      requests,
      invoices,
      notifications,
      revenue: revenue._sum.totalAmount || 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load dashboard statistics" });
  }
});

export default router;
