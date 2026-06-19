import express from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

const PROFILE_SELECT = {
  id: true, fullName: true, email: true, phone: true,
  businessName: true, businessIndustry: true, businessType: true, website: true,
  address: true, city: true, state: true, zipCode: true, country: true,
  preferredComm: true, preferredApptTime: true,
  billingContact: true, billingEmail: true, taxId: true,
  role: true, segment: true, status: true, createdAt: true,
};

// Get current user's own profile
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: PROFILE_SELECT,
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load profile" });
  }
});

// Update current user's own profile
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const allowed = [
      "fullName", "phone", "businessName", "businessIndustry", "businessType", "website",
      "address", "city", "state", "zipCode", "country",
      "preferredComm", "preferredApptTime",
      "billingContact", "billingEmail", "taxId",
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: PROFILE_SELECT,
    });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to update profile" });
  }
});

router.get("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        businessName: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        segment: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load users" });
  }
});

router.put("/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: {
        role: req.body.role,
        segment: req.body.segment,
        status: req.body.status,
      },
      select: {
        id: true,
        businessName: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        segment: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to update user" });
  }
});

router.patch("/:id/reset-password", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: { password: hashedPassword },
      select: { id: true, fullName: true, email: true, role: true },
    });

    res.json({ success: true, message: "Password reset successfully", user });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to reset password" });
  }
});

router.get("/segment/:segment", requireAuth, requireRole(...ADMIN_ROLES, "MARKETING"), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { segment: req.params.segment, status: "ACTIVE" },
      select: {
        id: true,
        businessName: true,
        fullName: true,
        email: true,
        segment: true,
        status: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load segment users" });
  }
});

export default router;
