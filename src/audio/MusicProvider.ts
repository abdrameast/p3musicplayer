import type { PlaybackErrorCode, SourceKind, SourceStatus } from '../core/types';

/**
 * Playback provider contract (YouTube IFrame embed, licensed audio file).
 *
 * Adapted from the brief's `MusicProvider { initialize, play, pause, next,
 * previous, selectTrack, seek, setVolume, getPlaybackState, destroy }`
 * ("Adapter les signatures lorsque nécessaire"): a provider only knows how to
 * play ONE source at a time. Navigation (next / previous / selectTrack) lives
 * in PlayerController, which owns the canonical catalogue and the source
 * resolution, so a provider can never pick "the next video" on its own and
 * play a wrong title under a canonical name.
 */

/** Provider-level media state; PlayerController maps it onto PlaybackStatus. */
export type ProviderStatus = 'idle' | 'cued' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export interface ProviderSnapshot {
  /** Source currently loaded (YouTube video id or audio URL); null when nothing is loaded. */
  sourceId: string | null;
  status: ProviderStatus;
  /** Seconds. */
  position: number;
  /** Seconds, 0 while unknown. */
  duration: number;
  /** Buffered fraction 0..1. */
  buffered: number;
  canSeek: boolean;
}

export interface ProviderError {
  code: PlaybackErrorCode;
  /** Source status the failure implies for the canonical track. */
  status: Exclude<SourceStatus, 'READY' | 'UNMAPPED'>;
  /** True when the source itself is broken (removed, blocked, undecodable), not a transient failure. */
  persistent: boolean;
  message: string;
  sourceId: string | null;
  /** Raw provider error code, for diagnostics. */
  detail?: number | string;
}

export interface ProviderSource {
  videoId?: string | null;
  audioUrl?: string | null;
}

export interface ProviderLoadOptions {
  autoplay: boolean;
  startSeconds?: number;
}

export interface ProviderEvents {
  /** Media state changed. */
  state: ProviderSnapshot;
  /** Position / duration / buffered progressed. */
  time: ProviderSnapshot;
  error: ProviderError;
  /** The browser refused to start playback without a user gesture. */
  'autoplay-blocked': { sourceId: string | null };
}

export interface MusicProvider {
  readonly kind: SourceKind;
  /** Loads the provider runtime. Rejects with a ProviderLoadError; may be called again after a failure. */
  initialize(): Promise<void>;
  /** Cues (autoplay false) or starts (autoplay true) one source. Failures arrive as 'error' events. */
  load(source: ProviderSource, options: ProviderLoadOptions): Promise<void>;
  /** Never rejects: a refused start is reported through 'autoplay-blocked'. */
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  /** 0..1 */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  getPlaybackState(): ProviderSnapshot;
  on<K extends keyof ProviderEvents>(event: K, handler: (payload: ProviderEvents[K]) => void): () => void;
  /** Same-origin media element usable for Web Audio analysis, or null (YouTube is cross-origin). */
  getMediaElement(): HTMLMediaElement | null;
  destroy(): void;
}

/** The provider runtime itself could not be loaded (script blocked, offline, no audio support). */
export class ProviderLoadError extends Error {
  readonly code = 'PROVIDER_LOAD_FAILED' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderLoadError';
  }
}

export function toProviderLoadError(error: unknown, fallbackMessage: string): ProviderLoadError {
  if (error instanceof ProviderLoadError) return error;
  return new ProviderLoadError(error instanceof Error && error.message ? error.message : fallbackMessage, { cause: error });
}

export function emptySnapshot(): ProviderSnapshot {
  return { sourceId: null, status: 'idle', position: 0, duration: 0, buffered: 0, canSeek: false };
}

export const clampVolume = (volume: number): number => (Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0);
