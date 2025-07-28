import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema(
  {
    step: {
      type: Number,
      required: false,
    },
    data: {
      type: Object,
      required: true,
    },
  },
  { timestamps: true }
); // crea createdAt y updatedAt automáticamente

const FormSubmission = mongoose.model("FormSubmission", formSubmissionSchema);

export default FormSubmission;
