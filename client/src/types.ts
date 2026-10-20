/* ------------------------------------------------------------------ */
/* Core domain types shared across the application.                    */
/* ------------------------------------------------------------------ */

export interface Track {
  /** Stable id: `yt:<videoId>`, `itunes:<trackId>`, or local:<hash>. */
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string | null;
  albumId: string | null;
  /** Seconds. 0 when the provider does not know. */
  duration: number;
  thumbnail: string | null;
  /** Provider that produced the record (youtube | itunes | local). */
  source: string;
  /** Native playable id (YouTube video id) - null until resolved. */
  sourceId: string | null;
  url: string | null;
  genre: string | null;
  releaseDate: string | null;
  viewCount?: number | null;
  /** Query used to lazily resolve playback for metadata-only records. */
  resolveQuery?: string | null;
}

export interface Artist {
  id: string;
  name: string;
  image: string | null;
  description?: string | null;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  image: string | null;
  releaseDate: string | null;
  trackCount?: number;
}

/**
 * A public YouTube playlist as returned by search.
 *
 * Distinct from the local `Playlist` (which owns its tracks): a remote playlist
 * only carries an id and metadata until it is saved, at which point its tracks
 * are fetched and it becomes a normal local playlist.
 */
export interface RemotePlaylist {
  id: string;
  title: string;
  /** Channel/uploader that published it. */
  owner: string;
  image: string | null;
  trackCount?: number;
  /** Likely published by the artist/label rather than a random user. */
  official?: boolean;
  source: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  image: string | null;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
  liked?: boolean;
  /** Set when this playlist was imported from a public YouTube playlist. */
  sourcePlaylistId?: string;
  /** Channel/uploader of the source YouTube playlist. */
  sourceOwner?: string;
}

export interface HistoryEntry {
  /** Grouping key: `<trackId>_<bucket>` where bucket is a 30 minute window. */
  id: string;
  track: Track;
  playedAt: number;
  /** Total ms played across grouped repeats. */
  durationPlayed: number;
  completionPercentage: number;
  /** How many repeats were grouped into this entry. */
  count: number;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  at: number;
}

/** Aggregated listening signals that drive the local recommendation engine. */
export interface PlaybackSignals {
  playCount: number;
  skipCount: number;
  completeCount: number;
  totalMsPlayed: number;
  lastPlayedAt: number;
}

export type RepeatMode = 'off' | 'one' | 'all';

export type Theme = 'dark' | 'light';

/**
 * Material-inspired accent palette. The keys are the persisted value, so they
 * are append-only: `settingsStore.hydrate` falls back to the default when a
 * stored value is not in this list (legacy keys from older builds, imports).
 */
export const ACCENT_KEYS = ['purple', 'indigo', 'blue', 'teal', 'green', 'pink'] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];
export type AudioQuality = 'auto' | 'high' | 'low';

export interface Settings {
  /** Playback */
  autoplay: boolean;
  /** Track fade duration in seconds (0 = off). */
  crossfadeSeconds: number;
  audioQuality: AudioQuality;
  normalizeVolume: boolean;
  /** Appearance */
  theme: Theme;
  accent: AccentKey;
  compactMode: boolean;
  reduceMotion: boolean;
  /** Content */
  /** Show only playlists that look artist/label published in search. */
  officialPlaylistsOnly: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoplay: true,
  crossfadeSeconds: 0,
  audioQuality: 'auto',
  normalizeVolume: false,
  theme: 'dark',
  accent: 'purple',
  compactMode: false,
  reduceMotion: false,
  officialPlaylistsOnly: false,
};

/* ------------------------------------------------------------- accounts */

export type UserRole = 'admin' | 'user';

/** The signed-in user (safe shape - no password material, ever). */
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

/** Admin user-list entry: adds the account creation date. */
export interface AdminUser extends AuthUser {
  createdAt: number;
}

/** A playable context: a list of tracks that was handed to the player. */
export interface PlayContext {
  label?: string;
  href?: string | null;
  kind?: 'album' | 'playlist' | 'liked' | 'search' | 'queue' | 'radio' | 'history';
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  /** Public YouTube playlists matching the query. */
  playlists: RemotePlaylist[];
}

export interface ChartsPayload {
  trending: Track[];
  popular: Track[];
  newReleases: Track[];
  popularArtists: Artist[];
  popularAlbums: Album[];
  chartsSource: string;
}

export interface ArtistDetail {
  artist: Artist;
  tracks: Track[];
  albums: Album[];
  related: Artist[];
  /** Public YouTube playlists by/matching the artist. */
  playlists?: RemotePlaylist[];
}

export interface AlbumDetail {
  album: Album;
  tracks: Track[];
  exactMatch?: boolean;
}

/* ------------------------------------------------------------------ Lyrics */

export interface SyncedLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lyrics {
  /** Provider that supplied the text: lrclib | youtube-captions. */
  source: string;
  /** True when the track has no vocals (informational state). */
  instrumental: boolean;
  plainText: string | null;
  synced: SyncedLine[] | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
}

/** Home page sections produced by the local recommendation engine. */
export type SectionKind = 'tracks' | 'artists' | 'albums' | 'playlists' | 'quickpicks' | 'mixes';

export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  kind: SectionKind;
  items: Array<Track | Artist | Album | Playlist>;
  /** Optional accent tone for special sections (e.g. mixes). */
  tone?: 'default' | 'accent' | 'warm';
  href?: string;
}

export interface DailyMix {
  id: string;
  name: string;
  subtitle: string;
  image: string | null;
  accentSeed: string;
  tracks: Track[];
}
