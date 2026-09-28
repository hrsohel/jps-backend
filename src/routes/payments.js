import express from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole, ADMIN_ROLES } from "../middleware/auth.js";
import { sendEmail } from "../utils/sendEmail.js";
import { ensureGuestToken, invoiceEmailHtml } from "../lib/invoiceHelpers.js";

const router = express.Router();

async function getStripeKey() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: "STRIPE_SECRET_KEY" } });
    if (setting?.value) return setting.value.trim();
  } catch (_) { /* DB not reachable — fall back to env */ }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return key.trim();
}

async function getWebhookSecret() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: "STRIPE_WEBHOOK_SECRET" } });
    if (setting?.value) return setting.value.trim();
  } catch (_) { /* DB not reachable — fall back to env */ }
  return (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

async function getStripe() {
  const key = await getStripeKey();
  return new Stripe(key, { apiVersion: "2024-04-10" });
}

// Resolves how much of the remaining balance a payment request should cover,
// validating the client-supplied "pay this much" amount against the invoice.
function resolvePayAmount(invoice, requestedAmount) {
  const balanceDue = Math.max(0, Number(invoice.totalAmount) - Number(invoice.amountPaid || 0));
  const amount = requestedAmount !== undefined && requestedAmount !== null && requestedAmount !== ""
    ? Number(requestedAmount)
    : balanceDue;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Enter a valid payment amount"), { expose: true });
  }
  if (amount > balanceDue + 0.01) {
    throw Object.assign(new Error(`Amount exceeds the balance due ($${balanceDue.toFixed(2)})`), { expose: true });
  }
  return Math.round(amount * 100) / 100;
}

// Only relays an error's own message to the client when it was deliberately
// thrown for the user (marked with `expose`). Everything else — Prisma,
// Stripe, or any other internal failure — gets a generic message instead,
// since those raw messages can include internal schema/type details.
function safeMessage(err, fallback) {
  return err?.expose ? err.message : fallback;
}

async function applyPayment(invoiceId, paidAmount) {
  const invoice = await prisma.invoice.findUnique({ where: { id: Number(invoiceId) } });
  if (!invoice) return null;

  const amountPaid = Math.round((Number(invoice.amountPaid || 0) + Number(paidAmount)) * 100) / 100;
  const isFullyPaid = amountPaid >= Number(invoice.totalAmount) - 0.01;

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid,
      status: isFullyPaid ? "PAID" : "PARTIAL",
      paidAt: isFullyPaid ? new Date() : invoice.paidAt,
    },
  });

  const clientUser = await prisma.user.findUnique({ where: { email: updated.clientEmail } }).catch(() => null);
  if (clientUser) {
    await prisma.notification.create({
      data: {
        userId: clientUser.id,
        title: isFullyPaid ? "Invoice Paid" : "Payment Received",
        message: isFullyPaid
          ? `Invoice ${updated.invoiceNumber} has been paid in full. Thank you!`
          : `We received a payment of $${Number(paidAmount).toFixed(2)} on invoice ${updated.invoiceNumber}. Remaining balance: $${(updated.totalAmount - amountPaid).toFixed(2)}.`,
        type: "INVOICE",
      },
    }).catch(() => {});
  }

  sendEmail({
    to: updated.clientEmail,
    subject: isFullyPaid
      ? `Payment Received — Invoice ${updated.invoiceNumber}`
      : `Partial Payment Received — Invoice ${updated.invoiceNumber}`,
    html: invoiceEmailHtml(updated),
  }).catch(() => {});

  return updated;
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
    res.status(500).json({ error: safeMessage(err, "Payment processing error") });
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
    res.status(500).json({ error: safeMessage(err, "Confirmation error") });
  }
});

async function createCheckoutSession(invoice, requestedAmount) {
  invoice = await ensureGuestToken(prisma, invoice);

  const payAmount = resolvePayAmount(invoice, requestedAmount);
  const balanceDue = Math.max(0, Number(invoice.totalAmount) - Number(invoice.amountPaid || 0));
  const isPartial = payAmount < balanceDue - 0.01;

  const stripe = await getStripe();
  const amountCents = Math.round(payAmount * 100);

  return stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: invoice.clientEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Invoice ${invoice.invoiceNumber}${isPartial ? " — Partial Payment" : ""}`,
            description: invoice.serviceDescription || "JPS Core Services",
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoiceNumber,
      payAmount: String(payAmount),
    },
    success_url: `https://my.jpscoreinc.com/?page=guest-pay&invoice=${invoice.id}&token=${invoice.guestToken}`,
    cancel_url: `https://my.jpscoreinc.com/?page=Invoices`,
  });
}

// POST /api/payments/checkout-session
// Creates a Stripe Hosted Checkout Session — returns { url } for redirect.
// Accepts an optional `amount` so a registered client can pay any amount up
// to the remaining balance due, not just the full invoice total.
router.post("/checkout-session", requireAuth, async (req, res) => {
  try {
    const { invoiceId, amount } = req.body;
    if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(invoiceId) } });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.clientEmail !== req.user.email && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (invoice.status === "PAID") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }

    const session = await createCheckoutSession(invoice, amount);
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout-session error:", err);
    res.status(500).json({ error: safeMessage(err, "Checkout error") });
  }
});

// POST /api/payments/guest/checkout-session
// Same as above but for an unregistered client using the tokenized link from
// their invoice email — no login required, just a matching guestToken.
router.post("/guest/checkout-session", async (req, res) => {
  try {
    const { invoiceId, token, amount } = req.body;
    if (!invoiceId || !token) return res.status(400).json({ error: "invoiceId and token required" });

    const invoice = await prisma.invoice.findUnique({ where: { id: Number(invoiceId) } });
    if (!invoice || !invoice.guestToken || invoice.guestToken !== token) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    if (invoice.status === "PAID") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }

    const session = await createCheckoutSession(invoice, amount);
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe guest checkout-session error:", err);
    res.status(500).json({ error: safeMessage(err, "Checkout error") });
  }
});

// POST /api/payments/webhook
// Stripe webhook — the authoritative source of truth for payment completion.
// Configure this URL in the Stripe Dashboard and store the signing secret via
// Settings (key STRIPE_WEBHOOK_SECRET) or the STRIPE_WEBHOOK_SECRET env var.
router.post("/webhook", async (req, res) => {
  try {
    const stripe = await getStripe();
    const webhookSecret = await getWebhookSecret();
    const signature = req.headers["stripe-signature"];

    let event;
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } else {
      // No signing secret configured yet — accept the parsed body (dev-only fallback).
      console.warn("[Stripe webhook] STRIPE_WEBHOOK_SECRET not configured — skipping signature verification.");
      event = req.body;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const invoiceId = session.metadata?.invoiceId;
      const payAmount = Number(session.metadata?.payAmount || 0);
      if (invoiceId && payAmount > 0) {
        await applyPayment(invoiceId, payAmount);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    res.status(400).json({ error: err.message || "Webhook error" });
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
      prisma.invoice.aggregate({ where: { status: { in: ["SENT", "PARTIAL", "OVERDUE"] } }, _sum: { totalAmount: true }, _count: true }),
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
    res.status(500).json({ error: safeMessage(err, "Unable to load payment summary") });
  }
});

export default router;
