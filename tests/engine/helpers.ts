import { vi } from 'vitest';
import { emptySnapshot, type MusicProvider, type ProviderEvents, type ProviderLoadOptions, type ProviderSnapshot, type ProviderSource } from '../../src/audio/MusicProvider';
import { EventBus } from '../../src/core/EventBus';
import type { AppEvents, SourceKind, SourceMapEntry, Track } from '../../src/core/types';
import { PlayerController } from '../../src/player/PlayerController';
import { SourceResolver } from '../../src/sources/SourceResolver';

export class FakeProvider implements MusicProvider {
  readonly events = new EventBus<ProviderEvents>();
  snapshot = emptySnapshot();
  media: HTMLMediaElement | null = null;
  constructor(readonly kind: SourceKind = 'youtube') {}
  initialize = vi.fn<() => Promise<void>>(async () => undefined);
  load = vi.fn(async (source: ProviderSource, options: ProviderLoadOptions) => {
    this.snapshot = { sourceId: source.videoId ?? source.audioUrl ?? null, status: options.autoplay ? 'playing' : 'cued', position: options.startSeconds ?? 0, duration: 120, buffered: 1, canSeek: true };
    this.events.emit('state', this.getPlaybackState());
  });
  play = vi.fn(async () => this.emit({ status: 'playing' }));
  pause = vi.fn(() => this.emit({ status: 'paused' }));
  stop = vi.fn(() => { this.snapshot = emptySnapshot(); });
  seek = vi.fn((position: number) => this.emit({ position }, 'time'));
  setVolume = vi.fn();
  setMuted = vi.fn();
  destroy = vi.fn();
  getPlaybackState(): ProviderSnapshot { return { ...this.snapshot }; }
  getMediaElement(): HTMLMediaElement | null { return this.media; }
  on<K extends keyof ProviderEvents>(event: K, handler: (payload: ProviderEvents[K]) => void): () => void { return this.events.on(event, handler); }
  emit(patch: Partial<ProviderSnapshot>, type: 'state' | 'time' = 'state'): void {
    Object.assign(this.snapshot, patch);
    this.events.emit(type, this.getPlaybackState());
  }
}

export const tracks: Track[] = [1, 2, 3].map((id) => ({ id, title: `Track ${id}`, artist: 'Test artist', collection: 'ORIGINAL' }));
export const source = (trackId: number, confidence = 1): SourceMapEntry => ({
  trackId, videoId: `testvideo0${trackId}`,
  verification: { method: 'manual-title-match', checkedAt: '2026-10-19', confidence },
});

export function fixture(entries = [source(1), source(2), source(3)]) {
  const bus = new EventBus<AppEvents>();
  const resolver = new SourceResolver(tracks, entries);
  const youtube = new FakeProvider();
  const licensed = new FakeProvider('licensed');
  let now = 0;
  const player = new PlayerController({
    bus, resolver, initial: { trackId: 1, volume: 0.7, muted: false, repeat: 'off' }, sourcePreference: 'auto',
    createYouTubeProvider: () => youtube, createLicensedProvider: () => licensed, now: () => now,
  });
  return { bus, resolver, youtube, licensed, player, clock: (time: number) => { now = time; } };
}

export const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
