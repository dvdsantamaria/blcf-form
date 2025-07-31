// backend/controllers/formController.js
import "dotenv/config";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

// Initialize S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configuration helpers
const BUCKET = () => process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};

// Utility functions
const genToken = (len = 24) => crypto.randomBytes(len).toString("base64url");
const sanitize = (s) => String(s).replace(/[^a-z0-9_.-]/gi, "_");
const extFromMime = (m) =>
  ({
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  }[m] || "bin");

function requireToken(qsToken, bodyToken) {
  const t = (qsToken || bodyToken || "").trim();
  if (!t) throw new Error("Missing token");
  return t;
}

function s3UploadKey(token, field, mime) {
  const ext = extFromMime(mime);
  const ts = new Date()
    .toISOString()
    .replace(/[T:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `submissions/${token}/uploads/${ts}_${sanitize(field)}.${ext}`;
}
function s3DraftKey(token, name = "current") {
  return `submissions/${token}/drafts/${name}.json`;
}
function s3FinalKey(token) {
  return `submissions/${token}/final/submission.json`;
}

async function putJsonToS3(key, obj) {
  const bucket = BUCKET();
  if (!bucket) throw new Error("AWS_S3_BUCKET is not defined");
  const body = JSON.stringify(obj);
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/json",
    ...kmsParams,
  });
  await s3.send(cmd);
  return key;
}

async function getJsonFromS3(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: key });
  const res = await s3.send(cmd);
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

// File key extraction
const S3_KEY_RX =
  /^(submissions\/[^\/]+\/uploads\/.*\.(pdf|png|jpg|jpeg|webp|heic))$/i;
function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (typeof v === "string" && S3_KEY_RX.test(v)) {
      keys.push({ field: k, key: v });
    }
  }
  return keys;
}

// GET /api/generate-upload-url
export const generateUploadUrl = async (req, res) => {
  try {
    const { field, type, token: qsToken } = req.query;
    if (!field || !type)
      return res.status(400).json({ error: "Missing field or type" });
    const mimeAllowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
    ]);
    if (!mimeAllowed.has(type))
      return res.status(400).json({ error: "Unsupported MIME" });

    const token = requireToken(qsToken, null);
    const Key = s3UploadKey(token, field, type);
    const cmd = new PutObjectCommand({
      Bucket: BUCKET(),
      Key,
      ContentType: type,
      ...kmsParams,
    });
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    return res.json({ url, key: Key });
  } catch (err) {
    console.error("generate-upload-url error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// POST /api/save-draft
export const saveDraft = async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : genToken(16);
    const step = Number(body.step ?? 0) || 0;

    // Validate email from parent1
    if (
      !body.parent1 ||
      typeof body.parent1.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.parent1.email.trim())
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Invalid email format",
          details: ["parent1.email"],
        });
    }

    const isoName = new Date(now)
      .toISOString()
      .replace(/[T:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const currentKey = s3DraftKey(token, "current");
    const historyKey = s3DraftKey(token, isoName);

    const fileKeys = extractFileKeysFromBody(body);
    const draftPayload = {
      token,
      step,
      updatedAt: new Date(now).toISOString(),
      schemaVersion: 1,
      data: body,
      fileKeys,
    };
    await putJsonToS3(currentKey, draftPayload);
    await putJsonToS3(historyKey, draftPayload);

    await FormDraft.findOneAndUpdate(
      { token },
      {
        $set: {
          token,
          s3Key: currentKey,
          step,
          status: "draft",
          updatedAt: new Date(now),
          lastActivityAt: new Date(now),
          email: body.parent1.email,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ ok: true, token, s3Key: currentKey, step });
  } catch (err) {
    console.error("save draft error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// GET /api/get-draft
export const getDraft = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ ok: false, error: "Token is required" });
    const key = s3DraftKey(token, "current");
    const draft = await getJsonFromS3(key);
    return res.status(200).json({ ok: true, token, draft });
  } catch (err) {
    console.error("get draft error:", err);
    return res.status(404).json({ ok: false, error: "Draft not found" });
  }
};

// POST /api/submit-form
export const handleFormSubmission = async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : genToken(16);

    // Minimal submission validation (could be extended)
    const finalKey = s3FinalKey(token);
    const fileKeys = extractFileKeysFromBody(body);

    const payload = {
      token,
      submittedAt: new Date(now).toISOString(),
      schemaVersion: 1,
      data: body,
      fileKeys,
    };
    await putJsonToS3(finalKey, payload);

    await FormSubmission.findOneAndUpdate(
      { submissionId: token },
      {
        $set: {
          s3Key: finalKey,
          status: "submitted",
          fileKeys,
          email: body.parent1.email,
          lastActivityAt: new Date(now),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await FormDraft.findOneAndUpdate(
      { token },
      {
        $set: {
          finalizedAt: new Date(now),
          status: "finalized",
          lastActivityAt: new Date(now),
        },
      },
      { upsert: true }
    );

    return res.status(200).json({ ok: true, token, s3Key: finalKey });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};
