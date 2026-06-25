import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import { sendEmail } from "../utils/sendEmail.js";
import { emailWrap, PORTAL_URL } from "../utils/emailLayout.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const registerSchema = z.object({
  businessName: z.string().optional(),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

router.post("/register", async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        businessName: data.businessName,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        password: hashedPassword,
      },
      select: {
        id: true,
        businessName: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "jps-portal-secret-change-in-production",
      { expiresIn: "7d" }
    );

    // Notify all admin users about the new account
    const adminUsers = await prisma.user.findMany({ where: { role: "ADMIN" } });
    await Promise.all(
      adminUsers.map((admin) =>
        prisma.notification.create({
          data: {
            userId: admin.id,
            title: "New Account Created",
            message: `${user.fullName} (${user.email}) just created a new client account.`,
            type: "USER",
          },
        }).catch(() => {})
      )
    );

    await sendEmail({
      to: user.email,
      subject: "Welcome to JPS Core!",
      html: emailWrap(`
        <h2 style="color:#0749B3;margin:0 0 6px">Welcome to JPS Core!</h2>
        <p style="color:#475569">Hello ${user.fullName},</p>
        <p style="color:#475569">Thank you for choosing us as your business growth partner. We are excited to support your organization with the tools, expertise, and solutions needed to strengthen your brand and grow your business.</p>

        <p style="font-weight:700;color:#0f172a;margin:20px 0 10px">At JPS Core, you can rely on us for:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr style="background:#f8fafc"><td style="padding:10px 12px;width:36%;color:#0749B3;font-weight:700;font-size:13px;vertical-align:top">Website Development &amp; Web Applications</td><td style="padding:10px 12px;color:#475569;font-size:13px">Professional websites and business applications designed to engage customers and support your operations.</td></tr>
          <tr><td style="padding:10px 12px;color:#0749B3;font-weight:700;font-size:13px;vertical-align:top">Digital Marketing</td><td style="padding:10px 12px;color:#475569;font-size:13px">Strategies that increase visibility, generate leads, and help you connect with the right audience.</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;color:#0749B3;font-weight:700;font-size:13px;vertical-align:top">Print Marketing &amp; Branding</td><td style="padding:10px 12px;color:#475569;font-size:13px">Business cards, brochures, flyers, signs, banners, apparel branding, and other marketing assets that promote your business professionally.</td></tr>
          <tr><td style="padding:10px 12px;color:#0749B3;font-weight:700;font-size:13px;vertical-align:top">IT Solutions</td><td style="padding:10px 12px;color:#475569;font-size:13px">Reliable technology support, website maintenance, hosting, cybersecurity, and business technology solutions.</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;color:#0749B3;font-weight:700;font-size:13px;vertical-align:top">Ongoing Business Support</td><td style="padding:10px 12px;color:#475569;font-size:13px">Responsive assistance from experienced professionals committed to helping your business succeed.</td></tr>
        </table>

        <p style="font-weight:700;color:#0f172a;margin:20px 0 8px">Getting the Best Results</p>
        <p style="color:#475569;margin-bottom:8px">To maximize the value of our partnership, we encourage you to:</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:5px 0;color:#475569;font-size:13px">&#10003;&nbsp; Share your business goals and objectives clearly.</td></tr>
          <tr><td style="padding:5px 0;color:#475569;font-size:13px">&#10003;&nbsp; Provide timely feedback on designs, content, and campaigns.</td></tr>
          <tr><td style="padding:5px 0;color:#475569;font-size:13px">&#10003;&nbsp; Keep your website and marketing information current.</td></tr>
          <tr><td style="padding:5px 0;color:#475569;font-size:13px">&#10003;&nbsp; Take advantage of our recommendations and growth strategies.</td></tr>
          <tr><td style="padding:5px 0;color:#475569;font-size:13px">&#10003;&nbsp; Stay engaged through our client portal and communication channels.</td></tr>
        </table>

        <p style="color:#475569;margin-top:16px;font-size:13px">We view every project as a partnership. The more we understand your business, the more effectively we can help you build your brand, attract customers, and achieve sustainable growth.</p>
        <p style="color:#475569;font-size:13px">If you have questions or would like to discuss your next project, our team is ready to assist.</p>
        <p style="color:#475569;font-size:13px">Thank you for choosing JPS Core.</p>
      `),
    }).catch(() => {});

    res.status(201).json({ message: "User registered successfully", token, user });
  } catch (error) {
    res.status(400).json({ error: "Registration failed", details: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.status === "DISABLED") {
      return res.status(403).json({ error: "Your account has been disabled. Please contact support." });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "jps-portal-secret-change-in-production",
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        businessName: user.businessName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
});

router.patch("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to change password" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If that email is registered, a reset link has been sent." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}?page=reset-password&token=${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: "JPS Core — Password Reset Request",
      html: emailWrap(`
        <h2 style="color:#0749B3;margin:0 0 8px">Password Reset Request</h2>
        <p style="color:#475569">Hello ${user.fullName},</p>
        <p style="color:#475569">We received a request to reset your password. Click the button below to create a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#0749B3;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;margin:16px 0;font-weight:700">Reset Password</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:16px">If you did not request this, you can safely ignore this email. Your password will not be changed.</p>
      `),
    });

    res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to process request" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to reset password" });
  }
});

export default router;
