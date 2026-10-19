/**
 * Provider abstraction.
 *
 * The API normalizes every provider into the same shapes. Adding a new
 * legitimate source means implementing `MusicProvider` and registering it -
 * no route or frontend changes are required.
 */

export interface NormalizedTrack {
  /** Stable identifier, e.g. `yt:dQw4w9WgXcQ` or `charts:123456`. */
  id: string;
  source: string;
  /** Native provider id (YouTube video id) when playback can be resolved. */
  sourceId: string | null;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId: string | null;
  duration: number;
  thumbnail: string | null;
  viewCount?: number | null;
  genre?: string | null;
  releaseDate?: string | null;
  url?: string | null;
  /** Query used to lazily resolve playback for non-streaming metadata sources. */
  resolveQuery?: string | null;
}

export interface NormalizedArtist {
  id: string;
  name: string;
  image: string | null;
  description?: string | null;
  source: string;
}

export interface NormalizedAlbum {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  image: string | null;
  releaseDate: string | null;
  trackCount?: number;
  source: string;
}

export interface SearchResults {
  tracks: NormalizedTrack[];
  artists: NormalizedArtist[];
  albums: NormalizedAlbum[];
}

export interface ChartsResult {
  trending: NormalizedTrack[];
  popular: NormalizedTrack[];
  newReleases: NormalizedTrack[];
  popularArtists: NormalizedArtist[];
  popularAlbums: NormalizedAlbum[];
  chartsSource: string;
}

export interface StreamSource {
  url: string;
  /** Epoch ms after which the URL should be considered expired. */
  expiresAt: number;
  contentType?: string;
}

export interface MusicProvider {
  readonly id: string;
  readonly displayName: string;
  /** Whether this provider can serve playable streams. */
  readonly providesStreams: boolean;

  search(query: string, limit?: number): Promise<SearchResults>;
  getTrack(id: string): Promise<NormalizedTrack | null>;
  resolveStream(track: NormalizedTrack): Promise<StreamSource>;
  getCharts?(): Promise<ChartsResult>;
}
