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

// Read Node stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Tolerant child name extractor for various payload shapes
function pickChildNameFromJson(json) {
  const d = json?.data || {};

  const first =
    d?.child?.firstName ||
    d?.childFirstName ||
    d?.child_first_name ||
    d?.childFirst ||
    d?.child_first ||
    d["child.firstName"] ||   // <-- agregado
    d["child.first_name"] ||  // <-- agregado
    "";

  const last =
    d?.child?.lastName ||
    d?.childLastName ||
    d?.child_last_name ||
    d?.childLast ||
    d?.child_last ||
    d["child.lastName"] ||    // <-- agregado
    d["child.last_name"] ||   // <-- agregado
    "";

  const full =
    d?.child?.name ||
    d?.childName ||
    d["child.name"] ||        // <-- agregado
    "";

  let f = String(first || "").trim();
  let l = String(last || "").trim();
  if (!f && !l && full) {
    const parts = String(full).trim().split(/\s+/);
    f = parts.shift() || "";
    l = parts.join(" ");
  }
  return { f, l };
}

// List all S3 objects under a prefix
async function listPrefix(Prefix, MaxKeys = 1_000, reqId) {
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
      const batch = (res.Contents || []).map(({ Key, Size, LastModified }) => ({
        key: Key,
        size: Size,
        lastModified: LastModified,
      }));
      out.push(...batch);
      ContinuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
      console.log("[S3][list]", {
        reqId,
        prefix: Prefix,
        batch: batch.length,
        total: out.length,
      });
    } while (ContinuationToken);
  } catch (err) {
    console.error("listPrefix error:", {
      reqId,
      prefix: Prefix,
      error: err?.message || err,
    });
  }
  return out;
}

/* ──────────────── Controllers ──────────────── */

// GET /api/admin/submissions
export async function listSubmissions(req, res) {
  const reqId = req.requestId || "-";
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminEmail || !allowed.includes(adminEmail)) {
    console.warn("[admin][listSubmissions][forbidden]", { reqId, adminEmail });
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const baseItems = await FormSubmission.find({}, { _id: 0, __v: 0 })
      .sort({ lastActivityAt: -1, createdAt: -1 })
      .limit(500)
      .lean();

    // Enrich with childFirst childLast and submittedAt
    const items = await Promise.all(
      (baseItems || []).map(async (sub) => {
        let childFirst = sub.childFirst || "";
        let childLast = sub.childLast || "";
        let submittedAt = sub.submittedAt || null;

        try {
          const key = sub?.s3Key;
          if (key && (!childFirst || !childLast || !submittedAt)) {
            const obj = await s3.send(
              new GetObjectCommand({ Bucket: S3_BUCKET, Key: key })
            );
            const txt = await streamToString(obj.Body);
            const json = JSON.parse(txt);

            if (!childFirst || !childLast) {
              const picked = pickChildNameFromJson(json);
              childFirst = childFirst || picked.f || "";
              childLast = childLast || picked.l || "";
            }
            submittedAt = submittedAt || json?.submittedAt || null;
          }
        } catch (e) {
          console.warn("[admin][listSubmissions][parse]", {
            reqId,
            key: sub?.s3Key,
            error: e?.message || e,
          });
        }

        return { ...sub, childFirst, childLast, submittedAt };
      })
    );

    console.log("[admin][listSubmissions]", { reqId, count: items.length });
    res.json({ ok: true, items });
  } catch (err) {
    console.error("listSubmissions error:", {
      reqId,
      error: err?.message || err,
    });
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/submission/:token/manifest
export async function getManifest(req, res) {
  const reqId = req.requestId || "-";
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminEmail || !allowed.includes(adminEmail)) {
    console.warn("[admin][getManifest][forbidden]", { reqId, adminEmail });
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const { token } = req.params;
    if (!token)
      return res.status(400).json({ ok: false, error: "Missing token" });

    const [uploads, drafts, finals, sub, draftMeta] = await Promise.all([
      listPrefix(`submissions/${token}/uploads/`, 1_000, reqId),
      listPrefix(`submissions/${token}/drafts/`, 1_000, reqId),
      listPrefix(`submissions/${token}/final/`, 1_000, reqId),
      FormSubmission.findOne({ submissionId: token }).lean(),
      FormDraft.findOne({ token }).lean(),
    ]);

    const manifest = {
      token,
      status: sub?.status || draftMeta?.status || "unknown",
      email: sub?.email || draftMeta?.email || null,
      childFirst: sub?.childFirst || draftMeta?.childFirst || null,
      childLast: sub?.childLast || draftMeta?.childLast || null,
      lastActivityAt: sub?.lastActivityAt || draftMeta?.lastActivityAt || null,
      uploads,
      drafts,
      final: finals[0] || null,
    };

    console.log("[admin][manifest]", {
      reqId,
      token,
      uploads: uploads.length,
      drafts: drafts.length,
      finals: finals.length,
    });
    res.json({ ok: true, manifest });
  } catch (err) {
    console.error("getManifest error:", { reqId, error: err?.message || err });
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// GET /api/admin/file-url?key=...
export async function adminFileUrl(req, res) {
  const reqId = req.requestId || "-";
  const adminEmail = req.adminEmail;
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminEmail || !allowed.includes(adminEmail)) {
    console.warn("[admin][file-url][forbidden]", { reqId, adminEmail });
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
      { expiresIn: 300 }
    );
    console.log("[S3][presign-get][admin]", { reqId, key, ttl: 300 });
    res.json({ ok: true, url });
  } catch (err) {
    console.error("adminFileUrl error:", { reqId, error: err?.message || err });
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
}

// POST /api/admin/submission/:token/archive   (placeholder)
export async function createArchive(_, res) {
  res.status(501).json({ ok: false, error: "Not implemented yet" });
}