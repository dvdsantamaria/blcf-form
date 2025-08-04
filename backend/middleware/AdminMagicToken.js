/* AdminMagicToken.js
   Magic-link login (single file) for your admin.

   What this adds
   1) Backend endpoints (Express):
      - POST /api/admin/auth/request  (body: { email })
      - GET  /api/admin/auth/verify?token=...
      - GET  /api/admin/auth/client.js  (serves the frontend snippet)

   2) Middleware:
      - authAdminMagic(config)  (drop-in auth that validates x-admin-token as a signed session)

   3) Frontend snippet (no build needed):
      - <script src="/api/admin/auth/client.js"></script>
        Renders a pre-admin screen with email input for magic link.
        Handles magic token in URL (m=...) and stores a session in localStorage("adminToken").

   How to integrate (quick)
   - Server:
       import { buildAdminMagicRouter, authAdminMagic } from "./AdminMagicToken.js";
       const magic = buildAdminMagicRouter({
         // keep it simple; use envs in prod
         allowedEmails: ["owner@yourclient.com", "backup1@yourclient.com", "backup2@yourclient.com"],
         uiBaseUrl: "https://grants.beyondlimitscf.org.au/admin", // page that loads admin UI
         fromEmail: "contact@beyondlimitscf.org.au",
         mailer: "console" // "ses" or "smtp" if you want real email now
       });
       app.use("/api/admin/auth", magic.router);

       // If you want to switch your admin protection to magic sessions:
       // app.use("/api/admin", authAdminMagic(magic.config));

   - Frontend (admin page):
       Add BEFORE your current admin.js:
         <script src="/api/admin/auth/client.js"></script>

     The snippet will:
       - Show a minimal email form if no session is present.
       - If URL has ?m=... it will verify, set localStorage("adminToken"), and reload.

   Dependencies
   - None required for console mode (links go to server logs).
   - For email via AWS SES:  npm i @aws-sdk/client-ses
   - For email via SMTP:     npm i nodemailer

   Notes
   - Tokens: short-lived magic token (default 15 min) and session token (default 12 h) via JWT.
   - Allowed emails: strict list (use env ADMIN_ALLOWED_EMAILS in prod).
   - Rate limiting: simple in-memory (per email, 60 seconds).
*/

import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
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
        from: cfg.fromEmail, // Esto sale de SES_FROM
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

      const allowed = config.allowedEmails.includes(emailRaw);
      if (!allowed) return res.status(403).json({ error: "Email not allowed" });

      if (!canSend(emailRaw)) {
        return res
          .status(429)
          .json({ error: "Too many requests. Try again in a minute." });
      }

      const magic = signMagicToken(emailRaw, config);

      // Build the link (prefer configured UI URL, else infer)
      const base = config.uiBaseUrl || `${req.protocol}://${req.get("host")}`;
      // Append with query param m
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
      if (!config.allowedEmails.includes(email)) {
        return res.status(403).json({ error: "Email not allowed" });
      }

      const session = signSessionToken(email, config);
      const decoded = jwt.decode(session);
      res.json({ token: session, exp: decoded?.exp || null });
    } catch (err) {
      console.error("[AdminMagic] /verify error", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  // Serve the small frontend snippet
  router.get("/client.js", (req, res) => {
    const js = buildClientScript(config);
    res.type("application/javascript").send(js);
  });

  return { router, config };
}

/* =========================
   Auth middleware (server-side)
   Drop-in replacement for your admin protection.
   Validates x-admin-token as a session JWT.
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
      if (!cfg.allowedEmails.includes(email)) {
        return res.status(403).json({ error: "Email not allowed" });
      }
      // ok
      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
  };
}

/* =========================
   Frontend snippet
   - Shows a pre-admin email screen if no session.
   - Handles ?m=... to verify and store localStorage("adminToken").
   - Leaves your existing admin.js intact (it still reads adminToken).
   ========================= */

function buildClientScript(cfg) {
  // Keep it dependency-free and minimal
  const API = cfg.apiBasePath || "/api/admin/auth";
  const ttlInfo = `${cfg.tokenTtlMinutes} minutes`;
  const brand = cfg.brandName || "Admin";
  return `
  (function () {
    const API = ${JSON.stringify(API)};
    const TOKEN_KEY = "adminToken";
    const ttlInfo = ${JSON.stringify(
      cfg.tokenTtlMinutes + " minutes"
    )}; // si lo tenés en la config
  
    function qs(name) {
      const u = new URL(window.location.href);
      return u.searchParams.get(name);
    }
  
    function saveToken(t) {
      try { localStorage.setItem(TOKEN_KEY, t || ""); } catch(_) {}
    }
    function getToken() {
      try { return localStorage.getItem(TOKEN_KEY) || ""; } catch(_) { return ""; }
    }
    function clearQuery() {
      const u = new URL(window.location.href);
      u.searchParams.delete("m");
      u.searchParams.delete("magic");
      window.location.replace(u.toString());
    }
  
    async function verifyMagic(magic) {
      const url = API + "/verify?token=" + encodeURIComponent(magic);
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!data.token) throw new Error("Missing token");
      saveToken(data.token);
      clearQuery();
    }
  
    async function requestLink(email) {
      const res = await fetch(API + "/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      const ok = res.ok;
      const j = ok ? await res.json() : { error: await res.text() };
      if (!ok) throw new Error(j.error || "Request failed");
      return true;
    }
  
    function renderGate() {
      document.documentElement.style.height = "100%";
      document.body.style.margin = "0";
      document.body.style.minHeight = "100%";
      document.body.innerHTML = "";
      const root = document.createElement("div");
      root.innerHTML = \`
        <style>
          .amx-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; background:#f6f8fa; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; padding:16px; }
          .amx-card { width:100%; max-width:420px; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:20px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
          .amx-title { margin:0 0 6px 0; font-size:20px; }
          .amx-sub { margin:0 0 14px 0; color:#555; font-size:14px; }
          .amx-row { display:flex; gap:8px; }
          .amx-input { flex:1; padding:10px 12px; font-size:14px; border:1px solid #d1d5db; border-radius:8px; }
          .amx-btn { padding:10px 14px; font-size:14px; border-radius:8px; border:1px solid #0b5ed7; background:#0b5ed7; color:#fff; cursor:pointer; }
          .amx-btn[disabled] { opacity:.6; cursor:default; }
          .amx-msg { margin-top:12px; font-size:13px; color:#444; }
          .amx-err { color:#b91c1c; }
          .amx-ok { color:#065f46; }
        </style>
        <div class="amx-wrap">
          <div class="amx-card">
            <img src="/admin/logo-blcf.svg" alt="Logo" style="display:block;margin:0 auto 16px auto;width:72px;">
            <h2 class="amx-title">BLCF Admin access</h2>
            <p class="amx-sub">Enter your authorized email. We will send a magic link (expires in \${ttlInfo}).</p>
            <div class="amx-row">
              <input id="amx-email" class="amx-input" type="email" placeholder="you@company.com" autocomplete="email" />
              <button id="amx-send" class="amx-btn">Send link</button>
            </div>
            <div id="amx-msg" class="amx-msg"></div>
          </div>
        </div>
      \`;
      document.body.appendChild(root);
  
      const $email = document.getElementById("amx-email");
      const $btn = document.getElementById("amx-send");
      const $msg = document.getElementById("amx-msg");
  
      function setMsg(t, ok) {
        $msg.textContent = t;
        $msg.className = "amx-msg " + (ok ? "amx-ok" : "amx-err");
      }
  
      $btn.addEventListener("click", async () => {
        const v = ($email.value || "").trim().toLowerCase();
        if (!v || !v.includes("@")) { setMsg("Enter a valid email.", false); return; }
        $btn.disabled = true;
        setMsg("Sending...", true);
        try {
          await requestLink(v);
          setMsg("Link sent. Check your inbox.", true);
        } catch (e) {
          setMsg(e.message || "Could not send link.", false);
        } finally {
          $btn.disabled = false;
        }
      });
    }
  
    (async function init() {
      const m = qs("m") || qs("magic");
      if (m) {
        try {
          await verifyMagic(m);
          return;
        } catch (e) {
          console.error("Magic verify failed:", e);
          // fall through to gate
        }
      }
      const has = getToken();
      if (!has) renderGate();
    })();
  })();
  `;
}
/* End of AdminMagicToken.js */
