import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  ChartsPayload,
  Lyrics,
  RemotePlaylist,
  SearchResults,
  Track,
} from '../types';

/**
 * Provider abstraction (client side).
 *
 * The UI only talks to `MusicProvider`. `ApiProvider` implements it against
 * the backend, which in turn talks to yt-dlp / metadata providers. Another
 * legitimate provider can be added without touching components.
 */
export interface MusicProvider {
  readonly id: string;

  search(query: string, limit?: number): Promise<SearchResults>;
  getTrack(id: string): Promise<Track | null>;
  getArtist(name: string): Promise<ArtistDetail>;
  getAlbum(artist: string, title: string): Promise<AlbumDetail>;

  /** Turn a metadata-only record into a playable one (has `sourceId`). */
  resolveTrack(track: Track): Promise<Track>;

  /** Relative stream path for a playable track (`/api/stream/<videoId>`). */
  streamPath(track: Track): string | null;

  getRecommendations(seeds: string[], limit?: number): Promise<Track[]>;
  getTrending(limit?: number): Promise<Track[]>;
  getCharts(): Promise<ChartsPayload>;

  /** Public YouTube playlists by/matching an artist. */
  getArtistPlaylists?(name: string, limit?: number): Promise<RemotePlaylist[]>;

  /** Expand a public playlist into playable tracks (for saving). */
  getPlaylistTracks(id: string, limit?: number): Promise<Track[]>;

  /** Lyrics (synced or plain) for a track, or null when none exist. */
  getLyrics(track: Track): Promise<Lyrics | null>;

  /** Warm the backend stream cache for a track (no audio is downloaded). */
  prefetchStream?(track: Track): Promise<void>;
}

export type ProviderSearchResults = SearchResults;

export type { Album, Artist, Track };
