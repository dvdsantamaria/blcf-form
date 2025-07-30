import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, index: true, required: true, unique: true },
  s3Key: { type: String, required: true },
  status: { type: String, default: "submitted" },
  fileKeys: [{ field: String, key: String }],
  email: { type: String },
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

const FormSubmission = mongoose.model("FormSubmission", formSubmissionSchema);
export default FormSubmission;
