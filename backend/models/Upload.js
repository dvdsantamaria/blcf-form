// models/Upload.js
import mongoose from "mongoose";

const UploadSchema = new mongoose.Schema({
  key: { type: String, required: true }, // S3 object key
  label: { type: String, required: true }, // campo del form (ej: docs.ndisCommunication)
  originalName: { type: String, required: true }, // nombre original
  fileType: { type: String, required: true }, // MIME (ej: application/pdf)
  token: { type: String }, // opcional (guardar y volver)
  uploadedAt: { type: Date, default: Date.now },
});

const Upload = mongoose.model("Upload", UploadSchema);

export default Upload;
