// backend/routes/resume.js
import express from "express";
import {
  sendResumeLink,
  exchangeResumeToken,
  whoAmI,
  getDraft,
  logout,
  testSes,
} from "../controllers/resumeController.js";

const router = express.Router();

router.post("/send-link", sendResumeLink);
router.get("/exchange", exchangeResumeToken);
router.get("/whoami", whoAmI);
router.get("/get-draft", getDraft);
router.post("/logout", logout);

// dev only (requires ENABLE_SES_TEST=1)
router.get("/test-email", testSes);

export default router;
