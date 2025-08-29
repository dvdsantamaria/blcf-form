// backend/models/FormSubmission.js
import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, index: true, required: true, unique: true },
  // Human readable reference (safe to share, not an access secret)
  submissionNumber: {
    type: String,
    unique: true,
    index: true,
    sparse: true, // allows old docs without this field until backfill
    required: true,
    trim: true,
  },
  s3Key: { type: String, required: true },
  status: { type: String, default: "submitted" },
  fileKeys: [{ field: String, key: String }], // supports multi file
  email: {
    type: String,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

// Auto generate submissionNumber if missing
formSubmissionSchema.pre("save", function (next) {
  if (this.submissionNumber) return next();

  const when = this.createdAt || new Date();
  const yyyymm = `${when.getUTCFullYear()}${String(
    when.getUTCMonth() + 1
  ).padStart(2, "0")}`;

  // Use last 8 hex chars of ObjectId for low collision risk
  const suffix = this._id.toString().slice(-8).toUpperCase();

  this.submissionNumber = `BL-${yyyymm}-${suffix}`;
  next();
});

const FormSubmission = mongoose.model("FormSubmission", formSubmissionSchema);
export default FormSubmission;