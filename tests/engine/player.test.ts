import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../src/config/config';
import { fixture, flush, source } from './helpers';

afterEach(() => vi.useRealTimers());

describe('canonical player navigation', () => {
  it('cues without autoplay and preserves playback intent on previous/next', async () => {
    const { player, youtube } = fixture();
    await player.init();
    expect(player.getState().status).toBe('READY');
    expect(youtube.play).not.toHaveBeenCalled();
    await player.next();
    expect(player.getState()).toMatchObject({ trackId: 2, status: 'READY' });
    await player.play();
    await player.next();
    expect(player.getState()).toMatchObject({ trackId: 3, status: 'PLAYING' });
    await player.previous();
    expect(player.getState().trackId).toBe(2);
    player.dispose();
  });

  it('restarts a progressed track on previous and freezes progress on pause', async () => {
    const { player, youtube, clock } = fixture();
    await player.init();
    await player.play();
    youtube.emit({ position: 20 });
    clock(1000);
    expect(player.getInterpolatedPosition()).toBe(21);
    youtube.snapshot.position = 21;
    await player.pause();
    clock(8000);
    expect(player.getInterpolatedPosition()).toBe(21);
    await player.previous();
    expect(player.getState().trackId).toBe(1);
    expect(player.getState().position).toBe(0);
    expect(player.getState().status).toBe('PAUSED');
    player.dispose();
  });

  it('loops all, loops one, and stops at the catalogue end with repeat off', async () => {
    const { player, youtube } = fixture();
    await player.init();
    await player.select(3);
    youtube.emit({ status: 'ended' });
    await flush();
    expect(player.getState()).toMatchObject({ trackId: 3, status: 'ENDED' });
    player.setRepeat('all');
    await player.play();
    youtube.emit({ status: 'ended' });
    await flush();
    expect(player.getState()).toMatchObject({ trackId: 1, status: 'PLAYING' });
    player.setRepeat('one');
    youtube.emit({ status: 'ended', position: 120 });
    await flush();
    expect(player.getState()).toMatchObject({ trackId: 1, status: 'PLAYING', position: 0 });
    player.dispose();
  });

  it('never loads an unverified candidate and reports unavailable direct selections', async () => {
    const { player, youtube } = fixture([source(1), source(2, 0.5), source(3)]);
    await player.init();
    const result = await player.select(2);
    expect(result.ok).toBe(false);
    expect(player.getState()).toMatchObject({ trackId: 2, status: 'SOURCE_UNAVAILABLE', provider: null });
    expect(youtube.load).toHaveBeenCalledTimes(1);
    expect(youtube.stop).toHaveBeenCalled();
    await player.next();
    expect(player.getState().trackId).toBe(3);
    player.dispose();
  });

  it('keeps the latest selection when provider initialization resolves late', async () => {
    const { player, youtube, bus } = fixture();
    let ready!: () => void;
    youtube.initialize.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const titles: number[] = [];
    bus.on('player:track', ({ track }) => titles.push(track.id));
    const initial = player.init();
    const second = player.select(2);
    const third = player.select(3);
    ready();
    await Promise.all([initial, second, third]);
    expect(titles).toEqual([1, 2, 3]);
    expect(youtube.load).toHaveBeenCalledTimes(1);
    expect(youtube.load.mock.calls[0][0].videoId).toBe(source(3).videoId);
    expect(player.getState()).toMatchObject({ trackId: 3, status: 'PLAYING' });
    youtube.events.emit('state', { ...youtube.snapshot, sourceId: source(2).videoId!, status: 'ended' });
    expect(player.getState().trackId).toBe(3);
    player.dispose();
  });

  it('cancels play while initialization is pending', async () => {
    const { player, youtube } = fixture();
    let ready!: () => void;
    youtube.initialize.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const initial = player.init();
    await player.play();
    await player.pause();
    ready();
    await initial;
    expect(youtube.load.mock.calls[0][1].autoplay).toBe(false);
    expect(player.getState().status).toBe('READY');
    player.dispose();
  });

  it('honours play from native iframe controls when navigating', async () => {
    const { player, youtube } = fixture();
    await player.init();
    youtube.emit({ status: 'playing' });
    await player.next();
    expect(player.getState()).toMatchObject({ trackId: 2, status: 'PLAYING' });
    player.setSignalWindowOpen(false);
    expect(player.getState().status).toBe('PAUSED');
    player.dispose();
  });

  it('stops bounded auto-advance when all remaining sources fail', async () => {
    vi.useFakeTimers();
    const { player, youtube } = fixture();
    await player.init();
    await player.play();
    player.setRepeat('all');
    youtube.emit({ status: 'ended' });
    await flush();
    for (let i = 0; i < 3; i += 1) {
      youtube.events.emit('error', { code: 'NOT_FOUND', status: 'UNAVAILABLE', persistent: true, sourceId: youtube.snapshot.sourceId, message: 'Removed' });
      await vi.advanceTimersByTimeAsync(CONFIG.playback.autoSkipDelayMs + 10);
    }
    expect(player.getState().error?.code).toBe('NO_PLAYABLE_TRACKS');
    const loads = youtube.load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(youtube.load).toHaveBeenCalledTimes(loads);
    player.dispose();
  });
});
