/* AdminMagicToken.js
   Magic-link login for the admin area.
   (header intact)
*/

import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// En Node 18+ ya existe fetch global —
// si usas una versión anterior instala node-fetch.
/////////////////////////////////////////////////////

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
    /* QUIÉNES PUEDEN RECIBIR EL LINK */
    allowedEmails:
      overrides.allowedEmails ||
      envList(process.env.ADMIN_ALLOWED_EMAILS) ||
      [],

    /* JWT secrets                        */
    jwtSecret:
      overrides.jwtSecret ||
      process.env.ADMIN_JWT_SECRET ||
      crypto.randomBytes(32).toString("hex"),
    sessionSecret:
      overrides.sessionSecret ||
      process.env.ADMIN_SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),

    /* TTLs */
    tokenTtlMinutes: Number(
      overrides.tokenTtlMinutes || process.env.ADMIN_MAGIC_TTL_MIN || 15
    ),
    sessionTtlHours: Number(
      overrides.sessionTtlHours || process.env.ADMIN_SESSION_TTL_HOURS || 12
    ),

    /* Frontend & mail */
    uiBaseUrl: overrides.uiBaseUrl || process.env.ADMIN_UI_BASE_URL || "",
    fromEmail:
      overrides.fromEmail ||
      process.env.RESEND_FROM || // ← primera opción
      "no-reply@grants.beyondlimitscf.org.au", // valor seguro por defecto
    mailer: overrides.mailer || process.env.ADMIN_MAILER || "resend",

    /* Resend */
    resendKey: overrides.resendKey || process.env.RESEND_API_KEY || "",

    /* Branding / paths */
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

/* ---------- JWT helpers ---------- */

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
   Email delivery (Resend / console)
   ========================= */

async function sendMagicMail({ to, link, cfg }) {
  if (cfg.mailer === "resend") {
    const RESEND_KEY = cfg.resendKey || process.env.RESEND_API_KEY;
    if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY");

    const payload = {
      from: cfg.fromEmail,
      to: [to],
      subject: `${cfg.brandName} magic link`,
      html: `
        <p>Use this link to access ${cfg.brandName}:</p>
        <p><a href="${link}">${link}</a></p>
        <p>This link expires in ${cfg.tokenTtlMinutes} minutes.</p>
      `,
      text: `Use this link to access ${cfg.brandName}: ${link}
This link expires in ${cfg.tokenTtlMinutes} minutes.`,
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

  // --- Fallback consola (dev) ---
  console.log(`[AdminMagic] Magic link for ${to}: ${link}`);
}

/* =========================
   Rate-limit (memoria)
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

  /* ---- POST /request ---- */
  router.post("/request", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });
      if (!config.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });
      if (!canSend(email))
        return res
          .status(429)
          .json({ error: "Too many requests. Try again later." });

      const magic = signMagicToken(email, config);
      const base = config.uiBaseUrl || `${req.protocol}://${req.get("host")}`;
      const link = `${base}${
        base.endsWith("/") ? "" : "/"
      }?m=${encodeURIComponent(magic)}`;

      await sendMagicMail({ to: email, link, cfg: config });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AdminMagic] /request error", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  /* ---- GET /verify ---- */
  router.get("/verify", (req, res) => {
    try {
      const token = String(req.query.token || "");
      if (!token) return res.status(400).json({ error: "Missing token" });

      const { sub: email } = verifyMagicToken(token, config);
      if (!config.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });

      const session = signSessionToken(email, config);
      const { exp } = jwt.decode(session) || {};
      return res.json({ token: session, exp });
    } catch (err) {
      console.error("[AdminMagic] /verify error", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  /* ---- Front-end snippet ---- */
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
      const { sub: email } = verifySessionToken(t, cfg);
      if (!cfg.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired session" });
    }
  };
}

/* =========================
   Front-end snippet generator
   ========================= */

function buildClientScript(cfg) {
  /* … SIN cambios: aquí va tu snippet de  ~200 líneas … */
}
/* End of AdminMagicToken.js */
