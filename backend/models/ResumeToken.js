// backend/models/ResumeToken.js
import mongoose from "mongoose";

const resumeTokenSchema = new mongoose.Schema({
  resumeToken: { type: String, index: true, unique: true, required: true }, // one-time token for email link
  submissionId: { type: String, index: true, required: true }, // = token del draft/submission
  email: { type: String },
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  // TTL basado en expiresAt (al llegar la fecha, Mongo lo elimina)
  expiresAt: { type: Date, index: { expires: 0 } },
});

const ResumeToken = mongoose.model("ResumeToken", resumeTokenSchema);
export default ResumeToken;
