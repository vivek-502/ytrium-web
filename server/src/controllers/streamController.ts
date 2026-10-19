import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/http.js';
import { errors } from '../utils/errors.js';
import { proxyStream, redirectStream, getStreamSource, streamMode } from '../services/streamService.js';
import { normalizeQuality } from '../providers/youtube.js';

function parseVideoId(raw: string): string {
  const id = raw.startsWith('yt:') ? raw.slice(3) : raw;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw errors.invalidInput('invalid stream id');
  return id;
}

/**
 * GET /api/stream/:id - play a track through the API (proxy or redirect).
 * Optional `?q=auto|low|high` selects the yt-dlp audio format only.
 */
export const stream = asyncHandler(async (req: Request, res: Response) => {
  const videoId = parseVideoId(req.params.id);
  const quality = normalizeQuality(req.query.q);
  if (streamMode === 'redirect') {
    await redirectStream(res, videoId, quality);
    return;
  }
  await proxyStream(req, res, videoId, quality);
});

/** GET /api/stream/:id/meta - freshness info for the resolved media URL. */
export const streamMeta = asyncHandler(async (req: Request, res: Response) => {
  const videoId = parseVideoId(req.params.id);
  const quality = normalizeQuality(req.query.q);
  const source = await getStreamSource(videoId, quality);
  res.json({
    id: videoId,
    expiresAt: source.expiresAt,
    mode: streamMode,
    quality,
    // In proxy mode no upstream URL is disclosed.
    path: `/api/stream/${videoId}`,
  });
});
