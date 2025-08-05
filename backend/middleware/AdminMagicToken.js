/* AdminMagicToken.js
 * Magic-link login for the admin area.
 * … (header intact, sin cambios) …
 */

import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
// Con Node 18+ ya existe fetch global; si lo prefieres quita la línea siguiente
import fetch from "node-fetch";

/* =========================
   Config and helpers
   ========================= */

function makeConfig(overrides = {}) {
  const envList = (s) =>
    (s || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

  const cfg = {
    allowedEmails:
      overrides.allowedEmails ||
      envList(process.env.ADMIN_ALLOWED_EMAILS) ||
      [],
    jwtSecret:
      overrides.jwtSecret ||
      process.env.ADMIN_JWT_SECRET ||
      crypto.randomBytes(32).toString("hex"),
    sessionSecret:
      overrides.sessionSecret ||
      process.env.ADMIN_SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),
    tokenTtlMinutes: Number(
      overrides.tokenTtlMinutes || process.env.ADMIN_MAGIC_TTL_MIN || 15
    ),
    sessionTtlHours: Number(
      overrides.sessionTtlHours || process.env.ADMIN_SESSION_TTL_HOURS || 12
    ),
    uiBaseUrl: overrides.uiBaseUrl || process.env.ADMIN_UI_BASE_URL || "",
    fromEmail:
      overrides.fromEmail || process.env.SES_FROM || "no-reply@example.com",
    mailer: overrides.mailer || process.env.ADMIN_MAILER || "console",
    resendKey: overrides.resendKey || process.env.RESEND_API_KEY || "",
    brandName: overrides.brandName || process.env.ADMIN_BRAND || "Admin Access",
    apiBasePath: overrides.apiBasePath || "/api/admin/auth",
  };

  if (!Array.isArray(cfg.allowedEmails) || cfg.allowedEmails.length === 0) {
    console.warn(
      "[AdminMagic] No allowedEmails configured. Only console delivery makes sense in dev."
    );
  }
  return cfg;
}

function signMagicToken(email, cfg) {
  return jwt.sign({ sub: email, typ: "magic" }, cfg.jwtSecret, {
    expiresIn: `${cfg.tokenTtlMinutes}m`,
  });
}

function signSessionToken(email, cfg) {
  return jwt.sign(
    { sub: email, role: "admin", typ: "session" },
    cfg.sessionSecret,
    { expiresIn: `${cfg.sessionTtlHours}h` }
  );
}

function verifyMagicToken(token, cfg) {
  const payload = jwt.verify(token, cfg.jwtSecret);
  if (payload.typ !== "magic") throw new Error("Invalid token type");
  return payload;
}

function verifySessionToken(token, cfg) {
  const payload = jwt.verify(token, cfg.sessionSecret);
  if (payload.typ !== "session") throw new Error("Invalid token type");
  return payload;
}

/* =========================
   Email delivery (pluggable)
   ========================= */

async function sendMagicMail({ to, link, cfg }) {
  if (cfg.mailer === "resend") {
    const RESEND_KEY = cfg.resendKey || process.env.RESEND_API_KEY;
    if (!RESEND_KEY) throw new Error("Missing Resend API key");

    const payload = {
      from: cfg.fromEmail,
      to: [to],
      subject: `${cfg.brandName} magic link`,
      html: `
        <p>Use this link to access ${cfg.brandName}:</p>
        <p><a href="${link}">${link}</a></p>
        <p>This link expires in ${cfg.tokenTtlMinutes} minutes.</p>
      `,
      text: `Use this link to access ${cfg.brandName}: ${link}\nThis link expires in ${cfg.tokenTtlMinutes} minutes.`,
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
      throw new Error("Resend API error: " + err);
    }
    return;
  }

  // Console fallback (dev)
  console.log(`[AdminMagic] Magic link for ${to}: ${link}`);
}

/* =========================
   Rate limit (simple in-memory)
   ========================= */

const lastSendMsByEmail = new Map();
function canSend(email, minIntervalMs = 60_000) {
  const last = lastSendMsByEmail.get(email) || 0;
  const now = Date.now();
  if (now - last < minIntervalMs) return false;
  lastSendMsByEmail.set(email, now);
  return true;
}

/* =========================
   Router factory
   ========================= */

export function buildAdminMagicRouter(overrides = {}) {
  const config = makeConfig(overrides);
  const router = express.Router();

  router.use(express.json());

  // Request magic link
  router.post("/request", async (req, res) => {
    try {
      const emailRaw = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!emailRaw) return res.status(400).json({ error: "Missing email" });

      if (!config.allowedEmails.includes(emailRaw))
        return res.status(403).json({ error: "Email not allowed" });

      if (!canSend(emailRaw))
        return res
          .status(429)
          .json({ error: "Too many requests. Try again in a minute." });

      const magic = signMagicToken(emailRaw, config);

      // Build the link (prefer configured UI URL, else infer)
      const base = config.uiBaseUrl || `${req.protocol}://${req.get("host")}`;
      const link = `${base}${
        base.endsWith("/") ? "" : "/"
      }?m=${encodeURIComponent(magic)}`;

      await sendMagicMail({ to: emailRaw, link, cfg: config });
      res.json({ ok: true });
    } catch (err) {
      console.error("[AdminMagic] /request error", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Verify magic token and mint session
  router.get("/verify", (req, res) => {
    try {
      const token = String(req.query.token || "");
      if (!token) return res.status(400).json({ error: "Missing token" });

      const payload = verifyMagicToken(token, config);
      const email = String(payload.sub || "").toLowerCase();
      if (!config.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });

      const session = signSessionToken(email, config);
      const decoded = jwt.decode(session);
      res.json({ token: session, exp: decoded?.exp || null });
    } catch (err) {
      console.error("[AdminMagic] /verify error", err);
      res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  // Serve the small frontend snippet
  router.get("/client.js", (_req, res) => {
    res.type("application/javascript").send(buildClientScript(config));
  });

  return { router, config };
}

/* =========================
   Auth middleware
   ========================= */

export function authAdminMagic(configOrOverrides = {}) {
  const cfg =
    typeof configOrOverrides.jwtSecret === "string" ||
    configOrOverrides.sessionSecret
      ? configOrOverrides
      : makeConfig(configOrOverrides);

  return function authAdminMagicMiddleware(req, res, next) {
    try {
      const t = req.header("x-admin-token") || "";
      if (!t) return res.status(401).json({ error: "Missing admin token" });
      const payload = verifySessionToken(t, cfg);
      const email = String(payload.sub || "").toLowerCase();
      if (!cfg.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired session" });
    }
  };
}

/* =========================
   Frontend snippet generator
   ========================= */

function buildClientScript(cfg) {
  // … (sin cambios, se mantiene igual) …
}
/* End of AdminMagicToken.js */
