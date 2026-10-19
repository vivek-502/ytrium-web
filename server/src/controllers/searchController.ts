import type { Request, Response } from 'express';
import { asyncHandler, parseLimit, sanitizeQuery } from '../middleware/http.js';
import { youtubeProvider } from '../providers/youtube.js';
import { errors } from '../utils/errors.js';
import { config } from '../config.js';

/** GET /api/search?q=<query>&limit=<n> */
export const search = asyncHandler(async (req: Request, res: Response) => {
  const q = sanitizeQuery(req.query.q);
  const limit = parseLimit(req.query.limit, config.ytdlp.searchLimit, 50);
  const results = await youtubeProvider.search(q, limit);
  res.json({ query: q, source: youtubeProvider.id, ...results });
});

async function firstPlayable(query: string) {
  const results = await youtubeProvider.search(query, 8);
  const playable = results.tracks.find((t) => t.sourceId);
  if (playable) return playable;
  const candidate = results.tracks[0];
  if (candidate?.resolveQuery) {
    const retry = await youtubeProvider.search(candidate.resolveQuery, 8);
    const resolved = retry.tracks.find((t) => t.sourceId);
    if (resolved) return resolved;
  }
  return candidate ?? null;
}

/**
 * POST /api/resolve  { id? , q? , title? , artist? }
 * GET  /api/resolve?q=
 *
 * Turns a logical track description (or a metadata-only id) into a playable
 *, provider-resolvable track. Also used by the frontend to lazily resolve
 * chart/metadata entries right before playback.
 */
export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawId = typeof body.id === 'string' ? body.id : undefined;
  const rawQ = typeof body.q === 'string' ? body.q : (req.query.q as string | undefined);
  const title = typeof body.title === 'string' ? body.title : undefined;
  const artist = typeof body.artist === 'string' ? body.artist : undefined;

  // Exact id resolution.
  if (rawId) {
    const track = await youtubeProvider.getTrack(rawId);
    if (track) {
      res.json({ track });
      return;
    }
  }

  const query = rawQ?.trim() || (title ? [title, artist].filter(Boolean).join(' ') : '');
  if (!query) throw errors.invalidInput('provide id, q, or title');

  const track = await firstPlayable(sanitizeQuery(query, 240));
  if (!track) throw errors.notFound('No playable match was found for that query.');
  res.json({ track });
});
