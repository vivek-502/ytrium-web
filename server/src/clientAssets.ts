import path from 'node:path';
import type { RequestHandler } from 'express';

/**
 * In-memory static file serving for the packaged single-file binary.
 *
 * The SEA build embeds `client/dist` as base64 in the bundle (see
 * packaging/embed-client.mjs); the generated module publishes it on
 * `globalThis.__YTTRIUM_CLIENT_ASSETS__` before this server loads. When that
 * bag is absent - dev server or `npm start` from a checkout - this returns
 * null and `app.ts` serves from disk exactly as before.
 */

interface Entry {
  body: Buffer;
  type: string;
  cache: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

let entries: Map<string, Entry> | null = null;

function load(): Map<string, Entry> | null {
  if (entries) return entries;
  const bag = (globalThis as { __YTTRIUM_CLIENT_ASSETS__?: Record<string, string> })
    .__YTTRIUM_CLIENT_ASSETS__;
  if (!bag) return null;
  const map = new Map<string, Entry>();
  for (const [rel, b64] of Object.entries(bag)) {
    const posix = rel.replace(/\\/g, '/');
    const ext = path.posix.extname(posix).toLowerCase();
    const cache = posix.endsWith('index.html')
      ? 'no-cache' // HTML is the app shell - always revalidate
      : posix.startsWith('assets/')
        ? 'public, max-age=31536000, immutable' // vite hashes asset names
        : 'public, max-age=3600';
    map.set(`/${posix}`, {
      body: Buffer.from(b64, 'base64'),
      type: MIME[ext] ?? 'application/octet-stream',
      cache,
    });
  }
  if (!map.has('/index.html')) return null;
  entries = map;
  return map;
}

/**
 * A middleware that answers GET/HEAD for embedded files and falls back to the
 * app shell for extension-less paths (SPA routing). Unknown files fall
 * through to the API 404 handlers - nothing touches the filesystem.
 */
export function createEmbeddedStatic(): RequestHandler | null {
  const files = load();
  if (!files) return null;
  const shell = files.get('/index.html') as Entry;

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();

    let target = req.path;
    try {
      target = decodeURIComponent(req.path);
    } catch {
      /* keep the raw path; the lookup below simply won't match */
    }

    let hit = files.get(target) ?? null;
    if (!hit && !path.posix.extname(target)) hit = shell; // deep link -> SPA
    if (!hit) return next();

    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', hit.cache);
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(hit.body);
  };
}
