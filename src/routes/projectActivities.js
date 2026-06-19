import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/:projectId", requireAuth, async (req, res) => {
  try {
    const activities = await prisma.projectActivity.findMany({
      where: { projectId: Number(req.params.projectId) },
      orderBy: { createdAt: "desc" },
    });

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: "Unable to load activities" });
  }
});

export default router;
