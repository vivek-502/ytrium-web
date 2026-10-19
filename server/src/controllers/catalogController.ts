import type { Request, Response } from 'express';
import { asyncHandler, parseLimit, sanitizeQuery } from '../middleware/http.js';
import { getCharts } from '../providers/charts.js';
import { getRecommendations } from '../providers/registry.js';

/** GET /api/health */
export const health = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    name: 'yttrium-api',
    version: '1.0.0',
    providers: ['youtube', 'charts'],
    time: new Date().toISOString(),
  });
});

/** GET /api/charts - aggregated trending / popular / new release material. */
export const charts = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getCharts();
  res.json(data);
});

/** GET /api/trending - trending tracks only. */
export const trending = asyncHandler(async (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit, 20, 50);
  const data = await getCharts();
  res.json({ tracks: data.trending.slice(0, limit), source: data.chartsSource });
});

/**
 * GET /api/recommendations?seeds=artist1,artist2&limit=20
 * Provider-side similar material. The client combines this with its local
 * recommendation engine (play counts, likes, history).
 */
export const recommendations = asyncHandler(async (req: Request, res: Response) => {
  const raw = typeof req.query.seeds === 'string' ? req.query.seeds : '';
  const seeds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  const sanitized = seeds.map((s) => sanitizeQuery(s, 80));
  const limit = parseLimit(req.query.limit, 20, 40);
  const tracks = await getRecommendations(sanitized, limit);
  res.json({ tracks, seeds: sanitized });
});
