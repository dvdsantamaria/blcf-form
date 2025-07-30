// backend/routes/admin.js
import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import {
  listSubmissions,
  getManifest,
  adminFileUrl,
  createArchive,
} from "../controllers/adminController.js";

const router = express.Router();
router.use(authAdmin);

router.get("/submissions", listSubmissions);
router.get("/submission/:token/manifest", getManifest);
router.get("/file-url", adminFileUrl);
router.post("/submission/:token/archive", createArchive); // opcional

export default router;
