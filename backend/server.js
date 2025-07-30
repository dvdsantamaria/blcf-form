import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import formRoutes from "./routes/form.js";
import adminRoutes from "./routes/admin.js";
import resumeRoutes from "./routes/resume.js";

const app = express();

/* ────────────── BASIC MIDDLEWARES ────────────── */
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(rateLimit({ windowMs: 5 * 60 * 1000, max: 500 }));

/* ────────────── ENV CHECK ────────────── */
console.log("ENV CHECK:", {
  BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
  REGION: process.env.AWS_REGION,
});

/* ────────────── ROUTES ────────────── */
app.use("/api", formRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/resume", resumeRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ────────────── STATIC FRONTEND ────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/admin", express.static(path.join(__dirname, "../public/admin")));

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

/* ────────────── ERROR HANDLING ────────────── */
process.on("unhandledRejection", (err) =>
  console.error("Unhandled Rejection:", err)
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err)
);
