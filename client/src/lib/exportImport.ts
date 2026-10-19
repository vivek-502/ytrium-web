import type {
  Album,
  Artist,
  HistoryEntry,
  PlaybackSignals,
  Playlist,
  RepeatMode,
  SearchHistoryEntry,
  Settings,
  Track,
} from "../types";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { usePlayerStore } from "../stores/playerStore";
import { flushSaves, prefStorage, SETTINGS_KEY, storage } from "./storage";

/* ------------------------------------------------------------- identity */

export const EXPORT_APP = "Ytrium";
/** Older builds exported under the previous name - keep those importable. */
const LEGACY_EXPORT_APPS = ["Sonare"];
export const EXPORT_SCHEMA_VERSION = 1;

const MAX_IMPORT_BYTES = 25 * 1024 * 1024; // exported data is a few MB at most

/* ---------------------------------------------------------------- types */

export interface ExportPayload {
  app: string;
  exportedAt: string;
  schemaVersion: number;
  settings: unknown;
  library: unknown;
  history: unknown;
  player: unknown;
  preferences: unknown;
}

export interface ImportSummary {
  playlists: number;
  liked: number;
  history: number;
  settings: boolean;
}

/** Thrown for anything that is not a valid Ytrium export file. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/* ------------------------------------------------------------------ guard */

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const strOrNull = (x: unknown): string | null => (isStr(x) ? (x as string) : null);
const numOr = (x: unknown, fallback: number): number => (isNum(x) ? (x as number) : fallback);
const boolOr = (x: unknown, fallback: boolean): boolean => (isBool(x) ? (x as boolean) : fallback);

const ACCENTS = new Set(["purple", "indigo", "blue", "teal", "green", "pink"]);
const QUALITIES = new Set(["auto", "high", "low"]);
const THEMES = new Set(["dark", "light"]);
const REPEAT_MODES = new Set(["off", "one", "all"]);

/* -------------------------------------------------------------- sanitizers */

function sanitizeTrack(u: unknown): Track | null {
  if (!isRecord(u)) return null;
  if (!isStr(u.id) || !isStr(u.title) || !isStr(u.artist)) return null;
  return {
    id: u.id,
    title: u.title,
    artist: u.artist,
    artistId: isStr(u.artistId) ? (u.artistId as string) : "",
    album: strOrNull(u.album),
    albumId: strOrNull(u.albumId),
    duration: numOr(u.duration, 0),
    thumbnail: strOrNull(u.thumbnail),
    source: isStr(u.source) ? (u.source as string) : "youtube",
    sourceId: strOrNull(u.sourceId),
    url: strOrNull(u.url),
    genre: strOrNull(u.genre),
    releaseDate: strOrNull(u.releaseDate),
    viewCount: isNum(u.viewCount) ? (u.viewCount as number) : undefined,
    resolveQuery: strOrNull(u.resolveQuery) ?? undefined,
  };
}

function sanitizeTrackMap(u: unknown): Record<string, Track> {
  const out: Record<string, Track> = {};
  if (!isRecord(u)) return out;
  for (const [id, v] of Object.entries(u)) {
    const track = sanitizeTrack(v);
    if (track) out[id] = track;
  }
  return out;
}

function sanitizeAlbumMap(u: unknown): Record<string, Album> {
  const out: Record<string, Album> = {};
  if (!isRecord(u)) return out;
  for (const [id, v] of Object.entries(u)) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.title) || !isStr(v.artist)) continue;
    out[id] = {
      id: v.id,
      title: v.title,
      artist: v.artist,
      artistId: isStr(v.artistId) ? (v.artistId as string) : "",
      image: strOrNull(v.image),
      releaseDate: strOrNull(v.releaseDate),
      trackCount: isNum(v.trackCount) ? (v.trackCount as number) : undefined,
    };
  }
  return out;
}

function sanitizeArtistMap(u: unknown): Record<string, Artist> {
  const out: Record<string, Artist> = {};
  if (!isRecord(u)) return out;
  for (const [id, v] of Object.entries(u)) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.name)) continue;
    out[id] = {
      id: v.id,
      name: v.name,
      image: strOrNull(v.image),
      description: strOrNull(v.description) ?? undefined,
    };
  }
  return out;
}

function sanitizePlaylists(u: unknown): Playlist[] {
  if (!Array.isArray(u)) return [];
  const out: Playlist[] = [];
  for (const v of u) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.name)) continue;
    const tracks = Array.isArray(v.tracks)
      ? (v.tracks.map(sanitizeTrack).filter((t): t is Track => t !== null) as Track[])
      : [];
    out.push({
      id: v.id,
      name: v.name,
      description: isStr(v.description) ? (v.description as string) : "",
      image: strOrNull(v.image),
      tracks,
      createdAt: numOr(v.createdAt, Date.now()),
      updatedAt: numOr(v.updatedAt, Date.now()),
      liked: boolOr(v.liked, false),
    });
  }
  return out;
}

function sanitizeLiked(
  u: unknown
): Record<string, { track: Track; likedAt: number }> {
  const out: Record<string, { track: Track; likedAt: number }> = {};
  if (!isRecord(u)) return out;
  for (const [id, v] of Object.entries(u)) {
    if (!isRecord(v)) continue;
    const track = sanitizeTrack(v.track);
    if (!track) continue;
    out[id] = { track, likedAt: numOr(v.likedAt, 0) };
  }
  return out;
}

function sanitizeHistory(u: unknown): HistoryEntry[] {
  if (!Array.isArray(u)) return [];
  const out: HistoryEntry[] = [];
  for (const v of u) {
    if (!isRecord(v) || !isStr(v.id)) continue;
    const track = sanitizeTrack(v.track);
    if (!track) continue;
    out.push({
      id: v.id,
      track,
      playedAt: numOr(v.playedAt, 0),
      durationPlayed: numOr(v.durationPlayed, 0),
      completionPercentage: numOr(v.completionPercentage, 0),
      count: Math.max(1, Math.round(numOr(v.count, 1))),
    });
  }
  return out;
}

function sanitizeSearchHistory(u: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(u)) return [];
  const out: SearchHistoryEntry[] = [];
  for (const v of u) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.query)) continue;
    out.push({ id: v.id, query: v.query, at: numOr(v.at, 0) });
  }
  return out;
}

function sanitizeSignals(u: unknown): Record<string, PlaybackSignals> {
  const out: Record<string, PlaybackSignals> = {};
  if (!isRecord(u)) return out;
  for (const [id, v] of Object.entries(u)) {
    if (!isRecord(v)) continue;
    out[id] = {
      playCount: numOr(v.playCount, 0),
      skipCount: numOr(v.skipCount, 0),
      completeCount: numOr(v.completeCount, 0),
      totalMsPlayed: numOr(v.totalMsPlayed, 0),
      lastPlayedAt: numOr(v.lastPlayedAt, 0),
    };
  }
  return out;
}

function sanitizeSettings(u: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!isRecord(u)) return out;
  if (isBool(u.autoplay)) out.autoplay = u.autoplay;
  if (isNum(u.crossfadeSeconds) && u.crossfadeSeconds >= 0 && u.crossfadeSeconds <= 60) {
    out.crossfadeSeconds = u.crossfadeSeconds;
  }
  if (isStr(u.audioQuality) && QUALITIES.has(u.audioQuality)) {
    out.audioQuality = u.audioQuality as Settings["audioQuality"];
  }
  if (isBool(u.normalizeVolume)) out.normalizeVolume = u.normalizeVolume;
  if (isStr(u.theme) && THEMES.has(u.theme)) out.theme = u.theme as Settings["theme"];
  if (isStr(u.accent) && ACCENTS.has(u.accent)) out.accent = u.accent as Settings["accent"];
  if (isBool(u.compactMode)) out.compactMode = u.compactMode;
  if (isBool(u.reduceMotion)) out.reduceMotion = u.reduceMotion;
  return out;
}

interface PlayerPrefs {
  volume?: number;
  isMuted?: boolean;
  repeatMode?: RepeatMode;
  shuffle?: boolean;
  queue?: Track[];
}

function sanitizePlayerPrefs(u: unknown): PlayerPrefs {
  const out: PlayerPrefs = {};
  if (!isRecord(u)) return out;
  if (isNum(u.volume)) out.volume = Math.min(1, Math.max(0, u.volume));
  if (isBool(u.isMuted)) out.isMuted = u.isMuted;
  if (isStr(u.repeatMode) && REPEAT_MODES.has(u.repeatMode)) {
    out.repeatMode = u.repeatMode as RepeatMode;
  }
  if (isBool(u.shuffle)) out.shuffle = u.shuffle;
  if (Array.isArray(u.queue)) {
    const queue = u.queue.map(sanitizeTrack).filter((t): t is Track => t !== null);
    if (queue.length) out.queue = queue;
  }
  return out;
}

/* ------------------------------------------------------------- validation */

function validatePayload(raw: unknown): ExportPayload {
  if (!isRecord(raw)) throw new ImportError("That file is not a Ytrium export.");
  const app = isStr(raw.app) ? raw.app.trim().toLowerCase() : null;
  const known = [EXPORT_APP, ...LEGACY_EXPORT_APPS].map((a) => a.toLowerCase());
  if (app === null || !known.includes(app)) {
    throw new ImportError("That file was not exported by Ytrium.");
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new ImportError(
      `That export uses schema v${String(raw.schemaVersion)}, which this version of Ytrium cannot read.`
    );
  }
  return {
    app: EXPORT_APP,
    exportedAt: isStr(raw.exportedAt) ? (raw.exportedAt as string) : "",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    settings: raw.settings,
    library: raw.library,
    history: raw.history,
    player: raw.player,
    preferences: raw.preferences,
  };
}

/* ----------------------------------------------------------------- export */

/** Builds the full export payload from persisted state (never the live player). */
export async function buildExportPayload(): Promise<ExportPayload> {
  flushSaves();
  const [library, history, player] = await Promise.all([
    storage.get<unknown>("library.v1"),
    storage.get<unknown>("history.v1"),
    storage.get<unknown>("player.v1"),
  ]);
  const payload: ExportPayload = {
    app: EXPORT_APP,
    exportedAt: new Date().toISOString(),
    schemaVersion: EXPORT_SCHEMA_VERSION,
    settings: useSettingsStore.getState().settings,
    library: library ?? null,
    history: history ?? null,
    player,
    preferences: prefStorage.get<Record<string, unknown>>(SETTINGS_KEY, {}),
  };
  return payload;
}

/** Serializes the payload and downloads it as `yttrium-export-YYYY-MM-DD.json`. */
export function downloadExport(payload: ExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yttrium-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ----------------------------------------------------------------- import */

/** Reads + validates the uploaded file, throwing ImportError for anything invalid. */
export async function parseImportFile(file: File): Promise<ExportPayload> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new ImportError("Could not read that file.");
  }
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError("That file is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("That file is not valid JSON.");
  }
  return validatePayload(raw);
}

/** Merges an export into the current library, history, settings and player prefs. */
export async function applyImport(payload: ExportPayload): Promise<ImportSummary> {
  const libRaw = isRecord(payload.library) ? payload.library : {};
  const importedLibrary = {
    playlists: sanitizePlaylists(libRaw.playlists),
    liked: sanitizeLiked(libRaw.liked),
    savedAlbums: sanitizeAlbumMap(libRaw.savedAlbums),
    savedArtists: sanitizeArtistMap(libRaw.savedArtists),
    searchHistory: sanitizeSearchHistory(libRaw.searchHistory),
    signals: sanitizeSignals(libRaw.signals),
    catalog: sanitizeTrackMap(libRaw.catalog),
  };
  const importedHistory = sanitizeHistory(payload.history);

  // Library first (persists immediately, no debounce delay on app close).
  useLibraryStore.getState().importData(importedLibrary, importedHistory);

  const settingsPatch = sanitizeSettings(payload.settings);
  if (Object.keys(settingsPatch).length > 0) {
    useSettingsStore.getState().update(settingsPatch);
  }

  const prefs = sanitizePlayerPrefs(payload.player);
  if (Object.keys(prefs).length > 0) {
    usePlayerStore.getState().importPrefs(prefs);
  }

  return {
    playlists: importedLibrary.playlists.length,
    liked: Object.keys(importedLibrary.liked).length,
    history: importedHistory.length,
    settings: Object.keys(settingsPatch).length > 0,
  };
}