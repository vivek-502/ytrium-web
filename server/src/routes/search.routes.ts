import { Router } from 'express';
import { search, resolve } from '../controllers/searchController.js';
import { limiter } from '../middleware/http.js';
import { config } from '../config.js';

export const searchRoutes = Router();

searchRoutes.use(limiter(config.rateLimit.searchPerMin, 'search'));
searchRoutes.get('/search', search);
searchRoutes.get('/resolve', resolve);
searchRoutes.post('/resolve', resolve);
