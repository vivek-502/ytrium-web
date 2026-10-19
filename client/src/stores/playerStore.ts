import { create } from 'zustand';
import type { PlayContext, RepeatMode, Track } from '../types';
import { audioEngine } from '../engine/audioEngine';
import { provider } from '../providers/apiProvider';
import { storage, saveDebounced, flushSaves, PLAYER_KEY } from '../lib/storage';
import { clamp } from '../lib/format';
import { useLibraryStore } from './libraryStore';
import { useSettingsStore } from './settingsStore';
import { ui } from './uiStore';

const MAX_RETRIES = 2;

interface PersistedPlayer {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  currentTime: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  context: PlayContext | null;
  /** Pre-shuffle ordering, kept so disabling shuffle restores it. */
  originalQueue?: Track[] | null;
}

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  loading: boolean;
  buffering: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  queue: Track[];
  queueIndex: number;
  context: PlayContext | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  playTracks: (tracks: Track[], startIndex?: number, context?: PlayContext | null) => Promise<void>;
  playTrack: (track: Track, contextTracks?: Track[], context?: PlayContext | null) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  next: (auto?: boolean) => Promise<void>;
  previous: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  nudgeVolume: (delta: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track, opts?: { playNext?: boolean }) => void;
  removeFromQueue: (index: number) => void;
  clearUpcoming: () => void;
  moveQueueItem: (from: number, to: number) => void;
  jumpTo: (index: number) => void;
  retry: () => void;
  dismissError: () => void;
  /** Restores non-session prefs from an import (volume/mute/repeat/shuffle, queue when idle). */
  importPrefs: (patch: {
    volume?: number;
    isMuted?: boolean;
    repeatMode?: RepeatMode;
    shuffle?: boolean;
    queue?: Track[];
  }) => void;
}

/* -------------------------- module-level session ------------------------- */

interface Session {
  trackId: string | null;
  playedMs: number;
  lastTime: number;
  didFade: boolean;
  reportAccum: number;
}
let session: Session = { trackId: null, playedMs: 0, lastTime: 0, didFade: false, reportAccum: 0 };
let retries = 0;
let restoredStartAt: number | null = null;
const prefetchedIds = new Set<string>();
let originalQueue: Track[] | null = null;

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function persist(state: PlayerState, delay = 800): void {
  const snapshot: PersistedPlayer = {
    currentTrack: state.currentTrack,
    queue: state.queue,
    queueIndex: state.queueIndex,
    currentTime: state.currentTime,
    volume: state.volume,
    isMuted: state.isMuted,
    shuffle: state.shuffle,
    repeatMode: state.repeatMode,
    context: state.context,
    originalQueue,
  };
  saveDebounced(PLAYER_KEY, snapshot, delay);
}

function buildSrc(track: Track | null): string | null {
  if (!track) return null;
  const base = provider.streamPath(track);
  if (!base) return null;
  const quality = useSettingsStore.getState().settings.audioQuality;
  if (quality === 'auto') return base;
  return `${base}?q=${quality}`;
}

/* ------------------------------ the store -------------------------------- */

export const usePlayerStore = create<PlayerState>((set, get) => {
  /* --------------------------- engine events --------------------------- */

  const finalizeCurrent = (reason: 'switch' | 'ended' | 'skip' | 'stop') => {
    const s = session;
    const st = get();
    if (!s.trackId) return;
    const duration = st.duration || st.currentTrack?.duration || 0;
    const ratio = duration > 0 ? clamp(s.playedMs / (duration * 1000), 0, 1) : 0;
    const completion = reason === 'ended' ? Math.max(ratio, 0.95) : ratio;
    const lib = useLibraryStore.getState();
    lib.finishTrack(s.trackId, completion, s.playedMs);
    if (reason === 'skip' && ratio < 0.5) lib.recordSkip(s.trackId);
    session = { trackId: null, playedMs: 0, lastTime: 0, didFade: false, reportAccum: 0 };
  };

  const loadTrack = async (track: Track, startAt = 0) => {
    // Account for the track we are leaving (history, completion, skips).
    if (session.trackId && session.trackId !== track.id) finalizeCurrent('switch');
    set({ loading: true, error: null, buffering: true });
    let playable = track;
    try {
      if (!playable.sourceId) {
        playable = await provider.resolveTrack(playable);
        // Swap the resolved track into the queue so ids stay consistent.
        const st = get();
        const idx = st.queue.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          const queue = [...st.queue];
          queue[idx] = playable;
          set({ queue });
        }
        useLibraryStore.getState().rememberTracks([playable]);
      }
      const src = buildSrc(playable);
      if (!src) throw new Error('No playable source for this track.');

      const resumeAt = startAt > 0 ? startAt : 0;
      const wasFaded = session.didFade;
      const continuingSameTrack = session.trackId === playable.id;
      session = {
        trackId: playable.id,
        playedMs: 0,
        lastTime: resumeAt,
        didFade: false,
        reportAccum: 0,
      };
      retries = 0;
      restoredStartAt = null;

      set({ currentTrack: playable, duration: playable.duration || 0, currentTime: resumeAt });
      // Register new plays in history + recommendation signals (retries of the
      // same track do not double count).
      if (!continuingSameTrack) useLibraryStore.getState().recordTrackStart(playable);
      audioEngine.load(src, { startAt: resumeAt, autoplay: true });
      void audioEngine.resumeContext();

      if (wasFaded || get().volume > 0) {
        audioEngine.fadeTo(get().volume, 900);
      }

      // Warm the backend stream cache for what plays next (no audio download).
      const next = get().queue[get().queueIndex + 1];
      if (next?.sourceId && !prefetchedIds.has(next.id)) {
        prefetchedIds.add(next.id);
        void provider.prefetchStream?.(next);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to play this track right now.';
      set({ loading: false, buffering: false, error: message, isPlaying: false });
      ui.toast(message, 'error');
    }
  };

  audioEngine.setHandlers({
    onTime: (t) => {
      const st = get();
      if (!st.currentTrack) return;

      // Play-time accounting for the recommendation signals.
      if (t > session.lastTime && t - session.lastTime < 5) {
        const delta = t - session.lastTime;
        session.playedMs += delta * 1000;
        session.reportAccum += delta;
        if (session.reportAccum >= 5) {
          useLibraryStore.getState().addPlayTime(st.currentTrack.id, session.reportAccum * 1000);
          session.reportAccum = 0;
        }
      }
      session.lastTime = t;

      // Track fade-out ahead of the next song (crossfade-style).
      const settings = useSettingsStore.getState().settings;
      const duration = st.duration || 0;
      if (settings.crossfadeSeconds > 0 && duration > 0 && !session.didFade) {
        const remaining = duration - t;
        if (remaining > 0 && remaining <= settings.crossfadeSeconds) {
          session.didFade = true;
          audioEngine.fadeTo(0, Math.max(250, remaining * 1000));
        }
      }

      set({ currentTime: t });
      if (Math.floor(t) % 5 === 0) persist(get(), 2000);
    },
    onDuration: (d) => set({ duration: d }),
    onPlaying: () => set({ isPlaying: true, loading: false, buffering: false, error: null }),
    onPaused: () => {
      set({ isPlaying: false });
      persist(get(), 300);
    },
    onWaiting: () => set({ buffering: true }),
    onCanPlay: () => set({ buffering: false }),
    onStalled: () => set({ buffering: true }),
    onEnded: () => void get().next(true),
    onError: (message) => {
      if (retries < MAX_RETRIES && audioEngine.src) {
        retries += 1;
        const startAt = session.lastTime;
        setTimeout(() => {
          audioEngine.reload({ startAt, autoplay: true });
        }, 400 * retries);
        set({ buffering: true });
        return;
      }
      set({ error: message, isPlaying: false, loading: false, buffering: false });
      ui.toast(message, 'error');
    },
  });

  return {
    currentTrack: null,
    isPlaying: false,
    loading: false,
    buffering: false,
    error: null,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    shuffle: false,
    repeatMode: 'off',
    queue: [],
    queueIndex: -1,
    context: null,
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      const saved = await storage.get<PersistedPlayer>(PLAYER_KEY);
      if (saved) {
        originalQueue = saved.originalQueue ?? null;
        set({
          currentTrack: saved.currentTrack ?? null,
          queue: saved.queue ?? [],
          queueIndex: typeof saved.queueIndex === 'number' ? saved.queueIndex : -1,
          currentTime: saved.currentTime ?? 0,
          volume: typeof saved.volume === 'number' ? saved.volume : 1,
          isMuted: Boolean(saved.isMuted),
          shuffle: Boolean(saved.shuffle),
          repeatMode: saved.repeatMode ?? 'off',
          context: saved.context ?? null,
          duration: saved.currentTrack?.duration ?? 0,
        });
        audioEngine.setVolume(saved.volume ?? 1);
        audioEngine.setMuted(Boolean(saved.isMuted));
        if (saved.currentTrack?.sourceId && (saved.currentTime ?? 0) > 0) {
          // Deferred load: media is not fetched until the user presses play.
          restoredStartAt = saved.currentTime ?? 0;
        }
      } else {
        set({ volume: 1 });
      }
      audioEngine.setNormalize(useSettingsStore.getState().settings.normalizeVolume).catch(() => {});
      set({ hydrated: true });
    },

    playTracks: async (tracks, startIndex = 0, context = null) => {
      if (!tracks.length) return;
      const st = get();
      const idx = clamp(startIndex, 0, tracks.length - 1);
      let queue = [...tracks];
      let index = idx;

      if (st.shuffle) {
        const chosen = tracks[idx];
        const rest = tracks.filter((_, i) => i !== idx);
        queue = [chosen, ...shuffleArray(rest)];
        index = 0;
        originalQueue = [...tracks];
      } else {
        originalQueue = null;
      }

      set({ queue, queueIndex: index, context, error: null });
      persist(get(), 100);
      await loadTrack(queue[index]);
    },

    playTrack: async (track, contextTracks, context = null) => {
      if (contextTracks && contextTracks.length) {
        const idx = contextTracks.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          await get().playTracks(contextTracks, idx, context);
          return;
        }
      }
      const st = get();
      // Replace the upcoming queue with this track as the current context.
      set({
        queue: [track, ...st.queue.filter((t) => t.id !== track.id && t.id !== st.currentTrack?.id)],
        queueIndex: 0,
        context,
        error: null,
      });
      persist(get(), 100);
      await loadTrack(track);
    },

    play: async () => {
      const st = get();
      if (st.loading) return;
      if (st.currentTrack && restoredStartAt !== null && !audioEngine.src) {
        await loadTrack(st.currentTrack, restoredStartAt);
        return;
      }
      if (st.currentTrack && !audioEngine.src) {
        await loadTrack(st.currentTrack, st.currentTime);
        return;
      }
      await audioEngine.play();
      void audioEngine.resumeContext();
      set({ isPlaying: true });
    },

    pause: () => {
      audioEngine.pause();
      set({ isPlaying: false });
      finalizeCurrent('stop');
      // Re-arm session bookkeeping for the same track.
      const st = get();
      if (st.currentTrack) {
        session = {
          trackId: st.currentTrack.id,
          playedMs: 0,
          lastTime: st.currentTime,
          didFade: false,
          reportAccum: 0,
        };
      }
      persist(get(), 200);
    },

    togglePlay: async () => {
      const st = get();
      if (st.isPlaying) get().pause();
      else await get().play();
    },

    next: async (auto = false) => {
      const st = get();

      if (auto && st.repeatMode === 'one') {
        session.lastTime = 0;
        audioEngine.seek(0);
        await audioEngine.play();
        return;
      }

      finalizeCurrent(auto ? 'ended' : 'skip');

      if (st.queue.length === 0) {
        set({ isPlaying: false });
        return;
      }

      let index = st.queueIndex + 1;
      if (index >= st.queue.length) {
        if (st.repeatMode === 'all') index = 0;
        else if (auto && useSettingsStore.getState().settings.autoplay) {
          const extended = await extendQueueWithRadio(st);
          if (!extended) {
            set({ isPlaying: false, currentTime: 0 });
            audioEngine.pause();
            return;
          }
          index = st.queue.length; // appended at the end
        } else {
          set({ isPlaying: false });
          audioEngine.pause();
          return;
        }
      }

      set({ queueIndex: index });
      await loadTrack(get().queue[index]);
    },

    previous: () => {
      const st = get();
      // Standard behavior: restart the track unless we are near its start.
      if (st.currentTime > 3 || st.queueIndex <= 0) {
        audioEngine.seek(0);
        set({ currentTime: 0 });
        session.lastTime = 0;
        return;
      }
      finalizeCurrent('switch');
      const index = st.queueIndex - 1;
      set({ queueIndex: index });
      void loadTrack(get().queue[index]);
    },

    seek: (seconds) => {
      const st = get();
      const target = clamp(seconds, 0, st.duration || st.currentTrack?.duration || 0);
      audioEngine.seek(target);
      session.lastTime = target;
      if (session.didFade && (st.duration - target) > (useSettingsStore.getState().settings.crossfadeSeconds || 0)) {
        session.didFade = false;
        audioEngine.setVolume(st.isMuted ? 0 : st.volume);
      }
      set({ currentTime: target });
      persist(get(), 1500);
    },

    seekBy: (delta) => get().seek(get().currentTime + delta),

    setVolume: (value) => {
      const v = clamp(value, 0, 1);
      audioEngine.setVolume(v);
      const wasMuted = get().isMuted;
      set({ volume: v });
      if (v > 0 && wasMuted) {
        audioEngine.setMuted(false);
        set({ isMuted: false });
      }
      persist(get(), 400);
    },

    toggleMute: () => {
      const next = !get().isMuted;
      audioEngine.setMuted(next);
      set({ isMuted: next });
      persist(get(), 400);
    },

    nudgeVolume: (delta) => get().setVolume(clamp(get().volume + delta, 0, 1)),

    toggleShuffle: () => {
      const st = get();
      const next = !st.shuffle;
      if (st.queue.length > 1 && st.queueIndex >= 0) {
        if (next) {
          originalQueue = [...st.queue];
          const before = st.queue.slice(0, st.queueIndex + 1);
          const after = shuffleArray(st.queue.slice(st.queueIndex + 1));
          set({ shuffle: true, queue: [...before, ...after] });
        } else {
          // Restore the original ordering around the current track.
          const current = st.queue[st.queueIndex];
          const restored = originalQueue && originalQueue.length ? [...originalQueue] : [...st.queue];
          const index = current ? restored.findIndex((t) => t.id === current.id) : st.queueIndex;
          originalQueue = null;
          set({
            shuffle: false,
            queue: restored,
            queueIndex: Math.max(0, index < 0 ? st.queueIndex : index),
          });
        }
      } else {
        originalQueue = next ? [...st.queue] : null;
        set({ shuffle: next });
      }
      persist(get(), 200);
      ui.toast(next ? 'Shuffle on' : 'Shuffle off', 'info');
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const idx = order.indexOf(get().repeatMode);
      const next = order[(idx + 1) % order.length];
      set({ repeatMode: next });
      persist(get(), 200);
      ui.toast(
        next === 'off' ? 'Repeat off' : next === 'all' ? 'Repeat all' : 'Repeat one',
        'info',
      );
    },

    importPrefs: (patch) => {
      const st = get();
      const next: Partial<PlayerState> = {};
      if (patch.volume !== undefined) {
        const v = clamp(patch.volume, 0, 1);
        audioEngine.setVolume(v);
        next.volume = v;
      }
      if (patch.isMuted !== undefined) {
        audioEngine.setMuted(patch.isMuted);
        next.isMuted = patch.isMuted;
      }
      if (patch.repeatMode !== undefined) next.repeatMode = patch.repeatMode;
      if (patch.shuffle !== undefined) next.shuffle = patch.shuffle;
      // The imported queue only lands when nothing is currently loaded, so the
      // act of importing never interrupts or rewrites an active session.
      if (!st.currentTrack && patch.queue && patch.queue.length > 0) {
        next.queue = patch.queue;
        next.queueIndex = 0;
        originalQueue = patch.shuffle ? [...patch.queue] : originalQueue;
      } else {
        delete next.shuffle;
      }
      if (Object.keys(next).length === 0) return;
      set(next);
      persist(get(), 0);
    },

    addToQueue: (track, opts) => {
      const st = get();
      const queue = [...st.queue];
      if (opts?.playNext) {
        queue.splice(st.queueIndex + 1, 0, track);
      } else {
        queue.push(track);
      }
      set({ queue });
      persist(get(), 300);
      ui.toast(
        opts?.playNext ? `Playing next: ${track.title}` : `Added to queue: ${track.title}`,
        'success',
      );
    },

    removeFromQueue: (index) => {
      const st = get();
      if (index < 0 || index >= st.queue.length || index === st.queueIndex) return;
      const queue = st.queue.filter((_, i) => i !== index);
      const queueIndex = index < st.queueIndex ? st.queueIndex - 1 : st.queueIndex;
      set({ queue, queueIndex });
      persist(get(), 300);
    },

    clearUpcoming: () => {
      const st = get();
      set({ queue: st.queue.slice(0, st.queueIndex + 1) });
      persist(get(), 300);
      ui.toast('Queue cleared', 'info');
    },

    moveQueueItem: (from, to) => {
      const st = get();
      if (from === to || from === st.queueIndex || to === st.queueIndex) return;
      if (from < 0 || to < 0 || from >= st.queue.length || to >= st.queue.length) return;
      const queue = [...st.queue];
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);
      const queueIndex = from === st.queueIndex ? to : st.queueIndex;
      set({ queue, queueIndex });
      persist(get(), 300);
    },

    jumpTo: (index) => {
      const st = get();
      if (index < 0 || index >= st.queue.length || index === st.queueIndex) return;
      finalizeCurrent('switch');
      set({ queueIndex: index });
      void loadTrack(st.queue[index]);
    },

    retry: () => {
      const st = get();
      set({ error: null });
      retries = 0;
      if (st.currentTrack) void loadTrack(st.currentTrack, st.currentTime);
    },

    dismissError: () => set({ error: null }),
  };
});

/* --------------------------- helpers (module) ----------------------------- */

/** Autoplay: append provider recommendations after the last track. */
async function extendQueueWithRadio(state: PlayerState): Promise<boolean> {
  try {
    const seed = state.currentTrack?.artist;
    const recs = await provider.getRecommendations(seed ? [seed] : [], 10);
    const existing = new Set(state.queue.map((t) => t.id));
    const fresh = recs.filter((t) => !existing.has(t.id)).slice(0, 8);
    if (!fresh.length) return false;
    useLibraryStore.getState().rememberTracks(fresh);
    const queue = [...state.queue, ...fresh];
    usePlayerStore.setState({ queue });
    persist(usePlayerStore.getState(), 200);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------- external wiring ----------------------------- */

// Keep the audio engine in sync with normalization preference.
useSettingsStore.subscribe((state, prev) => {
  if (state.settings.normalizeVolume !== prev.settings.normalizeVolume) {
    void audioEngine.setNormalize(state.settings.normalizeVolume);
  }
});

// Flush pending persistence when the tab is closed or backgrounded.
if (typeof window !== 'undefined') {
  const flush = () => {
    const st = usePlayerStore.getState();
    if (st.hydrated) persist(st, 0);
    flushSaves();
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
