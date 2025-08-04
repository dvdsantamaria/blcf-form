// backend/routes/admin.js
import express from "express";
import { authAdminMagic } from "../middleware/AdminMagicToken.js";
import {
  listSubmissions,
  getManifest,
  adminFileUrl,
  createArchive,
} from "../controllers/adminController.js";

const router = express.Router();
// protegido por token JWT generado por magic link
router.use(authAdminMagic());

router.get("/submissions", listSubmissions);
router.get("/submission/:token/manifest", getManifest);
router.get("/file-url", adminFileUrl);
router.post("/submission/:token/archive", createArchive); // opcional

export default router;
