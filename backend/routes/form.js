// backend/routes/form.js
import express from "express";
import multer from "multer";

import {
  generateUploadUrl,
  saveDraft,
  getDraft,
  handleFormSubmission,
} from "../controllers/formController.js";

const router = express.Router();
const upload = multer(); // For form-data bodies without files

// Generate pre-signed URL for S3 upload
router.get("/generate-upload-url", generateUploadUrl);

// Save draft form (no file handling required)
router.post("/save-draft", upload.none(), saveDraft);

// Retrieve saved draft
router.get("/get-draft", getDraft);

// Submit final form (also no file in body, files are on S3)
router.post("/submit-form", (req, res, next) => {
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
