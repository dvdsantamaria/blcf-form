// backend/models/FormDraft.js
import mongoose from "mongoose";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formDraftSchema = new mongoose.Schema({
  token: { type: String, index: true, required: true, unique: true },
  s3Key: { type: String, required: true },
  step: { type: Number, default: 0 },
  status: { type: String, default: "draft" },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    match: EMAIL_RX,
    select: false,
  },
  fileKeys: [{ field: String, key: String }],            // <- added to track multiple uploads
  lastActivityAt: { type: Date, default: Date.now },
  updatedAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 180, // 180 days
  },
  finalizedAt: { type: Date },

  // new fields for resume email tracking
  lastResumeEmailAt: { type: Date },
  lastResumeEmailTo: { type: String, select: false },
});

const FormDraft = mongoose.model("FormDraft", formDraftSchema);
export default FormDraft;

