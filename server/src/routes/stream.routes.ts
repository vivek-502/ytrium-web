import { Router } from 'express';
import { stream, streamMeta } from '../controllers/streamController.js';
import { limiter } from '../middleware/http.js';
import { config } from '../config.js';

export const streamRoutes = Router();

streamRoutes.use(limiter(config.rateLimit.streamPerMin, 'stream'));
streamRoutes.get('/stream/:id', stream);
streamRoutes.get('/stream/:id/meta', streamMeta);
