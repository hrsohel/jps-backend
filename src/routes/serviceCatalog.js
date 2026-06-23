import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

// Public - used on dashboard and services page
router.get("/groups", async (req, res) => {
  try {
    const groups = await prisma.serviceGroup.findMany({
      where: { isActive: true },
      include: {
        services: {
          where: { isActive: true, featured: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    res.json(groups);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load service groups" });
  }
});

// Public - used on services page
router.get("/services", async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      include: { serviceGroup: true },
      orderBy: { displayOrder: "asc" },
    });

    res.json(services);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load services" });
  }
});

// Admin only - create/manage
router.post("/groups", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const group = await prisma.serviceGroup.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        imageUrl: req.body.imageUrl,
        displayOrder: Number(req.body.displayOrder || 0),
        isActive: req.body.isActive ?? true,
        featured: req.body.featured ?? false,
      },
    });

    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to create service group" });
  }
});

router.put("/groups/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const group = await prisma.serviceGroup.update({
      where: { id: Number(req.params.id) },
      data: {
        name: req.body.name,
        description: req.body.description,
        imageUrl: req.body.imageUrl,
        displayOrder: Number(req.body.displayOrder || 0),
        isActive: req.body.isActive ?? true,
        featured: req.body.featured ?? false,
      },
    });

    res.json(group);
  } catch (error) {
    res.status(400).json({ error: "Unable to update service group" });
  }
});

router.delete("/groups/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    await prisma.serviceGroup.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: "Unable to delete service group" });
  }
});

router.post("/services", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const service = await prisma.service.create({
      data: {
        serviceGroupId: Number(req.body.serviceGroupId),
        title: req.body.title,
        description: req.body.description,
        startingPrice: Number(req.body.startingPrice || 0),
        featured: req.body.featured ?? false,
        displayOrder: Number(req.body.displayOrder || 0),
        isActive: req.body.isActive ?? true,
        imageUrl: req.body.imageUrl,
      },
    });

    res.status(201).json(service);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to create service" });
  }
});

router.put("/services/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const service = await prisma.service.update({
      where: { id: Number(req.params.id) },
      data: {
        title: req.body.title,
        description: req.body.description,
        startingPrice: Number(req.body.startingPrice || 0),
        featured: req.body.featured ?? false,
        isActive: req.body.isActive ?? true,
        imageUrl: req.body.imageUrl,
      },
    });

    res.json(service);
  } catch (error) {
    res.status(400).json({ error: "Unable to update service" });
  }
});

router.delete("/services/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    await prisma.service.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: "Unable to delete service" });
  }
});

export default router;
