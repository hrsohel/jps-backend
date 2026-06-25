import express from "express";
import multer from "multer";
import path from "path";
import prisma from "../lib/prisma.js";
import fs from "fs";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const ALLOWED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".txt", ".csv", ".zip",
  ".mp4", ".mov", ".avi",
];

const storage = multer.diskStorage({
  destination: "uploads/projects",
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

fs.mkdirSync("uploads/campaigns", { recursive: true });

const imageStorage = multer.diskStorage({
  destination: "uploads/campaigns",
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
  const relPath = req.file.path.replace(/\\/g, "/");
  const url = `${req.protocol}://${req.get("host")}/${relPath}`;
  res.status(201).json({ url, filename: req.file.filename });
});

router.post("/projects", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const savedFile = await prisma.projectFile.create({
      data: {
        projectId: Number(req.body.projectId),
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
      },
    });

    // Notify the project client + all admins about the new file
    const project = await prisma.project.findUnique({
      where: { id: Number(req.body.projectId) },
    }).catch(() => null);

    if (project) {
      if (project.clientUserId && project.clientUserId !== req.user.userId) {
        await prisma.notification.create({
          data: {
            userId: project.clientUserId,
            title: "New File Available",
            message: `A new file "${req.file.originalname}" was uploaded to your project "${project.title}".`,
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

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const file = await prisma.projectFile.findUnique({ where: { id: Number(req.params.id) } });

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
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
