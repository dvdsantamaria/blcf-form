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

/* Send email via SES with clear logs (returns { ok, id } or { ok:false, code, message }) */
async function sendSesEmail(to, subject, text) {
  try {
    if (!process.env.SES_FROM) {
      return { ok: false, code: "NO_FROM", message: "SES_FROM not set" };
    }
    const cmd = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Source: process.env.SES_FROM,
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: text } },
      },
    });
    const out = await ses.send(cmd);
    console.log("[SES] sent", {
      to,
      from: process.env.SES_FROM,
      id: out?.MessageId,
    });
    return { ok: true, id: out?.MessageId };
  } catch (e) {
    const code = e?.Code || e?.name || "SES_ERROR";
    const message = e?.Error?.Message || e?.message || String(e);
    console.error("[SES] error", {
      to,
      from: process.env.SES_FROM,
      code,
      message,
    });
    return { ok: false, code, message };
  }
}

/* POST /api/resume/send-link  body: { email, token } */
export async function sendResumeLink(req, res) {
  try {
    console.log("[sendResumeLink] body received:", req.body);
    const { email, token } = req.body || {};
    if (!email || !isEmail(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email" });
    }
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing token" });
    }
    console.log("[sendResumeLink] email:", email, "token:", token);

    const draft = await FormDraft.findOne({ token }).lean();
    if (!draft) {
      return res
        .status(404)
        .json({ ok: false, error: "Draft not found for that token" });
    }

    const rt = genToken(24);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
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

    const subject = "Resume your application";
    const text = `Hello,

Use this secure link (valid 24h) to resume your application:

${exchangeUrl}

If you didn't request this, please ignore this email.`;

    const mail = await sendSesEmail(email, subject, text);
    console.log("[sendResumeLink] SES mail result:", mail);

    await FormDraft.findOneAndUpdate(
      { token },
      { $set: { email, lastActivityAt: new Date(), lastEmailStatus: mail } },
      { upsert: true }
    );

    return res.json({ ok: true, mail });
  } catch (err) {
    console.error("sendResumeLink error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

/* GET /api/resume/exchange?rt=...  (sets cookie and redirects to front) */
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

/* GET /api/resume/get-draft?token=...  (returns plain data for form) */
export async function getDraft(req, res) {
  try {
    const token = req.query?.token || req.cookies?.resume;
    if (!token) {
      return res.status(400).json({ ok: false, error: "Missing token" });
    }
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

/* GET /api/resume/whoami -> { ok, token } */
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

/* POST /api/resume/logout (clears cookie) */
export async function logout(req, res) {
  try {
    res.clearCookie("resume", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

/* DEV ONLY: test email endpoint
   Enabled only if process.env.ENABLE_SES_TEST === "1"
   GET /api/resume/test-email?email=...&token=...
*/
export async function testSes(req, res) {
  try {
    if (process.env.ENABLE_SES_TEST !== "1") {
      return res.status(403).json({ ok: false, error: "Disabled" });
    }
    const email = req.query?.email;
    const token = req.query?.token;
    if (!email || !isEmail(email) || !token) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing email or token" });
    }
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

    const exchangeUrl =
      BACKEND_BASE_URL || PUBLIC_BASE_URL
        ? `${
            BACKEND_BASE_URL || PUBLIC_BASE_URL
          }/api/resume/exchange?rt=${encodeURIComponent(rt)}`
        : `EXCHANGE: /api/resume/exchange?rt=${rt}`;

    const subject = "BLCF test email";
    const text = `Test link:

${exchangeUrl}

(24h)`;

    const mail = await sendSesEmail(email, subject, text);
    return res.json({ ok: true, mail, exchangeUrl });
  } catch (e) {
    console.error("testSes error:", e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}
