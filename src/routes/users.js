import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const createUserSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  businessName: z.string().optional(),
  role: z.string().optional(),
  segment: z.string().optional(),
  status: z.string().optional(),
});

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

// Admin creates a user account
router.post("/", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const data = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        password: hashedPassword,
        phone: data.phone || null,
        businessName: data.businessName || null,
        role: data.role || "CLIENT",
        segment: data.segment || "General",
        status: data.status || "ACTIVE",
      },
      select: PROFILE_SELECT,
    });

    sendEmail({
      to: user.email,
      subject: "Your JPS Support Services Portal Account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0749B3">Welcome to JPS Support Services!</h2>
          <p>Hello ${user.fullName},</p>
          <p>An account has been created for you on the JPS Client Portal. You can sign in using your email and the temporary password provided by our team.</p>
          <a href="${PORTAL_URL}" style="display:inline-block;background:#0E9F6E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">Go to Portal</a>
          <p style="color:#64748b;margin-top:24px">JPS Support Services &mdash; Your Digital Business Partner</p>
        </div>
      `,
    }).catch(() => {});

    res.status(201).json(user);
  } catch (error) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid user details", details: error.errors });
    }
    console.error(error);
    res.status(400).json({ error: "Unable to create user" });
  }
});

// Recipients list for marketing (active users) — used by campaign composer
router.get("/recipients", requireAuth, requireRole(...ADMIN_ROLES, "MARKETING"), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, fullName: true, email: true, segment: true, role: true },
      orderBy: { fullName: "asc" },
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load recipients" });
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
