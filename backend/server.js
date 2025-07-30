// backend/server.js
import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import formRoutes from "./routes/form.js";

const app = express();

/* ────────────── MIDDLEWARES ────────────── */
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" })); // for application/json
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // for application/x-www-form-urlencoded

/* ────────────── ENV CHECK ────────────── */
console.log("ENV CHECK:", {
  BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
  REGION: process.env.AWS_REGION,
});

/* ────────────── ROUTES ────────────── */
app.use("/api", formRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
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

/* ────────────── ERROR HANDLING ────────────── */
process.on("unhandledRejection", (err) =>
  console.error("Unhandled Rejection:", err)
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err)
);
