// backend/controllers/resumeController.js
import "dotenv/config";
import crypto from "crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import ResumeToken from "../models/ResumeToken.js";
import FormDraft from "../models/FormDraft.js";

const ses = new SESClient({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

function genToken(len = 24) {
  return crypto.randomBytes(len).toString("base64url");
}
function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL || "").replace(
  /\/$/,
  ""
);

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

const S3_BUCKET =
  process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.BUCKET_NAME;

// POST /api/resume/send-link   { email, token }
export async function sendResumeLink(req, res) {
  try {
    const { email, token } = req.body || {};
    if (!email || !isEmail(email))
      return res.status(400).json({ ok: false, error: "Invalid email" });
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    console.log("[sendResumeLink] email:", email, "token:", token);

    const draft = await FormDraft.findOne({ token }).lean();
    if (!draft) {
      return res
        .status(404)
        .json({ ok: false, error: "Draft not found for that token" });
    }

    const rt = genToken(24);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await ResumeToken.create({
      resumeToken: rt,
      submissionId: token,
      email,
      expiresAt,
    });

    const exchangeUrl =
      BACKEND_BASE_URL || PUBLIC_BASE_URL
        ? `${
            BACKEND_BASE_URL || PUBLIC_BASE_URL
          }/api/resume/exchange?rt=${encodeURIComponent(rt)}`
        : `EXCHANGE: /api/resume/exchange?rt=${rt}`;

    if (process.env.SES_FROM) {
      const cmd = new SendEmailCommand({
        Destination: { ToAddresses: [email] },
        Source: process.env.SES_FROM,
        Message: {
          Subject: { Data: "Resume your application" },
          Body: {
            Text: {
              Data: `Hello,\n\nUse this secure link (valid 24h) to resume your application:\n\n${exchangeUrl}\n\nIf you didn't request this, please ignore this email.`,
            },
          },
        },
      });
      await ses.send(cmd);
      console.log("[sendResumeLink] SES email sent to:", email);
    } else {
      console.warn(
        "[sendResumeLink] SES_FROM not set. DEV fallback link:",
        exchangeUrl
      );
    }

    await FormDraft.findOneAndUpdate(
      { token },
      { $set: { email, lastActivityAt: new Date() } },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("sendResumeLink error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/resume/exchange?rt=...
export async function exchangeResumeToken(req, res) {
  try {
    const { rt } = req.query || {};
    if (!rt) return res.status(400).send("Missing token");

    console.log("[exchangeResumeToken] Received token:", rt);

    const doc = await ResumeToken.findOne({ resumeToken: rt }).lean();
    if (!doc) return res.status(404).send("Token not found");
    if (doc.used) return res.status(410).send("Token already used");
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      return res.status(410).send("Token expired");
    }

    await ResumeToken.updateOne({ resumeToken: rt }, { $set: { used: true } });

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    };
    res.cookie("resume", doc.submissionId, cookieOpts);

    const redirectTo = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/?resumed=1` : "/";
    console.log("[exchangeResumeToken] Redirecting to:", redirectTo);
    return res.redirect(302, redirectTo);
  } catch (err) {
    console.error("exchangeResumeToken error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

// GET /api/resume/get-draft?token=...
export async function getDraft(req, res) {
  try {
    const token = req.query?.token || req.cookies?.resume;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    console.log("[getDraft] Token:", token);

    const doc = await FormDraft.findOne({ token }).lean();
    if (!doc || !doc.s3Key) {
      return res.status(404).json({ ok: false, error: "Draft not found" });
    }
    if (!S3_BUCKET) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing S3 bucket env" });
    }

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

// GET /api/resume/whoami
export async function whoAmI(req, res) {
  try {
    const token = req.cookies?.resume;
    console.log("[whoAmI] Resume cookie token:", token);
    return res.json({ ok: true, token: token || null });
  } catch (err) {
    console.error("whoAmI error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// POST /api/resume/logout
export async function logout(req, res) {
  try {
    res.clearCookie("resume", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}
