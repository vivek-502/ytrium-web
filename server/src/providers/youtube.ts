import { config } from '../config.js';
import { TtlCache, memoize } from '../cache/ttlCache.js';
import {
  parseJsonDoc,
  parseJsonLines,
  runYtDlp,
  isValidVideoId,
} from '../services/ytdlp.js';
import { errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import type {
  MusicProvider,
  NormalizedAlbum,
  NormalizedArtist,
  NormalizedTrack,
  SearchResults,
  StreamSource,
} from './types.js';

const log = createLogger('youtube');

const searchCache = new TtlCache<SearchResults>(config.cache.searchTtlMs, config.cache.maxEntries);
const metadataCache = new TtlCache<NormalizedTrack>(config.cache.metadataTtlMs, config.cache.maxEntries);
const streamCache = new TtlCache<StreamSource>(config.stream.ttlMs, config.cache.maxEntries);

/** Episodes/streams that are not on-demand media. */
const OFFICIAL_ARTIST_CHANNEL = /\s*-\s*Topic$/;

export function artistIdFor(name: string): string {
  return name.trim().toLowerCase();
}

export function albumIdFor(artist: string, album: string): string {
  return `${artistIdFor(artist)}::${album.trim().toLowerCase()}`;
}

export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const NOISE_PATTERNS: RegExp[] = [
  /\((?:official\s+)?(?:music\s+)?video\)/gi,
  /\[(?:official\s+)?(?:music\s+)?video\]/gi,
  /\((?:official\s+)?audio\)/gi,
  /\[(?:official\s+)?audio\]/gi,
  /\(lyrics?\)/gi,
  /\(lyric\s+video\)/gi,
  /\((?:lyric\s+)?video\)/gi,
  /\(visuali[sz]er\)/gi,
  /\(official\s+visuali[sz]er\)/gi,
  /\(hd\)/gi,
  /\(4k\)/gi,
];

/** Light, conservative title cleanup for display purposes only. */
export function cleanTitle(raw: string): string {
  let t = raw.trim();
  for (const re of NOISE_PATTERNS) t = t.replace(re, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+[-–]\s*$/g, '').trim();
  return t || raw.trim();
}

/** Strip a leading "Artist - " from the title when it duplicates the artist. */
export function splitTitle(title: string, artist: string): string {
  const prefix = `${artist} - `;
  if (artist && title.toLowerCase().startsWith(prefix.toLowerCase())) {
    return title.slice(prefix.length).trim() || title;
  }
  return title;
}

interface FlatEntry {
  id?: string;
  ie_key?: string;
  title?: string;
  duration?: number | null;
  uploader?: string;
  channel?: string;
  artist?: string;
  uploader_id?: string;
  view_count?: number | null;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; preference?: number }>;
  live_status?: string;
}

function pickArtist(e: FlatEntry): string {
  const candidates = [e.artist, e.uploader, e.channel, e.uploader_id];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.replace(OFFICIAL_ARTIST_CHANNEL, '').trim();
  }
  return 'Unknown Artist';
}

function pickThumb(e: FlatEntry, id: string): string {
  if (Array.isArray(e.thumbnails) && e.thumbnails.length) {
    const sorted = [...e.thumbnails].sort(
      (a, b) => (b.preference ?? 0) - (a.preference ?? 0),
    );
    const url = sorted[0]?.url;
    if (url) return url;
  }
  if (typeof e.thumbnail === 'string' && e.thumbnail) return e.thumbnail;
  return thumbnailFor(id);
}

function fromFlat(e: FlatEntry): NormalizedTrack | null {
  const id = e.id;
  if (!isValidVideoId(id)) return null; // Filters playlists / non-video entries.
  if (e.live_status && e.live_status !== 'not_live') return null;
  const artist = pickArtist(e);
  const rawTitle = cleanTitle(typeof e.title === 'string' ? e.title : 'Unknown title');
  const title = splitTitle(rawTitle, artist);
  return {
    id: `yt:${id}`,
    source: 'youtube',
    sourceId: id,
    title,
    artist,
    artistId: artistIdFor(artist),
    album: null,
    albumId: null,
    duration: typeof e.duration === 'number' && e.duration > 0 ? Math.round(e.duration) : 0,
    thumbnail: pickThumb(e, id),
    viewCount: typeof e.view_count === 'number' ? e.view_count : null,
    url: `https://www.youtube.com/watch?v=${id}`,
    resolveQuery: null,
  };
}

interface FullEntry extends FlatEntry {
  album?: string;
  genre?: string;
  release_date?: string;
  upload_date?: string;
  webpage_url?: string;
}

function fromFull(e: FullEntry, fallbackId: string): NormalizedTrack | null {
  const id = isValidVideoId(e.id) ? e.id : fallbackId;
  if (!isValidVideoId(id)) return null;
  const artist = pickArtist(e);
  const rawTitle = cleanTitle(typeof e.title === 'string' ? e.title : 'Unknown title');
  const title = splitTitle(rawTitle, artist);
  const album = typeof e.album === 'string' && e.album.trim() ? e.album.trim() : null;
  const releaseDate = normalizeDate(e.release_date || e.upload_date);
  return {
    id: `yt:${id}`,
    source: 'youtube',
    sourceId: id,
    title,
    artist,
    artistId: artistIdFor(artist),
    album,
    albumId: album ? albumIdFor(artist, album) : null,
    duration: typeof e.duration === 'number' && e.duration > 0 ? Math.round(e.duration) : 0,
    thumbnail: pickThumb(e, id),
    viewCount: typeof e.view_count === 'number' ? e.view_count : null,
    genre: typeof e.genre === 'string' && e.genre.trim() ? e.genre.trim() : null,
    releaseDate,
    url: typeof e.webpage_url === 'string' ? e.webpage_url : `https://www.youtube.com/watch?v=${id}`,
    resolveQuery: null,
  };
}

function normalizeDate(value?: string): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return null;
}

function buildSearchResults(tracks: NormalizedTrack[]): SearchResults {
  const artists = new Map<string, NormalizedArtist>();
  const albums = new Map<string, NormalizedAlbum>();
  for (const t of tracks) {
    if (t.artistId && !artists.has(t.artistId)) {
      artists.set(t.artistId, {
        id: t.artistId,
        name: t.artist,
        image: t.thumbnail,
        source: t.source,
      });
    }
    if (t.album && t.albumId && !albums.has(t.albumId)) {
      albums.set(t.albumId, {
        id: t.albumId,
        title: t.album,
        artist: t.artist,
        artistId: t.artistId,
        image: t.thumbnail,
        releaseDate: t.releaseDate ?? null,
        source: t.source,
      });
    }
  }
  return { tracks, artists: [...artists.values()], albums: [...albums.values()] };
}

function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/* --------------------------- stream quality ------------------------------ */

/** Client-facing quality levels (`GET /api/stream/:id?q=...`). */
export type StreamQuality = 'auto' | 'low' | 'high';

const QUALITIES: StreamQuality[] = ['auto', 'low', 'high'];

/** yt-dlp selectors: `low` caps bitrate so slow links start faster. */
const QUALITY_FORMATS: Record<StreamQuality, string> = {
  auto: 'bestaudio[ext=m4a]/bestaudio/best/best',
  low: 'bestaudio[abr<=96][ext=m4a]/bestaudio[abr<=96]/bestaudio[ext=m4a]/bestaudio/best/best',
  high: 'bestaudio[ext=m4a]/bestaudio/best/best',
};

/** Untrusted query value -> a known quality (anything else falls back to auto). */
export function normalizeQuality(raw: unknown): StreamQuality {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (QUALITIES.find((q) => q === value) ?? 'auto');
}

function streamKey(videoId: string, quality: StreamQuality): string {
  return quality === 'auto' ? videoId : `${videoId}::${quality}`;
}

export const youtubeProvider: MusicProvider = {
  id: 'youtube',
  displayName: 'YouTube',
  providesStreams: true,

  async search(query: string, limit = config.ytdlp.searchLimit): Promise<SearchResults> {
    const key = `search::${limit}::${query.toLowerCase()}`;
    return memoize(
      searchCache,
      key,
      async () => {
        const { stdout } = await runYtDlp([
          '--flat-playlist',
          '--dump-json',
          '--no-warnings',
          '--skip-download',
          `ytsearch${limit}:${query}`,
        ]);
        const entries = parseJsonLines<FlatEntry>(stdout);
        const tracks = entries
          .map(fromFlat)
          .filter((t): t is NormalizedTrack => t !== null)
          .slice(0, limit);
        log.info('search completed', { q: query.slice(0, 60), results: tracks.length });
        return buildSearchResults(tracks);
      },
      config.cache.searchTtlMs,
    );
  },

  async getTrack(id: string): Promise<NormalizedTrack | null> {
    const videoId = id.startsWith('yt:') ? id.slice(3) : id;
    if (!isValidVideoId(videoId)) return null;
    return memoize(
      metadataCache,
      videoId,
      async () => {
        const { stdout } = await runYtDlp([
          '--dump-single-json',
          '--no-playlist',
          '--no-warnings',
          '--skip-download',
          watchUrl(videoId),
        ]);
        const doc = parseJsonDoc<FullEntry>(stdout);
        if (!doc) return null;
        return fromFull(doc, videoId);
      },
      config.cache.metadataTtlMs,
    );
  },

  async resolveStream(track: NormalizedTrack): Promise<StreamSource> {
    if (track.sourceId && isValidVideoId(track.sourceId)) {
      return resolveMediaUrl(track.sourceId);
    }
    if (track.resolveQuery) {
      const results = await this.search(track.resolveQuery, 5);
      const first = results.tracks[0];
      if (first?.sourceId) return resolveMediaUrl(first.sourceId);
    }
    throw errors.extractionFailed('no resolvable source for track');
  },
};

/**
 * Resolve a streamable media URL for a video id.
 *
 * URLs are held ONLY in the in-memory TTL cache, keyed by the expiry that
 * YouTube itself embeds (`expire=...`). They are never written to disk and are
 * refreshed on demand.
 *
 * `quality` comes from the client's `?q=` parameter and only selects the
 * yt-dlp format - it never affects what is persisted (nothing is persisted).
 */
export async function resolveMediaUrl(
  videoId: string,
  quality: StreamQuality = 'auto',
): Promise<StreamSource> {
  if (!isValidVideoId(videoId)) throw errors.invalidInput('invalid video id');
  const q = normalizeQuality(quality);

  const cacheKey = streamKey(videoId, q);
  const cached = streamCache.getWithMinTtl(cacheKey, 60_000);
  if (cached) return cached;

  const { stdout } = await runYtDlp([
    '-f',
    QUALITY_FORMATS[q],
    '-g',
    '--no-playlist',
    '--no-warnings',
    watchUrl(videoId),
  ]);
  const url = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('http'));
  if (!url) throw errors.extractionFailed('yt-dlp returned no media url');

  const expiresAt = computeExpiry(url);
  const ttl = Math.max(30_000, Math.min(expiresAt - Date.now(), config.stream.ttlMs));
  const source: StreamSource = { url, expiresAt, contentType: undefined };
  streamCache.set(cacheKey, source, ttl);
  return source;
}

/** YouTube appends `expire=<unix seconds>` to media URLs; fall back to TTL. */
function computeExpiry(url: string): number {
  try {
    const u = new URL(url);
    const expire = u.searchParams.get('expire');
    if (expire && /^\d+$/.test(expire)) {
      return Number(expire) * 1000;
    }
  } catch {
    // fall through
  }
  return Date.now() + config.stream.ttlMs;
}

export function invalidateStream(videoId: string): void {
  // Drop every quality variant of this id.
  for (const q of QUALITIES) streamCache.delete(streamKey(videoId, q));
}

export function clearProviderCaches(): void {
  searchCache.clear();
  metadataCache.clear();
  streamCache.clear();
}

export const providerCaches = { searchCache, metadataCache, streamCache };
