// backfill-child.js
import mongoose from "mongoose";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const uri = process.env.MONGODB_URI;
const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
const token = process.argv[2]; // pasás el token como argumento

const FormSubmission = mongoose.model(
  "FormSubmission",
  new mongoose.Schema({}, { strict: false, collection: "formsubmissions" })
);

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function extractChildName(json) {
  const d = json?.data || {};
  const first = d["child.firstName"] || d.childFirstName || "";
  const last = d["child.lastName"] || d.childLastName || "";
  return { childFirst: first, childLast: last };
}

(async () => {
  if (!uri || !bucket || !token) {
    console.error("Missing uri/bucket/token");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const key = `submissions/${token}/final/submission.json`;
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await streamToString(obj.Body);
  const json = JSON.parse(text);

  const { childFirst, childLast } = extractChildName(json);
  console.log("Extracted:", { childFirst, childLast });

  if (childFirst || childLast) {
    await FormSubmission.updateOne(
      { submissionId: token },
      { $set: { childFirst, childLast } }
    );
    console.log("✅ Updated in Mongo");
  } else {
    console.warn("⚠️ No child name found");
  }

  await mongoose.disconnect();
})();