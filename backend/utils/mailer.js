// backend/utils/mailer.js
import "dotenv/config";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function isAbsolute(url) {
  return /^https?:\/\//i.test(url);
}

function buildReaderLink(token) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const readerPath = process.env.READER_PATH || "/?mode=reader";

  if (isAbsolute(readerPath)) {
    const sep = readerPath.includes("?") ? "&" : "?";
    return `${readerPath}${sep}token=${encodeURIComponent(token)}`;
  }

  const pathHasQuery = readerPath.includes("?");
  const path = pathHasQuery ? readerPath : `${readerPath}?`;
  const sep = path.endsWith("?") ? "" : "&";

  return base
    ? `${base}${path}${sep}token=${encodeURIComponent(token)}`
    : `${path}${sep}token=${encodeURIComponent(token)}`;
}

function dump(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Send HTML email using Resend SDK.
 * Accepts optional text and replyTo.
 */
export async function sendHtmlEmail({ to, subject, html, text, replyTo }) {
  try {
    const FROM =
      process.env.RESEND_FROM ||
      process.env.SES_FROM ||
      "onboarding@resend.dev";

    if (!resend) {
      console.warn("[Resend] Skipped (missing RESEND_API_KEY)", { to });
      return { ok: false, skipped: true };
    }
    if (!to || !FROM) {
      console.warn("[Resend] Skipped (missing to or from)", { to, FROM });
      return { ok: false, skipped: true };
    }

    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      ...(text ? { text } : {}), // include plain text when provided
      ...(replyTo ? { reply_to: replyTo } : {}),
    });

    if (error) {
      console.error("[Resend] send error:", dump(error));
      throw new Error(error?.message || dump(error));
    }

    console.log("[Resend] sent", { to, id: data?.id });
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error("[Resend] error:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function sendSubmissionMail({ to, token, role = "user" }) {
  const link = buildReaderLink(token);
  const subject =
    role === "admin"
      ? "BLCF – New grant application received"
      : "BLCF – Your application has been submitted";

  const html = `
    <p>${
      role === "admin"
        ? "A new submission has been received."
        : "Thank you for submitting your application."
    }</p>
    <p>You can view it here:</p>
    <p><a href="${link}">${link}</a></p>
    <p>Ref: <code>${token}</code></p>
  `;

  const text = `${
    role === "admin"
      ? "A new submission has been received."
      : "Thank you for submitting your application."
  }

View it here:
${link}

Ref: ${token}
`;

  return sendHtmlEmail({
    to,
    subject,
    html,
    text,
    replyTo: process.env.REPLY_TO || undefined,
  });
}
