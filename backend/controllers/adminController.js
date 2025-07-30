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

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;

async function listPrefix(Prefix, MaxKeys = 1000) {
  const out = [];
  let ContinuationToken;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix,
        ContinuationToken,
        MaxKeys,
      })
    );
    (res.Contents || []).forEach((o) =>
      out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified })
    );
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

// GET /api/admin/submissions
export async function listSubmissions(req, res) {
  try {
    const docs = await FormSubmission.find({}, { _id: 0, __v: 0 })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ ok: true, items: docs });
  } catch (err) {
    console.error("listSubmissions error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/submission/:token/manifest
export async function getManifest(req, res) {
  try {
    const token = req.params.token;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const uploads = await listPrefix(`submissions/${token}/uploads/`);
    const drafts = await listPrefix(`submissions/${token}/drafts/`);
    const final = await listPrefix(`submissions/${token}/final/`);

    // Enriquecer con Mongo si existe
    const sub = await FormSubmission.findOne({ submissionId: token }).lean();
    const draftMeta = await FormDraft.findOne({ token }).lean();

    const manifest = {
      token,
      status: sub?.status || draftMeta?.status || "unknown",
      email: sub?.email || draftMeta?.email || null,
      lastActivityAt: sub?.lastActivityAt || draftMeta?.lastActivityAt || null,
      uploads,
      drafts,
      final: final.length ? final[0] : null,
    };
    res.json({ ok: true, manifest });
  } catch (err) {
    console.error("getManifest error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/file-url?key=...
export async function adminFileUrl(req, res) {
  try {
    const { key } = req.query || {};
    if (!key) return res.status(400).json({ error: "Missing key" });
    if (!key.startsWith("submissions/"))
      return res.status(400).json({ error: "Invalid key prefix" });

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    res.json({ ok: true, url });
  } catch (err) {
    console.error("adminFileUrl error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// POST /api/admin/submission/:token/archive  (opcional; placeholder)
export async function createArchive(req, res) {
  try {
    // TODO: implementar armado ZIP y subir a submissions/{token}/exports/{ISO}.zip
    return res.status(501).json({ ok: false, error: "Not implemented yet" });
  } catch (err) {
    console.error("createArchive error:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}
