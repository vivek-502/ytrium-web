import { create } from 'zustand';
import type { Lyrics, Track } from '../types';
import { provider } from '../providers/apiProvider';

export type LyricsStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface LyricsEntry {
  status: LyricsStatus;
  data: Lyrics | null;
  /** Human-readable failure message (shown with a Retry action). */
  error?: string;
}

interface LyricsState {
  /** Per-track lyrics, kept in memory for the whole session. */
  byId: Record<string, LyricsEntry>;
  fetchLyrics: (track: Track, opts?: { force?: boolean }) => void;
  clearLyrics: () => void;
}

/**
 * Lyrics for the currently-visible track. Keyed by track id so the full
 * player can be opened and closed repeatedly without refetching; only tracks
 * that errored (network/upstream) are retried, and only on demand.
 */
export const useLyricsStore = create<LyricsState>((set, get) => ({
  byId: {},

  fetchLyrics: (track, opts) => {
    const id = track.id;
    const existing = get().byId[id];
    if (!opts?.force) {
      if (existing?.status === 'loading') return;
      if (existing && existing.status !== 'error') return;
    }
    if (existing?.status === 'loading' && opts?.force) return;

    set((s) => ({
      byId: { ...s.byId, [id]: { status: 'loading', data: existing?.data ?? null } },
    }));

    provider
      .getLyrics(track)
      .then((lyrics) => {
        set((s) => ({
          byId: {
            ...s.byId,
            [id]: lyrics === null ? { status: 'missing', data: null } : { status: 'ready', data: lyrics },
          },
        }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unable to load lyrics.';
        set((s) => ({
          byId: { ...s.byId, [id]: { status: 'error', data: null, error: message } },
        }));
      });
  },

  clearLyrics: () => set({ byId: {} }),
}));