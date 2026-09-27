import prisma from "../lib/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { ensureGuestToken, invoiceEmailHtml } from "../lib/invoiceHelpers.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_LEAD_DAYS = 3; // send the first reminder this many days before the due date
const OVERDUE_REPEAT_DAYS = 3; // once overdue, remind again every N days until paid

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / ONE_DAY_MS);
}

export async function runInvoiceReminders() {
  const now = new Date();

  let invoices;
  try {
    invoices = await prisma.invoice.findMany({
      where: {
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        dueDate: { not: null },
      },
    });
  } catch (error) {
    console.error("[invoice-reminders] Unable to load invoices:", error);
    return;
  }

  for (const invoice of invoices) {
    try {
      const dueDate = new Date(invoice.dueDate);
      const daysUntilDue = daysBetween(dueDate, now); // negative once overdue
      const isOverdue = daysUntilDue < 0;

      // Flip status to OVERDUE once the due date has passed
      if (isOverdue && invoice.status !== "OVERDUE") {
        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
        invoice.status = "OVERDUE";
      }

      const lastSent = invoice.lastReminderSentAt ? new Date(invoice.lastReminderSentAt) : null;
      const daysSinceLastReminder = lastSent ? daysBetween(now, lastSent) : Infinity;

      let shouldRemind = false;
      if (isOverdue) {
        shouldRemind = daysSinceLastReminder >= OVERDUE_REPEAT_DAYS;
      } else if (daysUntilDue <= REMINDER_LEAD_DAYS) {
        // Due today or within the lead window — send once
        shouldRemind = !lastSent;
      }

      if (!shouldRemind) continue;

      const withToken = await ensureGuestToken(prisma, invoice);

      await sendEmail({
        to: withToken.clientEmail,
        subject: isOverdue
          ? `Payment Overdue — Invoice ${withToken.invoiceNumber}`
          : `Payment Reminder — Invoice ${withToken.invoiceNumber}`,
        html: invoiceEmailHtml(withToken, { reminder: true, overdue: isOverdue }),
      });

      await prisma.invoice.update({ where: { id: invoice.id }, data: { lastReminderSentAt: now } });

      console.log(`[invoice-reminders] Reminder sent for ${withToken.invoiceNumber} (${isOverdue ? "overdue" : "upcoming"}).`);
    } catch (error) {
      console.error(`[invoice-reminders] Failed to process invoice #${invoice.id}:`, error);
    }
  }
}

// Run once at startup, then every 24h.
export function startInvoiceReminderJob() {
  runInvoiceReminders();
  setInterval(runInvoiceReminders, ONE_DAY_MS);
  console.log("[invoice-reminders] Invoice due-date reminder job started.");
}
