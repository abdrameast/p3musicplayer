import { afterEach, describe, expect, it, vi } from 'vitest';
import { LicensedAudioProvider } from '../../src/audio/LicensedAudioProvider';
import { YouTubeProvider } from '../../src/audio/YouTubeProvider';
import type { YTNamespace, YTPlayer, YTPlayerOptions } from '../../src/audio/youtube-iframe';
import { flush } from './helpers';

afterEach(() => vi.useRealTimers());

function youtubeFixture(ready = true) {
  let options!: YTPlayerOptions;
  let held = '';
  const iframe = document.createElement('iframe');
  const mockPlayer = {
    cueVideoById: vi.fn(), loadVideoById: vi.fn(), cuePlaylist: vi.fn(), getPlaylist: () => [],
    playVideo: vi.fn(), pauseVideo: vi.fn(), stopVideo: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(), mute: vi.fn(), unMute: vi.fn(),
    getCurrentTime: () => 12, getDuration: () => 180, getVideoLoadedFraction: () => 0.5, getPlayerState: () => 5,
    getVideoUrl: () => held ? `https://www.youtube.com/watch?v=${held}` : '', getIframe: () => iframe, destroy: vi.fn(),
  } satisfies YTPlayer;
  const api = { Player: class {
    constructor(_target: HTMLElement | string, opts: YTPlayerOptions) {
      options = opts;
      if (ready) queueMicrotask(() => options.events?.onReady?.({ target: mockPlayer }));
      return mockPlayer;
    }
  } } as unknown as YTNamespace;
  const host = document.createElement('div');
  const provider = new YouTubeProvider({ host, loadApi: async () => api, playerHostOrigin: 'https://example.test' });
  return {
    provider, host, mockPlayer, hold: (id: string) => { held = id; },
    state: (data: number) => options.events?.onStateChange?.({ target: mockPlayer, data }),
    error: (data: number) => options.events?.onError?.({ target: mockPlayer, data }),
  };
}

describe('YouTube provider lifecycle', () => {
  it('ignores late state/error callbacks for a previous video during a quick switch', async () => {
    const { provider, hold, state, error } = youtubeFixture();
    await provider.initialize();
    await provider.load({ videoId: 'testvideo01' }, { autoplay: false });
    hold('testvideo01');
    state(1);
    expect(provider.getPlaybackState().status).toBe('playing');
    await provider.load({ videoId: 'testvideo02' }, { autoplay: false });
    const failure = vi.fn();
    provider.on('error', failure);
    state(0);
    error(150);
    expect(provider.getPlaybackState()).toMatchObject({ sourceId: 'testvideo02', status: 'cued', position: 0 });
    expect(failure).not.toHaveBeenCalled();
    hold('testvideo02');
    state(1);
    expect(provider.getPlaybackState()).toMatchObject({ status: 'playing', duration: 180 });
    provider.destroy();
  });

  it('cancels the readiness timeout and releases the frame on disposal', async () => {
    vi.useFakeTimers();
    const { provider, host, mockPlayer } = youtubeFixture(false);
    const started = provider.initialize();
    const rejected = expect(started).rejects.toThrow('destroyed');
    await flush();
    expect(host.children.length).toBe(1);
    provider.destroy();
    await rejected;
    expect(mockPlayer.destroy).toHaveBeenCalledOnce();
    expect(host.children.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans playback polling and autoplay timers when stopped', async () => {
    vi.useFakeTimers();
    const { provider, hold, state } = youtubeFixture();
    const initialized = provider.initialize();
    await vi.runAllTicks();
    await initialized;
    await provider.load({ videoId: 'testvideo01' }, { autoplay: true });
    hold('testvideo01');
    state(1);
    expect(vi.getTimerCount()).toBe(1);
    provider.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(provider.getPlaybackState().sourceId).toBeNull();
    provider.destroy();
  });
});

function mediaFixture() {
  const element = document.createElement('audio');
  let paused = true;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'duration', { value: 120, configurable: true });
  Object.defineProperty(element, 'buffered', { value: { length: 1, end: () => 120 } });
  const play = vi.spyOn(element, 'play').mockImplementation(async () => {
    paused = false;
    element.dispatchEvent(new Event('playing'));
  });
  vi.spyOn(element, 'pause').mockImplementation(() => {
    paused = true;
    element.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(element, 'load').mockImplementation(() => undefined);
  const provider = new LicensedAudioProvider({ createElement: () => element });
  return { provider, element, play };
}

describe('licensed audio provider', () => {
  it('samples pause position and permits seeking after metadata arrives', async () => {
    const { provider, element } = mediaFixture();
    await provider.initialize();
    await provider.load({ audioUrl: '/licensed.mp3' }, { autoplay: false });
    element.dispatchEvent(new Event('loadedmetadata'));
    await provider.play();
    element.currentTime = 37;
    provider.pause();
    expect(provider.getPlaybackState()).toMatchObject({ status: 'paused', position: 37, canSeek: true });
    provider.seek(200);
    expect(element.currentTime).toBe(120);
    provider.destroy();
  });

  it('ignores a rejected play from an older load of the same file', async () => {
    const { provider, play } = mediaFixture();
    await provider.initialize();
    await provider.load({ audioUrl: '/licensed.mp3' }, { autoplay: false });
    let reject!: (reason: unknown) => void;
    play.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const blocked = vi.fn();
    provider.on('autoplay-blocked', blocked);
    const old = provider.play();
    await provider.load({ audioUrl: '/licensed.mp3' }, { autoplay: false });
    reject(new DOMException('Blocked old request', 'NotAllowedError'));
    await old;
    expect(blocked).not.toHaveBeenCalled();
    expect(provider.getPlaybackState().status).toBe('cued');
    provider.destroy();
  });

  it('surfaces an actual autoplay refusal', async () => {
    const { provider, play } = mediaFixture();
    await provider.initialize();
    await provider.load({ audioUrl: '/licensed.mp3' }, { autoplay: false });
    play.mockRejectedValueOnce(new DOMException('Needs a gesture', 'NotAllowedError'));
    const blocked = vi.fn();
    provider.on('autoplay-blocked', blocked);
    await provider.play();
    expect(blocked).toHaveBeenCalledWith({ sourceId: '/licensed.mp3' });
    provider.destroy();
  });
});
