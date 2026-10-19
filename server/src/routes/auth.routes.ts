import { Router } from 'express';
import { config } from '../config.js';
import { changeCredentials, login, logout, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { limiter } from '../middleware/http.js';

export const authRoutes = Router();

// All sign-in / credential checks are rate limited per client IP.
authRoutes.post('/login', limiter(config.auth.attemptsPerMin, 'sign-in'), login);
authRoutes.get('/me', me);
authRoutes.post('/logout', requireAuth, logout);
authRoutes.post(
  '/change-credentials',
  requireAuth,
  limiter(config.auth.attemptsPerMin, 'credential'),
  changeCredentials,
);
