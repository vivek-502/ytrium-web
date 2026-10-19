import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

/**
 * Session store - random bearer tokens handed to the browser as an httpOnly
 * cookie. Only the SHA-256 of each token is written to disk
 * (`server/data/sessions.json`, mode 0600), so a leaked file cannot be used
 * to impersonate a signed-in user.
 */

const log = createLogger('sessions');

const SESSIONS_FILE = path.join(config.auth.dataDir, 'sessions.json');
/** Keep the file bounded on a long-lived instance. */
const MAX_SESSIONS = 200;

export interface SessionRecord {
  /** SHA-256 of the raw token (hex). */
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

let cache: SessionRecord[] | null = null;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function looksLikeSession(v: unknown): v is SessionRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.tokenHash === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.expiresAt === 'number'
  );
}

function prune(sessions: SessionRecord[]): boolean {
  const now = Date.now();
  const before = sessions.length;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].expiresAt <= now) sessions.splice(i, 1);
  }
  while (sessions.length > MAX_SESSIONS) sessions.shift(); // oldest first
  return sessions.length !== before;
}

function readDisk(): SessionRecord[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    if (Array.isArray(parsed)) return parsed.filter(looksLikeSession);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('failed to read sessions.json', { err: String(err) });
    }
  }
  return [];
}

function writeDisk(sessions: SessionRecord[]): void {
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  const tmp = `${SESSIONS_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, SESSIONS_FILE);
}

function ensureLoaded(): SessionRecord[] {
  if (cache) return cache;
  cache = readDisk();
  if (prune(cache)) writeDisk(cache);
  return cache;
}

/** Creates a session and returns the raw token (only ever sent as a cookie). */
export function createSession(userId: string): string {
  const sessions = ensureLoaded();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.auth.sessionTtlMs,
  });
  prune(sessions);
  writeDisk(sessions);
  return token;
}

export function getSession(token: string): SessionRecord | null {
  const sessions = ensureLoaded();
  const found = sessions.find((s) => s.tokenHash === hashToken(token));
  if (!found) return null;
  if (found.expiresAt <= Date.now()) {
    sessions.splice(sessions.indexOf(found), 1);
    writeDisk(sessions);
    return null;
  }
  return found;
}

export function revokeSession(token: string): void {
  const sessions = ensureLoaded();
  const at = sessions.findIndex((s) => s.tokenHash === hashToken(token));
  if (at === -1) return;
  sessions.splice(at, 1);
  writeDisk(sessions);
}

/** Invalidates every session of a user (used when an account is deleted). */
export function revokeUserSessions(userId: string): number {
  const sessions = ensureLoaded();
  const before = sessions.length;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].userId === userId) sessions.splice(i, 1);
  }
  const removed = before - sessions.length;
  if (removed > 0) writeDisk(sessions);
  return removed;
}
