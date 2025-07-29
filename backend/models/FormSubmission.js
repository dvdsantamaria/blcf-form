import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, index: true, required: true, unique: true }, // = token
  s3Key: { type: String, required: true }, // submissions/<ts>_<token>.json
  status: { type: String, default: "submitted" },
  fileKeys: [{ field: String, key: String }],
  createdAt: { type: Date, default: Date.now },
});

const FormSubmission = mongoose.model("FormSubmission", formSubmissionSchema);
export default FormSubmission;
