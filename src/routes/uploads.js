import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../lib/prisma.js";
import fs from "fs";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Absolute path to api/uploads/ regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");

fs.mkdirSync(path.join(UPLOADS_ROOT, "projects"),  { recursive: true });
fs.mkdirSync(path.join(UPLOADS_ROOT, "campaigns"), { recursive: true });

const ALLOWED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".txt", ".csv", ".zip",
  ".mp4", ".mov", ".avi",
];

const storage = multer.diskStorage({
  destination: path.join(UPLOADS_ROOT, "projects"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
    }
  },
});

// ── Image uploads for email campaigns/banners ──
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

const imageStorage = multer.diskStorage({
  destination: path.join(UPLOADS_ROOT, "campaigns"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
    cb(null, uniqueName);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Image type not allowed. Allowed: ${IMAGE_EXTENSIONS.join(", ")}`));
    }
  },
});

// Returns an absolute, publicly reachable URL so it can be embedded in emails
router.post("/image", requireAuth, imageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }
  const filename = req.file.filename;
  const apiBase = process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.replace(/\/$/, "")
    : `${req.protocol}://${req.get("host")}`;
  const url = `${apiBase}/uploads/campaigns/${filename}`;
  res.status(201).json({ url, filename });
});

router.post("/projects", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const uploadedByRole = req.user?.role || "CLIENT";
    const isStaffUpload = ["ADMIN", "STAFF"].includes(uploadedByRole);

    const savedFile = await prisma.projectFile.create({
      data: {
        projectId: Number(req.body.projectId),
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: `uploads/projects/${req.file.filename}`,  // always relative URL path
        uploadedByRole,
        approvalStatus: isStaffUpload ? "PENDING_APPROVAL" : "APPROVED",
      },
    });

    // Notify the project client + all admins about the new file
    const project = await prisma.project.findUnique({
      where: { id: Number(req.body.projectId) },
    }).catch(() => null);

    if (project) {
      if (project.clientUserId && project.clientUserId !== req.user.id) {
        const notifMessage = isStaffUpload
          ? `JPS Core uploaded "${req.file.originalname}" to your project "${project.title}". Please review and approve.`
          : `A new file "${req.file.originalname}" was uploaded to your project "${project.title}".`;
        await prisma.notification.create({
          data: {
            userId: project.clientUserId,
            title: isStaffUpload ? "File Requires Your Approval" : "New File Available",
            message: notifMessage,
            type: "FILE",
          },
        }).catch(() => {});
      }
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
      await Promise.all(
        admins
          .filter((a) => a.id !== req.user.userId)
          .map((admin) =>
            prisma.notification.create({
              data: {
                userId: admin.id,
                title: "File Uploaded",
                message: `"${req.file.originalname}" was uploaded to project "${project.title}".`,
                type: "FILE",
              },
            }).catch(() => {})
          )
      );
    }

    res.status(201).json({ message: "File uploaded successfully", file: savedFile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "File upload failed" });
  }
});

router.get("/projects/:projectId", requireAuth, async (req, res) => {
  try {
    const files = await prisma.projectFile.findMany({
      where: { projectId: Number(req.params.projectId) },
      orderBy: { createdAt: "desc" },
    });

    res.json(files);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load files" });
  }
});

router.patch("/:id/approve", requireAuth, async (req, res) => {
  try {
    const file = await prisma.projectFile.findUnique({ where: { id: Number(req.params.id) } });
    if (!file) return res.status(404).json({ error: "File not found" });

    // Verify requester owns the project (client) or is staff
    const project = await prisma.project.findUnique({ where: { id: file.projectId } });
    const isOwner = project?.clientUserId === req.user.id;
    const isStaff = ["ADMIN", "STAFF"].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: "Access denied" });

    const updated = await prisma.projectFile.update({
      where: { id: Number(req.params.id) },
      data: { approvalStatus: "APPROVED" },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Unable to approve file" });
  }
});

router.patch("/:id/reject", requireAuth, async (req, res) => {
  try {
    const file = await prisma.projectFile.findUnique({ where: { id: Number(req.params.id) } });
    if (!file) return res.status(404).json({ error: "File not found" });

    const project = await prisma.project.findUnique({ where: { id: file.projectId } });
    const isOwner = project?.clientUserId === req.user.id;
    const isStaff = ["ADMIN", "STAFF"].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: "Access denied" });

    const updated = await prisma.projectFile.update({
      where: { id: Number(req.params.id) },
      data: { approvalStatus: "REJECTED" },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Unable to reject file" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const file = await prisma.projectFile.findUnique({ where: { id: Number(req.params.id) } });

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    const diskPath = path.join(UPLOADS_ROOT, "projects", file.filename);
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }

    await prisma.projectFile.delete({ where: { id: Number(req.params.id) } });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to delete file" });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 25MB." });
    }
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

export default router;
