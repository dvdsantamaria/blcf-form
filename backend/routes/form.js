// backend/routes/form.js
import express from "express";
import multer from "multer";

import {
  generateUploadUrl,
  saveDraft,
  handleFormSubmission,
  getViewData,
} from "../controllers/formController.js";

const router = express.Router();
const upload = multer();

// Presigned
router.get("/generate-upload-url", generateUploadUrl);

// Draft
router.post("/save-draft", upload.none(), saveDraft);

// Reader view (tokenizado) -> /api/form/view
router.get("/form/view", getViewData);

// Submit final
router.post("/submit-form", (req, res) => {
  upload.none()(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        ok: false,
        error: "Form parsing error",
        details: err.message,
      });
    }
    handleFormSubmission(req, res);
  });
});

export default router;
