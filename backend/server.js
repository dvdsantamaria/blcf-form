// backend/server.js
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

import formRoutes from "./routes/form.js";
import adminRoutes from "./routes/admin.js";
import resumeRoutes from "./routes/resume.js";

const app = express();

/* ────────────── SECURITY & MIDDLEWARE ────────────── */
app.set("trust proxy", 1);
app.use(helmet());

const allowedOrigins = (process.env.CORS_ALLOW_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return cb(null, true);
      }
      return cb(new Error("CORS not allowed"), false);
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(rateLimit({ windowMs: 5 * 60 * 1000, max: 500 }));

/* ────────────── ENV CHECK ────────────── */
console.log("ENV CHECK:", {
  BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
  REGION: process.env.AWS_REGION,
  ALLOW_ORIGINS: allowedOrigins,
  ENABLE_SES_TEST: process.env.ENABLE_SES_TEST,
});

/* ────────────── ROUTES ────────────── */
app.use("/api", formRoutes); // <- todo lo del form (save-draft, submit, presign, reader view)
app.use("/api/admin", adminRoutes);
app.use("/api/resume", resumeRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ────────────── STATIC ADMIN FRONTEND ────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/admin", express.static(path.join(__dirname, "../public/admin")));

// Global error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ ok: false, error: "Multer error", details: err.message });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        error: "Internal Server Error",
        details: err.message,
      });
  }
  next();
});

/* ────────────── START SERVER ────────────── */
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log("Connected to MongoDB Atlas");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`BLCF backend running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Mongo connection error:", err);
    process.exit(1);
  });

process.on("unhandledRejection", (err) =>
  console.error("Unhandled Rejection:", err)
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err)
);
