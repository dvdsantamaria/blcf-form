import express from "express";
import multer from "multer";
import {
  handleFormSubmission,
  saveDraft,
} from "../controllers/formController.js";

const router = express.Router();
const upload = multer(); // Para recibir formData (sin archivos por ahora)

router.post("/submit-form", upload.none(), handleFormSubmission);
router.post("/save-draft", upload.none(), saveDraft);

export default router;
