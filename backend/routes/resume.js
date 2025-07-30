// backend/routes/resume.js
import express from "express";
import {
  sendResumeLink,
  exchangeResumeToken,
  whoAmI,
  logout,
} from "../controllers/resumeController.js";

const router = express.Router();

router.post("/send-link", sendResumeLink); // { email, token }
router.get("/exchange", exchangeResumeToken);
router.get("/whoami", whoAmI);
router.post("/logout", logout);

export default router;
