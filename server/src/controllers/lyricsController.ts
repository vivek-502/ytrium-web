import type { Request, Response } from 'express';
import { asyncHandler, sanitizeQuery } from '../middleware/http.js';
import { getLyricsFor } from '../providers/lyrics.js';
import { isValidVideoId } from '../services/ytdlp.js';

/**
 * GET /api/lyrics?title=<title>&artist=<artist>
 *                  [&album=<album>&duration=<seconds>&id=<ytVideoId>]
 *
 * Resolves lyrics through the backend-only lyrics provider (LRCLIB, with a
 * YouTube caption fallback for the track's video id when provided). Returns
 * 200 with `{ lyrics: null }` when no lyrics exist, so the client can show a
 * graceful empty state instead of a generic error.
 */
export const getLyricsHandler = asyncHandler(async (req: Request, res: Response) => {
  const title = sanitizeQuery(req.query.title, 300);
  const artist = sanitizeQuery(req.query.artist, 200);
  const album = req.query.album ? sanitizeQuery(req.query.album, 200) : undefined;

  let duration: number | undefined;
  if (typeof req.query.duration === 'string' && /^\d{1,5}$/.test(req.query.duration)) {
    const n = Number(req.query.duration);
    if (n > 0 && n <= 86400) duration = n;
  }

  const rawId = req.query.id;
  const videoId = typeof rawId === 'string' && isValidVideoId(rawId) ? rawId : undefined;

  const lyrics = await getLyricsFor({ title, artist, album, duration, videoId });
  res.json({ lyrics });
});