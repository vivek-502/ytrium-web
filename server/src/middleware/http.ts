import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { AppError, errors, isAppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function limiter(perMin: number, scope: string) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: perMin,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: `Too many ${scope} requests. Please slow down.` },
      });
    },
  });
}

/** Remove control characters from untrusted input. */
function stripControlChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue;
    out += ch;
  }
  return out;
}

/** Sanitize and cap length for arbitrary query input. */
export function sanitizeQuery(value: unknown, maxLength = 200): string {
  if (typeof value !== 'string') throw errors.invalidInput('query must be a string');
  const cleaned = stripControlChars(value).trim();
  if (!cleaned) throw errors.invalidInput('query is required');
  if (cleaned.length > maxLength) throw errors.invalidInput('query is too long');
  return cleaned;
}

export function requireParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw errors.invalidInput(`missing parameter: ${name}`);
  }
  return value.trim();
}

export function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw errors.invalidInput('limit must be a positive number');
  return Math.min(Math.floor(n), max);
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

/** Central error handler: logs details, returns sanitized payloads only. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appErr: AppError = isAppError(err)
    ? err
    : errors.internal(err instanceof Error ? err.message : String(err));

  if (appErr.status >= 500) {
    log.error('request failed', {
      code: appErr.code,
      detail: appErr.detail,
      stack: (err as Error)?.stack?.slice(0, 1200),
    });
  } else {
    log.warn('request rejected', { code: appErr.code, detail: appErr.detail });
  }

  if (res.headersSent) return;
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(config.isProd ? {} : appErr.detail ? { detail: appErr.detail.slice(0, 400) } : {}),
    },
  });
}

/** Wrap async route handlers so rejections reach the error handler. */
export function asyncHandler<
  H extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
>(handler: H) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
