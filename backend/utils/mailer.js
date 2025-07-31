// backend/utils/mailer.js
import "dotenv/config";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses =
  process.env.SES_FROM && process.env.AWS_REGION
    ? new SESClient({ region: process.env.AWS_REGION })
    : null;

function buildReaderLink(token) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  // Por defecto usamos "/?mode=reader". Podés overridear con READER_PATH=/form/view
  const readerPath = process.env.READER_PATH || "/?mode=reader";
  const pathHasQuery = readerPath.includes("?");
  const path = pathHasQuery ? readerPath : `${readerPath}?`;
  const sep = path.endsWith("?") ? "" : "&";
  return base
    ? `${base}${path}${sep}token=${encodeURIComponent(token)}`
    : `${path}${sep}token=${encodeURIComponent(token)}`;
}

async function sendHtmlEmail({ to, subject, html, text }) {
  try {
    if (!ses || !process.env.SES_FROM || !to) {
      console.warn("[SES] Skipped (missing SES client / SES_FROM / to).", {
        to,
      });
      return { ok: false, skipped: true };
    }
    const cmd = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Source: process.env.SES_FROM, // usar identidad verificada (no hardcodear)
      Message: {
        Subject: { Data: subject },
        Body: {
          ...(html ? { Html: { Data: html } } : {}),
          ...(text ? { Text: { Data: text } } : {}),
        },
      },
    });
    const out = await ses.send(cmd);
    console.log("[SES] sent", { to, id: out?.MessageId });
    return { ok: true, id: out?.MessageId };
  } catch (e) {
    console.error("[SES] error:", e?.message || e);
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

  return sendHtmlEmail({ to, subject, html });
}
