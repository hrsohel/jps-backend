// One-time data import: loads prisma/_data-export.json (exported from the old
// SQLite DB) into the current (MySQL) database. Safe to keep in the repo; it
// aborts if the target DB already has data so it can't double-insert.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const prisma = new PrismaClient();
const data = JSON.parse(
  readFileSync(new URL("./_data-export.json", import.meta.url))
);

// Insert order respects foreign keys:
//   ServiceGroup -> Service, Project -> ProjectActivity, User -> Notification
const order = [
  "user", "serviceGroup", "service", "serviceRequest", "project",
  "invoice", "projectFile", "projectMessage", "campaign", "campaignLog",
  "projectActivity", "notification", "emailTemplate", "appointment", "zoomWebhookLog",
];

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`Target DB already has ${existing} users — aborting seed to avoid duplicates.`);
    return;
  }

  for (const model of order) {
    const rows = data[model];
    if (!rows || rows.length === 0) {
      console.log(model.padEnd(18), "0 (skip)");
      continue;
    }
    if (!prisma[model]) {
      console.log(model.padEnd(18), "no delegate, skip");
      continue;
    }
    const res = await prisma[model].createMany({ data: rows });
    console.log(model.padEnd(18), "inserted", res.count);
  }
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
