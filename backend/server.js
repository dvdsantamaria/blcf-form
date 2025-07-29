// backend/server.js
import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import formRoutes from "./routes/form.js";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// sanity check opcional en logs
console.log("ENV CHECK:", {
  BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
  REGION: process.env.AWS_REGION,
});

app.use("/api", formRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

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
