// backend/utils/mailer.js
import "dotenv/config";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses =
  process.env.SES_FROM && process.env.AWS_REGION
    ? new SESClient({ region: process.env.AWS_REGION })
    : null;

function isAbsolute(url) {
  return /^https?:\/\//i.test(url);
}

function buildReaderLink(token) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  // Por defecto usamos "/?mode=reader". Podés overridear con READER_PATH=/form/view o un absoluto.
  const readerPath = process.env.READER_PATH || "/?mode=reader";

  // Si READER_PATH es absoluto, lo usamos como base y sólo agregamos el token
  if (isAbsolute(readerPath)) {
    const sep = readerPath.includes("?") ? "&" : "?";
    return `${readerPath}${sep}token=${encodeURIComponent(token)}`;
  }

  const pathHasQuery = readerPath.includes("?");
  const path = pathHasQuery ? readerPath : `${readerPath}?`;
  const sep = path.endsWith("?") ? "" : "&";

  // Evitar doble slash: `${base}${path}` cuando path empieza con "/"
  return base
    ? `${base}${path}${sep}token=${encodeURIComponent(token)}`
    : `${path}${sep}token=${encodeURIComponent(token)}`;
}

async function sendHtmlEmail({ to, subject, html, text, replyTo }) {
  try {
    if (!ses || !process.env.SES_FROM || !to) {
      console.warn("[SES] Skipped (missing SES client / SES_FROM / to).", {
        to,
      });
      return { ok: false, skipped: true };
    }

    const cmd = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Source: process.env.SES_FROM, // usar identidad verificada
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
      Message: {
        Subject: { Data: subject /* , Charset: "UTF-8" */ },
        Body: {
          ...(html ? { Html: { Data: html /* , Charset: "UTF-8" */ } } : {}),
          ...(text ? { Text: { Data: text /* , Charset: "UTF-8" */ } } : {}),
        },
      },
      // ...(process.env.SES_CONFIG_SET ? { ConfigurationSetName: process.env.SES_CONFIG_SET } : {}),
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
    replyTo: process.env.REPLY_TO || undefined, // opcional
  });
}
