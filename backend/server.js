// backend/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import formRoutes from "./routes/form.js";
import resumeRoutes from "./routes/resume.js";
import adminRoutes from "./routes/admin.js";

import {
  buildAdminMagicRouter,
  authAdminMagic,
} from "./middleware/AdminMagicToken.js";

const app = express();

/* ───────────── SECURITY & MIDDLEWARE ───────────── */
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

// ---- requestId + request/response logging (observability) ----
app.use((req, res, next) => {
  const rid = req.headers["x-request-id"] || crypto.randomUUID();
  req.requestId = rid;
  res.setHeader("X-Request-Id", rid);

  const start = Date.now();
  console.log("[req]", {
    reqId: rid,
    method: req.method,
    url: req.originalUrl,
  });

  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log("[res]", { reqId: rid, status: res.statusCode, ms });
  });

  next();
});

console.log("ENV CHECK:", {
  MONGO_URI: process.env.MONGO_URI,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
  AWS_REGION: process.env.AWS_REGION,
  CORS_ALLOW_ORIGINS: allowedOrigins,
  SUBMISSION_NOTIFY_TO: process.env.SUBMISSION_NOTIFY_TO,
  ADMIN_NOTIFY_TO: process.env.ADMIN_NOTIFY_TO,
  ADMIN_ALLOWED_EMAILS: (process.env.ADMIN_ALLOWED_EMAILS || "").split(
    /[,;]\s*/
  ),
});

/* ───────────── ROUTES ───────────── */

// health check antes de rate limiting para que nunca lo bloquee
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// APIs de formulario
app.use("/api", formRoutes);

// logging de todo lo que llega a resume
app.use("/api/resume", (req, res, next) => {
  console.log(
    "[resume] incoming:",
    req.method,
    req.originalUrl,
    "body→",
    req.body
  );
  next();
});

// resume routes (send-link, exchange, whoami, etc)
app.use("/api/resume", resumeRoutes);
/* ───────────── ADMIN MAGIC TOKEN ───────────── */

// Normalize env list to lowercase and trimmed
const allowedAdminEmails = (process.env.ADMIN_ALLOWED_EMAILS || "")
  .split(/[,;]\s*/)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Build one shared config and reuse it for both the /auth router and the guard
const { router: adminAuthRouter, config: adminCfg } = buildAdminMagicRouter({
  allowedEmails: allowedAdminEmails,
  uiBaseUrl:
    process.env.ADMIN_UI_BASE_URL ||
    "https://grants.beyondlimitscf.org.au/admin/", // keep trailing slash
  jwtSecret: process.env.ADMIN_JWT_SECRET || "", // must be same across restarts
  sessionSecret: process.env.ADMIN_SESSION_SECRET || "", // must be same across restarts
  mailer: process.env.ADMIN_MAILER || "resend",
  resendKey: process.env.RESEND_API_KEY || "",
  mailFrom:
    process.env.ADMIN_NOTIFY_FROM ||
    process.env.SUBMISSION_NOTIFY_TO ||
    "no-reply@grants.beyondlimitscf.org.au",
  brandName: process.env.ADMIN_BRAND || "Admin Access",
  apiBasePath: "/api/admin/auth",
});

// Mount with the exact same config instance
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin", authAdminMagic(adminCfg), adminRoutes);

// Optional short log to verify at boot
console.log("[admin-magic]", {
  allowed: adminCfg.allowedEmails,
  uiBaseUrl: adminCfg.uiBaseUrl,
});

/* ───────────── STATIC ADMIN UI ───────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/admin", express.static(path.join(__dirname, "../public/admin")));

/* ───────────── GLOBAL ERROR HANDLER ───────────── */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ ok: false, error: "Multer error", details: err.message });
  }
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ ok: false, error: "Internal Server Error", details: err.message });
});

/* ───────────── START SERVER ───────────── */
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ BLCF backend running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Mongo connection error:", err);
    process.exit(1);
  });

process.on("unhandledRejection", (err) =>
  console.error("Unhandled Rejection:", err)
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err)
);
