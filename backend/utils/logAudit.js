import AuditLog from "../models/AuditLog.js";

export async function logAudit(req, payload) {
  try {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() || req.ip;
    const ua = req.headers["user-agent"] || "";
    const actorEmail = req.admin?.email || null;         // si AdminMagic adjunta el usuario en req.admin
    const token = req.query?.token || req.body?.token || null;

    const actorType = actorEmail ? "admin" : (token ? "token" : "unknown");

    await AuditLog.create({
      ts: new Date(),
      reqId: req.requestId,
      ip, ua,
      actorType,
      actorEmail,
      token,
      action: payload.action,
      key: payload.key,
      extra: payload.extra || null,
      httpStatus: payload.httpStatus,
      ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    });
  } catch (e) {
    // no romper el flujo principal si falló el log
    console.warn("[audit][skip]", e?.message || e);
  }
}