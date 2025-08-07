/* AdminMagicToken.js
   Magic-link login for the admin area.
   Comments concisos.
*/
import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

/* =============== Config & helpers =============== */
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
      overrides.fromEmail ||
      process.env.RESEND_FROM ||
      "no-reply@grants.beyondlimitscf.org.au",
    mailer: overrides.mailer || process.env.ADMIN_MAILER || "resend",
    resendKey: overrides.resendKey || process.env.RESEND_API_KEY || "",

    brandName: overrides.brandName || process.env.ADMIN_BRAND || "Admin Access",
    apiBasePath: overrides.apiBasePath || "/api/admin/auth",
  };

  return cfg;
}

/* ---------- JWT ---------- */
const signMagicToken = (email, cfg) =>
  jwt.sign({ sub: email, typ: "magic" }, cfg.jwtSecret, {
    expiresIn: `${cfg.tokenTtlMinutes}m`,
  });

const signSessionToken = (email, cfg) =>
  jwt.sign({ sub: email, role: "admin", typ: "session" }, cfg.sessionSecret, {
    expiresIn: `${cfg.sessionTtlHours}h`,
  });

const verifyMagicToken = (t, cfg) => {
  const p = jwt.verify(t, cfg.jwtSecret);
  if (p.typ !== "magic") throw new Error("Bad type");
  return p;
};
const verifySessionToken = (t, cfg) => {
  const p = jwt.verify(t, cfg.sessionSecret);
  if (p.typ !== "session") throw new Error("Bad type");
  return p;
};

/* ---------- Mail (Resend) ---------- */
async function sendMagicMail({ to, link, cfg }) {
  if (cfg.mailer !== "resend") {
    console.log(`[AdminMagic] link for ${to}: ${link}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.fromEmail,
      to: [to],
      subject: `${cfg.brandName} magic link`,
      html: `<p>Use this link to access ${cfg.brandName}:</p>
             <p><a href="${link}">${link}</a></p>
             <p>This link expires in ${cfg.tokenTtlMinutes} minutes.</p>`,
      text: `Use this link to access ${cfg.brandName}: ${link}`,
    }),
  });

  if (!res.ok) throw new Error("Resend error: " + (await res.text()));
}

/* ---------- Router factory ---------- */
export function buildAdminMagicRouter(overrides = {}) {
  const cfg = makeConfig(overrides);
  const router = express.Router();
  router.use(express.json());

  router.post("/request", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });
      if (!cfg.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });

      const magic = signMagicToken(email, cfg);
      const base = cfg.uiBaseUrl || `${req.protocol}://${req.get("host")}`;
      const link = `${base}${
        base.endsWith("/") ? "" : "/"
      }?m=${encodeURIComponent(magic)}`;

      await sendMagicMail({ to: email, link, cfg });
      res.json({ ok: true });
    } catch (e) {
      console.error("[AdminMagic]/request", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/verify", (req, res) => {
    try {
      const token = String(req.query.token || "");
      const { sub: email } = verifyMagicToken(token, cfg);
      if (!cfg.allowedEmails.includes(email))
        return res.status(403).json({ error: "Email not allowed" });

      const session = signSessionToken(email, cfg);
      const { exp } = jwt.decode(session);
      res.json({ token: session, exp });
    } catch (e) {
      console.error("[AdminMagic]/verify", e);
      res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  router.get("/client.js", (_req, res) => {
    res.type("application/javascript").send(buildClientScript(cfg));
  });

  return { router, config: cfg };
}

/* ---------- Auth middleware ---------- */
export function authAdminMagic(configOrOverrides = {}) {
  const cfg =
    configOrOverrides.sessionSecret || configOrOverrides.jwtSecret
      ? configOrOverrides
      : makeConfig(configOrOverrides);

  return function authAdminMagicMiddleware(req, res, next) {
    try {
      const t = req.header("x-admin-token") || "";
      if (!t) return res.status(401).json({ error: "Missing admin token" });

      const { sub: email } = verifySessionToken(t, cfg);
      if (!cfg.allowedEmails.includes(email.toLowerCase()))
        return res.status(403).json({ error: "Email not allowed" });

      /* ← fix: exponer email al resto de rutas */
      req.adminEmail = email;
      req.admin = { email };

      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired session" });
    }
  };
}

/* ---------- Front-end snippet (sin cambios) ---------- */
function buildClientScript(cfg) {
  // … tu snippet de ~200 líneas …
}
