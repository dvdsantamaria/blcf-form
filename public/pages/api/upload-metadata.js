// /pages/api/upload-metadata.js

import dbConnect from "../../lib/dbConnect";
import Upload from "../../models/Upload";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await dbConnect();

    const { key, label, originalName, fileType, token } = req.body;

    if (!key || !label || !originalName || !fileType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const upload = new Upload({
      key,
      label,
      originalName,
      fileType,
      token,
      uploadedAt: new Date(),
    });

    await upload.save();

    res.status(200).json({ success: true, id: upload._id });
  } catch (error) {
    console.error("Error saving file metadata:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
