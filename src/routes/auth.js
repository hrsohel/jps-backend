import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import { sendEmail } from "../utils/sendEmail.js";
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

    await sendEmail({
      to: user.email,
      subject: "Welcome to JPS Support Services Portal",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0749B3">Welcome to JPS Support Services!</h2>
          <p>Hello ${user.fullName},</p>
          <p>Your account has been created successfully. You can now log in to the JPS Client Portal to submit service requests, track projects, and manage invoices.</p>
          <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}" style="display:inline-block;background:#0E9F6E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">Go to Portal</a>
          <p style="color:#64748b;margin-top:24px">JPS Support Services<br/>Your Digital Business Partner</p>
        </div>
      `,
    }).catch(() => {});

    res.status(201).json({ message: "User registered successfully", user });
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
      subject: "JPS Portal - Password Reset Request",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0749B3">Password Reset Request</h2>
          <p>Hello ${user.fullName},</p>
          <p>We received a request to reset your password. Click the button below to create a new password. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">Reset Password</a>
          <p style="color:#64748b;margin-top:24px">If you did not request this, you can safely ignore this email. Your password will not be changed.</p>
          <p style="color:#64748b">JPS Support Services</p>
        </div>
      `,
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
