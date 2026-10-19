import { create } from 'zustand';
import { provider } from '../providers/apiProvider';
import type { ChartsPayload, Track } from '../types';
import { useLibraryStore } from './libraryStore';

/**
 * Discovery store: charts, provider recommendations and other remote catalog
 * data used by Home / Search browse sections. All remote data is cached by the
 * provider layer; this store tracks status for loading/error UIs.
 */
interface DiscoveryState {
  charts: ChartsPayload | null;
  chartsStatus: 'idle' | 'loading' | 'ready' | 'error';
  chartsError: string | null;
  chartsLoadedAt: number;

  radioTracks: Track[];
  radioStatus: 'idle' | 'loading' | 'ready' | 'error';

  loadCharts: (force?: boolean) => Promise<void>;
  /** Provider-side recommendations seeded by what the user plays. */
  loadRadio: (seeds: string[]) => Promise<Track[]>;
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  charts: null,
  chartsStatus: 'idle',
  chartsError: null,
  chartsLoadedAt: 0,

  radioTracks: [],
  radioStatus: 'idle',

  loadCharts: async (force = false) => {
    const st = get();
    if (st.chartsStatus === 'loading') return;
    if (st.charts && !force && Date.now() - st.chartsLoadedAt < 10 * 60_000) return;
    set({ chartsStatus: 'loading', chartsError: null });
    try {
      const charts = await provider.getCharts();
      set({ charts, chartsStatus: 'ready', chartsLoadedAt: Date.now() });
      // Feed newly seen tracks into the local catalog for recommendations.
      useLibraryStore.getState().rememberTracks([
        ...charts.trending,
        ...charts.newReleases,
      ]);
    } catch (err) {
      set({
        chartsStatus: 'error',
        chartsError: err instanceof Error ? err.message : 'Could not load charts.',
      });
    }
  },

  loadRadio: async (seeds) => {
    set({ radioStatus: 'loading' });
    try {
      const tracks = await provider.getRecommendations(seeds, 20);
      useLibraryStore.getState().rememberTracks(tracks);
      set({ radioTracks: tracks, radioStatus: 'ready' });
      return tracks;
    } catch (err) {
      set({ radioStatus: 'error' });
      throw err;
    }
  },
}));
