import express from "express";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailWrap, PORTAL_URL } from "../utils/emailLayout.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

function projectEmail(project, subject, bodyHtml) {
  return sendEmail({
    to: project.clientEmail,
    subject,
    html: emailWrap(bodyHtml),
  });
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    const where = isStaff ? {} : { clientUserId: userId };

    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load projects" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.id) },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Clients can only access their own projects
    if (!STAFF_ROLES.includes(req.user.role) && project.clientUserId !== req.user.userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load project" });
  }
});

router.post("/", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const project = await prisma.project.create({
      data: {
        title: req.body.title,
        serviceGroup: req.body.serviceGroup,
        clientName: req.body.clientName,
        clientEmail: req.body.clientEmail,
        clientUserId: req.body.clientUserId ? Number(req.body.clientUserId) : null,
        description: req.body.description,
        status: req.body.status || "IN_PROGRESS",
        progress: Number(req.body.progress || 0),
        sourceRequestId: req.body.sourceRequestId || null,
      },
    });

    await prisma.projectActivity.create({
      data: {
        projectId: project.id,
        action: "Project Created",
        details: `Project "${project.title}" was created.`,
      },
    });

    projectEmail(
      project,
      `New Project Created: ${project.title} — JPS Core`,
      `<h2 style="color:#0749B3;margin:0 0 8px">New Project Created</h2>
       <p style="color:#475569">Hello ${project.clientName},</p>
       <p style="color:#475569">A new project has been created for you. You can track progress, upload files, and communicate with our team through the portal.</p>
       <table style="width:100%;border-collapse:collapse;margin:12px 0">
         <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Project</td><td style="padding:10px;font-weight:700">${project.title}</td></tr>
         <tr><td style="padding:10px;color:#64748b;font-size:13px">Service</td><td style="padding:10px">${project.serviceGroup}</td></tr>
         <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Status</td><td style="padding:10px"><span style="background:#fefce8;color:#a16207;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700">In Progress</span></td></tr>
       </table>`
    ).catch(() => {});

    res.status(201).json(project);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to create project", details: error.message });
  }
});

router.patch("/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const project = await prisma.project.update({
      where: { id: Number(req.params.id) },
      data: {
        status: req.body.status,
        progress: Number(req.body.progress || 0),
      },
    });

    await prisma.projectActivity.create({
      data: {
        projectId: project.id,
        action: "Project Updated",
        details: `Status: ${project.status} | Progress: ${project.progress}%`,
      },
    });

    // Notify client if they have a linked user ID
    if (project.clientUserId) {
      await prisma.notification.create({
        data: {
          userId: project.clientUserId,
          title: "Project Updated",
          message: `${project.title} has been updated to ${project.status} (${project.progress}% complete).`,
          type: "PROJECT",
        },
      }).catch(() => {});
    }

    const isCompleted = project.status === "COMPLETED";

    projectEmail(
      project,
      isCompleted ? `Project Completed: ${project.title}` : `Project Update: ${project.title}`,
      isCompleted
        ? `<h2 style="color:#0E9F6E">Project Completed!</h2>
           <p>Hello ${project.clientName},</p>
           <p>Great news — your project <strong>${project.title}</strong> has been completed!</p>
           <p>Please log in to review the final deliverables and provide feedback.</p>`
        : `<h2 style="color:#0749B3">Project Update</h2>
           <p>Hello ${project.clientName},</p>
           <p>Your project <strong>${project.title}</strong> has been updated.</p>
           <table style="width:100%;border-collapse:collapse">
             <tr><td style="padding:8px;color:#64748b">Status</td><td style="padding:8px"><strong>${project.status}</strong></td></tr>
             <tr><td style="padding:8px;color:#64748b">Progress</td><td style="padding:8px"><strong>${project.progress}%</strong></td></tr>
           </table>`
    ).catch(() => {});

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to update project" });
  }
});

export default router;
