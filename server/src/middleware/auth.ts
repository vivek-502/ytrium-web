import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { getSession, revokeSession } from '../services/sessions.js';
import { findUserById, toPublic, type PublicUser } from '../services/users.js';

/** Name of the httpOnly session cookie. */
export const SESSION_COOKIE = 'ytrium-web_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `attachSession` when a valid session cookie is present. */
      user?: PublicUser;
    }
  }
}

/** Reads a single cookie from the request headers (no cookie-parser needed). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Resolves the session cookie into `req.user` for every request. Never
 * rejects - routes decide whether a session is required.
 */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const session = getSession(token);
      if (session) {
        const user = findUserById(session.userId);
        if (user) {
          req.user = toPublic(user);
        } else {
          // The account was deleted - drop the orphaned session.
          revokeSession(token);
        }
      }
    }
  } catch (err) {
    // A broken session must never break the request pipeline.
    console.error('[auth] attachSession failed', err);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.'));
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.'));
    return;
  }
  if (req.user.role !== 'admin') {
    next(new AppError('FORBIDDEN', 403, 'Admin access required.'));
    return;
  }
  next();
}
