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
export async function sendSubmissionMail({
  to,
  token,
  role = "user",
  requestId,
}) {
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
    kind: role === "admin" ? "submission.admin" : "submission.user",
    requestId,
  });
}
