import { config } from '../config.js';
import { TtlCache, memoize } from '../cache/ttlCache.js';
import { errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { runYtDlp, parseJsonLines } from '../services/ytdlp.js';
import { albumIdFor, artistIdFor, cleanTitle, splitTitle } from './youtube.js';
import type { ChartsResult, NormalizedAlbum, NormalizedArtist, NormalizedTrack } from './types.js';

const log = createLogger('charts');

const chartsCache = new TtlCache<ChartsResult>(config.cache.chartTtlMs, 10);

/**
 * Chart/toplist metadata provider.
 *
 * Uses Apple's public iTunes RSS + lookup APIs (metadata only, no media).
 * Chart tracks are `itunes:` records that carry a `resolveQuery`; playback is
 * resolved lazily through the YouTube provider by the client right before a
 * track plays. Falls back to yt-dlp search derived charts when unavailable.
 */
const FALLBACK_QUERIES = ['trending songs this week', 'top 50 popular songs', 'new music hits'];

async function fetchJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'yttrium/1.0 (+metadata)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw errors.upstreamUnavailable(`charts http ${res.status}`);
  const text = await res.text();
  if (text.length > 6 * 1024 * 1024) throw errors.upstreamUnavailable('charts payload too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw errors.upstreamUnavailable('charts returned invalid json');
  }
}

/** Ask mzstatic for a large artwork size instead of the 170px thumbnail. */
function upgradeArtwork(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\.(png|jpg)/, '/600x600bb.$1');
}

interface RssEntry {
  'im:name'?: { label?: string };
  'im:image'?: Array<{ label?: string }>;
  'im:collection'?: { 'im:name'?: { label?: string } };
  'im:artist'?: { label?: string };
  'im:releaseDate'?: { attributes?: { label?: string }; label?: string };
  id?: { attributes?: { 'im:id'?: string }; label?: string };
  link?: { attributes?: { href?: string } };
  title?: { label?: string };
  category?: { attributes?: { 'im:id'?: string; label?: string } };
}

interface RssFeed {
  feed?: { entry?: RssEntry[] | RssEntry };
}

function entriesOf(feed: RssFeed): RssEntry[] {
  const e = feed.feed?.entry;
  if (!e) return [];
  return Array.isArray(e) ? e : [e];
}

function lastImage(entry: RssEntry): string | null {
  const imgs = entry['im:image'];
  if (imgs && imgs.length) return upgradeArtwork(imgs[imgs.length - 1].label);
  return null;
}

function releaseLabel(entry: RssEntry): string | null {
  const raw = entry['im:releaseDate']?.attributes?.label || entry['im:releaseDate']?.label;
  return raw || null;
}

interface LookupTrack {
  wrapperType?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
}

async function lookupTracks(ids: number[]): Promise<Map<number, LookupTrack>> {
  const map = new Map<number, LookupTrack>();
  if (!ids.length) return map;
  const base = config.providers.chartsBase.replace(/\/$/, '');
  // iTunes lookup accepts comma separated ids in a single request.
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    try {
      const res = await fetchJson<{ results?: LookupTrack[] }>(
        `${base}/lookup?id=${chunk.join(',')}&entity=song&limit=100`,
      );
      for (const r of res.results ?? []) {
        if (r.trackId) map.set(r.trackId, r);
      }
    } catch (err) {
      log.warn('itunes lookup enrichment failed', { err: String(err) });
    }
  }
  return map;
}

function songFromRss(entry: RssEntry, detail?: LookupTrack): NormalizedTrack | null {
  const trackId = entry.id?.attributes?.['im:id'];
  const title = detail?.trackName || entry['im:name']?.label || entry.title?.label;
  if (!trackId || !title) return null;

  const artist = detail?.artistName || entry['im:artist']?.label || 'Unknown Artist';
  const album = detail?.collectionName || entry['im:collection']?.['im:name']?.label || null;
  const genre = detail?.primaryGenreName || entry.category?.attributes?.label || null;
  const releaseDate = detail?.releaseDate?.slice(0, 10) ?? releaseLabel(entry);
  const artwork = detail?.artworkUrl100 ? upgradeArtwork(detail.artworkUrl100) : lastImage(entry);

  return {
    id: `itunes:${trackId}`,
    source: 'itunes',
    sourceId: null,
    title: splitTitle(cleanTitle(title), artist),
    artist,
    artistId: artistIdFor(artist),
    album,
    albumId: album ? albumIdFor(artist, album) : null,
    duration: detail?.trackTimeMillis ? Math.round(detail.trackTimeMillis / 1000) : 0,
    thumbnail: artwork,
    genre,
    releaseDate,
    url: entry.link?.attributes?.href ?? null,
    resolveQuery: `${title} ${artist}`,
  };
}

function albumFromRss(entry: RssEntry): NormalizedAlbum | null {
  const albumId = entry.id?.attributes?.['im:id'];
  const title = entry['im:name']?.label;
  if (!albumId || !title) return null;
  const artist = entry['im:artist']?.label || 'Unknown Artist';
  return {
    id: albumIdFor(artist, title),
    title,
    artist,
    artistId: artistIdFor(artist),
    image: lastImage(entry),
    releaseDate: releaseLabel(entry),
    source: 'itunes',
  };
}

/** Build a track record from a bare iTunes lookup result (no RSS entry). */
function trackFromLookup(detail: LookupTrack): NormalizedTrack | null {
  const trackId = detail.trackId;
  const title = detail.trackName;
  if (!trackId || !title) return null;
  const artist = detail.artistName || 'Unknown Artist';
  const album = detail.collectionName || null;
  return {
    id: `itunes:${trackId}`,
    source: 'itunes',
    sourceId: null,
    title: splitTitle(cleanTitle(title), artist),
    artist,
    artistId: artistIdFor(artist),
    album,
    albumId: album ? albumIdFor(artist, album) : null,
    duration: detail.trackTimeMillis ? Math.round(detail.trackTimeMillis / 1000) : 0,
    thumbnail: detail.artworkUrl100 ? upgradeArtwork(detail.artworkUrl100) : null,
    genre: detail.primaryGenreName || null,
    releaseDate: detail.releaseDate ? detail.releaseDate.slice(0, 10) : null,
    url: null,
    resolveQuery: `${title} ${artist}`,
  };
}

/**
 * Songs belonging to the given collection ids (`entity=song` returns the
 * collection itself plus its tracks - non-track rows are skipped).
 */
async function lookupAlbumSongs(albumIds: number[]): Promise<NormalizedTrack[]> {
  const out: NormalizedTrack[] = [];
  if (!albumIds.length) return out;
  const base = config.providers.chartsBase.replace(/\/$/, '');
  for (let i = 0; i < albumIds.length; i += 10) {
    const chunk = albumIds.slice(i, i + 10);
    try {
      const res = await fetchJson<{ results?: Array<LookupTrack & { wrapperType?: string }> }>(
        `${base}/lookup?id=${chunk.join(',')}&entity=song&limit=200`,
      );
      for (const r of res.results ?? []) {
        if (r.wrapperType && r.wrapperType !== 'track') continue;
        const track = trackFromLookup(r);
        if (track) out.push(track);
      }
    } catch (err) {
      log.warn('itunes album song lookup failed', { err: String(err) });
    }
  }
  return out;
}

function deriveArtists(
  songs: NormalizedTrack[],
  albums: NormalizedAlbum[],
): NormalizedArtist[] {
  const map = new Map<string, NormalizedArtist>();
  for (const s of songs) {
    if (!map.has(s.artistId!)) {
      map.set(s.artistId!, {
        id: s.artistId!,
        name: s.artist,
        image: s.thumbnail,
        source: 'itunes',
      });
    }
  }
  for (const a of albums) {
    if (!map.has(a.artistId!)) {
      map.set(a.artistId!, {
        id: a.artistId!,
        name: a.artist,
        image: a.image,
        source: 'itunes',
      });
    }
  }
  return [...map.values()];
}

async function itunesCharts(): Promise<ChartsResult> {
  const base = config.providers.chartsBase.replace(/\/$/, '');
  const region = encodeURIComponent(config.providers.chartsRegion || 'us');

  const [songsFeed, albumsFeed] = await Promise.all([
    fetchJson<RssFeed>(`${base}/rss/topsongs/limit=30/json`),
    fetchJson<RssFeed>(`${base}/rss/topalbums/limit=20/json`),
  ]);

  const songEntries = entriesOf(songsFeed);
  const albumEntries = entriesOf(albumsFeed);
  if (!songEntries.length) throw errors.upstreamUnavailable('empty top songs feed');

  const ids = songEntries
    .map((e) => Number(e.id?.attributes?.['im:id']))
    .filter((n) => Number.isFinite(n) && n > 0);

  const details = await lookupTracks(ids);

  const trending: NormalizedTrack[] = [];
  for (const entry of songEntries) {
    const id = Number(entry.id?.attributes?.['im:id']);
    const t = songFromRss(entry, details.get(id));
    if (t) trending.push(t);
  }

  const albums: NormalizedAlbum[] = [];
  for (const entry of albumEntries) {
    const a = albumFromRss(entry);
    if (a) albums.push(a);
  }

  /* "New releases": real tracks from the newest chart albums.
   * The feed is ordered by popularity, so re-rank albums by release date and
   * resolve their songs. Falls back to the newest chart songs when the song
   * lookup is unavailable, so the field is always a track list. */
  const newestAlbumIds = [...albumEntries]
    .map((entry) => ({
      id: Number(entry.id?.attributes?.['im:id']),
      date: releaseLabel(entry) ?? '',
    }))
    .filter((x) => Number.isFinite(x.id) && x.id > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((x) => x.id);

  const seenSongIds = new Set<string>();
  const newReleaseSongs = (await lookupAlbumSongs(newestAlbumIds)).filter((t) => {
    if (seenSongIds.has(t.id)) return false;
    seenSongIds.add(t.id);
    return true;
  });

  const newReleases: NormalizedTrack[] = newReleaseSongs.length
    ? newReleaseSongs.slice(0, 12)
    : [...trending]
        .filter((t) => t.releaseDate)
        .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
        .slice(0, 12);

  const popularArtists = deriveArtists(trending, albums).slice(0, 12);

  if (!trending.length) throw errors.upstreamUnavailable('chart normalization produced nothing');

  log.info('itunes charts fetched', {
    region,
    songs: trending.length,
    albums: albums.length,
  });

  return {
    trending,
    popular: trending,
    newReleases,
    popularArtists,
    popularAlbums: albums.slice(0, 12),
    chartsSource: 'itunes',
  };
}

/** Fallback: derive trending material from real YouTube search results. */
async function ytdlpCharts(): Promise<ChartsResult> {
  const collected: NormalizedTrack[] = [];
  const seen = new Set<string>();
  for (const q of FALLBACK_QUERIES) {
    try {
      const { stdout } = await runYtDlp([
        '--flat-playlist',
        '--dump-json',
        '--no-warnings',
        '--skip-download',
        `ytsearch10:${q}`,
      ]);
      const entries = parseJsonLines<{
        id?: string;
        title?: string;
        duration?: number;
        uploader?: string;
        view_count?: number;
      }>(stdout);
      for (const entry of entries) {
        if (!entry.id || entry.id.length !== 11 || seen.has(entry.id)) continue;
        seen.add(entry.id);
        const artist = (entry.uploader || 'Unknown Artist').replace(/\s*-\s*Topic$/, '');
        collected.push({
          id: `yt:${entry.id}`,
          source: 'youtube',
          sourceId: entry.id,
          title: splitTitle(cleanTitle(entry.title || 'Untitled'), artist),
          artist,
          artistId: artistIdFor(artist),
          album: null,
          albumId: null,
          duration: entry.duration ?? 0,
          thumbnail: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
          viewCount: entry.view_count ?? null,
          url: `https://www.youtube.com/watch?v=${entry.id}`,
          resolveQuery: null,
        });
      }
    } catch (err) {
      log.warn('trending fallback query failed', { q, err: String(err) });
    }
  }
  if (!collected.length) throw errors.upstreamUnavailable('no chart data available');
  return {
    trending: collected.slice(0, 24),
    popular: collected.slice(0, 24),
    newReleases: collected.slice(0, 12),
    popularArtists: [],
    popularAlbums: [],
    chartsSource: 'youtube-search',
  };
}

/** Aggregated chart data with TTL caching and graceful provider fallback. */
export async function getCharts(): Promise<ChartsResult> {
  return memoize(
    chartsCache,
    'charts',
    async () => {
      if (config.providers.chartsEnabled) {
        try {
          return await itunesCharts();
        } catch (err) {
          log.warn('chart provider failed, falling back to yt-dlp search', { err: String(err) });
        }
      }
      return ytdlpCharts();
    },
    config.cache.chartTtlMs,
  );
}
