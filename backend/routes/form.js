import express from "express";
import multer from "multer";
import {
  handleFormSubmission,
  saveDraft,
  getDraft,
  generateUploadUrl,
} from "../controllers/formController.js";

const router = express.Router();
const upload = multer();

router.get("/generate-upload-url", generateUploadUrl);
router.post("/save-draft", upload.none(), saveDraft);
router.get("/get-draft", getDraft);
router.post("/submit-form", upload.none(), handleFormSubmission);

export default router;
