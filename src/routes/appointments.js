import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

// GET all appointments visible to the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    const { userId, role, email } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    let appointments;
    if (isStaff) {
      appointments = await prisma.appointment.findMany({
        orderBy: { createdAt: "desc" },
      });
    } else {
      // Client sees appointments they created OR appointments admin sent to them
      appointments = await prisma.appointment.findMany({
        where: {
          OR: [
            { createdByUserId: userId },
            { targetUserId: userId },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
    }

    res.json(appointments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load appointments" });
  }
});

// POST create appointment
router.post("/", requireAuth, async (req, res) => {
  try {
    const { userId, role, email } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    const { title, serviceType, date, timeSlot, notes, targetUserId, targetName, targetEmail } = req.body;

    if (!title || !serviceType || !date || !timeSlot) {
      return res.status(400).json({ error: "title, serviceType, date, and timeSlot are required" });
    }

    // Get creator's name from DB
    const creator = await prisma.user.findUnique({ where: { id: userId } });

    const appointment = await prisma.appointment.create({
      data: {
        title,
        serviceType,
        date,
        timeSlot,
        notes: notes || null,
        status: "PENDING",
        createdByUserId: userId,
        createdByName: creator?.fullName || "Unknown",
        createdByEmail: email,
        createdByRole: role,
        targetUserId: targetUserId ? Number(targetUserId) : null,
        targetName: targetName || null,
        targetEmail: targetEmail || null,
      },
    });

    // Notify the other party
    if (isStaff && targetUserId) {
      await prisma.notification.create({
        data: {
          userId: Number(targetUserId),
          title: "New Appointment Scheduled",
          message: `${creator?.fullName || "Admin"} has scheduled an appointment: "${title}" on ${date} (${timeSlot}). Please approve or decline.`,
          type: "APPOINTMENT",
        },
      });
    } else if (!isStaff) {
      // Notify all admins/staff
      const admins = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "STAFF"] } },
      });
      await Promise.all(
        admins.map((admin) =>
          prisma.notification.create({
            data: {
              userId: admin.id,
              title: "Appointment Request",
              message: `${creator?.fullName || "A client"} has requested an appointment: "${title}" on ${date} (${timeSlot}).`,
              type: "APPOINTMENT",
            },
          })
        )
      );
    }

    res.status(201).json(appointment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to create appointment" });
  }
});

// PATCH approve
router.patch("/:id/approve", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const appt = await prisma.appointment.findUnique({ where: { id: Number(req.params.id) } });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    const isStaff = STAFF_ROLES.includes(role);
    const isTarget = appt.targetUserId === userId;

    // Staff can approve client requests; clients can approve admin-sent appointments
    if (!isStaff && !isTarget) {
      return res.status(403).json({ error: "Not authorized to approve this appointment" });
    }

    const updated = await prisma.appointment.update({
      where: { id: Number(req.params.id) },
      data: { status: "APPROVED" },
    });

    // Notify the creator
    await prisma.notification.create({
      data: {
        userId: appt.createdByUserId,
        title: "Appointment Approved",
        message: `Your appointment "${appt.title}" on ${appt.date} has been approved.`,
        type: "APPOINTMENT",
      },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to approve appointment" });
  }
});

// PATCH reject
router.patch("/:id/reject", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const appt = await prisma.appointment.findUnique({ where: { id: Number(req.params.id) } });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    const isStaff = STAFF_ROLES.includes(role);
    const isTarget = appt.targetUserId === userId;

    if (!isStaff && !isTarget) {
      return res.status(403).json({ error: "Not authorized to reject this appointment" });
    }

    const updated = await prisma.appointment.update({
      where: { id: Number(req.params.id) },
      data: { status: "REJECTED" },
    });

    await prisma.notification.create({
      data: {
        userId: appt.createdByUserId,
        title: "Appointment Declined",
        message: `Your appointment "${appt.title}" on ${appt.date} has been declined.`,
        type: "APPOINTMENT",
      },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to reject appointment" });
  }
});

// PATCH cancel (creator can cancel)
router.patch("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { userId } = req.user;
    const appt = await prisma.appointment.findUnique({ where: { id: Number(req.params.id) } });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (appt.createdByUserId !== userId) {
      return res.status(403).json({ error: "Only the creator can cancel this appointment" });
    }

    const updated = await prisma.appointment.update({
      where: { id: Number(req.params.id) },
      data: { status: "CANCELLED" },
    });

    if (appt.targetUserId) {
      await prisma.notification.create({
        data: {
          userId: appt.targetUserId,
          title: "Appointment Cancelled",
          message: `The appointment "${appt.title}" on ${appt.date} has been cancelled.`,
          type: "APPOINTMENT",
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to cancel appointment" });
  }
});

export default router;
