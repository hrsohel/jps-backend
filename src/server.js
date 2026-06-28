import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import userRoutes from "./routes/users.js";
import authRoutes from "./routes/auth.js";
import serviceRequestRoutes from "./routes/serviceRequests.js";
import projectRoutes from "./routes/projects.js";
import uploadRoutes from "./routes/uploads.js";
import projectMessageRoutes from "./routes/projectMessages.js";
import campaignRoutes from "./routes/campaigns.js";
import emailRoutes from "./routes/email.js";
import campaignLogRoutes from "./routes/campaignLogs.js";
import serviceCatalogRoutes from "./routes/serviceCatalog.js";
import dashboardRoutes from "./routes/dashboard.js";
import projectActivityRoutes from "./routes/projectActivities.js";
import invoiceRoutes from "./routes/invoices.js";
import notificationRoutes from "./routes/notifications.js";
import appointmentRoutes from "./routes/appointments.js";
import emailTemplateRoutes from "./routes/emailTemplates.js";
import zoomWebhookRoutes from "./routes/zoomWebhook.js";
import paymentRoutes from "./routes/payments.js";
import siteBannerRoutes from "./routes/siteBanner.js";
import settingsRoutes from "./routes/settings.js";
import { startCleanupJobs } from "./jobs/cleanup.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

const allowedOrigins = [
  "https://my.jpscoreinc.com",
  "https://jpscoreinc.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow all localhost origins in development
      if (!origin || origin.startsWith("http://localhost") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Capture raw body for Zoom webhook signature verification before JSON parsing
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(limiter);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/service-requests", serviceRequestRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/project-messages", projectMessageRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/campaign-logs", campaignLogRoutes);
app.use("/api/service-catalog", serviceCatalogRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/project-activities", projectActivityRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/email-templates", emailTemplateRoutes);
app.use("/api/zoom", zoomWebhookRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/site-banner", siteBannerRoutes);
app.use("/api/settings", settingsRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "JPS Client Portal API", timestamp: new Date().toISOString() });
});

app.get("/api/services", (req, res) => {
  res.json([
    "Website Services",
    "Digital Marketing",
    "Branding & Signs",
    "IT & Business Solutions",
  ]);
});

app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`JPS API running on port ${port}`);
  startCleanupJobs();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Kill the old process first:\n  kill $(lsof -t -i:${port})`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
