import express from "express";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();
const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// GET unread message count for the current user
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    let count;
    if (isStaff) {
      // Staff sees messages sent by clients that they haven't read
      count = await prisma.projectMessage.count({
        where: { senderRole: "CLIENT", isReadByStaff: false },
      });
    } else {
      // Client sees messages from staff on their projects
      const projects = await prisma.project.findMany({
        where: { clientUserId: userId },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      count = await prisma.projectMessage.count({
        where: {
          projectId: { in: projectIds },
          senderRole: "STAFF",
          isReadByClient: false,
        },
      });
    }

    res.json({ count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to get unread count" });
  }
});

// GET full conversation audit log across all projects (staff/admin only)
router.get("/log/all", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const messages = await prisma.projectMessage.findMany({
      orderBy: { createdAt: "desc" },
    });

    const projectIds = [...new Set(messages.map((m) => m.projectId))];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, title: true, clientName: true, clientEmail: true },
    });
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

    const enriched = messages.map((m) => ({
      ...m,
      projectTitle: byId[m.projectId]?.title || `Project #${m.projectId}`,
      clientName: byId[m.projectId]?.clientName || null,
      clientEmail: byId[m.projectId]?.clientEmail || null,
    }));

    res.json(enriched);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load conversation log" });
  }
});

// GET messages for a project — marks them as read for the current user
router.get("/:projectId", requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    const isStaff = STAFF_ROLES.includes(role);
    const projectId = Number(req.params.projectId);

    const messages = await prisma.projectMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });

    // Mark opposite-side messages as read
    if (isStaff) {
      await prisma.projectMessage.updateMany({
        where: { projectId, senderRole: "CLIENT", isReadByStaff: false },
        data: { isReadByStaff: true },
      });
    } else {
      await prisma.projectMessage.updateMany({
        where: { projectId, senderRole: "STAFF", isReadByClient: false },
        data: { isReadByClient: true },
      });
    }

    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load messages" });
  }
});

// POST send a message
router.post("/", requireAuth, async (req, res) => {
  try {
    const { role } = req.user;
    const isStaff = STAFF_ROLES.includes(role);
    const senderRole = isStaff ? "STAFF" : "CLIENT";

    const message = await prisma.projectMessage.create({
      data: {
        projectId: Number(req.body.projectId),
        sender: req.body.sender,
        senderRole,
        message: req.body.message,
        // Sender's own side is already "read"; other side starts unread
        isReadByStaff: !isStaff ? false : true,
        isReadByClient: isStaff ? false : true,
      },
    });

    const project = await prisma.project.findUnique({
      where: { id: Number(req.body.projectId) },
    });

    if (project) {
      if (isStaff) {
        sendEmail({
          to: project.clientEmail,
          subject: `New Message on Project: ${project.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
              <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
              <h2 style="color:#0749B3">New Message on Your Project</h2>
              <p>Hello ${project.clientName},</p>
              <p>The JPS team sent a new message on <strong>${project.title}</strong>.</p>
              <div style="background:#f8fafc;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #22A9E0">
                <p style="margin:0">${req.body.message}</p>
              </div>
              <a href="${PORTAL_URL}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Reply in Portal</a>
            </div>
          `,
        }).catch(() => {});

        if (project.clientUserId) {
          await prisma.notification.create({
            data: {
              userId: project.clientUserId,
              title: "New Project Message",
              message: `New message on project "${project.title}"`,
              type: "MESSAGE",
            },
          }).catch(() => {});
        }
      }
    }

    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to send message" });
  }
});

export default router;
