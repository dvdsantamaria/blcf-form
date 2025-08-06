import mongoose from "mongoose";
const resumeTokenSchema = new mongoose.Schema(
  {
    resumeToken: { type: String, required: true, unique: true, index: true },
    submissionId: { type: String, required: true, index: true }, // = token del draft
    email: { type: String },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, index: { expires: 14 * 24 * 60 * 60 } },
  },
  { timestamps: true }
);

export default mongoose.model("ResumeToken", resumeTokenSchema);
