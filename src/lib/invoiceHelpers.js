import crypto from "crypto";
import { emailWrap, PORTAL_URL } from "../utils/emailLayout.js";

export const TAX_RATE = 0.06;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function truthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// Recomputes tax/discount/total from line-item amounts. Falls back to `existing`
// (the stored invoice) for any field not present in `input`, so a partial PATCH
// body doesn't reset the other amounts.
export function computeInvoiceAmounts(input = {}, existing = {}) {
  const num = (key) => Number(input[key] !== undefined ? input[key] : existing[key] || 0);

  const serviceAmount = num("serviceAmount");
  const domainAmount = num("domainAmount");
  const hostingAmount = num("hostingAmount");
  const shippingAmount = num("shippingAmount");
  const installationAmount = num("installationAmount");

  const taxEnabled = input.taxEnabled !== undefined ? truthy(input.taxEnabled) : Boolean(existing.taxEnabled);
  const discountPercent = Math.min(100, Math.max(0,
    Number(input.discountPercent !== undefined ? input.discountPercent : existing.discountPercent || 0)
  ));

  const subtotal = serviceAmount + domainAmount + hostingAmount + shippingAmount + installationAmount;
  const discountAmount = round2(subtotal * (discountPercent / 100));
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxEnabled ? round2(taxableBase * TAX_RATE) : 0;
  const totalAmount = round2(taxableBase + taxAmount);

  return {
    serviceAmount, domainAmount, hostingAmount, shippingAmount, installationAmount,
    taxEnabled, taxAmount, discountPercent, discountAmount, totalAmount,
  };
}

export function generateGuestToken() {
  return crypto.randomBytes(20).toString("hex");
}

// Ensures the invoice has a guestToken (older invoices created before this
// feature won't have one yet), persisting it lazily on first use.
export async function ensureGuestToken(prisma, invoice) {
  if (invoice.guestToken) return invoice;
  const guestToken = generateGuestToken();
  return prisma.invoice.update({ where: { id: invoice.id }, data: { guestToken } });
}

export function guestPayLink(invoice) {
  if (!invoice.guestToken) return null;
  return `${PORTAL_URL}/?page=guest-pay&invoice=${invoice.id}&token=${invoice.guestToken}`;
}

export function invoiceEmailHtml(invoice, { reminder = false, overdue = false } = {}) {
  const balanceDue = Math.max(0, Number(invoice.totalAmount) - Number(invoice.amountPaid || 0));
  const payLink = guestPayLink(invoice);
  const isPaid = invoice.status === "PAID";

  const heading = reminder
    ? (overdue ? "Payment Overdue" : "Payment Reminder")
    : `Invoice ${invoice.invoiceNumber}`;

  return emailWrap(`
    <h2 style="color:${overdue ? "#dc2626" : "#0749B3"};margin:0 0 8px">${heading}</h2>
    <p style="color:#475569">Hello ${invoice.clientName},</p>
    <p style="color:#475569">
      ${reminder
        ? (overdue
            ? `Invoice <strong>${invoice.invoiceNumber}</strong> is now past due. Please submit payment as soon as possible.`
            : `This is a friendly reminder that invoice <strong>${invoice.invoiceNumber}</strong> is coming due.`)
        : `Your invoice from JPS Core is ready. Please review the details below.`}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Service</td><td style="padding:10px;font-size:13px">${invoice.serviceDescription}</td></tr>
      <tr><td style="padding:10px;color:#64748b;font-size:13px">Service Amount</td><td style="padding:10px;font-size:13px">$${Number(invoice.serviceAmount).toFixed(2)}</td></tr>
      ${invoice.domainAmount ? `<tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Domain</td><td style="padding:10px;font-size:13px">$${Number(invoice.domainAmount).toFixed(2)}</td></tr>` : ""}
      ${invoice.hostingAmount ? `<tr><td style="padding:10px;color:#64748b;font-size:13px">Hosting</td><td style="padding:10px;font-size:13px">$${Number(invoice.hostingAmount).toFixed(2)}</td></tr>` : ""}
      ${invoice.discountAmount ? `<tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-size:13px">Discount${invoice.discountPercent ? ` (${invoice.discountPercent}%)` : ""}</td><td style="padding:10px;font-size:13px">-$${Number(invoice.discountAmount).toFixed(2)}</td></tr>` : ""}
      ${invoice.taxAmount ? `<tr><td style="padding:10px;color:#64748b;font-size:13px">Tax</td><td style="padding:10px;font-size:13px">$${Number(invoice.taxAmount).toFixed(2)}</td></tr>` : ""}
      <tr style="border-top:2px solid #0749B3"><td style="padding:12px 10px;font-weight:800;color:#0f172a">TOTAL</td><td style="padding:12px 10px;font-weight:800;font-size:18px;color:#0749B3">$${Number(invoice.totalAmount).toFixed(2)}</td></tr>
      ${invoice.amountPaid ? `<tr><td style="padding:10px;color:#64748b;font-size:13px">Paid to Date</td><td style="padding:10px;font-size:13px">-$${Number(invoice.amountPaid).toFixed(2)}</td></tr>
      <tr style="border-top:2px solid #0749B3"><td style="padding:12px 10px;font-weight:800;color:#0f172a">BALANCE DUE</td><td style="padding:12px 10px;font-weight:800;font-size:20px;color:#0749B3">$${balanceDue.toFixed(2)}</td></tr>` : ""}
    </table>
    ${invoice.dueDate ? `<p style="color:#64748b;font-size:13px">&#x1F4C5; Due Date: <strong>${new Date(invoice.dueDate).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</strong></p>` : ""}
    ${invoice.notes ? `<p style="color:#64748b;font-size:13px">Notes: ${invoice.notes}</p>` : ""}
    ${!isPaid && payLink ? `
    <div style="margin-top:20px">
      <a href="${payLink}" style="display:inline-block;background:#0E9F6E;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:800;font-size:15px">Pay Now — $${balanceDue.toFixed(2)}</a>
    </div>` : ""}
  `);
}
