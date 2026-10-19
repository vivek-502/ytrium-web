import type {
  Album,
  Artist,
  ChartsPayload,
  DailyMix,
  HistoryEntry,
  HomeSection,
  PlaybackSignals,
  Playlist,
  SearchHistoryEntry,
  Track,
} from '../types';
import { fnv1a, greetingForHour } from '../lib/format';

/**
 * Local, deterministic recommendation engine.
 *
 * Signals used: play counts, completion, skips, likes, recency, search
 * history, playlist membership and artist affinity. Everything is derived from
 * data the user generated locally - no fake statistics, no hard-coded lists.
 *
 * The pure function shape (`buildHomeModel`) means a remote recommendation
 * API can be dropped in later without touching presentation code.
 */

export interface RecInput {
  signals: Record<string, PlaybackSignals>;
  liked: Record<string, { track: Track; likedAt: number }>;
  history: HistoryEntry[];
  searchHistory: SearchHistoryEntry[];
  playlists: Playlist[];
  catalog: Track[];
  charts: ChartsPayload | null;
  radio: Track[];
}

export interface QuickPick {
  id: string;
  kind: 'track' | 'playlist' | 'album';
  title: string;
  subtitle: string;
  image: string | null;
  track?: Track;
  playlist?: Playlist;
}

export interface HomeModel {
  greeting: string;
  quickPicks: QuickPick[];
  sections: HomeSection[];
  mixes: DailyMix[];
  topSeedArtist: string | null;
  isNewUser: boolean;
  hasCharts: boolean;
}

/* ------------------------------- scoring --------------------------------- */

const DAY = 86_400_000;

export function scoreTrack(
  track: Track,
  signals: Record<string, PlaybackSignals>,
  liked: Record<string, unknown>,
): number {
  const sig = signals[track.id];
  const isLiked = Boolean(liked[track.id]);
  let score = isLiked ? 28 : 0;
  if (!sig) return score;

  const plays = sig.playCount || 0;
  const skips = sig.skipCount || 0;
  const completions = sig.completeCount || 0;
  const now = Date.now();

  score += Math.log2(1 + plays) * 9;
  score += completions * 5;
  score -= skips * 4;

  if (sig.lastPlayedAt) {
    const age = now - sig.lastPlayedAt;
    if (age < DAY) score += 14;
    else if (age < 3 * DAY) score += 8;
    else if (age < 7 * DAY) score += 4;
    else if (age < 30 * DAY) score += 1.5;
  }
  return Math.max(0, score);
}

/** Artist affinity scores from likes, plays and history (0 = unknown). */

/** Full-library artist scores (used for mixes / "because you listened to"). */
export function artistScores(
  input: RecInput,
): Array<{ artistId: string; name: string; score: number }> {
  const map = new Map<string, { artistId: string; name: string; score: number }>();
  const bump = (artistId: string, name: string, delta: number) => {
    const entry = map.get(artistId) ?? { artistId, name, score: 0 };
    entry.score += delta;
    map.set(artistId, entry);
  };

  for (const [id, sig] of Object.entries(input.signals)) {
    const track = input.catalog.find((t) => t.id === id);
    if (!track) continue;
    bump(track.artistId, track.artist, sig.playCount * 3 + sig.completeCount * 2 - sig.skipCount);
  }
  for (const { track } of Object.values(input.liked)) {
    bump(track.artistId, track.artist, 5);
  }
  for (const entry of input.history.slice(0, 60)) {
    bump(entry.track.artistId, entry.track.artist, 2);
  }
  for (const q of input.searchHistory.slice(0, 10)) {
    const match = input.catalog.find(
      (t) =>
        t.artist.toLowerCase().includes(q.query.toLowerCase()) ||
        t.title.toLowerCase().includes(q.query.toLowerCase()),
    );
    if (match) bump(match.artistId, match.artist, 2);
  }

  return [...map.values()]
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/* ------------------------------- day mixes -------------------------------- */

/** Deterministic mixes built from the most-played artists in the local data. */
export function buildMixes(input: RecInput): DailyMix[] {
  const seeds = artistScores(input).slice(0, 6);
  if (!seeds.length) return [];

  const mixes: DailyMix[] = [];
  const used = new Set<string>();

  for (let i = 0; i < Math.min(3, Math.ceil(seeds.length / 2)); i++) {
    const primary = seeds[i * 2] ?? seeds[i];
    if (!primary) break;
    const partners = seeds.filter((s) => s.artistId !== primary.artistId).slice(i * 2, i * 2 + 2);

    const memberArtists = new Set([primary.artistId, ...partners.map((p) => p.artistId)]);
    const tracks = input.catalog
      .filter((t) => memberArtists.has(t.artistId) && !used.has(t.id))
      .sort((a, b) => scoreTrack(b, input.signals, input.liked) - scoreTrack(a, input.signals, input.liked))
      .slice(0, 20);

    if (tracks.length < 3) continue;
    for (const t of tracks) used.add(t.id);

    const cover = tracks[0]?.thumbnail ?? null;
    mixes.push({
      id: `mix_${i + 1}`,
      name: `Daily Mix ${i + 1}`,
      subtitle: [primary.name, ...partners.map((p) => p.name)].join(', '),
      image: cover,
      accentSeed: primary.artistId,
      tracks,
    });
  }
  return mixes;
}

/* ------------------------------ home model -------------------------------- */

function dedupeTracks(tracks: Track[], limit = 24): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

function albumsFromCharts(charts: ChartsPayload | null): Album[] {
  if (!charts) return [];
  return charts.popularAlbums;
}

function newReleaseAlbums(charts: ChartsPayload | null): Album[] {
  if (!charts) return [];
  const map = new Map<string, Album>();
  for (const t of charts.newReleases) {
    if (!t.album || !t.albumId) continue;
    map.set(t.albumId, {
      id: t.albumId,
      title: t.album,
      artist: t.artist,
      artistId: t.artistId,
      image: t.thumbnail,
      releaseDate: t.releaseDate,
    });
  }
  return [...map.values()];
}

export function buildHomeModel(input: RecInput): HomeModel {
  const sections: HomeSection[] = [];
  const likedTracks = Object.values(input.liked)
    .sort((a, b) => b.likedAt - a.likedAt)
    .map((e) => e.track);
  const hasSignals = Object.values(input.signals).some((s) => s.playCount > 0);
  const isNewUser = !hasSignals && likedTracks.length === 0 && input.history.length === 0;

  /* Quick picks: recent favorites + playlists + recent history */
  const quickPicks: QuickPick[] = [];
  const recentHistoryTracks = dedupeTracks(input.history.map((h) => h.track), 12);
  for (const playlist of input.playlists.slice(0, 4)) {
    quickPicks.push({
      id: playlist.id,
      kind: 'playlist',
      title: playlist.name,
      subtitle: playlist.tracks.length ? `${playlist.tracks.length} songs` : 'Playlist',
      image: playlist.image ?? playlist.tracks[0]?.thumbnail ?? null,
      playlist,
    });
  }
  for (const track of [...likedTracks.slice(0, 4), ...recentHistoryTracks].slice(0, 8)) {
    if (quickPicks.length >= 8) break;
    // A favourite can also sit in history: never render the same id twice.
    if (quickPicks.some((p) => p.id === track.id)) continue;
    quickPicks.push({
      id: track.id,
      kind: 'track',
      title: track.title,
      subtitle: track.artist,
      image: track.thumbnail,
      track,
    });
  }

  /* Recently played */
  if (recentHistoryTracks.length >= 3) {
    sections.push({
      id: 'recently-played',
      title: 'Recently played',
      kind: 'tracks',
      items: recentHistoryTracks.slice(0, 12),
      href: '/recently-played',
    });
  }

  /* Continue listening (partially played tracks) */
  const unfinished = dedupeTracks(
    input.history.filter((h) => h.completionPercentage > 5 && h.completionPercentage < 85).map((h) => h.track),
    12,
  );
  if (unfinished.length >= 2) {
    sections.push({
      id: 'continue',
      title: 'Continue listening',
      kind: 'tracks',
      items: unfinished,
    });
  }

  /* Made for you - daily mixes */
  const mixes = buildMixes(input);
  if (mixes.length) {
    sections.push({
      id: 'made-for-you',
      title: 'Made for you',
      subtitle: 'Mixes built from what you play',
      kind: 'mixes',
      items: mixes as unknown as HomeSection['items'],
      tone: 'accent',
    });
  }

  /* Recommended for you - scored local catalog */
  const scored = dedupeTracks(
    [...input.catalog]
      .filter((t) => !input.history.slice(0, 5).some((h) => h.track.id === t.id))
      .sort((a, b) => scoreTrack(b, input.signals, input.liked) - scoreTrack(a, input.signals, input.liked)),
    20,
  );
  const recommended = scored.length
    ? scored
    : (input.radio ?? []);
  if (recommended.length >= 3) {
    sections.push({
      id: 'recommended',
      title: isNewUser ? 'Recommended for you' : 'Picked up from your listening',
      subtitle: isNewUser ? 'Popular picks to get you started' : undefined,
      kind: 'tracks',
      items: recommended.slice(0, 20),
    });
  }

  /* Because you listened to <artist> */
  const seeds = artistScores(input);
  const topSeed = seeds[0] ?? null;
  if (topSeed && input.radio.length) {
    const seedTracks = dedupeTracks(
      input.radio.filter((t) => t.artistId !== topSeed.artistId),
      20,
    );
    if (seedTracks.length >= 3) {
      sections.push({
        id: 'because-you-listened',
        title: `Because you listened to ${topSeed.name}`,
        kind: 'tracks',
        items: seedTracks,
      });
    }
  }

  /* Trending now */
  if (input.charts?.trending.length) {
    sections.push({
      id: 'trending',
      title: 'Trending now',
      subtitle: input.charts.chartsSource !== 'unknown' ? 'Updated automatically' : undefined,
      kind: 'tracks',
      items: dedupeTracks(input.charts.trending, 24),
    });
  }

  /* Popular artists */
  const localArtists: Artist[] = seeds.slice(0, 6).map((s) => ({
    id: s.artistId,
    name: s.name,
    image:
      input.catalog.find((t) => t.artistId === s.artistId)?.thumbnail ?? null,
  }));
  const chartArtists = input.charts?.popularArtists ?? [];
  const mergedArtists = [...localArtists, ...chartArtists].filter(
    (a, i, arr) => arr.findIndex((x) => x.id === a.id) === i,
  );
  if (mergedArtists.length) {
    sections.push({
      id: 'popular-artists',
      title: isNewUser ? 'Popular artists' : 'Artists you follow & popular now',
      kind: 'artists',
      items: mergedArtists.slice(0, 12),
    });
  }

  /* New releases */
  const newAlbums = newReleaseAlbums(input.charts);
  if (newAlbums.length) {
    sections.push({
      id: 'new-releases',
      title: 'New releases',
      kind: 'albums',
      items: newAlbums.slice(0, 12),
    });
  }

  /* Top albums */
  const topAlbums = albumsFromCharts(input.charts);
  if (topAlbums.length) {
    sections.push({
      id: 'top-albums',
      title: 'Top albums',
      kind: 'albums',
      items: topAlbums.slice(0, 12),
    });
  }

  /* Your mixes (playlist-shaped collections of local favorites) */
  if (likedTracks.length >= 5) {
    sections.push({
      id: 'liked-mix',
      title: 'Your favorites',
      subtitle: 'Everything you liked, in one place',
      kind: 'tracks',
      items: scored.length ? scored.slice(0, 20) : likedTracks.slice(0, 20),
    });
  }

  /* Search-history driven recaps */
  for (const s of input.searchHistory.slice(0, 2)) {
    const matches = dedupeTracks(
      input.catalog.filter(
        (t) =>
          t.artist.toLowerCase().includes(s.query.toLowerCase()) ||
          t.title.toLowerCase().includes(s.query.toLowerCase()),
      ),
      12,
    );
    if (matches.length >= 3) {
      sections.push({
        id: `search-recap-${s.id}`,
        title: `More from “${s.query}”`,
        kind: 'tracks',
        items: matches,
      });
      break;
    }
  }

  /* Recently added (playlists + likes by recency) */
  const recentlyAdded = input.playlists
    .filter((p) => p.tracks.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((p) => p.tracks.slice(0, 3));
  if (recentlyAdded.length >= 4) {
    sections.push({
      id: 'recently-added',
      title: 'Recently added',
      kind: 'tracks',
      items: dedupeTracks(recentlyAdded, 16),
    });
  }

  /* Recommended playlists - real generated collections from local data */
  const recommendedPlaylists: Playlist[] = [];
  for (const seed of seeds.slice(0, 2)) {
    const tracks = input.catalog
      .filter((t) => t.artistId === seed.artistId)
      .slice(0, 15);
    if (tracks.length >= 3) {
      recommendedPlaylists.push({
        id: `gen_${seed.artistId}`,
        name: `More of ${seed.name}`,
        description: `Generated from your listening history`,
        image: tracks[0].thumbnail,
        tracks,
        createdAt: 0,
        updatedAt: 0,
      });
    }
  }
  if (input.charts?.trending.length) {
    recommendedPlaylists.push({
      id: 'gen_trending',
      name: 'Trending playlist',
      description: 'Chart tracks updated automatically',
      image: input.charts.trending[0]?.thumbnail ?? null,
      tracks: dedupeTracks(input.charts.trending, 20),
      createdAt: 0,
      updatedAt: 0,
    });
  }
  if (recommendedPlaylists.length) {
    sections.push({
      id: 'recommended-playlists',
      title: 'Recommended playlists',
      kind: 'playlists',
      items: recommendedPlaylists,
      tone: 'warm',
    });
  }

  /* Deterministic ordering is already fixed; drop empty sections. */
  return {
    greeting: greetingForHour(),
    quickPicks,
    sections: sections.filter((s) => s.items.length > 0),
    mixes,
    topSeedArtist: topSeed?.name ?? null,
    isNewUser,
    hasCharts: Boolean(input.charts?.trending.length),
  };
}

/* --------------------------- similar-track helper -------------------------- */

/** Deterministic "more like this" from the local catalog. */
export function similarTracks(seed: Track, catalog: Track[], limit = 12): Track[] {
  const seedWords = new Set(
    `${seed.title} ${seed.artist} ${seed.album ?? ''} ${seed.genre ?? ''}`.toLowerCase().split(/\s+/),
  );
  return catalog
    .filter((t) => t.id !== seed.id)
    .map((t) => {
      const words = `${t.title} ${t.artist} ${t.album ?? ''} ${t.genre ?? ''}`
        .toLowerCase()
        .split(/\s+/);
      let overlap = 0;
      for (const w of words) if (w.length > 2 && seedWords.has(w)) overlap += 1;
      if (t.artistId === seed.artistId) overlap += 4;
      if (t.albumId && t.albumId === seed.albumId) overlap += 5;
      if (t.genre && t.genre === seed.genre) overlap += 2;
      return { t, score: overlap * 100 + (fnv1a(seed.id + t.id) % 50) };
    })
    .filter((x) => x.score > 100)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}
