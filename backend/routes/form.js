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
router.get("/generate-upload-url", generateUploadUrl);

// Draft save
router.post("/save-draft", upload.none(), saveDraft);

// Reader view
router.get("/form/view", getViewData);

// Final submit
router.post(
  "/submit-form",
  (req, res, next) => upload.none()(req, res, next),
  handleFormSubmission
);

export default router;
