import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const serviceRequestSchema = z.object({
  serviceGroup: z.string().min(2),
  projectTitle: z.string().min(2),
  businessName: z.string().min(2),
  contactName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  budgetRange: z.string().optional(),
  desiredDate: z.string().optional(),
  description: z.string().optional(),
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const data = serviceRequestSchema.parse(req.body);

    const request = await prisma.serviceRequest.create({ data });

    sendEmail({
      to: request.email,
      subject: "Service Request Received - JPS Support Services",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0749B3">Service Request Received</h2>
          <p>Hello ${request.contactName},</p>
          <p>We have received your service request and our team will review it shortly.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#64748b">Service</td><td style="padding:8px"><strong>${request.serviceGroup}</strong></td></tr>
            <tr><td style="padding:8px;color:#64748b">Project</td><td style="padding:8px">${request.projectTitle}</td></tr>
            <tr><td style="padding:8px;color:#64748b">Status</td><td style="padding:8px">Under Review</td></tr>
          </table>
          <a href="${PORTAL_URL}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">View in Portal</a>
          <p style="color:#64748b;margin-top:24px">JPS Support Services &mdash; Your Digital Business Partner</p>
        </div>
      `,
    }).catch(() => {});

    res.status(201).json({ message: "Service request submitted successfully", request });
  } catch (error) {
    res.status(400).json({ error: "Service request failed", details: error.message });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    const where = isStaff ? {} : { email: req.user.email };

    const requests = await prisma.serviceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "Unable to load requests" });
  }
});

router.patch("/:id/approve", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const request = await prisma.serviceRequest.update({
      where: { id: Number(req.params.id) },
      data: { status: "Approved" },
    });

    sendEmail({
      to: request.email,
      subject: "Service Request Approved - JPS Support Services",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0E9F6E">Service Request Approved!</h2>
          <p>Hello ${request.contactName},</p>
          <p>Great news! Your service request has been approved. Our team will be in touch shortly to get started.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#64748b">Service</td><td style="padding:8px"><strong>${request.serviceGroup}</strong></td></tr>
            <tr><td style="padding:8px;color:#64748b">Project</td><td style="padding:8px">${request.projectTitle}</td></tr>
          </table>
          <a href="${PORTAL_URL}" style="display:inline-block;background:#0E9F6E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">View in Portal</a>
          <p style="color:#64748b;margin-top:24px">JPS Support Services</p>
        </div>
      `,
    }).catch(() => {});

    res.json(request);
  } catch (error) {
    res.status(400).json({ error: "Unable to approve request" });
  }
});

router.patch("/:id/reject", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const request = await prisma.serviceRequest.update({
      where: { id: Number(req.params.id) },
      data: { status: "Rejected" },
    });

    sendEmail({
      to: request.email,
      subject: "Service Request Update - JPS Support Services",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
          <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
          <h2 style="color:#0749B3">Service Request Update</h2>
          <p>Hello ${request.contactName},</p>
          <p>After reviewing your service request, we are unable to proceed at this time. Please contact our team if you have questions or would like to discuss alternatives.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#64748b">Service</td><td style="padding:8px"><strong>${request.serviceGroup}</strong></td></tr>
            <tr><td style="padding:8px;color:#64748b">Project</td><td style="padding:8px">${request.projectTitle}</td></tr>
          </table>
          <a href="${PORTAL_URL}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">View in Portal</a>
          <p style="color:#64748b;margin-top:24px">JPS Support Services</p>
        </div>
      `,
    }).catch(() => {});

    res.json(request);
  } catch (error) {
    res.status(400).json({ error: "Unable to reject request" });
  }
});

router.post("/:id/create-project", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const requestId = Number(req.params.id);

    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId } });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const existingProject = await prisma.project.findFirst({ where: { sourceRequestId: requestId } });

    if (existingProject) {
      return res.status(400).json({ error: "Project already exists for this request", project: existingProject });
    }

    // Find the user linked to this email
    const clientUser = await prisma.user.findUnique({ where: { email: request.email } });

    const project = await prisma.project.create({
      data: {
        title: request.projectTitle,
        serviceGroup: request.serviceGroup,
        clientName: request.contactName,
        clientEmail: request.email,
        clientUserId: clientUser?.id || null,
        description: request.description,
        status: "IN_PROGRESS",
        progress: 0,
        sourceRequestId: requestId,
      },
    });

    await prisma.projectActivity.create({
      data: {
        projectId: project.id,
        action: "Project Created",
        details: `Created from service request #${requestId}`,
      },
    });

    if (clientUser) {
      await prisma.notification.create({
        data: {
          userId: clientUser.id,
          title: "New Project Created",
          message: `Your project "${project.title}" has been created and is now in progress.`,
          type: "PROJECT",
        },
      }).catch(() => {});
    }

    res.status(201).json(project);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to create project" });
  }
});

export default router;
