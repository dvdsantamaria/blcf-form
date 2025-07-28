// routes/upload.js
const express = require("express");
const router = express.Router();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const Upload = require("../models/Upload");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME;
const MIME_ALLOW = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const extFromMime = (m) =>
  ({
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  }[m] || "bin");
const sanitize = (s) => String(s).replace(/[^a-z0-9_.-]/gi, "_");

// GET /api/generate-upload-url
router.get("/generate-upload-url", async (req, res) => {
  try {
    const { field, type } = req.query;
    if (!field || !type)
      return res.status(400).json({ error: "Missing field or type" });
    if (!MIME_ALLOW.has(type))
      return res.status(400).json({ error: "Unsupported MIME" });

    const key = `${Date.now()}_${sanitize(field)}.${extFromMime(type)}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: type,
      ...(process.env.AWS_KMS_KEY_ID
        ? {
            ServerSideEncryption: "aws:kms",
            SSEKMSKeyId: process.env.AWS_KMS_KEY_ID,
          }
        : {}), // si usás KMS
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    return res.json({ url, key });
  } catch (err) {
    console.error("generate-upload-url error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/register-upload  (guarda metadata del archivo subido)
router.post("/register-upload", async (req, res) => {
  try {
    const { key, label, originalName, fileType, token } = req.body || {};
    if (!key || !label || !originalName || !fileType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!MIME_ALLOW.has(fileType))
      return res.status(400).json({ error: "Unsupported MIME" });

    const doc = await Upload.create({
      key,
      label,
      originalName,
      fileType,
      token,
    });
    return res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error("register-upload error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
