import { EventBus } from '../core/EventBus';
import {
  ProviderLoadError,
  clampVolume,
  emptySnapshot,
  type MusicProvider,
  type ProviderError,
  type ProviderEvents,
  type ProviderLoadOptions,
  type ProviderSnapshot,
  type ProviderSource,
  type ProviderStatus,
} from './MusicProvider';

/** Maps HTMLMediaElement.error codes; MEDIA_ERR_ABORTED (1) is a user/load abort, not a failure. */
export function mapMediaError(code: number | undefined, sourceId: string | null): ProviderError | null {
  switch (code) {
    case 1:
      return null;
    case 2:
      return { code: 'NETWORK', status: 'ERROR', persistent: false, sourceId, detail: code, message: 'A network error interrupted the audio file.' };
    case 3:
      return { code: 'DECODE', status: 'ERROR', persistent: true, sourceId, detail: code, message: 'The audio file could not be decoded.' };
    case 4:
      return {
        code: 'NOT_FOUND',
        status: 'UNAVAILABLE',
        persistent: true,
        sourceId,
        detail: code,
        message: 'The audio file was not found or its format is not supported.',
      };
    default:
      return { code: 'UNKNOWN', status: 'ERROR', persistent: false, sourceId, detail: code, message: 'The audio file failed to play.' };
  }
}

export interface LicensedAudioProviderOptions {
  /** Test seam; defaults to a detached <audio> element. */
  createElement?: () => HTMLAudioElement;
}

/**
 * Provider B — audio files the site owner is licensed to stream, declared in
 * public/source-overrides.json with method "licensed-declaration". It plays
 * whatever URL it is given and never ships, fetches or extracts protected
 * audio itself. The element is same-origin/CORS-enabled so the Web Audio
 * engine can analyse it directly.
 */
export class LicensedAudioProvider implements MusicProvider {
  readonly kind = 'licensed' as const;

  private readonly events = new EventBus<ProviderEvents>();
  private element: HTMLAudioElement | null = null;
  private snapshot: ProviderSnapshot = emptySnapshot();
  private pendingStart = 0;
  private generation = 0;
  private readonly listeners: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
    ['playing', () => this.setStatus('playing')],
    ['pause', () => {
      if (!this.element?.ended) this.setStatus('paused');
    }],
    ['waiting', () => this.setStatus('buffering')],
    ['ended', () => this.setStatus('ended')],
    ['error', () => this.handleMediaError()],
    ['loadedmetadata', () => this.applyPendingStart()],
    ['timeupdate', () => this.emitTime()],
    ['durationchange', () => this.emitTime()],
    ['progress', () => this.emitTime()],
  ];

  constructor(private readonly options: LicensedAudioProviderOptions = {}) {}

  async initialize(): Promise<void> {
    if (this.element) return;
    let element: HTMLAudioElement;
    try {
      element = this.options.createElement?.() ?? document.createElement('audio');
    } catch (error) {
      throw new ProviderLoadError('HTML audio playback is not available in this browser.', { cause: error });
    }
    element.crossOrigin = 'anonymous';
    element.preload = 'metadata';
    for (const [type, listener] of this.listeners) element.addEventListener(type, listener);
    this.element = element;
  }

  async load(source: ProviderSource, options: ProviderLoadOptions): Promise<void> {
    const element = this.requireElement();
    const audioUrl = source.audioUrl;
    if (!audioUrl) throw new Error('LicensedAudioProvider.load() needs an audio URL.');
    this.generation += 1;
    this.pendingStart = Math.max(0, options.startSeconds ?? 0);
    this.snapshot = {
      sourceId: audioUrl,
      status: options.autoplay ? 'buffering' : 'cued',
      position: this.pendingStart,
      duration: 0,
      buffered: 0,
      canSeek: false,
    };
    element.src = audioUrl;
    element.load();
    if (options.autoplay) void this.play();
  }

  async play(): Promise<void> {
    const element = this.element;
    const sourceId = this.snapshot.sourceId;
    if (!element || !sourceId) return;
    const generation = this.generation;
    try {
      await element.play();
    } catch (error) {
      if (sourceId !== this.snapshot.sourceId || generation !== this.generation) return;
      const name = error instanceof DOMException || error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError') {
        this.setStatus('paused');
        this.events.emit('autoplay-blocked', { sourceId });
      } else if (name !== 'AbortError' && !element.error) {
        // AbortError = interrupted by a newer load()/pause(); media errors arrive through 'error'.
        const mapped = mapMediaError(undefined, sourceId);
        if (mapped) this.events.emit('error', mapped);
      }
    }
  }

  pause(): void {
    this.generation += 1;
    this.element?.pause();
  }

  stop(): void {
    this.generation += 1;
    const element = this.element;
    this.snapshot = emptySnapshot();
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
  }

  seek(seconds: number): void {
    const element = this.element;
    if (!element || !this.snapshot.sourceId || !this.snapshot.canSeek) return;
    element.currentTime = Math.min(Math.max(0, seconds), this.snapshot.duration);
    this.emitTime();
  }

  setVolume(volume: number): void {
    if (this.element) this.element.volume = clampVolume(volume);
  }

  setMuted(muted: boolean): void {
    if (this.element) this.element.muted = muted;
  }

  getPlaybackState(): ProviderSnapshot {
    return { ...this.snapshot };
  }

  on<K extends keyof ProviderEvents>(event: K, handler: (payload: ProviderEvents[K]) => void): () => void {
    return this.events.on(event, handler);
  }

  getMediaElement(): HTMLMediaElement | null {
    return this.element;
  }

  destroy(): void {
    const element = this.element;
    this.stop();
    if (element) for (const [type, listener] of this.listeners) element.removeEventListener(type, listener);
    this.element = null;
    this.events.clear();
  }

  // ───────────────────────────────────────────────────────────── internals ──

  private requireElement(): HTMLAudioElement {
    if (!this.element) throw new Error('LicensedAudioProvider used before initialize().');
    return this.element;
  }

  private setStatus(status: ProviderStatus): void {
    if (!this.snapshot.sourceId) return;
    if (status === 'paused' && this.element?.paused === false) return;
    if (status === 'playing' && this.element?.paused === true) return;
    this.sample();
    if (this.snapshot.status === status) return;
    this.snapshot.status = status;
    this.events.emit('state', this.getPlaybackState());
  }

  private emitTime(): void {
    if (!this.snapshot.sourceId) return;
    this.sample();
    this.events.emit('time', this.getPlaybackState());
  }

  private sample(): void {
    const element = this.element;
    if (!element) return;
    const duration = element.duration;
    if (Number.isFinite(element.currentTime)) this.snapshot.position = Math.max(0, element.currentTime);
    // Live or unknown-length streams report Infinity / NaN: not seekable.
    this.snapshot.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.snapshot.canSeek = this.snapshot.duration > 0;
    const ranges = element.buffered;
    this.snapshot.buffered =
      this.snapshot.duration > 0 && ranges && ranges.length > 0
        ? Math.min(1, ranges.end(ranges.length - 1) / this.snapshot.duration)
        : 0;
  }

  private applyPendingStart(): void {
    const element = this.element;
    if (element && this.pendingStart > 0 && Number.isFinite(element.duration)) {
      element.currentTime = Math.min(this.pendingStart, element.duration);
    }
    this.pendingStart = 0;
    this.emitTime();
  }

  private handleMediaError(): void {
    const element = this.element;
    if (!element || !this.snapshot.sourceId) return;
    const mapped = mapMediaError(element.error?.code, this.snapshot.sourceId);
    if (!mapped) return;
    this.snapshot.status = 'error';
    this.events.emit('error', mapped);
  }
}
