// backend/routes/resume.js
import express from "express";
import rateLimit from "express-rate-limit";

import {
  sendResumeLink,
  exchangeResumeToken,
  whoAmI,
  getDraft,
  logout,
} from "../controllers/resumeController.js";

const router = express.Router();

// Limita envíos de link para reanudar (previene abuso)
const sendLinkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 30, // 30 requests por IP
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/resume/send-link
router.post("/send-link", sendLinkLimiter, sendResumeLink);

// GET  /api/resume/exchange?rt=…
router.get("/exchange", exchangeResumeToken);

// GET  /api/resume/whoami
router.get("/whoami", whoAmI);

// GET  /api/resume/get-draft?token=…
router.get("/get-draft", getDraft);

// POST /api/resume/logout
router.post("/logout", logout);

export default router;
