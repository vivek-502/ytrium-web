import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { TtlCache, memoize } from '../cache/ttlCache.js';
import { errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { runYtDlp, isValidVideoId } from '../services/ytdlp.js';

const log = createLogger('lyrics');

/* ------------------------------------------------------------------ types */

export interface SyncedLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface LyricsResult {
  /** Provider that supplied the text: lrclib | youtube-captions. */
  source: string;
  instrumental: boolean;
  plainText: string | null;
  synced: SyncedLine[] | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
}

export interface LyricsLookup {
  title: string;
  artist: string;
  album?: string | null;
  /** Seconds; used to pick the right match when a provider fuzzes. */
  duration?: number;
  /** YouTube video id (used for the caption fallback). */
  videoId?: string | null;
}

/** Caption lines that carry no lyric text (YouTube auto cues). */
const NOISE_LINE =
  /^\(?\[?[♪♫]*\s*(music|applause|laughter|instrumental|chorus|verse|intro|outro|silence|background|inaudible|speaking)\s*[)\]♪♫!~-]*$/i;
/** Lines consisting only of music-note glyphs (instrumental cues). */
const MUSIC_ONLY = /^[([♪♫\]]+[\s!~-]*$/;

/* ------------------------------------------------------------------ caching */

/** In-memory TTL cache; a null value records "no lyrics found" for the key. */
const lyricsCache = new TtlCache<LyricsResult | null>(
  config.cache.lyricsTtlMs,
  config.cache.lyricsMaxEntries,
);

/* ----------------------------------------------------------------- LRCLIB */

interface LrclibEntry {
  id?: number;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

function normalizeKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function lrclibFetch<T>(pathname: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${config.lyrics.base.replace(/\/$/, '')}${pathname}?${params}`, {
    headers: { accept: 'application/json', 'user-agent': 'yttrium/1.0 (+lyrics)' },
    signal: AbortSignal.timeout(config.lyrics.timeoutMs),
  });
  if (!res.ok) throw errors.upstreamUnavailable(`lyrics provider http ${res.status}`);
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) throw errors.upstreamUnavailable('lyrics payload too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw errors.upstreamUnavailable('lyrics provider returned invalid json');
  }
}

/** Exact-title lookup. 404 means "no exact match", not an outage. */
async function lrclibExact(artist: string, title: string): Promise<LrclibEntry | null> {
  const res = await fetch(
    `${config.lyrics.base.replace(/\/$/, '')}/api/get?${new URLSearchParams({
      artist_name: artist,
      track_name: title,
    })}`,
    {
      headers: { accept: 'application/json', 'user-agent': 'yttrium/1.0 (+lyrics)' },
      signal: AbortSignal.timeout(config.lyrics.timeoutMs),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw errors.upstreamUnavailable(`lyrics provider http ${res.status}`);
  const entry = (await res.json()) as LrclibEntry;
  return entry && typeof entry === 'object' ? entry : null;
}

/** Fuzzy search; results are ranked locally against the known track. */
async function lrclibSearch(artist: string, title: string): Promise<LrclibEntry[]> {
  const data = await lrclibFetch<unknown>(
    '/api/search',
    new URLSearchParams({ artist_name: artist, track_name: title }),
  );
  return Array.isArray(data) ? (data as LrclibEntry[]) : [];
}

function pickBest(entries: LrclibEntry[], lookup: LyricsLookup): LrclibEntry | null {
  const wantArtist = normalizeKey(lookup.artist);
  const wantTitle = normalizeKey(lookup.title);
  const wantAlbum = lookup.album ? normalizeKey(lookup.album) : '';
  const wantDuration = lookup.duration ?? 0;

  let best: LrclibEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    if (!entry.plainLyrics && !entry.syncedLyrics) continue;

    let score = 0;
    const a = normalizeKey(entry.artistName);
    const t = normalizeKey(entry.trackName);
    if (wantArtist && a) {
      if (a === wantArtist) score += 100;
      else if (a.includes(wantArtist) || wantArtist.includes(a)) score += 50;
    }
    if (wantTitle && t) {
      if (t === wantTitle) score += 60;
      else if (t.includes(wantTitle) || wantTitle.includes(t)) score += 30;
    }
    if (wantAlbum && normalizeKey(entry.albumName) === wantAlbum) score += 25;
    if (entry.syncedLyrics) score += 8;

    if (wantDuration > 0 && entry.duration && entry.duration > 0) {
      const diff = Math.abs(entry.duration - wantDuration);
      if (diff <= 3) score += 20;
      else if (diff <= 12) score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // A plausible match needs at least a strong artist or title signal.
  return bestScore >= 60 ? best : null;
}

/* ----------------------------------------------------------------- parsing */

/** Parse LRC-style synced lyrics: `[mm:ss.xx]text` (one or many stamps/line). */
export function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('[')) continue;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      times.push(min * 60 + sec + frac);
    }
    const text = line.replace(re, '').trim();
    if (!times.length || !text) continue;
    for (const t of times) out.push({ time: Math.round(t * 1000) / 1000, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Parse a WebVTT subtitle document into timed lyric lines. */
function parseVtt(vtt: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const m = lines[0].match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})\s*-->/);
    if (!m) continue;
    const time =
      Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
    const text = lines
      .slice(1)
      .map((l) => l.replace(/^<[^>]+>/i, '').replace(/<[^>]+>$/i, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/^[♪♫\s]+/u, '')
      .replace(/[♪♫\s]+$/u, '')
      .trim();
    if (!text || NOISE_LINE.test(text) || MUSIC_ONLY.test(text)) continue;
    out.push({ time: Math.round(time * 1000) / 1000, text });
  }
  return out;
}

/** Trim/space blanks; `null` when nothing usable remains. */
function cleanPlain(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || null;
}

function lrclibToResult(entry: LrclibEntry): LyricsResult | null {
  const instrumental = entry.instrumental === true;
  const synced = entry.syncedLyrics ? parseLrc(entry.syncedLyrics) : null;
  const plainText =
    cleanPlain(entry.plainLyrics) || (synced?.length ? synced.map((l) => l.text).join('\n') : null);
  if (!instrumental && !plainText) return null;
  return {
    source: 'lrclib',
    instrumental,
    // Instrumentals have no text; keep the flag and drop empty bodies.
    plainText: instrumental ? null : plainText,
    synced: synced && synced.length ? synced : null,
    trackName: entry.trackName ?? null,
    artistName: entry.artistName ?? null,
    albumName: entry.albumName ?? null,
  };
}

/* ------------------------------------------------------------- YouTube subs */

/** Prefer the official lyrics caption track over regional/auto variants. */
function captionRank(code: string): number {
  const c = code.toLowerCase();
  if (c.includes('lyric')) return 0;
  if (c === 'en') return 1;
  if (/^en-[a-z]{2}$/.test(c)) return 2; // en-US / en-GB …
  return 3; // auto captions (en-orig) and anything else
}

function pickBestCaption(files: string[], videoId: string): string {
  const prefix = `${videoId}.`;
  let best = files[0];
  let bestRank = Number.POSITIVE_INFINITY;
  for (const f of files) {
    const code = f.startsWith(prefix) ? f.slice(prefix.length, -'.vtt'.length) : f;
    const rank = captionRank(code);
    if (rank < bestRank) {
      bestRank = rank;
      best = f;
    }
  }
  return best;
}

/**
 * Last-resort fallback: download the YouTube video's captions (official or
 * auto) for tracks where a lyrics database has nothing. Only caption *text*
 * is retained - no media bytes touch disk for longer than the call.
 */
/** Original-language caption tracks worth trying (never translated copies). */
const CAPTION_LANGS = ['en', 'en-US', 'en-GB', 'en-orig', 'en-lyrics'];

async function youtubeCaptionLyrics(videoId: string): Promise<LyricsResult | null> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yttrium-lyrics-'));
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      await runYtDlp(
        [
          '--no-playlist',
          '--skip-download',
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs',
          CAPTION_LANGS.join(','),
          '--sub-format',
          'vtt',
          '--paths',
          tmp,
          '-o',
          '%(id)s.%(ext)s',
          url,
        ],
        config.lyrics.subsTimeoutMs,
      );
    } catch (err) {
      // yt-dlp aborts with a non-zero exit if a *single* caption track fails
      // (say, one 429 among several). Captions that already downloaded are
      // still useful, so keep going when we have at least one .vtt file.
      const files = await fs.readdir(tmp).catch(() => [] as string[]);
      if (!files.some((f) => f.endsWith('.vtt'))) throw err;
      log.warn('youtube caption download partial', { videoId, err: String(err) });
    }

    const files = (await fs.readdir(tmp)).filter((f) => f.endsWith('.vtt'));
    if (!files.length) return null;
    const chosen = pickBestCaption(files, videoId);
    const vtt = await fs.readFile(path.join(tmp, chosen), 'utf8');
    const synced = parseVtt(vtt);
    if (!synced.length) return null;

    return {
      source: 'youtube-captions',
      instrumental: false,
      plainText: synced.map((l) => l.text).join('\n'),
      synced,
      trackName: null,
      artistName: null,
      albumName: null,
    };
  } catch (err) {
    log.warn('youtube caption lyrics failed', { videoId, err: String(err) });
    return null;
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------------------------------------------------------- orchestrator */

/**
 * Lyrics for a track: LRCLIB exact match -> scored LRCLIB search -> YouTube
 * caption fallback. The result (including "not found") is TTL-cached.
 */
export async function getLyricsFor(lookup: LyricsLookup): Promise<LyricsResult | null> {
  const key = [
    normalizeKey(lookup.artist),
    normalizeKey(lookup.title),
    normalizeKey(lookup.album ?? ''),
    lookup.duration ? String(Math.round(lookup.duration / 10) * 10) : '',
    lookup.videoId ?? '',
  ].join('|');

  return memoize(
    lyricsCache,
    key,
    async () => {
      if (config.lyrics.enabled) {
        try {
          const exact = await lrclibExact(lookup.artist, lookup.title);
          const result = exact ? lrclibToResult(exact) : null;
          if (result) return result;
        } catch (err) {
          log.warn('lrclib exact lookup failed', { err: String(err) });
        }

        try {
          const results = await lrclibSearch(lookup.artist, lookup.title);
          const best = pickBest(results, lookup);
          if (best) {
            const result = lrclibToResult(best);
            if (result) return result;
          }
        } catch (err) {
          log.warn('lrclib search failed', { err: String(err) });
        }
      }

      if (lookup.videoId && isValidVideoId(lookup.videoId)) {
        return youtubeCaptionLyrics(lookup.videoId);
      }
      return null;
    },
    config.cache.lyricsTtlMs,
  );
}