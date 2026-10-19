import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

/**
 * Account store - usernames and scrypt password hashes in a small JSON file
 * (`server/data/users.json`, mode 0600). No database, no plaintext passwords.
 *
 * Privacy model: a password is chosen once, when an account is created. It
 * can only ever be changed by the account's owner (who must know the current
 * password). Admins can create and delete accounts, but can neither read,
 * reset nor set anyone's password - deleting requires the target's password.
 */

const log = createLogger('users');

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export type UserRole = 'admin' | 'user';

/** Full record - stays on the server, never leaves the API. */
export interface UserRecord {
  id: string;
  username: string;
  /** Case-insensitive uniqueness / lookup key. */
  usernameLower: string;
  role: UserRole;
  /** `scrypt$<salt-hex>$<hash-hex>` */
  password: string;
  createdAt: number;
}

/** Safe shape returned to clients (never includes the password hash). */
export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
}

const USERS_FILE = path.join(config.auth.dataDir, 'users.json');
const SCHEME = 'scrypt';
const KEY_LEN = 64;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 200;

let cache: UserRecord[] | null = null;

/* ------------------------------------------------------------- validation */

function validateUsername(raw: unknown): string {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (!USERNAME_RE.test(username)) {
    throw new AppError(
      'INVALID_USERNAME',
      400,
      'Usernames must be 3-32 characters using letters, numbers, dots, dashes or underscores.',
    );
  }
  return username;
}

function validatePassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD) {
    throw new AppError(
      'INVALID_PASSWORD',
      400,
      `Passwords must be at least ${MIN_PASSWORD} characters.`,
    );
  }
  if (raw.length > MAX_PASSWORD) {
    throw new AppError(
      'INVALID_PASSWORD',
      400,
      `Passwords must be at most ${MAX_PASSWORD} characters.`,
    );
  }
  return raw;
}

/* --------------------------------------------------------------- hashing */

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LEN);
  return `${SCHEME}$${salt}$${hash.toString('hex')}`;
}

/** Verifies a password against a stored hash with a timing-safe compare. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hashHex] = stored.split('$');
  if (scheme !== SCHEME || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = await scrypt(password, salt, KEY_LEN);
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Runs one real scrypt verification against a throwaway hash so that a login
 * for a non-existent user takes about as long as a login with a wrong
 * password (no username enumeration through timing).
 */
const DUMMY_STORED = `${SCHEME}$${'a0'.repeat(16)}$${'b1'.repeat(KEY_LEN)}`;
export function dummyVerify(password: string): Promise<boolean> {
  return verifyPassword(password, DUMMY_STORED);
}

/* ---------------------------------------------------------------- disk IO */

function looksLikeRecord(v: unknown): v is UserRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.username === 'string' &&
    typeof r.usernameLower === 'string' &&
    typeof r.password === 'string' &&
    typeof r.createdAt === 'number' &&
    (r.role === 'admin' || r.role === 'user')
  );
}

function readDisk(): UserRecord[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(parsed)) return parsed.filter(looksLikeRecord);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('failed to read users.json - starting with defaults', { err: String(err) });
    }
  }
  return [];
}

function writeDisk(users: UserRecord[]): void {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

function ensureLoaded(): UserRecord[] {
  if (cache) return cache;
  cache = readDisk();
  if (cache.length === 0) {
    // First run: bootstrap the default owner account (admin / admin).
    // The owner is expected to change this password from Settings.
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin', salt, KEY_LEN).toString('hex');
    const admin: UserRecord = {
      id: crypto.randomUUID(),
      username: 'admin',
      usernameLower: 'admin',
      role: 'admin',
      password: `${SCHEME}$${salt}$${hash}`,
      createdAt: Date.now(),
    };
    cache.push(admin);
    writeDisk(cache);
    log.info('bootstrapped default admin account', { username: 'admin' });
  }
  return cache;
}

export function toPublic(user: UserRecord): PublicUser {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

/* ---------------------------------------------------------------- queries */

export function listUsers(): PublicUser[] {
  return ensureLoaded()
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toPublic);
}

export function findUserById(id: string): UserRecord | null {
  return ensureLoaded().find((u) => u.id === id) ?? null;
}

export function findUserByUsername(username: string): UserRecord | null {
  const lower = username.trim().toLowerCase();
  return ensureLoaded().find((u) => u.usernameLower === lower) ?? null;
}

/* --------------------------------------------------------------- mutations */

/** Creates a regular user account (role `user`); the password is set here only. */
export async function createUser(username: unknown, password: unknown): Promise<PublicUser> {
  const name = validateUsername(username);
  const pw = validatePassword(password);
  const users = ensureLoaded();
  const lower = name.toLowerCase();
  if (users.some((u) => u.usernameLower === lower)) {
    throw new AppError('USERNAME_TAKEN', 409, 'That username is already taken.');
  }
  const record: UserRecord = {
    id: crypto.randomUUID(),
    username: name,
    usernameLower: lower,
    role: 'user',
    password: await hashPassword(pw),
    createdAt: Date.now(),
  };
  users.push(record);
  writeDisk(users);
  log.info('user created', { id: record.id, username: record.username });
  return toPublic(record);
}

/** Changes a user's own username and/or password (owner-initiated only). */
export async function updateUserCredentials(
  id: string,
  changes: { username?: string; password?: string },
): Promise<PublicUser> {
  const users = ensureLoaded();
  const record = users.find((u) => u.id === id);
  if (!record) throw new AppError('NOT_FOUND', 404, 'That account no longer exists.');

  // Validate everything up front so a bad password can never leave a
  // half-applied rename behind in memory.
  let name: string | null = null;
  if (changes.username !== undefined) {
    name = validateUsername(changes.username);
    const lower = name.toLowerCase();
    if (users.some((u) => u.id !== record.id && u.usernameLower === lower)) {
      throw new AppError('USERNAME_TAKEN', 409, 'That username is already taken.');
    }
  }
  const hashed =
    changes.password !== undefined ? await hashPassword(validatePassword(changes.password)) : null;

  if (name !== null) {
    record.username = name;
    record.usernameLower = name.toLowerCase();
  }
  if (hashed !== null) record.password = hashed;
  writeDisk(users);
  return toPublic(record);
}

export function deleteUser(id: string): void {
  const users = ensureLoaded();
  const at = users.findIndex((u) => u.id === id);
  if (at === -1) return;
  const [removed] = users.splice(at, 1);
  writeDisk(users);
  log.info('user deleted', { id: removed.id, username: removed.username });
}
