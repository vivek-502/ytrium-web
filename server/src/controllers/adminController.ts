import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/http.js';
import { AppError, errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { revokeUserSessions } from '../services/sessions.js';
import { createUser, deleteUser, findUserById, listUsers, verifyPassword } from '../services/users.js';

const log = createLogger('admin');

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

/**
 * GET /api/admin/users
 * Lists accounts for the admin settings screen. Password hashes are never
 * part of the payload - admins cannot read anyone's password.
 */
export const listUsersHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ users: listUsers() });
});

/**
 * POST /api/admin/users { username, password }
 * Creates a regular user. The password is set here, once; afterwards only
 * the user itself can change it (from their own Settings).
 */
export const createUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = bodyOf(req);
  const user = await createUser(username, password);
  res.status(201).json({ user });
});

/**
 * DELETE /api/admin/users/:id { password }
 *
 * Deletes an account, but only when the request carries THAT user's
 * password - the admin neither knows nor can reset it. Sessions of the
 * deleted account are revoked immediately.
 */
export const deleteUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const admin = req.user;
  if (!admin) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.');

  const target = findUserById(String(req.params.id));
  if (!target) throw errors.notFound('That user no longer exists.');
  if (target.id === admin.id) {
    throw errors.invalidInput('You cannot delete your own account.');
  }

  const { password } = bodyOf(req);
  if (typeof password !== 'string' || !password) {
    throw errors.invalidInput(`Enter ${target.username}'s password to confirm the deletion.`);
  }
  if (!(await verifyPassword(password, target.password))) {
    log.warn('admin delete rejected: password mismatch', { admin: admin.username, target: target.id });
    throw new AppError(
      'PASSWORD_MISMATCH',
      403,
      `That password does not match ${target.username}'s account.`,
    );
  }

  deleteUser(target.id);
  const revoked = revokeUserSessions(target.id);
  log.info('admin deleted user', { admin: admin.username, target: target.username, revoked });
  res.json({ ok: true });
});
