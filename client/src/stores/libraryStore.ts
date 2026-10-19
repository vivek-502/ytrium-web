import { create } from 'zustand';
import type {
  Album,
  Artist,
  HistoryEntry,
  PlaybackSignals,
  Playlist,
  SearchHistoryEntry,
  Track,
} from '../types';
import { storage, saveDebounced, LIBRARY_KEY, HISTORY_KEY } from '../lib/storage';
import { uid } from '../lib/format';
import { ui } from './uiStore';

const MAX_HISTORY = 400;
const MAX_SEARCH = 30;
const MAX_CATALOG = 1500;
/** Repeated plays of one track inside this window are grouped together. */
const HISTORY_GROUP_WINDOW = 30 * 60_000;

interface LibrarySnapshot {
  playlists: Playlist[];
  liked: Record<string, { track: Track; likedAt: number }>;
  savedAlbums: Record<string, Album>;
  savedArtists: Record<string, Artist>;
  searchHistory: SearchHistoryEntry[];
  signals: Record<string, PlaybackSignals>;
  catalog: Record<string, Track>;
}

interface LibraryState extends LibrarySnapshot {
  history: HistoryEntry[];
  hydrated: boolean;

  hydrate: () => Promise<void>;

  /* likes */
  toggleLike: (track: Track) => boolean;
  isLiked: (trackId: string) => boolean;
  toggleSaveAlbum: (album: Album) => boolean;
  toggleFollowArtist: (artist: Artist) => boolean;

  /* playlists */
  createPlaylist: (name: string, description?: string, coverTrack?: Track | null) => Playlist;
  updatePlaylist: (id: string, patch: Partial<Pick<Playlist, 'name' | 'description' | 'image'>>) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => boolean;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  reorderPlaylist: (playlistId: string, from: number, to: number) => void;
  togglePlaylistLike: (playlistId: string) => void;
  getPlaylist: (id: string) => Playlist | undefined;

  /* history */
  recordTrackStart: (track: Track) => void;
  addPlayTime: (trackId: string, deltaMs: number) => void;
  finishTrack: (trackId: string, completion: number, sessionMs: number) => void;
  recordSkip: (trackId: string) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: () => void;

  /* search history */
  addSearchQuery: (query: string) => void;
  removeSearchEntry: (id: string) => void;
  clearSearchHistory: () => void;

  /* catalog (known tracks that feed recommendations) */
  rememberTracks: (tracks: Track[]) => void;
  knownTracks: () => Track[];

  /* data management */
  clearListeningData: () => void;
  /** Merges an exported library snapshot + history into the current one. */
  importData: (data: LibrarySnapshot, history: HistoryEntry[]) => void;
  resetApplication: () => Promise<void>;
}

function emptySnapshot(): LibrarySnapshot {
  return {
    playlists: [],
    liked: {},
    savedAlbums: {},
    savedArtists: {},
    searchHistory: [],
    signals: {},
    catalog: {},
  };
}

function snapshotOf(state: LibraryState): LibrarySnapshot {
  return {
    playlists: state.playlists,
    liked: state.liked,
    savedAlbums: state.savedAlbums,
    savedArtists: state.savedArtists,
    searchHistory: state.searchHistory,
    signals: state.signals,
    catalog: state.catalog,
  };
}

function persistLibrary(state: LibraryState, delay = 500): void {
  saveDebounced(LIBRARY_KEY, snapshotOf(state), delay);
}

function persistHistory(state: LibraryState, delay = 800): void {
  saveDebounced(HISTORY_KEY, state.history, delay);
}

function ensureSignals(signals: Record<string, PlaybackSignals>, id: string): PlaybackSignals {
  return (
    signals[id] ?? { playCount: 0, skipCount: 0, completeCount: 0, totalMsPlayed: 0, lastPlayedAt: 0 }
  );
}

/** First occurrence wins, so "imported first" makes imported entries take precedence. */
function dedupeById<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ...emptySnapshot(),
  history: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const [lib, history] = await Promise.all([
      storage.get<LibrarySnapshot>(LIBRARY_KEY),
      storage.get<HistoryEntry[]>(HISTORY_KEY),
    ]);
    set({
      ...(lib ?? emptySnapshot()),
      history: Array.isArray(history) ? history : [],
      hydrated: true,
    });
  },

  /* ------------------------------- likes -------------------------------- */

  toggleLike: (track) => {
    const state = get();
    const liked = { ...state.liked };
    const already = Boolean(liked[track.id]);
    if (already) delete liked[track.id];
    else liked[track.id] = { track, likedAt: Date.now() };

    const signals = { ...state.signals };
    const sig = ensureSignals(signals, track.id);
    signals[track.id] = sig;

    set({ liked, signals });
    persistLibrary({ ...get() });
    if (already) ui.toast('Removed from Liked songs', 'success');
    else ui.toast('Added to Liked songs', 'success');
    return !already;
  },

  isLiked: (trackId) => Boolean(get().liked[trackId]),

  toggleSaveAlbum: (album) => {
    const savedAlbums = { ...get().savedAlbums };
    const already = Boolean(savedAlbums[album.id]);
    if (already) delete savedAlbums[album.id];
    else savedAlbums[album.id] = album;
    set({ savedAlbums });
    persistLibrary({ ...get() });
    return !already;
  },

  toggleFollowArtist: (artist) => {
    const savedArtists = { ...get().savedArtists };
    const already = Boolean(savedArtists[artist.id]);
    if (already) delete savedArtists[artist.id];
    else savedArtists[artist.id] = artist;
    set({ savedArtists });
    persistLibrary({ ...get() });
    return !already;
  },

  /* ----------------------------- playlists ------------------------------ */

  createPlaylist: (name, description = '', coverTrack = null) => {
    const now = Date.now();
    const playlist: Playlist = {
      id: uid('pl'),
      name: name.trim() || 'My Playlist',
      description: description.trim(),
      image: coverTrack?.thumbnail ?? null,
      tracks: [],
      createdAt: now,
      updatedAt: now,
      liked: false,
    };
    set({ playlists: [playlist, ...get().playlists] });
    persistLibrary({ ...get() });
    return playlist;
  },

  updatePlaylist: (id, patch) => {
    const playlists = get().playlists.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    set({ playlists });
    persistLibrary({ ...get() });
  },

  deletePlaylist: (id) => {
    set({ playlists: get().playlists.filter((p) => p.id !== id) });
    persistLibrary({ ...get() });
  },

  addToPlaylist: (playlistId, track) => {
    let added = false;
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      if (p.tracks.some((t) => t.id === track.id)) return p;
      added = true;
      const tracks = [...p.tracks, track];
      return {
        ...p,
        tracks,
        image: p.image ?? track.thumbnail,
        updatedAt: Date.now(),
      };
    });
    if (added) {
      set({ playlists });
      persistLibrary({ ...get() });
      get().rememberTracks([track]);
    }
    return added;
  },

  removeFromPlaylist: (playlistId, trackId) => {
    const playlists = get().playlists.map((p) =>
      p.id === playlistId
        ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updatedAt: Date.now() }
        : p,
    );
    set({ playlists });
    persistLibrary({ ...get() });
  },

  reorderPlaylist: (playlistId, from, to) => {
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      if (from === to || from < 0 || to < 0 || from >= p.tracks.length || to >= p.tracks.length) {
        return p;
      }
      const tracks = [...p.tracks];
      const [moved] = tracks.splice(from, 1);
      tracks.splice(to, 0, moved);
      return { ...p, tracks, updatedAt: Date.now() };
    });
    set({ playlists });
    persistLibrary({ ...get() });
  },

  togglePlaylistLike: (playlistId) => {
    const playlists = get().playlists.map((p) =>
      p.id === playlistId ? { ...p, liked: !p.liked, updatedAt: p.updatedAt } : p,
    );
    set({ playlists });
    persistLibrary({ ...get() });
  },

  getPlaylist: (id) => get().playlists.find((p) => p.id === id),

  /* ------------------------------ history -------------------------------- */

  recordTrackStart: (track) => {
    const state = get();
    const now = Date.now();

    const signals = { ...state.signals };
    const sig = ensureSignals(signals, track.id);
    signals[track.id] = {
      ...sig,
      playCount: sig.playCount + 1,
      lastPlayedAt: now,
    };

    const history = [...state.history];
    const grouped = history.find(
      (h) => h.track.id === track.id && now - h.playedAt < HISTORY_GROUP_WINDOW,
    );
    if (grouped) {
      const index = history.findIndex((h) => h.id === grouped.id);
      history[index] = { ...grouped, playedAt: now, count: grouped.count + 1 };
    } else {
      history.unshift({
        id: `${track.id}_${now}`,
        track,
        playedAt: now,
        durationPlayed: 0,
        completionPercentage: 0,
        count: 1,
      });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }

    set({ signals, history });
    get().rememberTracks([track]);
    persistLibrary({ ...get() });
    persistHistory({ ...get() }, 1500);
  },

  addPlayTime: (trackId, deltaMs) => {
    if (deltaMs <= 0) return;
    const state = get();
    const signals = { ...state.signals };
    const sig = ensureSignals(signals, trackId);
    signals[trackId] = { ...sig, totalMsPlayed: sig.totalMsPlayed + deltaMs };
    set({ signals });
    persistLibrary({ ...get() }, 4000);
  },

  finishTrack: (trackId, completion, sessionMs) => {
    const state = get();
    const now = Date.now();
    const signals = { ...state.signals };
    const sig = ensureSignals(signals, trackId);
    signals[trackId] = {
      ...sig,
      completeCount: sig.completeCount + (completion >= 0.85 ? 1 : 0),
      lastPlayedAt: now,
    };

    const history = [...state.history];
    const idx = history.findIndex((h) => h.track.id === trackId);
    if (idx >= 0) {
      const entry = history[idx];
      history[idx] = {
        ...entry,
        playedAt: now,
        durationPlayed: Math.max(entry.durationPlayed, sessionMs),
        completionPercentage: Math.max(entry.completionPercentage, Math.round(completion * 100)),
      };
      // Most recent first.
      const [moved] = history.splice(idx, 1);
      history.unshift(moved);
    }

    set({ signals, history });
    persistLibrary({ ...get() });
    persistHistory({ ...get() });
  },

  recordSkip: (trackId) => {
    const state = get();
    const signals = { ...state.signals };
    const sig = ensureSignals(signals, trackId);
    signals[trackId] = { ...sig, skipCount: sig.skipCount + 1 };
    set({ signals });
    persistLibrary({ ...get() }, 4000);
  },

  removeHistoryEntry: (id) => {
    set({ history: get().history.filter((h) => h.id !== id) });
    persistHistory({ ...get() });
  },

  clearHistory: () => {
    set({ history: [] });
    saveDebounced(HISTORY_KEY, [], 0);
  },

  /* --------------------------- search history ---------------------------- */

  addSearchQuery: (query) => {
    const q = query.trim();
    if (q.length < 2) return;
    const state = get();
    const filtered = state.searchHistory.filter(
      (s) => s.query.toLowerCase() !== q.toLowerCase(),
    );
    const searchHistory: SearchHistoryEntry[] = [
      { id: uid('sh'), query: q, at: Date.now() },
      ...filtered,
    ].slice(0, MAX_SEARCH);
    set({ searchHistory });
    persistLibrary({ ...get() });
  },

  removeSearchEntry: (id) => {
    set({ searchHistory: get().searchHistory.filter((s) => s.id !== id) });
    persistLibrary({ ...get() });
  },

  clearSearchHistory: () => {
    set({ searchHistory: [] });
    persistLibrary({ ...get() });
  },

  /* ------------------------------- catalog -------------------------------- */

  rememberTracks: (tracks) => {
    if (!tracks.length) return;
    const catalog = { ...get().catalog };
    for (const t of tracks) {
      if (!t?.id) continue;
      // Re-insert to keep insertion order fresh; skip bare metadata dupes when
      // we already hold a playable version.
      const existing = catalog[t.id];
      if (existing && existing.sourceId && !t.sourceId) continue;
      catalog[t.id] = t;
    }
    const keys = Object.keys(catalog);
    if (keys.length > MAX_CATALOG) {
      for (let i = 0; i < keys.length - MAX_CATALOG; i++) delete catalog[keys[i]];
    }
    set({ catalog });
    persistLibrary({ ...get() }, 3000);
  },

  knownTracks: () => Object.values(get().catalog),

  /* --------------------------- data management ---------------------------- */

  clearListeningData: () => {
    set({ history: [], signals: {}, searchHistory: [] });
    saveDebounced(HISTORY_KEY, [], 0);
    persistLibrary({ ...get() }, 0);
    ui.toast('Listening data cleared', 'success');
  },

  importData: (data, history) => {
    const cur = get();

    // Playlists: imported ones replace same-id entries, new ones are appended.
    const playlists = [...cur.playlists];
    for (const p of data.playlists) {
      const i = playlists.findIndex((x) => x.id === p.id);
      if (i >= 0) playlists[i] = p;
      else playlists.push(p);
    }

    // Maps: imported entries win per key.
    const catalog = { ...cur.catalog, ...data.catalog };
    const catalogKeys = Object.keys(catalog);
    if (catalogKeys.length > MAX_CATALOG) {
      for (let i = 0; i < catalogKeys.length - MAX_CATALOG; i++) delete catalog[catalogKeys[i]];
    }

    // History + search history: dedupe by id, imported wins, caps enforced.
    const historyMerged = dedupeById([...history, ...cur.history], (e) => e.id).slice(0, MAX_HISTORY);
    const searchHistory = dedupeById([...data.searchHistory, ...cur.searchHistory], (e) => e.id).slice(
      0,
      MAX_SEARCH
    );

    set({
      playlists,
      liked: { ...cur.liked, ...data.liked },
      savedAlbums: { ...cur.savedAlbums, ...data.savedAlbums },
      savedArtists: { ...cur.savedArtists, ...data.savedArtists },
      searchHistory,
      signals: { ...cur.signals, ...data.signals },
      catalog,
      history: historyMerged,
    });
    persistLibrary({ ...get() }, 0);
    saveDebounced(HISTORY_KEY, historyMerged, 0);
  },

  resetApplication: async () => {
    await storage.clear();
    window.location.href = '/';
  },
}));

/* ------------------------------ selectors -------------------------------- */

export const selectLikedTracks = (s: LibraryState): Track[] =>
  Object.values(s.liked)
    .sort((a, b) => b.likedAt - a.likedAt)
    .map((e) => e.track);

export const selectLibraryArtists = (s: LibraryState): Artist[] => {
  const map = new Map<string, Artist>();
  for (const artist of Object.values(s.savedArtists)) map.set(artist.id, artist);
  for (const t of Object.values(s.liked)) {
    if (!map.has(t.track.artistId)) {
      map.set(t.track.artistId, { id: t.track.artistId, name: t.track.artist, image: t.track.thumbnail });
    }
  }
  for (const p of s.playlists) {
    for (const t of p.tracks) {
      if (!map.has(t.artistId)) {
        map.set(t.artistId, { id: t.artistId, name: t.artist, image: t.thumbnail });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const selectLibraryAlbums = (s: LibraryState): Album[] => {
  const map = new Map<string, Album>();
  for (const album of Object.values(s.savedAlbums)) map.set(album.id, album);
  for (const t of Object.values(s.liked)) {
    if (t.track.album && t.track.albumId && !map.has(t.track.albumId)) {
      map.set(t.track.albumId, {
        id: t.track.albumId,
        title: t.track.album,
        artist: t.track.artist,
        artistId: t.track.artistId,
        image: t.track.thumbnail,
        releaseDate: t.track.releaseDate,
      });
    }
  }
  for (const p of s.playlists) {
    for (const t of p.tracks) {
      if (t.album && t.albumId && !map.has(t.albumId)) {
        map.set(t.albumId, {
          id: t.albumId,
          title: t.album,
          artist: t.artist,
          artistId: t.artistId,
          image: t.thumbnail,
          releaseDate: t.releaseDate,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
};
