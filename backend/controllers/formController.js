// backend/controllers/formController.js
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME;
const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};

// -------- utils --------
const genToken = (len = 24) => crypto.randomBytes(len).toString("base64url");

async function putJsonToS3(key, obj) {
  const body = JSON.stringify(obj);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: "application/json",
    ...kmsParams,
  });
  await s3.send(cmd);
  return key;
}

async function getJsonFromS3(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await s3.send(cmd);
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

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

// Heurística para encontrar keys de archivos ya subidos por presigned PUT
function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (
      typeof v === "string" &&
      /[0-9]{10,}_.+\.(pdf|png|jpg|jpeg|webp|heic)$/i.test(v)
    ) {
      keys.push({ field: k, key: v });
    }
  }
  return keys;
}

// -------- Handlers --------

// GET /api/generate-upload-url?field=...&type=...
export const generateUploadUrl = async (req, res) => {
  try {
    const { field, type } = req.query || {};
    if (!field || !type) {
      return res.status(400).json({ error: "Missing field or type" });
    }
    if (!MIME_ALLOW.has(type)) {
      return res.status(400).json({ error: "Unsupported MIME" });
    }

    const key = `${Date.now()}_${sanitize(field)}.${extFromMime(type)}`;
    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: type,
      ...kmsParams,
    });

    // Firma válida 5 minutos
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    return res.json({ url, key });
  } catch (err) {
    console.error("generate-upload-url error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// POST /api/save-draft
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
    const s3Key = `drafts/${token}.json`;

    const fileKeys = extractFileKeysFromBody(body);

    const draftPayload = {
      token,
      step,
      updatedAt: new Date(now).toISOString(),
      schemaVersion: 1,
      data: body,
      fileKeys,
    };

    await putJsonToS3(s3Key, draftPayload);

    await FormDraft.findOneAndUpdate(
      { token },
      {
        $set: {
          token,
          s3Key,
          step,
          updatedAt: new Date(now),
          status: "draft",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ ok: true, token, s3Key, step });
  } catch (err) {
    console.error("save draft error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// GET /api/get-draft?token=XXXX
export const getDraft = async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: "Token requerido" });
    }

    const meta = await FormDraft.findOne({ token }).lean().exec();
    const s3Key = meta?.s3Key || `drafts/${token}.json`;

    const draft = await getJsonFromS3(s3Key);
    return res.status(200).json({ ok: true, token, draft });
  } catch (err) {
    console.error("get draft error:", err);
    return res.status(404).json({ ok: false, error: "Draft no encontrado" });
  }
};

// POST /api/submit-form

// POST /api/submit-form
export const handleFormSubmission = async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : genToken(16);

    const s3Key = `submissions/${now}_${token}.json`;
    const fileKeys = extractFileKeysFromBody(body);

    const payload = {
      token,
      submittedAt: new Date(now).toISOString(),
      schemaVersion: 1,
      data: body,
      fileKeys,
      consent: {
        acceptedPrivacyPolicy:
          body.accept_privacy === "on" || body.accept_privacy === "true",
      },
    };

    await putJsonToS3(s3Key, payload);

    await FormSubmission.create({
      submissionId: token,
      s3Key,
      status: "submitted",
      fileKeys,
      createdAt: new Date(now),
    });

    await FormDraft.findOneAndUpdate(
      { token },
      { $set: { finalizedAt: new Date(now), status: "finalized" } },
      { upsert: false }
    );

    return res.status(200).json({ ok: true, token, s3Key });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};
