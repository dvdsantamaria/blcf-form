// backend/controllers/adminController.js
import "dotenv/config";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import FormSubmission from "../models/FormSubmission.js";
import FormDraft from "../models/FormDraft.js";

/* ──────────────── S3 setup ──────────────── */
const S3_BUCKET =
  process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || "";
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/* ──────────────── Helpers ──────────────── */
async function listPrefix(Prefix, MaxKeys = 1_000) {
  if (!S3_BUCKET) return [];

  const out = [];
  let ContinuationToken;

  try {
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix,
          ContinuationToken,
          MaxKeys,
        })
      );
      (res.Contents || []).forEach(({ Key, Size, LastModified }) =>
        out.push({ key: Key, size: Size, lastModified: LastModified })
      );
      ContinuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (ContinuationToken);
  } catch (err) {
    console.error("listPrefix error:", err);
  }
  return out;
}

/* ──────────────── Controllers ──────────────── */

// GET /api/admin/submissions
export async function listSubmissions(req, res) {
  // Authorization: only allow whitelisted admins
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!adminEmail || !allowed.includes(adminEmail)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const items = await FormSubmission.find({}, { _id: 0, __v: 0 })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ ok: true, items });
  } catch (err) {
    console.error("listSubmissions error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/submission/:token/manifest
export async function getManifest(req, res) {
  // Authorization
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!adminEmail || !allowed.includes(adminEmail)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const { token } = req.params;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const [uploads, drafts, finals, sub, draftMeta] = await Promise.all([
      listPrefix(`submissions/${token}/uploads/`),
      listPrefix(`submissions/${token}/drafts/`),
      listPrefix(`submissions/${token}/final/`),
      FormSubmission.findOne({ submissionId: token }).lean(),
      FormDraft.findOne({ token }).lean(),
    ]);

    const manifest = {
      token,
      status: sub?.status || draftMeta?.status || "unknown",
      email: sub?.email || draftMeta?.email || null,
      lastActivityAt: sub?.lastActivityAt || draftMeta?.lastActivityAt || null,
      uploads,
      drafts,
      final: finals[0] || null,
    };

    res.json({ ok: true, manifest });
  } catch (err) {
    console.error("getManifest error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/file-url?key=...
export async function adminFileUrl(req, res) {
  // Authorization
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!adminEmail || !allowed.includes(adminEmail)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const { key } = req.query || {};
    if (!key) return res.status(400).json({ ok: false, error: "Missing key" });
    if (!key.startsWith("submissions/"))
      return res.status(400).json({ ok: false, error: "Invalid key prefix" });

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: 300 } // 5 min
    );
    res.json({ ok: true, url });
  } catch (err) {
    console.error("adminFileUrl error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// POST /api/admin/submission/:token/archive   (placeholder)
export async function createArchive(_, res) {
  res.status(501).json({ ok: false, error: "Not implemented yet" });
}
