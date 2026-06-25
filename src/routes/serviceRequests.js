import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailWrap, PORTAL_URL } from "../utils/emailLayout.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

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

    // Notify all admins about the new service request
    const adminUsers = await prisma.user.findMany({ where: { role: "ADMIN" } });
    await Promise.all(
      adminUsers.map((admin) =>
        prisma.notification.create({
          data: {
            userId: admin.id,
            title: "New Service Request",
            message: `${request.contactName} submitted a "${request.serviceGroup}" request — "${request.projectTitle}".`,
            type: "REQUEST",
          },
        }).catch(() => {})
      )
    );

    sendEmail({
      to: request.email,
      subject: "Service Request Received — JPS Core",
      html: emailWrap(`
        <h2 style="color:#0749B3;margin:0 0 8px">Service Request Received</h2>
        <p style="color:#475569">Hello ${request.contactName},</p>
        <p style="color:#475569">We have received your service request and our team will review it shortly.</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Service</td><td style="padding:10px;font-weight:700">${request.serviceGroup}</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-size:13px">Project</td><td style="padding:10px">${request.projectTitle}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Status</td><td style="padding:10px"><span style="background:#fffbeb;color:#d97706;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700">Under Review</span></td></tr>
        </table>
        <p style="color:#475569;font-size:13px">Our team will contact you within 24 hours to discuss your project.</p>
      `),
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
      subject: "Service Request Approved — JPS Core",
      html: emailWrap(`
        <h2 style="color:#0E9F6E;margin:0 0 8px">Service Request Approved!</h2>
        <p style="color:#475569">Hello ${request.contactName},</p>
        <p style="color:#475569">Great news! Your service request has been approved. Our team will be in touch shortly to get started.</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Service</td><td style="padding:10px;font-weight:700">${request.serviceGroup}</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-size:13px">Project</td><td style="padding:10px">${request.projectTitle}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Status</td><td style="padding:10px"><span style="background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700">Approved</span></td></tr>
        </table>
      `),
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
      subject: "Service Request Update — JPS Core",
      html: emailWrap(`
        <h2 style="color:#0749B3;margin:0 0 8px">Service Request Update</h2>
        <p style="color:#475569">Hello ${request.contactName},</p>
        <p style="color:#475569">After reviewing your service request, we are unable to proceed at this time. Please contact our team if you have questions or would like to discuss alternatives.</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Service</td><td style="padding:10px;font-weight:700">${request.serviceGroup}</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-size:13px">Project</td><td style="padding:10px">${request.projectTitle}</td></tr>
        </table>
      `),
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
