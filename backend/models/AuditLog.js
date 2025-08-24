import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now, index: true },
    // Para borrado automático opcional, activa la línea de abajo con un TTL (en días)
    // expiresAt: { type: Date, index: { expires: '400d' } },

    reqId: String,
    ip: String,
    ua: String,

    actorType: { type: String, enum: ["admin", "token", "unknown"], default: "unknown" },
    actorEmail: String,       // si viene de AdminMagic
    token: String,            // si viene del reader/token

    action: { type: String, enum: ["presign-get", "view-data"], required: true },
    key: String,              // S3 key involucrada (o keys si querés almacenar ambas)
    extra: mongoose.Schema.Types.Mixed,  // por si querés guardar más contexto
    httpStatus: Number
  },
  { versionKey: false }
);

// índices útiles
auditLogSchema.index({ action: 1, ts: -1 });
auditLogSchema.index({ token: 1, ts: -1 });
auditLogSchema.index({ actorEmail: 1, ts: -1 });

export default mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);