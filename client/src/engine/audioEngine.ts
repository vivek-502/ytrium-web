/**
 * Audio engine.
 *
 * A single HTMLAudioElement is created once at module load and lives for the
 * whole session: route changes never recreate or interrupt playback.
 *
 * Optional WebAudio graph (volume normalization) is attached lazily on the
 * first user gesture-ish call; before that the element plays directly.
 */

export interface EngineHandlers {
  onTime?: (seconds: number) => void;
  onDuration?: (seconds: number) => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  onWaiting?: () => void;
  onCanPlay?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  onStalled?: () => void;
}

export class AudioEngine {
  readonly el: HTMLAudioElement;
  private handlers: EngineHandlers = {};
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private normalized = false;
  private volumeValue = 1;
  private muted = false;
  private fadeRaf: number | null = null;
  private currentSrc: string | null = null;

  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    this.el.volume = 1;

    this.el.addEventListener('timeupdate', () => {
      this.handlers.onTime?.(this.el.currentTime || 0);
    });
    this.el.addEventListener('durationchange', () => {
      const d = this.el.duration;
      if (Number.isFinite(d) && d > 0) this.handlers.onDuration?.(d);
    });
    this.el.addEventListener('loadedmetadata', () => {
      const d = this.el.duration;
      if (Number.isFinite(d) && d > 0) this.handlers.onDuration?.(d);
    });
    this.el.addEventListener('playing', () => this.handlers.onPlaying?.());
    this.el.addEventListener('pause', () => {
      if (!this.el.ended) this.handlers.onPaused?.();
    });
    this.el.addEventListener('waiting', () => this.handlers.onWaiting?.());
    this.el.addEventListener('canplay', () => this.handlers.onCanPlay?.());
    this.el.addEventListener('stalled', () => this.handlers.onStalled?.());
    this.el.addEventListener('ended', () => this.handlers.onEnded?.());
    this.el.addEventListener('error', () => {
      const code = this.el.error?.code;
      const message =
        code === MediaError.MEDIA_ERR_NETWORK
          ? 'Network error while loading audio.'
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'This track format is not supported.'
            : 'Unable to play this track right now.';
      this.handlers.onError?.(message);
    });
  }

  setHandlers(handlers: EngineHandlers): void {
    this.handlers = handlers;
  }

  get src(): string | null {
    return this.currentSrc;
  }

  /**
   * Load a media path. `startAt` seeks once metadata is available; playback
   * starts as soon as the browser allows it.
   */
  load(src: string, opts: { startAt?: number; autoplay?: boolean } = {}): void {
    this.currentSrc = src;
    this.el.src = src;
    this.el.load();
    const { startAt = 0, autoplay = true } = opts;
    if (startAt > 0) {
      const seekOnce = () => {
        try {
          this.el.currentTime = startAt;
        } catch {
          /* ignore - not seekable yet */
        }
        this.el.removeEventListener('loadedmetadata', seekOnce);
      };
      this.el.addEventListener('loadedmetadata', seekOnce);
    }
    if (autoplay) void this.play();
  }

  /** Re-request the current source (used for stream retries). */
  reload(opts: { startAt?: number; autoplay?: boolean } = {}): void {
    if (!this.currentSrc) return;
    this.load(this.currentSrc, opts);
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch (err) {
      // Autoplay policy: ignore silent blocks, surface real failures.
      const name = (err as Error).name;
      if (name === 'NotAllowedError') {
        this.handlers.onPaused?.();
        return;
      }
      if (name !== 'AbortError') {
        this.handlers.onError?.('Playback was blocked or failed.');
      }
    }
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    try {
      this.el.currentTime = Math.max(0, seconds);
      this.handlers.onTime?.(this.el.currentTime);
    } catch {
      /* ignore */
    }
  }

  setVolume(value: number): void {
    this.volumeValue = Math.min(1, Math.max(0, value));
    this.cancelFade();
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /** Smoothly ramp the effective volume (used by track fades). */
  fadeTo(value: number, ms: number): void {
    this.cancelFade();
    const target = Math.min(1, Math.max(0, value));
    const start = this.el.volume;
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / Math.max(1, ms));
      const eased = t * (2 - t); // ease-out
      const v = start + (target - start) * eased;
      this.el.muted = false;
      this.el.volume = v;
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(step);
      } else {
        this.fadeRaf = null;
        this.applyVolume();
      }
    };
    this.fadeRaf = requestAnimationFrame(step);
  }

  private cancelFade(): void {
    if (this.fadeRaf !== null) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
  }

  private applyVolume(): void {
    this.el.muted = this.muted;
    this.el.volume = this.muted ? 0 : this.volumeValue;
  }

  /**
   * Volume normalization via a gentle DynamicsCompressor. Requires routing the
   * element through WebAudio once enabled; before that audio plays directly.
   */
  async setNormalize(enabled: boolean): Promise<void> {
    if (enabled === this.normalized && (!enabled || this.source)) return;
    this.normalized = enabled;
    if (!enabled && !this.source) return; // never routed - element plays directly

    const ctx = this.ensureGraph();
    if (!this.source || !this.compressor) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* resumed later on gesture */
    }
    this.source.disconnect();
    this.compressor.disconnect();
    if (enabled) {
      this.source.connect(this.compressor);
      this.compressor.connect(ctx.destination);
    } else {
      this.source.connect(ctx.destination);
    }
  }

  /** Resume the WebAudio context after a user gesture. */
  async resumeContext(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* noop */
      }
    }
  }

  private ensureGraph(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.source = this.ctx.createMediaElementSource(this.el);
      this.compressor = this.ctx.createDynamicsCompressor();
      const comp = this.compressor;
      comp.threshold.value = -26;
      comp.knee.value = 24;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
    }
    return this.ctx;
  }
}

/** Global singleton - survives navigation, React re-renders, and route changes. */
export const audioEngine = new AudioEngine();
