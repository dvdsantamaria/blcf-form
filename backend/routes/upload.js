// backend/routes/upload.js
import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const router = express.Router();

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
        : {}),
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    return res.json({ url, key });
  } catch (err) {
    console.error("generate-upload-url error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
