import { Router } from 'express';
import { config } from '../config.js';
import {
  createUserHandler,
  deleteUserHandler,
  listUsersHandler,
} from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';
import { limiter } from '../middleware/http.js';

export const adminRoutes = Router();

adminRoutes.use(requireAdmin);
adminRoutes.get('/users', listUsersHandler);
adminRoutes.post('/users', limiter(config.auth.attemptsPerMin, 'user creation'), createUserHandler);
// Deleting verifies the target user's password -> keep it rate limited.
adminRoutes.delete('/users/:id', limiter(config.auth.attemptsPerMin, 'user deletion'), deleteUserHandler);
