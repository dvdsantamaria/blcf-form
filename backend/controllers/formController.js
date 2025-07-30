import "dotenv/config";

import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

// -------- AWS S3 client --------
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = () => process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};

// -------- utils --------
const genToken = (len = 24) => crypto.randomBytes(len).toString("base64url");

async function putJsonToS3(key, obj) {
  const bucket = BUCKET();
  if (!bucket) throw new Error("AWS_S3_BUCKET is not defined");

  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid payload: not an object");
  }

  const body = JSON.stringify(obj);
  console.log("[putJsonToS3] Uploading", { key, size: body.length });

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/json",
    ...kmsParams,
  });

  try {
    await s3.send(cmd);
    return key;
  } catch (err) {
    console.error("[putJsonToS3] S3 upload error:", {
      message: err.message,
      stack: err.stack,
      bucket,
      key,
    });
    throw err;
  }
}

async function getJsonFromS3(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: key });
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

// -------- validation helpers --------
const REQUIRED_TEXT_FIELDS = [
  "child.firstName",
  "child.lastName",
  "child.dob",
  "parent1.firstName",
  "parent1.lastName",
  "parent1.email",
  "therapy.toBeFunded",
];
const REQUIRED_CHECKBOX_FIELDS = ["consent.terms", "consent.truth"];
const ONE_OF_FILES = [
  ["docs.supportLetterHealthProfessional", "docs.diagnosisLetter"],
];
const S3_KEY_RX = /[0-9]{10,}_.+\.(pdf|png|jpg|jpeg|webp|heic)$/i;

function isNonEmpty(val) {
  return typeof val === "string" && val.trim() !== "";
}
function isTruthyCheckbox(val) {
  return val === "on" || val === "true" || val === true;
}
function isEmail(val) {
  return isNonEmpty(val) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}
function validateSubmission(body) {
  const errors = [];

  for (const f of REQUIRED_TEXT_FIELDS) {
    if (!isNonEmpty(body[f])) errors.push(`Missing or empty: ${f}`);
  }

  if (body["parent1.email"] && !isEmail(body["parent1.email"])) {
    errors.push("Invalid email format: parent1.email");
  }

  for (const f of REQUIRED_CHECKBOX_FIELDS) {
    if (!isTruthyCheckbox(body[f])) errors.push(`You must accept: ${f}`);
  }

  for (const group of ONE_OF_FILES) {
    const ok = group.some((f) => S3_KEY_RX.test(String(body[f] || "")));
    if (!ok) errors.push(`Provide at least one of: ${group.join(" OR ")}`);
  }

  return { ok: errors.length === 0, errors };
}

// ================== Handlers ==================

export const generateUploadUrl = async (req, res) => {
  try {
    const { field, type } = req.query || {};
    if (!field || !type)
      return res.status(400).json({ error: "Missing field or type" });
    if (!MIME_ALLOW.has(type))
      return res.status(400).json({ error: "Unsupported MIME" });

    const key = `${Date.now()}_${sanitize(field)}.${extFromMime(type)}`;
    const cmd = new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      ContentType: type,
      ...kmsParams,
    });

    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });

    return res.json({ url, key });
  } catch (err) {
    console.error("generate-upload-url error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

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

export const getDraft = async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token)
      return res.status(400).json({ ok: false, error: "Token is required" });

    const meta = await FormDraft.findOne({ token }).lean().exec();
    const s3Key = meta?.s3Key || `drafts/${token}.json`;

    const draft = await getJsonFromS3(s3Key);
    return res.status(200).json({ ok: true, token, draft });
  } catch (err) {
    console.error("get draft error:", err);
    return res.status(404).json({ ok: false, error: "Draft not found" });
  }
};

export const handleFormSubmission = async (req, res) => {
  try {
    console.log("[SUBMIT] Received /api/submit-form", {
      method: req.method,
      contentType: req.headers["content-type"],
      ts: new Date().toISOString(),
    });
    console.log("[SUBMIT] body keys:", Object.keys(req.body || {}));

    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : genToken(16);
    console.log(`[SUBMIT] token=${token}`);

    const validation = validateSubmission(body);
    if (!validation.ok) {
      console.warn("[VALIDATION FAILED]", validation.errors);
      return res.status(400).json({
        ok: false,
        error: "Validation failed",
        details: validation.errors,
      });
    }

    const s3Key = `submissions/${now}_${token}_${Math.random()
      .toString(36)
      .substring(2, 8)}.json`;
    const fileKeys = extractFileKeysFromBody(body);

    const payload = {
      token,
      submittedAt: new Date(now).toISOString(),
      schemaVersion: 1,
      data: body,
      fileKeys,
      consent: {
        acceptedTerms: isTruthyCheckbox(body["consent.terms"]),
        declaredTruth: isTruthyCheckbox(body["consent.truth"]),
        acceptedPrivacyPolicy:
          isTruthyCheckbox(body["consent.terms"]) ||
          isTruthyCheckbox(body["accept_privacy"]),
      },
    };

    console.log("[S3 UPLOAD]", {
      bucket: BUCKET(),
      key: s3Key,
      payloadKeys: Object.keys(payload),
      fileKeys,
    });
    await putJsonToS3(s3Key, payload);

    const submissionRecord = {
      submissionId: token,
      s3Key,
      status: "submitted",
      fileKeys,
      createdAt: new Date(now),
    };

    console.log("[DB] Inserting submission", submissionRecord);

    try {
      await FormSubmission.create(submissionRecord);
      console.log("[DB] Submission inserted successfully.");
    } catch (err) {
      console.error("[DB] Submission insert error:", {
        message: err.message,
        stack: err.stack,
        record: submissionRecord,
      });
      return res
        .status(500)
        .json({ ok: false, error: "Database insert failed" });
    }

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
