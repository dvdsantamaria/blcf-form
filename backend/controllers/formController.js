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

const genToken = (len = 24) => crypto.randomBytes(len).toString("base64url");

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

const S3_KEY_RX =
  /^(submissions\/[A-Za-z0-9._~-]+\/uploads\/.+\.(pdf|png|jpg|jpeg|webp|heic))$|^[0-9]{10,}_.+\.(pdf|png|jpg|jpeg|webp|heic)$/i;

function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (typeof v === "string" && S3_KEY_RX.test(v)) {
      keys.push({ field: k, key: v });
    }
  }
  return keys;
}

function isNonEmpty(val) {
  return typeof val === "string" && val.trim() !== "";
}
function isTruthyCheckbox(val) {
  return val === "on" || val === "true" || val === true;
}
function isEmail(val) {
  return isNonEmpty(val) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

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
function s3DraftKey(token, isoName = "current") {
  return `submissions/${token}/drafts/${isoName}.json`;
}
function s3FinalKey(token) {
  return `submissions/${token}/final/submission.json`;
}

async function putJsonToS3(key, obj) {
  const bucket = BUCKET();
  if (!bucket) throw new Error("AWS_S3_BUCKET is not defined");
  if (!obj || typeof obj !== "object")
    throw new Error("Invalid payload: not an object");

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

export const generateUploadUrl = async (req, res) => {
  try {
    const { field, type, token: qsToken } = req.query || {};
    if (!field || !type)
      return res.status(400).json({ error: "Missing field or type" });
    if (!MIME_ALLOW.has(type))
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
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });

    return res.json({ url, key: Key });
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

    if (step === 0) {
      const requiredMin = [
        "parent1.firstName",
        "parent1.lastName",
        "parent1.email",
      ];
      // const missing = requiredMin.filter((f) => !isNonEmpty(body[f]));
      // if (missing.length > 0) {
      //   return res.status(400).json({
      //     ok: false,
      //     error: "Missing required fields in step 0",
      //     details: missing,
      //   });
      // }
      if (!isEmail(body["parent1.email"])) {
        return res.status(400).json({
          ok: false,
          error: "Invalid email format",
          details: ["parent1.email"],
        });
      }
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
          email: body.email,
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

export const getDraft = async (req, res) => {
  try {
    const { token } = req.query || {};
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

    const fileKeys = extractFileKeysFromBody(body);
    const finalKey = s3FinalKey(token);

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

    console.log("[S3 UPLOAD FINAL]", {
      bucket: BUCKET(),
      key: finalKey,
      payloadKeys: Object.keys(payload),
      fileKeys,
    });
    await putJsonToS3(finalKey, payload);

    await FormSubmission.findOneAndUpdate(
      { submissionId: token },
      {
        $set: {
          s3Key: finalKey,
          status: "submitted",
          fileKeys,
          email: body.email,
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
