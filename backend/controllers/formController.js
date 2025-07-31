import "dotenv/config";
import crypto from "crypto";
import express from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

const BUCKET = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;

const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getField(body, dottedPath) {
  if (!body) return undefined;
  if (Object.prototype.hasOwnProperty.call(body, dottedPath))
    return body[dottedPath];
  return dottedPath.split(".").reduce((acc, k) => {
    return acc && typeof acc === "object" ? acc[k] : undefined;
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
  console.log("[putJsonToS3] Uploading", { key, size: body.length });
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
    console.warn("SES send failed:", e?.message || e);
  }
}

// SAVE DRAFT
export const saveDraft = async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date();
    const timestamp = now.toISOString();

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

    const isoName = timestamp.replace(/[T:]/g, "").replace(/\.\d+Z$/, "Z");
    const currentKey = `submissions/${token}/drafts/current.json`;
    const historyKey = `submissions/${token}/drafts/${isoName}.json`;

    const fileKeys = extractFileKeysFromBody(body);
    const draftPayload = {
      token,
      step,
      updatedAt: timestamp,
      schemaVersion: 1,
      data: body,
      fileKeys,
    };

    console.log("[save-draft] token:", token, "step:", step);
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
          updatedAt: now,
          lastActivityAt: now,
          ...(email ? { email } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log("✅ Draft saved:", token);
    return res.status(200).json({ ok: true, token, s3Key: currentKey, step });
  } catch (err) {
    console.error("save draft error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// SUBMIT
export const handleFormSubmission = async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date();
    const timestamp = now.toISOString();
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
      submittedAt: timestamp,
      schemaVersion: 1,
      data: body,
      fileKeys,
    };

    console.log("[submit] token:", token);
    await putJsonToS3(finalKey, payload);

    await FormSubmission.findOneAndUpdate(
      { submissionId: token },
      {
        $set: {
          s3Key: finalKey,
          status: "submitted",
          fileKeys,
          ...(email ? { email } : {}),
          lastActivityAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await FormDraft.findOneAndUpdate(
      { token },
      {
        $set: {
          finalizedAt: now,
          status: "finalized",
          lastActivityAt: now,
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

    console.log("✅ Submission saved:", token);
    return res.status(200).json({ ok: true, token, s3Key: finalKey });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// GENERATE PRESIGNED UPLOAD URL (accepts field or filename)
export const generateUploadUrl = async (req, res) => {
  try {
    const { token, filename, type, field } = req.query;
    if (!token || !type || (!filename && !field)) {
      return res.status(400).json({ ok: false, error: "Missing parameters" });
    }

    const extFromFilename = filename ? filename.split(".").pop() : null;
    const extFromType = type && type.includes("/") ? type.split("/")[1] : null;
    const ext = (extFromFilename || extFromType || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const safeField = (field || "file")
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_");
    const iso = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const key = `submissions/${token}/uploads/${iso}_${safeField}.${ext}`;

    console.log("[presign] token:", token, "key:", key);

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: type,
      ...kmsParams,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    return res.status(200).json({ ok: true, url, key });
  } catch (err) {
    console.error("generateUploadUrl error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// GET DRAFT (rarely used by front, kept for completeness)
export const getDraft = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key: `submissions/${token}/drafts/current.json`,
    });

    const draft = await s3.send(cmd);
    const stream = draft.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    const raw = Buffer.concat(chunks).toString("utf8");
    const json = JSON.parse(raw);

    return res.status(200).json({ ok: true, draft: json });
  } catch (err) {
    console.error("getDraft error:", err);
    return res.status(404).json({ ok: false, error: "Draft not found" });
  }
};

// ROUTER
const router = express.Router();
router.post("/save-draft", saveDraft);
router.post("/submit", handleFormSubmission);
router.get("/generate-upload-url", generateUploadUrl);
router.get("/get-draft", getDraft);

export default router;
