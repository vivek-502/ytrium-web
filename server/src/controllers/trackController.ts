import type { Request, Response } from 'express';
import { asyncHandler, requireParam, sanitizeQuery, parseLimit } from '../middleware/http.js';
import { youtubeProvider, artistIdFor, albumIdFor } from '../providers/youtube.js';
import { errors } from '../utils/errors.js';
import type { NormalizedAlbum, NormalizedArtist, NormalizedTrack } from '../providers/types.js';

function dedupeTracks(tracks: NormalizedTrack[]): NormalizedTrack[] {
  const seen = new Set<string>();
  const out: NormalizedTrack[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** GET /api/tracks/:id */
export const getTrack = asyncHandler(async (req: Request, res: Response) => {
  const id = requireParam(req.params.id, 'id');
  if (!/^[A-Za-z0-9_:,-]{4,64}$/.test(id)) throw errors.invalidInput('invalid track id');
  const track = await youtubeProvider.getTrack(id);
  if (!track) throw errors.notFound('Track metadata could not be found.');
  res.json({ track });
});

/** GET /api/artist?name=<name>&limit= */
export const getArtist = asyncHandler(async (req: Request, res: Response) => {
  const name = sanitizeQuery(req.query.name, 120);
  const limit = parseLimit(req.query.limit, 20, 40);

  const [main, relatedSearch] = await Promise.all([
    youtubeProvider.search(name, limit),
    youtubeProvider.search(`${name} similar artists`, 15).catch(() => null),
  ]);

  const tracks = dedupeTracks(main.tracks);
  const popular = [...tracks].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));

  const albums = new Map<string, NormalizedAlbum>();
  for (const t of tracks) {
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

  const self = artistIdFor(name);
  const relatedMap = new Map<string, NormalizedArtist>();
  for (const source of [main, relatedSearch]) {
    if (!source) continue;
    for (const a of source.artists) {
      if (a.id === self || relatedMap.has(a.id)) continue;
      relatedMap.set(a.id, a);
    }
  }

  const artist: NormalizedArtist = {
    id: self,
    name,
    image: popular[0]?.thumbnail ?? main.artists[0]?.image ?? null,
    description: null,
    source: 'youtube',
  };

  res.json({
    artist,
    tracks: popular,
    albums: [...albums.values()].slice(0, 12),
    related: [...relatedMap.values()].slice(0, 8),
  });
});

/** GET /api/album?artist=<artist>&title=<title> */
export const getAlbum = asyncHandler(async (req: Request, res: Response) => {
  const artist = sanitizeQuery(req.query.artist, 120);
  const title = sanitizeQuery(req.query.title, 160);

  const results = await youtubeProvider.search(`${artist} ${title}`, 30);
  const wanted = albumIdFor(artist, title);

  const exact = results.tracks.filter((t) => t.albumId === wanted);
  const loose = results.tracks.filter(
    (t) => t.albumId !== wanted && (t.album?.toLowerCase().includes(title.toLowerCase()) || t.title.toLowerCase().includes(title.toLowerCase())),
  );

  const tracks = [...exact, ...loose];
  const album: NormalizedAlbum = {
    id: wanted,
    title,
    artist,
    artistId: artistIdFor(artist),
    image: tracks[0]?.thumbnail ?? null,
    releaseDate: tracks.find((t) => t.releaseDate)?.releaseDate ?? null,
    trackCount: tracks.length,
    source: 'youtube',
  };

  res.json({ album, tracks, exactMatch: exact.length > 0 });
});
