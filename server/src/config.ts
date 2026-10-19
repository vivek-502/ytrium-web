import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const PACKED = process.env.YTRIUM_WEB_PACKED === '1';

let projectRoot: string;
if (PACKED) {
  projectRoot = path.dirname(process.execPath);
} else {
  const here = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(here, '..', '..');
}
export { projectRoot };

/** Resolves the default data directory for the current platform. */
function platformDataDir(name: string): string {
  if (process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim()) {
    return path.join(process.env.XDG_DATA_HOME.trim(), name);
  }
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, name === 'ytrium-web' ? 'Ytrium Web' : 'Ytrium');
    }
    case 'darwin': {
      return path.join(os.homedir(), 'Library', 'Application Support', name === 'ytrium-web' ? 'Ytrium Web' : 'Ytrium');
    }
    default:
      return path.join(os.homedir(), '.local', 'share', name);
  }
}

/**
 * The app was renamed from "yttrium" to "ytrium-web". Anyone upgrading from a
 * build that stored data under the old directory would otherwise start empty, so
 * on first boot we move the old directory forward (accounts, sessions, cache)
 * instead of abandoning it. One-time and best-effort: any failure leaves the old
 * data in place and lets the new directory be created fresh.
 */
function migrateLegacyDataDir(next: string): string {
  const prev = platformDataDir('yttrium');
  if (prev === next) return next;
  try {
    if (fs.existsSync(prev) && !fs.existsSync(next)) {
      fs.mkdirSync(path.dirname(next), { recursive: true });
      fs.renameSync(prev, next);
    }
  } catch {
    /* best-effort: fall through and use the new (still empty) directory */
  }
  return next;
}

function defaultDataDir(): string {
  return migrateLegacyDataDir(platformDataDir('ytrium-web'));
}

// Load `.env` from the project root first, then a server-local `.env` (skipped in packed builds).
if (!PACKED) {
  dotenv.config({ path: path.join(projectRoot, '.env') });
  dotenv.config({ path: path.join(projectRoot, 'server', '.env') });
} else {
  dotenv.config({ path: path.join(projectRoot, '.env') });
}

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function list(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = str('NODE_ENV', PACKED ? 'production' : 'development');

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: num('PORT', 8787),
  host: str('HOST', '0.0.0.0'),
  corsOrigins: list('CORS_ORIGIN', ['http://localhost:5173', 'http://127.0.0.1:5173']),

  ytdlp: {
    path: str('YTDLP_PATH', 'yt-dlp'),
    timeoutMs: num('YTDLP_TIMEOUT_MS', 30_000),
    searchLimit: Math.min(num('YTDLP_SEARCH_LIMIT', 20), 50),
    extraArgs: list('YTDLP_EXTRA_ARGS', []),
  },

  stream: {
    mode: str('STREAM_MODE', 'proxy') === 'redirect' ? ('redirect' as const) : ('proxy' as const),
    ttlMs: num('STREAM_TTL_MS', 30 * 60_000),
  },

  cache: {
    searchTtlMs: num('SEARCH_CACHE_TTL_MS', 10 * 60_000),
    metadataTtlMs: num('METADATA_CACHE_TTL_MS', 24 * 60 * 60_000),
    chartTtlMs: num('CHART_CACHE_TTL_MS', 30 * 60_000),
    recommendationTtlMs: num('RECOMMENDATION_CACHE_TTL_MS', 30 * 60_000),
    lyricsTtlMs: num('LYRICS_CACHE_TTL_MS', 24 * 60 * 60_000),
    lyricsMaxEntries: num('LYRICS_CACHE_MAX_ENTRIES', 400),
    maxEntries: num('CACHE_MAX_ENTRIES', 500),
  },

  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    searchPerMin: num('RATE_LIMIT_SEARCH_PER_MIN', 40),
    streamPerMin: num('RATE_LIMIT_STREAM_PER_MIN', 60),
    apiPerMin: num('RATE_LIMIT_API_PER_MIN', 300),
  },

  auth: {
    /** How long a sign-in session stays valid. */
    sessionTtlMs: num('SESSION_TTL_DAYS', 30) * 86_400_000,
    /** Password checks (sign-in, credential changes, admin deletes) per window. */
    attemptsPerMin: num('RATE_LIMIT_AUTH_PER_MIN', 20),
    /** Where accounts (users.json) and sessions (sessions.json) are stored. */
    /** Where accounts (users.json) and sessions (sessions.json) are stored.
     *  Checkout/dev runs keep data inside the repo; the packaged binary has
     *  no writable checkout, so it defaults to the per-user config dir. */
    dataDir: str('DATA_DIR', PACKED ? defaultDataDir() : path.join(projectRoot, 'server', 'data')),
  },

  providers: {
    chartsEnabled: bool('ENABLE_CHARTS_PROVIDER', true),
    chartsBase: str('CHARTS_API_BASE', 'https://itunes.apple.com'),
    chartsRegion: str('CHARTS_REGION', 'us'),
  },

  lyrics: {
    enabled: bool('ENABLE_LYRICS_PROVIDER', true),
    base: str('LYRICS_API_BASE', 'https://lrclib.net'),
    timeoutMs: num('LYRICS_TIMEOUT_MS', 10_000),
    /** Cap on the yt-dlp caption fallback so lyrics never block playback. */
    subsTimeoutMs: num('LYRICS_SUBS_TIMEOUT_MS', 12_000),
  },
} as const;

/** Absolute path of the built frontend, when it exists (production serving). */
export function clientDistDir(): string | null {
  if (process.env.YTRIUM_WEB_CLIENT_DIST && process.env.YTRIUM_WEB_CLIENT_DIST.trim()) {
    const dir = process.env.YTRIUM_WEB_CLIENT_DIST.trim();
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  const dir = path.join(projectRoot, 'client', 'dist');
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}
