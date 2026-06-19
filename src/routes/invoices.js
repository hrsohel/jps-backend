import express from "express";
import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { requireAuth, requireRole, ADMIN_ROLES, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";

function invoiceEmailHtml(invoice) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
      <img src="https://app.jpssupport.com/assets/jps-support-services-primary-logo.png" alt="JPS Support Services" style="height:50px;margin-bottom:20px" />
      <h2 style="color:#0749B3">Invoice ${invoice.invoiceNumber}</h2>
      <p>Hello ${invoice.clientName},</p>
      <p>Your invoice from JPS Support Services is ready.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b">Service</td><td style="padding:10px">${invoice.serviceDescription}</td></tr>
        <tr><td style="padding:10px;color:#64748b">Service Amount</td><td style="padding:10px">$${Number(invoice.serviceAmount).toFixed(2)}</td></tr>
        ${invoice.domainAmount ? `<tr style="background:#f8fafc"><td style="padding:10px;color:#64748b">Domain</td><td style="padding:10px">$${Number(invoice.domainAmount).toFixed(2)}</td></tr>` : ""}
        ${invoice.hostingAmount ? `<tr><td style="padding:10px;color:#64748b">Hosting</td><td style="padding:10px">$${Number(invoice.hostingAmount).toFixed(2)}</td></tr>` : ""}
        ${invoice.taxAmount ? `<tr style="background:#f8fafc"><td style="padding:10px;color:#64748b">Tax</td><td style="padding:10px">$${Number(invoice.taxAmount).toFixed(2)}</td></tr>` : ""}
        ${invoice.discountAmount ? `<tr><td style="padding:10px;color:#64748b">Discount</td><td style="padding:10px">-$${Number(invoice.discountAmount).toFixed(2)}</td></tr>` : ""}
        <tr style="border-top:2px solid #e5e7eb"><td style="padding:10px;font-weight:bold">Total</td><td style="padding:10px;font-weight:bold;font-size:18px">$${Number(invoice.totalAmount).toFixed(2)}</td></tr>
      </table>
      ${invoice.dueDate ? `<p style="color:#64748b">Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ""}
      ${invoice.notes ? `<p style="color:#64748b">Notes: ${invoice.notes}</p>` : ""}
      <a href="${PORTAL_URL}" style="display:inline-block;background:#0749B3;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">View Invoice in Portal</a>
      <p style="color:#64748b;margin-top:24px">JPS Support Services &mdash; Your Digital Business Partner</p>
    </div>
  `;
}

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
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${Date.now()}`,
        projectId: req.body.projectId ? Number(req.body.projectId) : null,
        clientName: req.body.clientName,
        clientEmail: req.body.clientEmail,
        serviceDescription: req.body.serviceDescription,
        serviceAmount: Number(req.body.serviceAmount || 0),
        domainAmount: Number(req.body.domainAmount || 0),
        hostingAmount: Number(req.body.hostingAmount || 0),
        shippingAmount: Number(req.body.shippingAmount || 0),
        installationAmount: Number(req.body.installationAmount || 0),
        taxAmount: Number(req.body.taxAmount || 0),
        discountAmount: Number(req.body.discountAmount || 0),
        totalAmount:
          Number(req.body.serviceAmount || 0) +
          Number(req.body.domainAmount || 0) +
          Number(req.body.hostingAmount || 0) +
          Number(req.body.shippingAmount || 0) +
          Number(req.body.installationAmount || 0) +
          Number(req.body.taxAmount || 0) -
          Number(req.body.discountAmount || 0),
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        notes: req.body.notes || null,
        status: "DRAFT",
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

    sendEmail({
      to: invoice.clientEmail,
      subject: `Invoice ${invoice.invoiceNumber} - JPS Support Services`,
      html: invoiceEmailHtml(invoice),
    }).catch(() => {});

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
    const invoice = await prisma.invoice.update({
      where: { id: Number(req.params.id) },
      data: {
        serviceAmount: Number(req.body.serviceAmount || 0),
        domainAmount: Number(req.body.domainAmount || 0),
        hostingAmount: Number(req.body.hostingAmount || 0),
        shippingAmount: Number(req.body.shippingAmount || 0),
        installationAmount: Number(req.body.installationAmount || 0),
        taxAmount: Number(req.body.taxAmount || 0),
        discountAmount: Number(req.body.discountAmount || 0),
        totalAmount:
          Number(req.body.serviceAmount || 0) +
          Number(req.body.domainAmount || 0) +
          Number(req.body.hostingAmount || 0) +
          Number(req.body.shippingAmount || 0) +
          Number(req.body.installationAmount || 0) +
          Number(req.body.taxAmount || 0) -
          Number(req.body.discountAmount || 0),
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        notes: req.body.notes !== undefined ? req.body.notes : undefined,
      },
    });

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
    const invoice = await prisma.invoice.update({
      where: { id: Number(req.params.id) },
      data: { status: "PAID" },
    });

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: "Unable to update invoice" });
  }
});

router.post("/:id/email", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    await sendEmail({
      to: invoice.clientEmail,
      subject: `Invoice ${invoice.invoiceNumber} - JPS Support Services`,
      html: invoiceEmailHtml(invoice),
    });

    res.json({ success: true, message: "Invoice emailed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to send invoice email" });
  }
});

export default router;
