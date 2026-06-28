import express from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";

const router = express.Router();

async function getStripeKey() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: "STRIPE_SECRET_KEY" } });
    if (setting?.value) return setting.value;
  } catch (_) { /* DB not reachable — fall back to env */ }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return key;
}

async function getStripe() {
  const key = await getStripeKey();
  return new Stripe(key, { apiVersion: "2024-04-10" });
}

// POST /api/payments/create-payment-intent
// Creates a Stripe PaymentIntent for an invoice
router.post("/create-payment-intent", requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.clientId !== req.user.id && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (invoice.status === "PAID") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }

    const stripe = await getStripe();
    const amountCents = Math.round(Number(invoice.totalAmount) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber || "",
        clientId: invoice.clientId || "",
      },
      description: `Invoice ${invoice.invoiceNumber || invoice.id} — JPS Core`,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Stripe create-payment-intent error:", err);
    res.status(500).json({ error: err.message || "Payment processing error" });
  }
});

// POST /api/payments/confirm-payment
// Called after successful client-side Stripe confirmation — marks invoice PAID
router.post("/confirm-payment", requireAuth, async (req, res) => {
  try {
    const { paymentIntentId, invoiceId } = req.body;
    if (!paymentIntentId || !invoiceId) {
      return res.status(400).json({ error: "paymentIntentId and invoiceId required" });
    }

    const stripe = await getStripe();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.status !== "succeeded") {
      return res.status(400).json({ error: `Payment not successful (status: ${pi.status})` });
    }
    if (pi.metadata?.invoiceId !== invoiceId) {
      return res.status(400).json({ error: "Invoice mismatch" });
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        stripePaymentIntentId: paymentIntentId,
      },
    });

    res.json({ ok: true, invoice: updated });
  } catch (err) {
    console.error("Stripe confirm-payment error:", err);
    res.status(500).json({ error: err.message || "Confirmation error" });
  }
});

// POST /api/payments/checkout-session
// Creates a Stripe Hosted Checkout Session — returns { url } for redirect
router.post("/checkout-session", requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(invoiceId) } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.clientEmail !== req.user.email && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (invoice.status === "PAID") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }

    const stripe = await getStripe();
    const frontendUrl = process.env.FRONTEND_URL || "https://my.jpscoreinc.com";
    const amountCents = Math.round(Number(invoice.totalAmount) * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: invoice.clientEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
              description: invoice.serviceDescription || "JPS Core Services",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId: String(invoice.id),
        invoiceNumber: invoice.invoiceNumber,
      },
      success_url: `${frontendUrl}?page=invoice-paid&invoice=${invoice.id}`,
      cancel_url: `${frontendUrl}?page=Invoices`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout-session error:", err);
    res.status(500).json({ error: err.message || "Checkout error" });
  }
});

// GET /api/payments/config
// Returns the publishable key for the frontend
router.get("/config", requireAuth, (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "" });
});

// GET /api/payments/admin/summary  (admin only)
router.get("/admin/summary", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const [paidInvoices, pendingInvoices] = await Promise.all([
      prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { totalAmount: true }, _count: true }),
      prisma.invoice.aggregate({ where: { status: { in: ["UNPAID", "OVERDUE"] } }, _sum: { totalAmount: true }, _count: true }),
    ]);

    // Try to fetch Stripe balance — silently skip if key not configured
    let balance = null;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      try {
        const stripe = await getStripe();
        balance = await stripe.balance.retrieve();
      } catch (_) { /* Stripe not reachable — continue without it */ }
    }

    res.json({
      totalPaid: Number(paidInvoices._sum.totalAmount || 0),
      paidCount: paidInvoices._count,
      totalPending: Number(pendingInvoices._sum.totalAmount || 0),
      pendingCount: pendingInvoices._count,
      stripeConfigured: Boolean(stripeKey),
      stripeAvailableBalance: balance?.available?.[0]?.amount != null
        ? balance.available[0].amount / 100
        : null,
      stripePendingBalance: balance?.pending?.[0]?.amount != null
        ? balance.pending[0].amount / 100
        : null,
      stripeCurrency: balance?.available?.[0]?.currency?.toUpperCase() || "USD",
    });
  } catch (err) {
    console.error("Admin summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
