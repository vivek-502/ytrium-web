import { Router } from 'express';
import { health } from '../controllers/catalogController.js';
import { attachSession, requireAuth } from '../middleware/auth.js';
import { searchRoutes } from './search.routes.js';
import { trackRoutes } from './tracks.routes.js';
import { streamRoutes } from './stream.routes.js';
import { catalogRoutes } from './catalog.routes.js';
import { lyricsRoutes } from './lyrics.routes.js';
import { authRoutes } from './auth.routes.js';
import { adminRoutes } from './admin.routes.js';

/** Mounts every /api/* route group behind the session gate. */
export function apiRouter(): Router {
  const router = Router();

  // Resolve the session cookie for every request (routes below rely on it).
  router.use(attachSession);

  // Public: liveness probe and the sign-in endpoints themselves.
  router.get('/health', health);
  router.use('/auth', authRoutes);

  // Everything else requires a signed-in session.
  router.use(requireAuth);

  router.use('/admin', adminRoutes);
  router.use(catalogRoutes);
  router.use(searchRoutes);
  router.use(trackRoutes);
  router.use(streamRoutes);
  router.use(lyricsRoutes);
  return router;
}
