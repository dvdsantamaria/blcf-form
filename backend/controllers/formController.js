// backend/controllers/formController.js
import "dotenv/config";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

// AWS clients
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ses = process.env.SES_FROM
  ? new SESClient({ region: process.env.AWS_REGION })
  : null;

// Helpers
const BUCKET = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;

const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};

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

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getField(body, dottedPath) {
  if (body == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(body, dottedPath)) {
    return body[dottedPath];
  }
  return dottedPath.split(".").reduce((acc, k) => {
    if (acc && typeof acc === "object") return acc[k];
    return undefined;
  }, body);
}

function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (
      typeof v === "string" &&
      /submissions\/.+\/uploads\/.+\.(pdf|png|jpe?g|webp|heic)$/i.test(v)
    ) {
      keys.push({ field: k, key: v });
    }
  }
  return keys;
}

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

async function safeSendEmail(to, subject, text) {
  try {
    if (!ses || !process.env.SES_FROM || !to) return;
    await ses.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [to] },
        Source: process.env.SES_FROM,
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: text } },
        },
      })
    );
  } catch (e) {
    console.warn("SES send failed (non-blocking):", e?.message || e);
  }
}

// ---------- SAVE DRAFT ----------
export const saveDraft = async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : crypto.randomBytes(16).toString("base64url");
    const step = Number(body.step ?? 0) || 0;

    const emailRaw = getField(body, "parent1.email") || getField(body, "email");
    const email =
      typeof emailRaw === "string" && EMAIL_RX.test(emailRaw.trim())
        ? emailRaw.trim()
        : null;

    const isoName = new Date(now)
      .toISOString()
      .replace(/[T:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const currentKey = `submissions/${token}/drafts/current.json`;
    const historyKey = `submissions/${token}/drafts/${isoName}.json`;

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
          ...(email ? { email } : {}),
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

// ---------- SUBMIT FINAL ----------
export const handleFormSubmission = async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const token =
      body.token && /^[A-Za-z0-9._~-]{10,}$/.test(body.token)
        ? body.token
        : crypto.randomBytes(16).toString("base64url");

    const emailRaw = getField(body, "parent1.email") || getField(body, "email");
    const email =
      typeof emailRaw === "string" && EMAIL_RX.test(emailRaw.trim())
        ? emailRaw.trim()
        : null;

    const finalKey = `submissions/${token}/final/submission.json`;
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
          ...(email ? { email } : {}),
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
          ...(email ? { email } : {}),
        },
      },
      { upsert: true }
    );

    if (email) {
      const base = process.env.PUBLIC_BASE_URL || "";
      const link = base
        ? `${base}/?resumeToken=${encodeURIComponent(token)}`
        : token;
      await safeSendEmail(
        email,
        "BLCF – Hemos recibido tu solicitud",
        `Gracias por tu envío.\n\nToken de referencia: ${token}\nReanudar/consultar: ${link}\n\n(SES sandbox: recuerda verificar este destinatario)`
      );
    }

    return res.status(200).json({ ok: true, token, s3Key: finalKey });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};
