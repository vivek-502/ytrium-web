import { Router } from 'express';
import { getLyricsHandler } from '../controllers/lyricsController.js';
import { limiter } from '../middleware/http.js';
import { config } from '../config.js';

export const lyricsRoutes = Router();

lyricsRoutes.use(limiter(config.rateLimit.apiPerMin, 'lyrics'));
lyricsRoutes.get('/lyrics', getLyricsHandler);