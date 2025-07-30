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
const upload = multer(); // para form-data sin archivos (ya subimos directo a S3)

// Endpoints únicos (no duplicar)
router.get("/generate-upload-url", generateUploadUrl);
router.post("/save-draft", upload.none(), saveDraft);
router.get("/get-draft", getDraft);
router.post("/submit-form", upload.none(), handleFormSubmission);

export default router;
