import prisma from "../lib/prisma.js";

// Retention period for conversation/message logs (days). Configurable via env.
const MESSAGE_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_DAYS || 90);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function runMessageCleanup() {
  const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * ONE_DAY_MS);
  try {
    const { count } = await prisma.projectMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      console.log(
        `[cleanup] Deleted ${count} conversation message(s) older than ${MESSAGE_RETENTION_DAYS} days.`
      );
    }
  } catch (error) {
    console.error("[cleanup] Message retention cleanup failed:", error);
  }
}

// Run once at startup, then every 24h.
export function startCleanupJobs() {
  runMessageCleanup();
  setInterval(runMessageCleanup, ONE_DAY_MS);
  console.log(
    `[cleanup] Message retention job started (purging messages older than ${MESSAGE_RETENTION_DAYS} days).`
  );
}
