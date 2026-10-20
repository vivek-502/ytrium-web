import { http } from './http';
import type { MusicProvider } from './types';
import type {
  AlbumDetail,
  ArtistDetail,
  ChartsPayload,
  Lyrics,
  RemotePlaylist,
  SearchResults,
  Track,
} from '../types';

/* ------------------------------ TTL cache -------------------------------- */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  constructor(
    private ttlMs: number,
    private max = 120,
  ) {}
  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }
  set(key: string, value: T, ttl = this.ttlMs): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttl });
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  clear(): void {
    this.map.clear();
  }
}

const searchCache = new TtlCache<SearchResults>(5 * 60_000, 80);
const chartsCache = new TtlCache<ChartsPayload>(10 * 60_000, 4);
const recCache = new TtlCache<Track[]>(10 * 60_000, 60);
const artistCache = new TtlCache<ArtistDetail>(5 * 60_000, 40);
const albumCache = new TtlCache<AlbumDetail>(5 * 60_000, 40);
const lyricsCache = new TtlCache<Lyrics | null>(24 * 60 * 60_000, 200);
const playlistSearchCache = new TtlCache<RemotePlaylist[]>(5 * 60_000, 60);
const playlistTracksCache = new TtlCache<Track[]>(10 * 60_000, 60);

/** In-flight request de-duplication. */
const inflight = new Map<string, Promise<unknown>>();
function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ---------------------------- normalization ------------------------------ */

interface RawTrack {
  id?: string;
  title?: string;
  artist?: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  duration?: number;
  thumbnail?: string | null;
  source?: string;
  sourceId?: string | null;
  url?: string | null;
  genre?: string | null;
  releaseDate?: string | null;
  viewCount?: number | null;
  resolveQuery?: string | null;
}

function slugify(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizeTrack(raw: RawTrack): Track {
  const artist = raw.artist?.trim() || 'Unknown Artist';
  const title = raw.title?.trim() || 'Untitled';
  return {
    id: raw.id || `local:${title}`,
    title,
    artist,
    artistId: raw.artistId || slugify(artist),
    album: raw.album ?? null,
    albumId: raw.albumId ?? null,
    duration: Math.max(0, Math.round(raw.duration ?? 0)),
    thumbnail: raw.thumbnail ?? null,
    source: raw.source ?? 'unknown',
    sourceId: raw.sourceId ?? null,
    url: raw.url ?? null,
    genre: raw.genre ?? null,
    releaseDate: raw.releaseDate ?? null,
    viewCount: raw.viewCount ?? null,
    resolveQuery: raw.resolveQuery ?? null,
  };
}

/* ------------------------------ provider --------------------------------- */

interface SearchResponse extends SearchResults {
  query?: string;
}

export class ApiProvider implements MusicProvider {
  readonly id = 'api';

  async search(query: string, limit = 20): Promise<SearchResults> {
    const key = `${limit}::${query.trim().toLowerCase()}`;
    const cached = searchCache.get(key);
    if (cached) return cached;
    return dedupe(`search::${key}`, async () => {
      const res = await http.get<SearchResponse>('/api/search', {
        params: { q: query, limit },
      });
      const value: SearchResults = {
        tracks: (res.tracks ?? []).map(normalizeTrack),
        artists: res.artists ?? [],
        albums: res.albums ?? [],
        playlists: res.playlists ?? [],
      };
      searchCache.set(key, value);
      return value;
    });
  }

  async getTrack(id: string): Promise<Track | null> {
    try {
      const res = await http.get<{ track: RawTrack }>(`/api/tracks/${encodeURIComponent(id)}`);
      return res.track ? normalizeTrack(res.track) : null;
    } catch {
      return null;
    }
  }

  async getArtist(name: string): Promise<ArtistDetail> {
    const key = name.trim().toLowerCase();
    const cached = artistCache.get(key);
    if (cached) return cached;
    return dedupe(`artist::${key}`, async () => {
      const [res, playlists] = await Promise.all([
        http.get<ArtistDetail & { tracks: RawTrack[] }>('/api/artist', { params: { name } }),
        this.getArtistPlaylists(name).catch((): RemotePlaylist[] => []),
      ]);
      const value: ArtistDetail = {
        artist: res.artist,
        tracks: (res.tracks ?? []).map(normalizeTrack),
        albums: res.albums ?? [],
        related: res.related ?? [],
        playlists,
      };
      artistCache.set(key, value);
      return value;
    });
  }

  /** Public YouTube playlists by/matching an artist. */
  async getArtistPlaylists(name: string, limit = 12): Promise<RemotePlaylist[]> {
    const key = `${name.trim().toLowerCase()}::${limit}`;
    const cached = playlistSearchCache.get(key);
    if (cached) return cached;
    return dedupe(`artistpl::${key}`, async () => {
      const res = await http.get<{ playlists: RemotePlaylist[] }>('/api/artist/playlists', {
        params: { name, limit },
      });
      const value = res.playlists ?? [];
      playlistSearchCache.set(key, value);
      return value;
    });
  }

  /**
   * Expand a public playlist into playable tracks.
   *
   * This is the step that turns a search result into something the player can
   * actually queue, so failures are surfaced rather than swallowed.
   */
  async getPlaylistTracks(id: string, limit = 200): Promise<Track[]> {
    const key = `${id}::${limit}`;
    const cached = playlistTracksCache.get(key);
    if (cached) return cached;
    return dedupe(`pltracks::${key}`, async () => {
      const res = await http.get<{ tracks: RawTrack[] }>(
        `/api/playlists/${encodeURIComponent(id)}/tracks`,
        { params: { limit }, timeoutMs: 60_000 },
      );
      const value = (res.tracks ?? []).map(normalizeTrack);
      playlistTracksCache.set(key, value);
      return value;
    });
  }

  async getAlbum(artist: string, title: string): Promise<AlbumDetail> {
    const key = `${artist}::${title}`.toLowerCase();
    const cached = albumCache.get(key);
    if (cached) return cached;
    return dedupe(`album::${key}`, async () => {
      const res = await http.get<AlbumDetail & { tracks: RawTrack[] }>('/api/album', {
        params: { artist, title },
      });
      const value: AlbumDetail = {
        album: res.album,
        tracks: (res.tracks ?? []).map(normalizeTrack),
        exactMatch: res.exactMatch,
      };
      albumCache.set(key, value);
      return value;
    });
  }

  async resolveTrack(track: Track): Promise<Track> {
    if (track.sourceId) return track;
    const res = await http.post<{ track: RawTrack }>('/api/resolve', {
      id: track.sourceId ?? undefined,
      title: track.title,
      artist: track.artist,
      q: track.resolveQuery ?? undefined,
    });
    if (!res.track?.sourceId) {
      throw new Error('Unable to find a playable source for this track.');
    }
    const resolved = normalizeTrack(res.track);
    // Preserve chart metadata (album/genre/artwork) when the provider omits it.
    return {
      ...resolved,
      album: resolved.album ?? track.album,
      albumId: resolved.albumId ?? track.albumId,
      genre: resolved.genre ?? track.genre,
      releaseDate: resolved.releaseDate ?? track.releaseDate,
      thumbnail: resolved.thumbnail ?? track.thumbnail,
      duration: resolved.duration || track.duration,
    };
  }

  streamPath(track: Track): string | null {
    return track.sourceId ? `/api/stream/${track.sourceId}` : null;
  }

  async getRecommendations(seeds: string[], limit = 20): Promise<Track[]> {
    const key = `${seeds.join('|').toLowerCase()}::${limit}`;
    const cached = recCache.get(key);
    if (cached) return cached;
    return dedupe(`rec::${key}`, async () => {
      const res = await http.get<{ tracks: RawTrack[] }>('/api/recommendations', {
        params: { seeds: seeds.join(','), limit },
      });
      const value = (res.tracks ?? []).map(normalizeTrack);
      recCache.set(key, value);
      return value;
    });
  }

  async getTrending(limit = 20): Promise<Track[]> {
    const charts = await this.getCharts();
    return charts.trending.slice(0, limit);
  }

  async getCharts(): Promise<ChartsPayload> {
    const cached = chartsCache.get('charts');
    if (cached) return cached;
    return dedupe('charts', async () => {
      const res = await http.get<ChartsPayload>('/api/charts');
      const value: ChartsPayload = {
        trending: (res.trending ?? []).map(normalizeTrack),
        popular: (res.popular ?? []).map(normalizeTrack),
        newReleases: (res.newReleases ?? []).map(normalizeTrack),
        popularArtists: res.popularArtists ?? [],
        popularAlbums: res.popularAlbums ?? [],
        chartsSource: res.chartsSource ?? 'unknown',
      };
      chartsCache.set('charts', value);
      return value;
    });
  }

  async getLyrics(track: Track): Promise<Lyrics | null> {
    const key = `${track.id}::${track.sourceId ?? ''}`;
    const cached = lyricsCache.get(key);
    if (cached !== undefined) return cached;
    return dedupe(`lyrics::${key}`, async () => {
      const res = await http.get<{ lyrics: Lyrics | null }>('/api/lyrics', {
        params: {
          title: track.title,
          artist: track.artist,
          id: track.sourceId ?? undefined,
          album: track.album ?? undefined,
          duration: track.duration || undefined,
        },
        timeoutMs: 25_000,
      });
      const value = res.lyrics ?? null;
      lyricsCache.set(key, value);
      return value;
    });
  }

  /** Warm the backend stream cache: resolves a media URL without streaming. */
  async prefetchStream(track: Track): Promise<void> {
    if (!track.sourceId) return;
    try {
      await http.get(`/api/stream/${track.sourceId}/meta`, { timeoutMs: 20_000 });
    } catch {
      // Best effort only.
    }
  }
}

export const provider: MusicProvider = new ApiProvider();
export { ApiError } from './http';
