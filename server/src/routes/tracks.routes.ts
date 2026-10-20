import { Router } from 'express';
import {
  getTrack,
  getArtist,
  getAlbum,
  getPlaylistTracks,
  getArtistPlaylists,
} from '../controllers/trackController.js';
import { limiter } from '../middleware/http.js';
import { config } from '../config.js';

export const trackRoutes = Router();

trackRoutes.use(limiter(config.rateLimit.apiPerMin, 'metadata'));
trackRoutes.get('/tracks/:id', getTrack);
trackRoutes.get('/playlists/:id/tracks', getPlaylistTracks);
trackRoutes.get('/artist/playlists', getArtistPlaylists);
trackRoutes.get('/artist', getArtist);
trackRoutes.get('/album', getAlbum);
