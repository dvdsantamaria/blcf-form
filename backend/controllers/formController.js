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
import { sendSubmissionMail } from "../utils/mailer.js";

import { logAudit } from "../utils/logAudit.js";

// AWS
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

// Helpers
function getField(body, dottedPath) {
  if (!body) return undefined;
  if (Object.prototype.hasOwnProperty.call(body, dottedPath))
    return body[dottedPath];
  return dottedPath.split(".").reduce((acc, k) => {
    return acc && typeof acc === "object" ? acc[k] : undefined;
  }, body);
}

// Extract child name from different shapes
function pickChildNameFromBody(d) {
  const data = d || {};
  const first =
    data?.child?.firstName ||
    data?.childFirstName ||
    data?.child_first_name ||
    data?.childFirst ||
    data?.child_first ||
    "";
  const last =
    data?.child?.lastName ||
    data?.childLastName ||
    data?.child_last_name ||
    data?.childLast ||
    data?.child_last ||
    "";
  const full = data?.child?.name || data?.childName || "";
  let f = String(first || "").trim();
  let l = String(last || "").trim();
  if (!f && !l && full) {
    const parts = String(full).trim().split(/\s+/);
    f = parts.shift() || "";
    l = parts.join(" ");
  }
  return { childFirst: f, childLast: l };
}

// Extract file keys from payload (accept arrays or scalars)
function extractFileKeysFromBody(body) {
  const keys = [];
  for (const [field, value] of Object.entries(body || {})) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const v of candidates) {
      if (
        typeof v === "string" &&
        /submissions\/.+\/uploads\/.+\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(v)
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

// SAVE DRAFT
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
    const { childFirst, childLast } = pickChildNameFromBody(body);

    const draftPayload = {
      token,
      step,
      updatedAt: timestamp,
      schemaVersion: 1,
      data: body,
      fileKeys,
    };

    console.log("[save-draft][begin]", { reqId, token, step, hasEmail: !!email });

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
          ...(childFirst ? { childFirst } : {}),
          ...(childLast ? { childLast } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log("✅ Draft saved:", token, "(reqId:", reqId + ")");
    return res.status(200).json({ ok: true, token, s3Key: currentKey, step });
  } catch (err) {
    console.error("save draft error:", { reqId, error: err?.message || err });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// SUBMIT (FINAL)
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

    const fileKeys = extractFileKeysFromBody(body);
    const { childFirst, childLast } = pickChildNameFromBody(body);

    // Create or load submission to get submissionNumber from pre-save hook
    let submission = await FormSubmission.findOne({ submissionId: token });

    if (!submission) {
      submission = new FormSubmission({
        submissionId: token,
        status: "submitted",
        fileKeys,
        ...(patientEmail ? { email: patientEmail } : {}),
        ...(childFirst ? { childFirst } : {}),
        ...(childLast ? { childLast } : {}),
        lastActivityAt: now,
        createdAt: now,
      });
      await submission.save(); // generates submissionNumber in pre-save
    } else {
      submission.status = "submitted";
      submission.fileKeys = fileKeys;
      if (patientEmail) submission.email = patientEmail;
      if (childFirst) submission.childFirst = childFirst;
      if (childLast) submission.childLast = childLast;
      submission.lastActivityAt = now;
      await submission.save();
    }

    const submissionNumber = submission.submissionNumber;

    // Build final S3 object including submissionNumber
    const finalKey = `submissions/${token}/final/submission.json`;
    const payload = {
      token,
      submissionNumber,
      submittedAt: timestamp,
      schemaVersion: 1,
      data: body,
      fileKeys,
    };

    console.log("[submit][begin]", {
      reqId,
      token,
      hasEmail: !!patientEmail,
      submissionNumber,
    });

    await putJsonToS3(finalKey, payload, reqId);

    // Update s3Key after upload
    submission.s3Key = finalKey;
    await submission.save();

    // Mark draft as finalized
    await FormDraft.findOneAndUpdate(
      { token },
      {
        $set: {
          finalizedAt: now,
          status: "finalized",
          lastActivityAt: now,
          ...(patientEmail ? { email: patientEmail } : {}),
          ...(childFirst ? { childFirst } : {}),
          ...(childLast ? { childLast } : {}),
        },
      },
      { upsert: true }
    );

    // Admin recipients
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
          role: "admin",
          submissionNumber,
          requestId: reqId,
        })
      );
      const results = await Promise.all(emailTasks);
      console.log("[submit][mails.admin]", {
        reqId,
        count: results.length,
        ids: results.map((r) => r?.id).filter(Boolean),
      });
    } else {
      console.warn("[submit][notify] no recipients configured; skipping email", {
        reqId,
      });
    }

    // Applicant email (if present)
    if (patientEmail) {
      await sendSubmissionMail({
        to: patientEmail,
        role: "user",
        submissionNumber,
        requestId: reqId,
      });
    }

    console.log("✅ Submission saved:", token, submissionNumber, "(reqId:", reqId + ")");
    return res
      .status(200)
      .json({ ok: true, token, submissionNumber, s3Key: finalKey });
  } catch (err) {
    console.error("❌ submit error:", { reqId, error: err?.message || err });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// PRESIGNED URL (PUT)
export const generateUploadUrl = async (req, res) => {
  const reqId = req.requestId || "-";
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

    console.log("[S3][presign-put]", { reqId, token, key, contentType: type });

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

    const sseHeaders = {
      "x-amz-server-side-encryption": "aws:kms",
      "x-amz-server-side-encryption-aws-kms-key-id":
        process.env.AWS_KMS_KEY_ID,
    };

    return res.json({ ok: true, url, key, sse: sseHeaders });
  } catch (err) {
    console.error("generateUploadUrl error:", {
      reqId,
      error: err?.message || err,
    });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

// PRESIGNED URL (GET)
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
    await logAudit(req, { action: "presign-get", key, httpStatus: 200 });
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

// VIEW DATA
export const getViewData = async (req, res) => {
  const reqId = req.requestId || "-";
  try {
    const { token } = req.query || {};
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

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
        extra: { type: "submitted" },
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
      extra: { type: "draft", step: json.step },
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
      key: req.query?.token
        ? `submissions/${req.query.token}/(final|draft)`
        : null,
      httpStatus: 404,
      extra: { error: err?.message || String(err) },
    });
    return res.status(404).json({ ok: false, error: "Not found" });
  }
};