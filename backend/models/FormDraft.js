import mongoose from "mongoose";

const formDraftSchema = new mongoose.Schema({
  step: {
    type: Number,
    required: false,
  },
  data: {
    type: Object,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 180, // Expira después de 6 meses
  },
});

const FormDraft = mongoose.model("FormDraft", formDraftSchema);

export default FormDraft;
