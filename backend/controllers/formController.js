// backend/controllers/formController.js
import "dotenv/config";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";
import { sendSubmissionMail, sendHtmlEmail } from "../utils/mailer.js";
import ResumeToken from "../models/ResumeToken.js";
import {
  genToken,
  PUBLIC_BASE_URL,
  BACKEND_BASE_URL,
} from "./resumeController.js";

// ───────────────── AWS clients ─────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
const kmsParams = process.env.AWS_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
  : {};
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ───────────────── Helpers ─────────────────
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

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function putJsonToS3(key, obj) {
  const body = JSON.stringify(obj);
  console.log("[putJsonToS3] Uploading", { key, size: body.length });
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ...kmsParams,
    })
  );
  return key;
}

// ───────────────── SAVE DRAFT ─────────────────
export const saveDraft = async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date();
    const timestamp = now.toISOString();

    // token del draft (nuevo o existente)
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

    // keys S3
    const isoName = timestamp.replace(/[T:]/g, "").replace(/\.\d+Z$/, "Z");
    const currentKey = `submissions/${token}/drafts/current.json`;
    const historyKey = `submissions/${token}/drafts/${isoName}.json`;

    // payload
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

    // MongoDraft
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

    // ── ResumeToken (14 días renovable)
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const existing = await ResumeToken.findOne({
      submissionId: token,
      used: false,
    });

    if (existing) {
      await ResumeToken.updateOne(
        { submissionId: token, used: false },
        { expiresAt }
      );
      console.log("[save-draft] extended resume token expiry for", token);
    } else if (email) {
      const rt = genToken(24);
      await ResumeToken.create({
        resumeToken: rt,
        submissionId: token,
        email,
        expiresAt,
      });
      const base = BACKEND_BASE_URL || PUBLIC_BASE_URL || "";
      const exchangeUrl = `${base}/api/resume/exchange?rt=${encodeURIComponent(
        rt
      )}`;
      const subject = "Resume your application";
      const text = `Hello,\n\nUse this secure link (valid 14 days) to resume your application:\n\n${exchangeUrl}\n\nIf you did not request this, ignore this email.`;
      const html = `<p>Hello,</p><p>Use this secure link (valid 14 days) to resume your application:</p><p><a href="${exchangeUrl}">${exchangeUrl}</a></p><p>If you did not request this, ignore this email.</p>`;
      const mail = await sendHtmlEmail({ to: email, subject, text, html });
      console.log("[save-draft] sent new resume link", {
        email,
        rt,
        ok: mail.ok,
        id: mail.id,
      });
    }

    console.log("✅ Draft saved:", token);
    return res.status(200).json({ ok: true, token, s3Key: currentKey, step });
  } catch (err) {
    console.error("save draft error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// ───────────────── SUBMIT (FINAL) ─────────────────
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
    const patientEmail =
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
          ...(patientEmail ? { email: patientEmail } : {}),
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
          ...(patientEmail ? { email: patientEmail } : {}),
        },
      },
      { upsert: true }
    );

    // ── Emails (paciente + admins)
    const emailTasks = [];

    if (patientEmail) {
      emailTasks.push(
        sendSubmissionMail({ to: patientEmail, token, role: "user" })
      );
    }

    const admins = (process.env.ADMIN_NOTIFY_TO || process.env.NOTIFY_TO || "")
      .split(/[,;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const adminEmail of admins) {
      emailTasks.push(
        sendSubmissionMail({ to: adminEmail, token, role: "admin" })
      );
    }

    await Promise.all(emailTasks);

    console.log("✅ Submission saved:", token);
    return res.status(200).json({ ok: true, token, s3Key: finalKey });
  } catch (err) {
    console.error("❌ submit error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// ───────────────── PRESIGNED URL ─────────────────
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

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: type,
        ...kmsParams,
      }),
      { expiresIn: 3600 }
    );
    return res.status(200).json({ ok: true, url, key });
  } catch (err) {
    console.error("generateUploadUrl error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// ───────────────── VIEW DATA (reader) ─────────────────
export const getViewData = async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    // 1) Intentar final
    const finalKey = `submissions/${token}/final/submission.json`;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: finalKey })
      );
      const text = await streamToString(obj.Body);
      const json = JSON.parse(text);
      return res.json({
        ok: true,
        type: "submitted",
        token,
        submittedAt: json.submittedAt,
        data: json.data || {},
        fileKeys: json.fileKeys || [],
      });
    } catch (_) {
      // sigue a draft
    }

    // 2) Draft actual
    const draftKey = `submissions/${token}/drafts/current.json`;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: draftKey })
    );
    const text = await streamToString(obj.Body);
    const json = JSON.parse(text);
    return res.json({
      ok: true,
      type: "draft",
      token,
      step: json.step,
      updatedAt: json.updatedAt,
      data: json.data || {},
      fileKeys: json.fileKeys || [],
    });
  } catch (err) {
    console.error("getViewData error:", err);
    return res.status(404).json({ ok: false, error: "Not found" });
  }
};
