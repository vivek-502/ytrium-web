import { Router } from 'express';
import { health, charts, trending, recommendations } from '../controllers/catalogController.js';
import { limiter } from '../middleware/http.js';
import { config } from '../config.js';

export const catalogRoutes = Router();

catalogRoutes.get('/health', health);
catalogRoutes.use(limiter(config.rateLimit.apiPerMin, 'catalog'));
catalogRoutes.get('/charts', charts);
catalogRoutes.get('/trending', trending);
catalogRoutes.get('/recommendations', recommendations);
