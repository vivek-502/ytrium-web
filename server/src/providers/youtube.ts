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
  NormalizedPlaylist,
  NormalizedTrack,
  SearchResults,
  StreamSource,
} from './types.js';

const log = createLogger('youtube');

const searchCache = new TtlCache<SearchResults>(config.cache.searchTtlMs, config.cache.maxEntries);
const metadataCache = new TtlCache<NormalizedTrack>(config.cache.metadataTtlMs, config.cache.maxEntries);
const streamCache = new TtlCache<StreamSource>(config.stream.ttlMs, config.cache.maxEntries);
const playlistCache = new TtlCache<NormalizedPlaylist[]>(config.cache.searchTtlMs, config.cache.maxEntries);
const playlistTracksCache = new TtlCache<NormalizedTrack[]>(config.cache.metadataTtlMs, config.cache.maxEntries);

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

/* ---------------------------- playlists ---------------------------------- */

/**
 * `sp=EgIQAw%3D%3D` is YouTube's "filter: playlist" search parameter, so every
 * entry the results page returns is a playlist rather than a video.
 */
const PLAYLIST_FILTER = 'EgIQAw%3D%3D';

/** How many playlist results to attach to each search response. */
const PLAYLIST_SEARCH_LIMIT = 12;

/** Playlist ids are `PL`, `UU`, `OLAK5uy_` ... followed by 10+ url-safe chars. */
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;

export function isValidPlaylistId(id: unknown): id is string {
  return typeof id === 'string' && PLAYLIST_ID_RE.test(id);
}

/** Channels that are almost certainly the artist/label rather than a fan. */
const OFFICIAL_CHANNEL_PATTERNS: RegExp[] = [
  /\s*-\s*topic$/i, // YouTube's auto-generated artist channels
  /vevo$/i,
  /\bofficial\b/i,
  /\brecords?\b/i,
  /\bmusic\b/i,
];

/**
 * Best-effort "is this an official playlist" test.
 *
 * YouTube exposes no official flag, so we infer it: the channel must look like
 * an artist/label channel (Topic, VEVO, "Official", a label) or match the
 * artist we searched for. This is deliberately conservative - a false negative
 * only means the playlist is hidden when "official only" is on.
 */
export function looksOfficial(owner: string, query: string): boolean {
  const channel = owner.trim();
  if (!channel) return false;
  if (OFFICIAL_CHANNEL_PATTERNS.some((re) => re.test(channel))) return true;
  // A channel that starts with the artist we searched for ("Daft Punk").
  const q = query.trim().toLowerCase();
  if (q.length >= 3) {
    const c = channel.toLowerCase();
    if (c.startsWith(q) || q.startsWith(c)) return true;
  }
  return false;
}

interface PlaylistEntry {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  playlist_count?: number | null;
  thumbnails?: Array<{ url?: string; preference?: number }>;
  thumbnail?: string;
}

function pickPlaylistThumb(e: PlaylistEntry): string | null {
  if (Array.isArray(e.thumbnails) && e.thumbnails.length) {
    const sorted = [...e.thumbnails].sort(
      (a, b) => (b.preference ?? 0) - (a.preference ?? 0),
    );
    const url = sorted[0]?.url;
    if (url) return url;
  }
  if (typeof e.thumbnail === 'string' && e.thumbnail) return e.thumbnail;
  return null;
}

function fromPlaylistEntry(e: PlaylistEntry, query: string): NormalizedPlaylist | null {
  const id = e.id;
  if (!isValidPlaylistId(id)) return null;
  const title = typeof e.title === 'string' && e.title.trim() ? e.title.trim() : null;
  if (!title) return null;
  const owner = (e.channel || e.uploader || '').trim();
  return {
    id,
    title,
    owner: owner || 'YouTube',
    image: pickPlaylistThumb(e),
    trackCount: typeof e.playlist_count === 'number' ? e.playlist_count : undefined,
    official: looksOfficial(owner, query),
    source: 'youtube',
  };
}

export async function searchPlaylists(
  query: string,
  limit = 12,
): Promise<NormalizedPlaylist[]> {
  const key = `plsearch::${limit}::${query.toLowerCase()}`;
  return memoize(
    playlistCache,
    key,
    async () => {
      const url =
        'https://www.youtube.com/results?search_query=' +
        encodeURIComponent(query) +
        `&sp=${PLAYLIST_FILTER}`;
      const { stdout } = await runYtDlp([
        '--flat-playlist',
        '--dump-single-json',
        '--no-warnings',
        '--skip-download',
        '--playlist-end',
        String(Math.max(limit * 2, 20)),
        url,
      ]);
      const doc = parseJsonDoc<{ entries?: PlaylistEntry[] }>(stdout);
      const entries = Array.isArray(doc?.entries) ? doc.entries : [];
      const playlists = entries
        .map((e) => fromPlaylistEntry(e, query))
        .filter((p): p is NormalizedPlaylist => p !== null)
        .slice(0, limit);
      log.info('playlist search completed', { q: query.slice(0, 60), results: playlists.length });
      return playlists;
    },
    config.cache.searchTtlMs,
  );
}

/**
 * Fetch the videos inside a public playlist.
 *
 * Flat extraction gives us video ids, titles, durations and thumbnails without
 * downloading anything; the entries are normalized exactly like search results
 * so they play through the normal stream resolver.
 */
export async function getPlaylistTracks(
  playlistId: string,
  limit = 200,
): Promise<NormalizedTrack[]> {
  if (!isValidPlaylistId(playlistId)) throw errors.invalidInput('invalid playlist id');
  return memoize(
    playlistTracksCache,
    `${playlistId}::${limit}`,
    async () => {
      const { stdout } = await runYtDlp([
        '--flat-playlist',
        '--dump-json',
        '--no-warnings',
        '--skip-download',
        '--playlist-end',
        String(limit),
        `https://www.youtube.com/playlist?list=${playlistId}`,
      ]);
      const entries = parseJsonLines<FlatEntry>(stdout);
      const tracks = entries
        .map(fromFlat)
        .filter((t): t is NormalizedTrack => t !== null);
      log.info('playlist tracks fetched', { playlistId, results: tracks.length });
      return tracks;
    },
    config.cache.metadataTtlMs,
  );
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
        // Playlist search runs alongside the video search. A failure here must
        // never break song results, so it degrades to an empty list.
        const playlists = await searchPlaylists(query, PLAYLIST_SEARCH_LIMIT).catch(() => {
          log.warn('playlist search failed', { q: query.slice(0, 60) });
          return [] as NormalizedPlaylist[];
        });
        log.info('search completed', {
          q: query.slice(0, 60),
          results: tracks.length,
          playlists: playlists.length,
        });
        return { ...buildSearchResults(tracks), playlists };
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
  playlistCache.clear();
  playlistTracksCache.clear();
}

export const providerCaches = {
  searchCache,
  metadataCache,
  streamCache,
  playlistCache,
  playlistTracksCache,
};
