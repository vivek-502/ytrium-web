import type { Request, Response } from 'express';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/http.js';
import { SESSION_COOKIE, readCookie } from '../middleware/auth.js';
import { AppError, errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { createSession, revokeSession } from '../services/sessions.js';
import {
  dummyVerify,
  findUserById,
  findUserByUsername,
  toPublic,
  updateUserCredentials,
  verifyPassword,
} from '../services/users.js';

const log = createLogger('auth');

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'Incorrect username or password.');

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * POST /api/auth/login { username, password }
 * Creates a session and sets the httpOnly session cookie.
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = bodyOf(req);
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    throw errors.invalidInput('Enter both a username and a password.');
  }

  const user = findUserByUsername(username);
  // Always run one scrypt verification so missing users and wrong passwords
  // take the same time (no username enumeration via timing).
  const ok = user ? await verifyPassword(password, user.password) : await dummyVerify(password);
  if (!user || !ok) {
    log.warn('failed sign-in attempt', { username: username.trim().slice(0, 64), ip: req.ip });
    throw invalidCredentials();
  }

  const token = createSession(user.id);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: config.auth.sessionTtlMs, secure: req.secure });
  log.info('user signed in', { id: user.id, username: user.username });
  res.json({ user: toPublic(user) });
});

/** GET /api/auth/me - the current session, or `{ user: null }`. Always 200. */
export const me = asyncHandler(async (req: Request, res: Response) => {
  res.json({ user: req.user ?? null });
});

/** POST /api/auth/logout - revokes the session and clears the cookie. */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) revokeSession(token);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, secure: req.secure });
  res.json({ ok: true });
});

/**
 * POST /api/auth/change-credentials
 *   { currentPassword, newUsername?, newPassword? }
 *
 * A user may rename themselves and/or set a new password. The current
 * password is always required; nobody else (not even an admin) can call
 * this on their behalf.
 */
export const changeCredentials = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newUsername, newPassword } = bodyOf(req);
  if (!req.user) throw new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.');
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw errors.invalidInput('Enter your current password.');
  }

  const record = findUserById(req.user.id);
  if (!record) throw errors.notFound('That account no longer exists.');
  if (!(await verifyPassword(currentPassword, record.password))) {
    log.warn('credential change with wrong current password', { id: record.id });
    throw new AppError('PASSWORD_MISMATCH', 403, 'Your current password is not correct.');
  }

  const wantUsername = typeof newUsername === 'string' && newUsername.trim() !== '';
  const wantPassword = typeof newPassword === 'string' && newPassword !== '';
  if (!wantUsername && !wantPassword) {
    throw errors.invalidInput('Enter a new username or a new password.');
  }

  const previousName = record.username;
  const updated = await updateUserCredentials(record.id, {
    username: wantUsername ? String(newUsername) : undefined,
    password: wantPassword ? String(newPassword) : undefined,
  });
  log.info('user changed own credentials', {
    id: updated.id,
    renamed: updated.username !== previousName,
    repassworded: wantPassword,
  });
  res.json({ user: updated });
});
