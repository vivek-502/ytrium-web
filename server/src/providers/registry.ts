import { config } from '../config.js';
import { TtlCache, memoize } from '../cache/ttlCache.js';
import { createLogger } from '../utils/logger.js';
import { youtubeProvider } from './youtube.js';
import type { NormalizedTrack } from './types.js';

const log = createLogger('registry');

/**
 * Registry of all registered providers. Currently YouTube is the streaming
 * provider; additional legitimate providers can be registered here without
 * touching routes or the frontend.
 */
export const providers = [youtubeProvider];

export function primaryProvider() {
  return providers[0];
}

const recommendationCache = new TtlCache<NormalizedTrack[]>(
  config.cache.recommendationTtlMs,
  config.cache.maxEntries,
);

/** Deterministic tiny string hash (FNV-1a) for stable shuffling. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Provider-backed recommendations: expands "seed" artists into similar
 * material through the provider's search, then orders results deterministically
 * (stable per seed set) so the UI does not flicker between requests.
 */
export async function getRecommendations(seeds: string[], limit = 20): Promise<NormalizedTrack[]> {
  const normalized = seeds.map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const key = `rec::${normalized.join('|').toLowerCase()}::${limit}`;
  return memoize(
    recommendationCache,
    key,
    async () => {
      const out: NormalizedTrack[] = [];
      const seen = new Set<string>();
      const queries = normalized.length
        ? normalized.map((s) => `${s}`)
        : ['popular music right now'];

      for (const q of queries) {
        try {
          const res = await youtubeProvider.search(q, Math.max(6, Math.ceil(limit / queries.length) + 2));
          for (const t of res.tracks) {
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            out.push(t);
          }
        } catch (err) {
          log.warn('recommendation seed failed', { q, err: String(err) });
        }
      }

      // Deterministic shuffle keyed by seed+id so order is stable.
      const shuffleKey = normalized.join('|') || 'default';
      out.sort((a, b) => fnv1a(shuffleKey + a.id) - fnv1a(shuffleKey + b.id));
      return out.slice(0, limit);
    },
    config.cache.recommendationTtlMs,
  );
}
