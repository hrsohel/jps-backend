import express from "express";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";
import { computeInvoiceAmounts, ensureGuestToken, generateGuestToken, invoiceEmailHtml } from "../lib/invoiceHelpers.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { role, email } = req.user;
    const isStaff = STAFF_ROLES.includes(role);

    const where = isStaff ? {} : { clientEmail: email };

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(invoices);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load invoices" });
  }
});

router.post("/", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const amounts = computeInvoiceAmounts(req.body);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${Date.now()}`,
        projectId: req.body.projectId ? Number(req.body.projectId) : null,
        clientName: req.body.clientName,
        clientEmail: req.body.clientEmail,
        serviceDescription: req.body.serviceDescription,
        ...amounts,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        notes: req.body.notes || null,
        status: "DRAFT",
        guestToken: generateGuestToken(),
      },
    });

    // Notify client
    const clientUser = await prisma.user.findUnique({ where: { email: invoice.clientEmail } });
    if (clientUser) {
      await prisma.notification.create({
        data: {
          userId: clientUser.id,
          title: "New Invoice",
          message: `Invoice ${invoice.invoiceNumber} for $${invoice.totalAmount.toFixed(2)} has been generated.`,
          type: "INVOICE",
        },
      }).catch(() => {});
    }

    // Email is NOT sent on draft creation — admin must click "Email Invoice" explicitly
    res.status(201).json(invoice);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Unable to create invoice" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Clients can only access their own invoices
    if (!STAFF_ROLES.includes(req.user.role) && invoice.clientEmail !== req.user.email) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: "Unable to load invoice" });
  }
});

router.patch("/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Invoice not found" });

    const amounts = computeInvoiceAmounts(req.body, existing);

    let invoice = await prisma.invoice.update({
      where: { id: Number(req.params.id) },
      data: {
        ...amounts,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        notes: req.body.notes !== undefined ? req.body.notes : undefined,
        status: existing.status === "DRAFT" ? "SENT" : existing.status,
      },
    });
    invoice = await ensureGuestToken(prisma, invoice);

    // Notify client that invoice has been updated/sent
    const clientUser = await prisma.user.findUnique({ where: { email: invoice.clientEmail } });
    if (clientUser) {
      prisma.notification.create({
        data: {
          userId: clientUser.id,
          title: "Invoice Updated",
          message: `Invoice ${invoice.invoiceNumber} for $${invoice.totalAmount.toFixed(2)} has been updated. Please review.`,
          type: "INVOICE",
        },
      }).catch(() => {});
    }

    sendEmail({
      to: invoice.clientEmail,
      subject: `Invoice ${invoice.invoiceNumber} — JPS Core`,
      html: invoiceEmailHtml(invoice),
    }).catch(() => {});

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: "Unable to update invoice" });
  }
});

router.patch("/:id/sent", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: Number(req.params.id) },
      data: { status: "SENT" },
    });

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: "Unable to update invoice" });
  }
});

router.patch("/:id/paid", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Invoice not found" });

    const invoice = await prisma.invoice.update({
      where: { id: Number(req.params.id) },
      data: { status: "PAID", amountPaid: existing.totalAmount, paidAt: existing.paidAt || new Date() },
    });

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: "Unable to update invoice" });
  }
});

router.delete("/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Unable to delete invoice" });
  }
});

router.post("/:id/email", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    let invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    invoice = await ensureGuestToken(prisma, invoice);

    await sendEmail({
      to: invoice.clientEmail,
      subject: `Invoice ${invoice.invoiceNumber} — JPS Core`,
      html: invoiceEmailHtml(invoice),
    });

    res.json({ success: true, message: "Invoice emailed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to send invoice email" });
  }
});

// Guest Checkout — lets an unregistered client open an invoice via the tokenized
// link from their invoice email, no login required.
router.get("/guest/:id", async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });

    if (!invoice || !invoice.guestToken || invoice.guestToken !== req.query.token) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(invoice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load invoice" });
  }
});

export default router;
