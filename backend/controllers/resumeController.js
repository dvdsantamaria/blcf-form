// backend/controllers/resumeController.js
import "dotenv/config";
import crypto from "crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
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

// POST /api/resume/send-link   { email, token }
export async function sendResumeLink(req, res) {
  try {
    const { email, token } = req.body || {};
    if (!email || !isEmail(email))
      return res.status(400).json({ ok: false, error: "Invalid email" });
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    // Verificá que exista draft para ese token (opcional pero recomendado)
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
      BACKEND_BASE_URL || PUBLIC_BASE_URL || ""
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
    } else {
      console.warn(
        "[sendResumeLink] SES_FROM not set. DEV fallback link:",
        exchangeUrl
      );
    }

    // Guarda email en draft
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
// Clic desde el email -> set cookie HttpOnly con submissionId y redirige al front
export async function exchangeResumeToken(req, res) {
  try {
    const { rt } = req.query || {};
    if (!rt) return res.status(400).send("Missing token");

    const doc = await ResumeToken.findOne({ resumeToken: rt }).lean();
    if (!doc) return res.status(404).send("Token not found");
    if (doc.used) return res.status(410).send("Token already used");
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      return res.status(410).send("Token expired");
    }

    // marcar como usado
    await ResumeToken.updateOne({ resumeToken: rt }, { $set: { used: true } });

    // set cookie HttpOnly (contiene submissionId -> se usa para recuperar el draft sin exponerlo en URL)
    const cookieOpts = {
      httpOnly: true,
      secure: true, // en prod con HTTPS
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    };
    res.cookie("resume", doc.submissionId, cookieOpts);

    const redirectTo = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/?resumed=1` : "/";
    return res.redirect(302, redirectTo);
  } catch (err) {
    console.error("exchangeResumeToken error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

// GET /api/resume/whoami -> { ok, token } si hay cookie
export async function whoAmI(req, res) {
  try {
    const token = req.cookies?.resume;
    if (!token) return res.json({ ok: true, token: null });
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("whoAmI error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// POST /api/resume/logout -> limpia cookie
export async function logout(req, res) {
  try {
    res.clearCookie("resume", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}
