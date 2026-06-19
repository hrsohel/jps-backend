import express from "express";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";

function projectEmail(project, subject, bodyHtml) {
  return sendEmail({
    to: project.clientEmail,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
        <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
        ${bodyHtml}
        <div style="margin-top:24px">
          <a href="${PORTAL_URL}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">View in Portal</a>
        </div>
        <p style="color:#64748b;margin-top:24px">JPS Support Services &mdash; Your Digital Business Partner</p>
      </div>
    `,
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
      `New Project Created: ${project.title}`,
      `<h2 style="color:#0749B3">New Project Created</h2>
       <p>Hello ${project.clientName},</p>
       <p>A new project has been created for you:</p>
       <table style="width:100%;border-collapse:collapse">
         <tr><td style="padding:8px;color:#64748b">Project</td><td style="padding:8px"><strong>${project.title}</strong></td></tr>
         <tr><td style="padding:8px;color:#64748b">Service</td><td style="padding:8px">${project.serviceGroup}</td></tr>
         <tr><td style="padding:8px;color:#64748b">Status</td><td style="padding:8px">${project.status}</td></tr>
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
