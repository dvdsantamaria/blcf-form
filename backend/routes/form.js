
// backend/routes/form.js
import express from "express";
import multer from "multer";
import {
  generateUploadUrl,
  saveDraft,
  handleFormSubmission,
  getViewData,
  getFileUrl,
} from "../controllers/formController.js";

const router = express.Router();
const upload = multer();

// Download presigned GET URL for a file
router.get("/form/file-url", getFileUrl);

// Presigned PUT URL for uploads
router.get("/form/generate-upload-url", generateUploadUrl); // <- scope under /form

// Draft save
router.post("/form/save-draft", upload.none(), saveDraft);    // <- scoped path

// Reader view
router.get("/form/view", getViewData);

// Final submit
router.post(
  "/form/submit-form",
  upload.none(),
  handleFormSubmission
);

export default router;