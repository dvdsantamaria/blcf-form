// backend/models/FormSubmission.js
import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, index: true, required: true, unique: true }, // = token
  s3Key: { type: String, required: true }, // submissions/{token}/final/submission.json
  status: { type: String, default: "submitted" }, // submitted | under_review | approved | ...
  fileKeys: [{ field: String, key: String }],
  email: { type: String },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

const FormSubmission = mongoose.model("FormSubmission", formSubmissionSchema);
export default FormSubmission;
