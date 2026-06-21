/**
 * Zoom Webhook Handler
 *
 * Endpoint: POST /api/zoom/webhook
 *
 * Handles:
 *   - CRC validation  (endpoint.url_validation)
 *   - Signature verification via HMAC-SHA256
 *   - meeting.started / meeting.ended → update linked Appointment status
 *   - meeting.participant_joined / meeting.participant_left → notifications
 *   - meeting.created / meeting.deleted
 *
 * Set ZOOM_WEBHOOK_SECRET_TOKEN in your .env file.
 * In Zoom Marketplace → your app → Features → Event Subscriptions,
 * set the endpoint URL to:  https://yourdomain.com/api/zoom/webhook
 */

import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";

const router = express.Router();

const SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

// ── Signature verification ───────────────────────────────────────────────────
function verifySignature(req) {
  if (!SECRET) {
    // No secret configured — skip verification in dev if you want, but log a warning
    console.warn("[Zoom] ZOOM_WEBHOOK_SECRET_TOKEN is not set. Skipping signature verification.");
    return true;
  }

  const timestamp = req.headers["x-zm-request-timestamp"];
  const incomingSig = req.headers["x-zm-signature"];

  if (!timestamp || !incomingSig) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) return false;

  // Use the raw body captured by express.json verify callback for exact byte match
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const message = `v0:${timestamp}:${rawBody}`;

  const expectedSig = "v0=" + crypto
    .createHmac("sha256", SECRET)
    .update(message)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig),
      Buffer.from(incomingSig)
    );
  } catch {
    return false;
  }
}

// ── Main webhook endpoint ────────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  const { event, event_ts, payload } = req.body;

  // ── 1. CRC validation (Zoom sends this when you add/update a webhook) ──
  if (event === "endpoint.url_validation") {
    if (!SECRET) {
      return res.status(500).json({ error: "ZOOM_WEBHOOK_SECRET_TOKEN not configured" });
    }
    const plainToken = payload?.plainToken;
    if (!plainToken) return res.status(400).json({ error: "Missing plainToken" });

    const encryptedToken = crypto
      .createHmac("sha256", SECRET)
      .update(plainToken)
      .digest("hex");

    console.log("[Zoom] CRC validation passed");
    return res.status(200).json({ plainToken, encryptedToken });
  }

  // ── 2. Verify signature for all other events ──
  if (!verifySignature(req)) {
    console.warn("[Zoom] Signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // ── 3. Acknowledge immediately — Zoom requires response within 3 seconds ──
  res.status(200).json({ received: true });

  // ── 4. Process event asynchronously (after responding) ──
  processEvent(event, event_ts, payload).catch((err) =>
    console.error(`[Zoom] Error processing event "${event}":`, err)
  );
});

// ── Event processor (runs after 200 is sent) ─────────────────────────────────
async function processEvent(event, event_ts, payload) {
  const obj = payload?.object || {};
  const meetingId = String(obj.id || "");
  const accountId = payload?.account_id;

  // Log every event for audit / debugging
  await prisma.zoomWebhookLog.create({
    data: {
      event,
      meetingId: meetingId || null,
      payload: JSON.stringify({ event_ts, payload }),
      processed: false,
    },
  }).catch(() => {}); // non-fatal if logging fails

  switch (event) {
    case "meeting.started":
      await onMeetingStarted(meetingId, obj);
      break;

    case "meeting.ended":
      await onMeetingEnded(meetingId, obj);
      break;

    case "meeting.participant_joined":
      await onParticipantJoined(meetingId, obj);
      break;

    case "meeting.participant_left":
      await onParticipantLeft(meetingId, obj);
      break;

    case "meeting.created":
      console.log(`[Zoom] Meeting created: ${meetingId} — "${obj.topic}"`);
      break;

    case "meeting.deleted":
      await onMeetingDeleted(meetingId);
      break;

    default:
      console.log(`[Zoom] Unhandled event: ${event}`);
  }

  // Mark log entry as processed
  await prisma.zoomWebhookLog.updateMany({
    where: { event, meetingId: meetingId || null },
    data: { processed: true },
  }).catch(() => {});
}

// ── meeting.started ──────────────────────────────────────────────────────────
async function onMeetingStarted(meetingId, obj) {
  const appt = await findAppointmentByMeetingId(meetingId);
  if (!appt) {
    console.log(`[Zoom] meeting.started: no appointment linked to meeting ${meetingId}`);
    return;
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "IN_PROGRESS" },
  });

  // Notify the target user (client)
  if (appt.targetUserId) {
    await prisma.notification.create({
      data: {
        userId: appt.targetUserId,
        title: "Your Meeting Has Started",
        message: `Your Zoom meeting for "${appt.title}" is now live. ${appt.zoomJoinUrl ? `Join: ${appt.zoomJoinUrl}` : ""}`,
        type: "APPOINTMENT",
      },
    });
  }

  console.log(`[Zoom] meeting.started → Appointment #${appt.id} marked IN_PROGRESS`);
}

// ── meeting.ended ────────────────────────────────────────────────────────────
async function onMeetingEnded(meetingId, obj) {
  const appt = await findAppointmentByMeetingId(meetingId);
  if (!appt) return;

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "COMPLETED" },
  });

  // Notify both parties
  const notifyIds = [appt.createdByUserId, appt.targetUserId].filter(Boolean);
  await Promise.all(
    notifyIds.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          title: "Meeting Ended",
          message: `Your Zoom meeting for "${appt.title}" has ended.`,
          type: "APPOINTMENT",
        },
      })
    )
  );

  console.log(`[Zoom] meeting.ended → Appointment #${appt.id} marked COMPLETED`);
}

// ── meeting.participant_joined ───────────────────────────────────────────────
async function onParticipantJoined(meetingId, obj) {
  const participant = obj.participant || {};
  const name = participant.user_name || "A participant";
  console.log(`[Zoom] ${name} joined meeting ${meetingId}`);
  // You could log this to ProjectActivity or emit a real-time notification here
}

// ── meeting.participant_left ─────────────────────────────────────────────────
async function onParticipantLeft(meetingId, obj) {
  const participant = obj.participant || {};
  const name = participant.user_name || "A participant";
  console.log(`[Zoom] ${name} left meeting ${meetingId}`);
}

// ── meeting.deleted ──────────────────────────────────────────────────────────
async function onMeetingDeleted(meetingId) {
  const appt = await findAppointmentByMeetingId(meetingId);
  if (!appt) return;

  // Clear zoom fields; keep the appointment itself
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { zoomMeetingId: null, zoomJoinUrl: null, zoomStartUrl: null },
  });

  console.log(`[Zoom] meeting.deleted → cleared Zoom fields on Appointment #${appt.id}`);
}

// ── Helper ───────────────────────────────────────────────────────────────────
function findAppointmentByMeetingId(meetingId) {
  if (!meetingId) return null;
  return prisma.appointment.findFirst({ where: { zoomMeetingId: meetingId } });
}

export default router;
