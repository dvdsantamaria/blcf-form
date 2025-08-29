// backend/utils/mailer.js
import "dotenv/config";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function isAbsolute(url) {
  return /^https?:\/\//i.test(url);
}

// Legacy helper kept for compatibility. Not used anymore for submissions.
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
 * Accepts optional text, replyTo, kind (log label) and requestId.
 */
export async function sendHtmlEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  kind,
  requestId,
}) {
  try {
    const FROM =
      process.env.RESEND_FROM ||
      process.env.SES_FROM ||
      "onboarding@resend.dev";

    if (!resend) {
      console.warn("[mail][skip]", {
        reqId: requestId,
        reason: "missing RESEND_API_KEY",
        to,
        kind,
      });
      return { ok: false, skipped: true };
    }
    if (!to || !FROM) {
      console.warn("[mail][skip]", {
        reqId: requestId,
        reason: "missing to/from",
        to,
        FROM,
        kind,
      });
      return { ok: false, skipped: true };
    }

    console.log("[mail][send]", {
      reqId: requestId,
      kind: kind || "generic",
      to,
      subject,
    });

    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    });

    if (error) {
      console.error("[mail][error]", {
        reqId: requestId,
        kind: kind || "generic",
        to,
        error: dump(error),
      });
      throw new Error(error?.message || dump(error));
    }

    console.log("[mail][sent]", {
      reqId: requestId,
      kind: kind || "generic",
      to,
      id: data?.id,
    });
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error("[mail][catch]", {
      reqId: requestId,
      kind: kind || "generic",
      to,
      error: e?.message || String(e),
    });
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Build a human readable submission number. Safe to share, not an access secret.
 * Prefer passing submissionNumber from controller. This is a fallback.
 */
function makeSubmissionNumber(submissionNumber, requestId) {
  if (submissionNumber) return String(submissionNumber);
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(
    now.getUTCMonth() + 1
  ).padStart(2, "0")}`;
  const suffix = (requestId || Math.random().toString(36).slice(2))
    .toString()
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  return `BL-${yyyymm}-${suffix}`;
}

/**
 * Submission email without token or token links.
 * New param: submissionNumber (string). If omitted, a safe fallback is generated.
 * Param token is ignored here to keep backward compatibility in callers.
 */
export async function sendSubmissionMail({
  to,
  token, // ignored
  role = "user",
  requestId,
  submissionNumber,
}) {
  const adminUrl = "https://grants.beyondlimitscf.org.au/admin/";
  const subject =
    role === "admin"
      ? "BLCF: New grant application received"
      : "BLCF: Your application has been submitted";

  const ref = makeSubmissionNumber(submissionNumber, requestId);

  // HTML bodies (no token, no reader links)
  const html =
    role === "admin"
      ? `
        <p>A new submission has been received.</p>
        <p>Submission number: <strong>${ref}</strong></p>
        <p>Sign in to view it: <a href="${adminUrl}">${adminUrl}</a></p>
      `
      : `
        <p>Thank you for submitting your application.</p>
        <p>Submission number: <strong>${ref}</strong></p>
        <p>Our team will review it and contact you by email.</p>
      `;

  // Plain-text bodies
  const text =
    role === "admin"
      ? `A new submission has been received.
Submission number: ${ref}
Sign in to view it: ${adminUrl}
`
      : `Thank you for submitting your application.
Submission number: ${ref}
Our team will review it and contact you by email.
`;

  return sendHtmlEmail({
    to,
    subject,
    html,
    text,
    replyTo: process.env.REPLY_TO || undefined,
    kind: role === "admin" ? "submission.admin" : "submission.user",
    requestId,
  });
}