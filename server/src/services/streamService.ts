import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { resolveMediaUrl, invalidateStream, normalizeQuality, type StreamQuality } from '../providers/youtube.js';
import type { StreamSource } from '../providers/types.js';

const log = createLogger('stream');

const UPSTREAM_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
];

/** Resolve a fresh stream source for a video id (cached with expiry). */
export async function getStreamSource(
  videoId: string,
  quality: StreamQuality = 'auto',
): Promise<StreamSource> {
  return resolveMediaUrl(videoId, normalizeQuality(quality));
}

/**
 * Proxy media bytes from the upstream CDN to the browser.
 *
 * - Supports HTTP Range requests so the HTML5 audio element can seek.
 * - If the upstream URL has expired (403/410), it is invalidated and resolved
 *   once more transparently.
 * - Upstream URLs are never sent to the client.
 */
export async function proxyStream(
  req: Request,
  res: Response,
  videoId: string,
  quality: StreamQuality = 'auto',
): Promise<void> {
  const attempt = async (): Promise<globalThis.Response> => {
    const source = await getStreamSource(videoId, quality);
    const controller = new AbortController();
    const headers: Record<string, string> = {
      'user-agent': UPSTREAM_UA,
      accept: '*/*',
    };
    const range = req.headers.range;
    if (typeof range === 'string') headers.Range = range;

    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const upstream = await fetch(source.url, { headers, signal: controller.signal });
      return upstream;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let upstream = await attempt();

    if (upstream.status === 403 || upstream.status === 410) {
      // Likely an expired media URL: refresh once and retry.
      log.info('upstream rejected media url, refreshing', { videoId, status: upstream.status });
      invalidateStream(videoId);
      upstream.body?.cancel?.().catch(() => undefined);
      upstream = await attempt();
    }

    if (!upstream.ok || !upstream.body) {
      log.warn('upstream fetch failed', { videoId, status: upstream.status });
      throw upstream.status === 404
        ? errors.videoUnavailable('media not found upstream')
        : errors.upstreamUnavailable(`upstream status ${upstream.status}`);
    }

    res.status(upstream.status);
    for (const name of HEADER_ALLOWLIST) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('cache-control', 'no-store, private');
    res.setHeader('x-content-type-options', 'nosniff');

    const body = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream);
    body.pipe(res);
    req.on('close', () => body.destroy());
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    throw err;
  }
}

/** Issue a temporary redirect to the resolved URL (STREAM_MODE=redirect). */
export async function redirectStream(
  res: Response,
  videoId: string,
  quality: StreamQuality = 'auto',
): Promise<void> {
  const source = await getStreamSource(videoId, quality);
  res.setHeader('cache-control', 'no-store, private');
  res.redirect(302, source.url);
}

export const streamMode = config.stream.mode;
