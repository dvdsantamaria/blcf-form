// backend/controllers/resumeController.js
import "dotenv/config";
import crypto from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

import ResumeToken from "../models/ResumeToken.js";
import FormDraft from "../models/FormDraft.js";
import { sendHtmlEmail } from "../utils/mailer.js"; // use Resend SDK util

/* ---------- AWS S3 ---------- */
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

/* ---------- Utils ---------- */
// export genToken so formController can import it
export function genToken(len = 24) {
  return crypto.randomBytes(len).toString("base64url");
}

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// export streamToString if ever needed elsewhere
export async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

/* ---------- Const ---------- */
// export these so formController can build links
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(
  /\/$/,
  ""
);
export const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL || "").replace(
  /\/$/,
  ""
);

// keep S3_BUCKET internal
const S3_BUCKET =
  process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.BUCKET_NAME;

/* ========================
   CONTROLLERS
   ======================== */

/* POST /api/resume/send-link */
export async function sendResumeLink(req, res) {
  const reqId = req.requestId || "-";
  try {
    const { email, token } = req.body || {};
    if (!isEmail(email))
      return res.status(400).json({ ok: false, error: "Invalid email" });
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const draft = await FormDraft.findOne({ token }).lean();
    if (!draft)
      return res.status(404).json({ ok: false, error: "Draft not found" });

    const rt = genToken(24);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
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
    const text = `Hello,


${exchangeUrl}

If you did not request this, please ignore this email.`;

    const html = `
      <p>Hello,</p>
      <p>Use this secure link (valid for 14 days) to resume your application:</p>
      <p><a href="${exchangeUrl}">${exchangeUrl}</a></p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    const mail = await sendHtmlEmail({
      to: email,
      subject,
      html,
      text,
      replyTo: process.env.REPLY_TO || undefined,
      kind: "resume-link",
      requestId: reqId,
    });

    await FormDraft.findOneAndUpdate(
      { token },
      { $set: { email, lastActivityAt: new Date(), lastEmailStatus: mail } },
      { upsert: true }
    );

    console.log("[resume][send-link]", {
      reqId,
      email,
      ok: mail?.ok,
      id: mail?.id,
    });

    return res.json({ ok: true, mail, exchangeUrl });
  } catch (err) {
    console.error("sendResumeLink error:", {
      reqId,
      error: err?.message || err,
    });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

/* GET /api/resume/exchange */
export async function exchangeResumeToken(req, res) {
  try {
    const { rt } = req.query || {};
    if (!rt) return res.status(400).send("Missing token");

    const doc = await ResumeToken.findOne({ resumeToken: rt }).lean();
    if (!doc) return res.status(404).send("Token not found");
    if (doc.used) return res.status(410).send("Token already used");
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now())
      return res.status(410).send("Token expired");

    await ResumeToken.updateOne({ resumeToken: rt }, { $set: { used: true } });

    /* ---- siempre set cookie (útil para navegación clásica) ---- */
    res.cookie("resume", doc.submissionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 14 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    /* ---- responde según quién lo pide ---- */
    const wantsJSON =
      req.xhr ||
      (req.headers.accept || "").includes("application/json") ||
      req.headers["content-type"]?.includes("application/json");

    if (wantsJSON) {
      // llamado vía fetch → devolver JSON para que el frontend hidrate
      return res.json({ ok: true, token: doc.submissionId });
    }

    // navegación directa → redirigir al sitio público
    const redirectTo = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL}/?resumed=1`
      : "/";
    return res.redirect(302, redirectTo);
  } catch (err) {
    console.error("exchangeResumeToken error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

/* GET /api/resume/get-draft */
export async function getDraft(req, res) {
  const reqId = req.requestId || "-";
  try {
    const token = req.query?.token || req.cookies?.resume;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const doc = await FormDraft.findOne({ token }).lean();
    if (!doc?.s3Key)
      return res.status(404).json({ ok: false, error: "Draft not found" });
    if (!S3_BUCKET)
      return res
        .status(500)
        .json({ ok: false, error: "Missing S3 bucket env" });

    const obj = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: doc.s3Key })
    );
    const text = await streamToString(obj.Body);
    console.log("[S3][read]", { reqId, key: doc.s3Key, bytes: text.length });
    const json = JSON.parse(text);

    const payload = json?.data || json || {};
    if (typeof doc.step === "number") payload.step = doc.step;

    return res.json(payload);
  } catch (err) {
    console.error("getDraft error:", { reqId, error: err?.message || err });
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

/* GET /api/resume/whoami */
export async function whoAmI(req, res) {
  try {
    const token = req.cookies?.resume || null;
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("whoAmI error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

/* POST /api/resume/logout */
export async function logout(req, res) {
  try {
    res.clearCookie("resume", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}