import mongoose from "mongoose";

const formDraftSchema = new mongoose.Schema({
  token: { type: String, index: true, required: true, unique: true },
  s3Key: { type: String, required: true }, // p.ej. drafts/<token>.json
  step: { type: Number, default: 0 },
  status: { type: String, default: "draft" }, // draft | finalized
  updatedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 }, // TTL 6 meses
  finalizedAt: { type: Date },
});

const FormDraft = mongoose.model("FormDraft", formDraftSchema);
export default FormDraft;
