import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

const BANNER_ID = 1;

const DEFAULT_BANNER = {
  title: "Everything Your Business Needs to Grow",
  subtitle: "Professional solutions for websites, marketing, branding, and IT — all in one place.",
  imageUrl: null,
  cta1Text: "Request Service",
  cta1Page: "Request Service",
  cta2Text: "Explore Services",
  cta2Page: "Services",
  isActive: true,
};

// Public — any authenticated user can fetch the banner
router.get("/", async (req, res) => {
  try {
    let banner = await prisma.siteBanner.findUnique({ where: { id: BANNER_ID } });
    if (!banner) {
      banner = await prisma.siteBanner.create({ data: { id: BANNER_ID, ...DEFAULT_BANNER } });
    }
    res.json(banner);
  } catch (error) {
    console.error(error);
    res.json({ ...DEFAULT_BANNER, id: BANNER_ID });
  }
});

// Admin only — update banner
router.put("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { title, subtitle, imageUrl, cta1Text, cta1Page, cta2Text, cta2Page, isActive } = req.body;

    const banner = await prisma.siteBanner.upsert({
      where: { id: BANNER_ID },
      update: {
        title: title || DEFAULT_BANNER.title,
        subtitle: subtitle ?? null,
        imageUrl: imageUrl || null,
        cta1Text: cta1Text || null,
        cta1Page: cta1Page || null,
        cta2Text: cta2Text || null,
        cta2Page: cta2Page || null,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      create: {
        id: BANNER_ID,
        title: title || DEFAULT_BANNER.title,
        subtitle: subtitle ?? DEFAULT_BANNER.subtitle,
        imageUrl: imageUrl || null,
        cta1Text: cta1Text || DEFAULT_BANNER.cta1Text,
        cta1Page: cta1Page || DEFAULT_BANNER.cta1Page,
        cta2Text: cta2Text || DEFAULT_BANNER.cta2Text,
        cta2Page: cta2Page || DEFAULT_BANNER.cta2Page,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
    });

    res.json(banner);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to update banner" });
  }
});

export default router;
