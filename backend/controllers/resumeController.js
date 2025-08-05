// backend/controllers/resumeController.js
import "dotenv/config";
import crypto from "crypto";
import fetch from "node-fetch";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

import ResumeToken from "../models/ResumeToken.js";
import FormDraft from "../models/FormDraft.js";

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

/* ---------- Utilidades ---------- */
function genToken(len = 24) {
  return crypto.randomBytes(len).toString("base64url");
}
function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

/* ---------- Constantes ---------- */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL || "").replace(
  /\/$/,
  ""
);
const S3_BUCKET =
  process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.BUCKET_NAME;

/* ========================
   EMAIL via Resend
   ======================== */
async function sendResendEmail(to, subject, text) {
  try {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM =
      process.env.RESEND_FROM || "no-reply@grants.beyondlimitscf.org.au";

    if (!RESEND_KEY) {
      console.error("[Resend] RESEND_API_KEY not set");
      return { ok: false, code: "NO_API_KEY" };
    }
    if (!isEmail(to)) {
      console.error("[Resend] bad recipient:", to);
      return { ok: false, code: "BAD_TO" };
    }

    const payload = {
      from: FROM,
      to: [to],
      subject,
      text,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Resend] error", err);
      return { ok: false, code: "RESEND_ERR", message: err };
    }

    const out = await res.json();
    console.log("[Resend] sent", { to, id: out?.id });
    return { ok: true, id: out?.id };
  } catch (e) {
    console.error("[Resend] exception", e);
    return { ok: false, code: "EXCEPTION", message: e?.message || String(e) };
  }
}

/* ========================
   CONTROLLERS
   ======================== */

/* POST /api/resume/send-link */
export async function sendResumeLink(req, res) {
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
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await ResumeToken.create({
      resumeToken: rt,
      submissionId: token,
      email,
      expiresAt,
    });

    const exchangeUrl = `${
      BACKEND_BASE_URL || PUBLIC_BASE_URL
    }/api/resume/exchange?rt=${encodeURIComponent(rt)}`;

    const mail = await sendResendEmail(
      email,
      "Resume your application",
      `Hello,

Use this secure link (valid 24 h) to resume your application:

${exchangeUrl}

If you didn't request this, please ignore this email.`
    );

    await FormDraft.findOneAndUpdate(
      { token },
      { $set: { email, lastActivityAt: new Date(), lastEmailStatus: mail } },
      { upsert: true }
    );

    return res.json({ ok: true, mail, exchangeUrl });
  } catch (err) {
    console.error("sendResumeLink error:", err);
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

    res.cookie("resume", doc.submissionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });

    const redirectTo = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/?resumed=1` : "/";
    return res.redirect(302, redirectTo);
  } catch (err) {
    console.error("exchangeResumeToken error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

/* GET /api/resume/get-draft */
export async function getDraft(req, res) {
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
    const json = JSON.parse(text);

    const payload = json?.data || json || {};
    if (typeof doc.step === "number") payload.step = doc.step;

    return res.json(payload);
  } catch (err) {
    console.error("getDraft error:", err);
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
