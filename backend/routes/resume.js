// backend/routes/resume.js
import express from "express";
import rateLimit from "express-rate-limit"; // opcional, para proteger send-link
import {
  sendResumeLink,
  exchangeResumeToken,
  whoAmI,
  getDraft,
  logout,
  testSes,
} from "../controllers/resumeController.js";

const router = express.Router();

/**
 * Opcional: limitar golpes a send-link para evitar abuso.
 * Si no querés esto, borrá el limiter y el objeto "limits".
 */
const limits = {
  sendLink: rateLimit({
    windowMs: 10 * 60 * 1000, // 10 min
    max: 30, // 30 intentos por IP
    standardHeaders: true,
    legacyHeaders: false,
  }),
};

// Envío de link para reanudar (usa SES)
router.post("/send-link", limits.sendLink, sendResumeLink);

// Intercambio de rt por cookie httpOnly y redirección al front
router.get("/exchange", exchangeResumeToken);

// Saber si hay cookie de reanudación activa
router.get("/whoami", whoAmI);

// Obtener draft plano para poblar el form
router.get("/get-draft", getDraft);

// Cerrar sesión de reanudación (borra cookie)
router.post("/logout", logout);

// Dev only (requiere ENABLE_SES_TEST=1), el controller ya valida y devuelve 403 si no está habilitado
router.get("/test-email", testSes);

export default router;
