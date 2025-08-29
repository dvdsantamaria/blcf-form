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
import { logAudit } from "../utils/logAudit.js";
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

// Updated to handle single values or arrays of file keys
function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [field, value] of Object.entries(body || {})) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const v of candidates) {
      if (
        typeof v === "string" &&
        /submissions\/.+\/uploads\/.+\.(pdf|png|jpe?g|webp|heic)$/i.test(v)
      ) {
        keys.push({ field, key: v });
      }
    }
  }
  return keys;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function putJsonToS3(key, obj, reqId) {
  const body = JSON.stringify(obj);
  console.log("[S3][put]", { reqId, key, bytes: body.length });
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
  const reqId = req.requestId || "-";
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

    console.log("[save-draft][begin]", {
      reqId,
      token,
      step,
      hasEmail: !!email,
    });
    await putJsonToS3(currentKey, draftPayload, reqId);
    await putJsonToS3(historyKey, draftPayload, reqId);

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
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    let rtDoc = await ResumeToken.findOne({
      submissionId: token,
      used: false,
    });

    if (rtDoc) {
      await ResumeToken.updateOne(
        { submissionId: token, used: false },
        { expiresAt }
      );
      console.log("[save-draft][resume-token-extend]", { reqId, token });
    }

    const throttleHrs = Number(process.env.RESUME_EMAIL_THROTTLE_HOURS) || 24;
    const throttleMs = throttleHrs * 3600 * 1000;
    const draftRecord = await FormDraft.findOne({ token }).lean();
    const lastSent = draftRecord?.lastResumeEmailAt
      ? new Date(draftRecord.lastResumeEmailAt).getTime()
      : 0;
    const shouldSend = email && Date.now() - lastSent > throttleMs;

    if (shouldSend) {
      const rt = rtDoc?.resumeToken || genToken(24);
      if (!rtDoc) {
        await ResumeToken.create({
          resumeToken: rt,
          submissionId: token,
          email,
          expiresAt,
        });
      }

      const base = BACKEND_BASE_URL || PUBLIC_BASE_URL || "";
      const exchangeUrl = `${base}/api/resume/exchange?rt=${encodeURIComponent(
        rt
      )}`;
      const subject = "Resume your application";
      const text = `Hello,\n\nUse this secure link (valid 14 days) to resume your application:\n\n${exchangeUrl}\n\nIf you did not request this, ignore this email.`;
      const html = `<p>Hello,</p>
        <p>Use this secure link (valid 14 days) to resume your application:</p>
        <p><a href="${exchangeUrl}">${exchangeUrl}</a></p>
        <p>If you did not request this, ignore this email.</p>`;

      const mail = await sendHtmlEmail({
        to: email,
        subject,
        text,
        html,
        replyTo: process.env.REPLY_TO || undefined,
        kind: "resume-link",
        requestId: reqId,
      });
      console.log("[save-draft][resume-link-sent]", {
        reqId,
        email,
        ok: mail.ok,
        id: mail.id,
      });

      await FormDraft.updateOne(
        { token },
        { $set: { lastResumeEmailAt: new Date(), lastResumeEmailTo: email } }
      );
    }

    console.log("✅ Draft saved:", token, "(reqId:", reqId + ")");
    return res.status(200).json({ ok: true, token, s3Key: currentKey, step });
  } catch (err) {
    console.error("save draft error:", { reqId, error: err?.message || err });
    return res
      .status(500)
      .json({ ok: false, error: "Internal Server Error" });
  }
};

// ───────────────── SUBMIT (FINAL) ─────────────────
export const handleFormSubmission = async (req, res) => {
  const reqId = req.requestId || "-";
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

    console.log("[submit][begin]", {
      reqId,
      token,
      hasEmail: !!patientEmail,
    });
    await putJsonToS3(finalKey, payload, reqId);

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

    const notifyRaw = [
      process.env.SUBMISSION_NOTIFY_TO || "",
      process.env.ADMIN_NOTIFY_TO || "",
      process.env.ADMIN_ALLOWED_EMAILS || "",
    ]
      .filter(Boolean)
      .join(",");

    const recipients = notifyRaw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    console.log("[submit][notify]", { reqId, notifyRaw, recipients });

    if (recipients.length) {
      const emailTasks = recipients.map((to) =>
        sendSubmissionMail({
          to,
          token,
          role: "admin",
          requestId: reqId,
        })
      );
      const results = await Promise.all(emailTasks);
      console.log("[submit][mails]", {
        reqId,
        count: results.length,
        ids: results.map((r) => r?.id).filter(Boolean),
      });
    } else {
      console.warn(
        "[submit][notify] no recipients configured; skipping email",
        { reqId }
      );
    }

    console.log("✅ Submission saved:", token, "(reqId:", reqId + ")");
    return res.status(200).json({ ok: true, token, s3Key: finalKey });
  } catch (err) {
    console.error("❌ submit error:", { reqId, error: err?.message || err });
    return res
      .status(500)
      .json({ ok: false, error: "Internal Server Error" });
  }
};
// ───────────────── PRESIGNED URL (PUT) ─────────────────
export const generateUploadUrl = async (req, res) => {
  const reqId = req.requestId || "-";
  try {
    const { token, filename, type, field } = req.query;
    if (!token || !type || (!filename && !field)) {
      return res.status(400).json({ ok: false, error: "Missing parameters" });
    }

    // --- construir key ---
    const extFromFilename = filename ? filename.split(".").pop() : null;
    const extFromType = type && type.includes("/") ? type.split("/")[1] : null;
    const ext = (extFromFilename || extFromType || "bin")
      .toLowerCase().replace(/[^a-z0-9]/g, "");

    const safeField = (field || "file")
      .toLowerCase().replace(/[^a-z0-9_.-]/g, "_");

    const iso = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const key = `submissions/${token}/uploads/${iso}_${safeField}.${ext}`;

    console.log("[S3][presign-put]", { reqId, token, key, contentType: type });

    // 👉  volvemos a incluir kmsParams  👈
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: type,
        ...kmsParams            // ← firma los encabezados SSE-KMS
      }),
      { expiresIn: 3600 }
    );

    // devolvemos los encabezados que el front-end DEBE reenviar
    const sseHeaders = {
      "x-amz-server-side-encryption": "aws:kms",
      "x-amz-server-side-encryption-aws-kms-key-id": process.env.AWS_KMS_KEY_ID
    };

    return res.json({ ok: true, url, key, sse: sseHeaders });
  } catch (err) {
    console.error("generateUploadUrl error:", { reqId, error: err?.message || err });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};


// ───────────────── PRESIGNED URL (GET) ─────────────────
export const getFileUrl = async (req, res) => {
  const reqId = req.requestId || "-";
  try {
    const { key } = req.query;
    if (!key) {
      return res.status(400).json({ ok: false, error: "Missing key" });
    }
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 60 }
    );
    console.log("[S3][presign-get]", { reqId, key, ttl: 60 });
    await logAudit(req, {
      action: "presign-get",
      key,
      httpStatus: 200,
    });
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("getFileUrl error:", { reqId, error: err?.message || err });
    await logAudit(req, {
      action: "presign-get",
      key: req.query?.key || null,
      httpStatus: 500,
      extra: { error: err?.message || String(err) },
    });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// ───────────────── VIEW DATA (reader) ─────────────────
export const getViewData = async (req, res) => {
  const reqId = req.requestId || "-";
  try {
    const { token } = req.query || {};
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    // 1) Final
    const finalKey = `submissions/${token}/final/submission.json`;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: finalKey })
      );
      const text = await streamToString(obj.Body);
      console.log("[S3][read]", { reqId, key: finalKey, bytes: text.length });
      const json = JSON.parse(text);
      await logAudit(req, {
        action: "view-data",
        key: finalKey,
        httpStatus: 200,
        extra: { type: "submitted" }
      });
      return res.json({
        ok: true,
        type: "submitted",
        token,
        submittedAt: json.submittedAt,
        data: json.data || {},
        fileKeys: json.fileKeys || [],
      });
    } catch (_) {
      // fallback to draft
    }

    // 2) Draft
    const draftKey = `submissions/${token}/drafts/current.json`;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: draftKey })
    );
    const text = await streamToString(obj.Body);
    console.log("[S3][read]", { reqId, key: draftKey, bytes: text.length });
    const json = JSON.parse(text);
    await logAudit(req, {
      action: "view-data",
      key: draftKey,
      httpStatus: 200,
      extra: { type: "draft", step: json.step }
    });
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
    console.error("getViewData error:", { reqId, error: err?.message || err });
    await logAudit(req, {
      action: "view-data",
      key: req.query?.token ? `submissions/${req.query.token}/(final|draft)` : null,
      httpStatus: 404,
      extra: { error: err?.message || String(err) }
    });
    return res.status(404).json({ ok: false, error: "Not found" });
  }
};