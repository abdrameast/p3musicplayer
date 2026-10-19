import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACKS } from '../src/config/tracks';
import { EventBus } from '../src/core/EventBus';
import { PreferencesStore } from '../src/core/Preferences';
import type { AppEvents, AudioSyncApi, PlaybackState, PlayerApi, ResolvedTrack } from '../src/core/types';
import { resolveShortcut } from '../src/ui/KeyboardShortcuts';
import { createSearchIndex, filterTracks, normalizeSearchText } from '../src/ui/search';
import { UIManager } from '../src/ui/UIManager';

describe('archive search', () => {
  const index = createSearchIndex(TRACKS);
  it('finds Latin accents, apostrophes, fullwidth text and exact canonical track numbers', () => {
    expect(filterTracks(index, 'ca va barder', 'ALL')).toEqual([66]);
    expect(filterTracks(index, 'its going down ＲＥＬＯＡＤ', 'ALL')).toEqual([52]);
    expect(filterTracks(index, '046', 'ALL')).toEqual([46]);
    expect(filterTracks(index, 'full moon', 'RELOAD')).toEqual([46]);
    expect(filterTracks(index, 'full moon', 'ORIGINAL')).toEqual([]);
  });
  it('matches kana variants while preserving dakuten and canonical Japanese text', () => {
    expect(filterTracks(index, 'きみの記憶', 'RELOAD')).toEqual([59]);
    expect(filterTracks(index, 'やすらぎ', 'ALL')).toEqual([3, 48]);
    expect(normalizeSearchText('やすらぎ')).not.toBe(normalizeSearchText('やすらき'));
    expect(TRACKS[58].title).toBe('キミの記憶 -Reload- (Memories of You)');
  });
});

describe('keyboard priority', () => {
  it('preserves text entry, native range arrows and browser shortcuts', () => {
    const search = document.createElement('input');
    search.type = 'search';
    const slider = document.createElement('input');
    slider.type = 'range';
    expect(resolveShortcut({ key: 't', target: search }, { isDev: false })).toBeNull();
    expect(resolveShortcut({ key: 'ArrowRight', target: slider }, { isDev: false })).toBeNull();
    expect(resolveShortcut({ key: 'f', ctrlKey: true }, { isDev: false })).toBeNull();
    expect(resolveShortcut({ key: 'ArrowRight', target: document.body }, { isDev: false })).toBe('next');
  });
});

function fixture(compact = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: compact && query.includes('767px'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  }));
  const bus = new EventBus<AppEvents>();
  const prefs = new PreferencesStore(null);
  prefs.set({ uiSounds: false });
  const tracks: ResolvedTrack[] = TRACKS.map((track) => ({
    ...track, source: { trackId: track.id, status: 'READY', kind: 'youtube', videoId: '12345678901',
      audioUrl: null, reason: null, durationHint: 180, verification: null, externalUrl: 'https://www.youtube.com/watch?v=12345678901' },
  }));
  const state: PlaybackState = { trackId: 46, status: 'READY', provider: 'youtube', position: 0, duration: 180,
    buffered: 0, volume: .7, muted: false, repeat: 'all', canSeek: true, error: null, sampledAt: 0 };
  const player: PlayerApi = {
    tracks, getState: () => state, getCurrentTrack: () => tracks[state.trackId - 1], getInterpolatedPosition: () => state.position,
    isPlayable: () => true, play: vi.fn(async () => {}), pause: vi.fn(async () => {}), toggle: vi.fn(async () => {}),
    next: vi.fn(async () => {}), previous: vi.fn(async () => {}), select: vi.fn(async () => ({ ok: true, status: 'PLAYING' as const })),
    seek: vi.fn(async () => {}), setVolume: vi.fn(), changeVolume: vi.fn(), setMuted: vi.fn(), toggleMute: vi.fn(),
    setRepeat: vi.fn(), cycleRepeat: vi.fn(() => 'off' as const), setSignalWindowOpen: vi.fn(), isSignalWindowOpen: () => true,
    retry: vi.fn(async () => {}), getMediaElement: () => null,
  };
  const sync: AudioSyncApi = {
    getStatus: () => ({ mode: 'simulated', label: 'VISUAL SYNC · SIMULATED', real: false }),
    isSupported: (mode) => mode === 'simulated',
    setMode: vi.fn(async () => ({ ok: true, status: { mode: 'simulated' as const, label: 'VISUAL SYNC · SIMULATED', real: false } })),
    tap: () => null, getBpm: () => 120, resetBpm: vi.fn(),
    getFeatures: () => ({ level: 0, bass: 0, lowMid: 0, mid: 0, high: 0, beat: false, kick: 0, bpm: 120, spectrum: new Float32Array(64), waveform: new Float32Array(256) }),
  };
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new UIManager({ root, bus, player, sync, prefs, isDev: false, getSceneStats: () => null });
  ui.mount();
  return { root, ui, player, prefs, bus, state, tracks };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UI composition and accessibility', () => {
  it('mounts the 67-track archive, restores panel focus and routes real playback commands', () => {
    const { ui, root, player, prefs, bus } = fixture();
    const opener = root.querySelector<HTMLButtonElement>('.mf-nav__item[data-panel="tracklist"]')!;
    opener.focus();
    opener.click();
    const panel = root.querySelector<HTMLElement>('#mf-panel-tracklist')!;
    expect(panel.hidden).toBe(false);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('input[type="search"]'));
    expect(root.querySelectorAll('.mf-row')).toHaveLength(67);
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    root.querySelector<HTMLButtonElement>('.mf-play')!.click();
    expect(player.toggle).toHaveBeenCalledOnce();
    expect(ui.getCanvasHost().isConnected).toBe(true);
    expect(ui.getHeroElement().isConnected).toBe(true);
    expect(ui.getSignalHost().isConnected).toBe(true);
    ui.dispose();
    prefs.flush();
    expect(bus.listenerCount('player:track')).toBe(0);
    expect(root.childElementCount).toBe(0);
  });

  it('makes mobile sheets modal and restores a valid focus target after filtered search', () => {
    const { ui, root, prefs } = fixture(true);
    prefs.set({ tracklistFilter: 'ORIGINAL' });
    root.querySelector<HTMLButtonElement>('.mf-menubtn')!.click();
    root.querySelector<HTMLButtonElement>('.mf-nav__item[data-panel="tracklist"]')!.click();
    const panel = root.querySelector<HTMLElement>('#mf-panel-tracklist')!;
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector('main')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.closest('.mf-row')?.getAttribute('data-id')).toBe('1');
    panel.querySelector<HTMLButtonElement>('.mf-panel__close')!.click();
    expect(root.querySelector('main')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('.mf-menubtn'));
    ui.dispose();
    prefs.flush();
  });

  it('keeps the 2D fallback playable and updates its LCD when the selected track changes', () => {
    const { ui, root, player, bus, prefs, tracks, state } = fixture();
    ui.showFallback('WebGL unavailable for this test.');
    expect(ui.getCanvasHost().hidden).toBe(true);
    expect(root.querySelector('.mf-fb__title')?.textContent).toContain('FULL MOON FULL LIFE');
    root.querySelector<HTMLButtonElement>('.mf-fb__object')!.click();
    expect(player.toggle).toHaveBeenCalledOnce();
    state.trackId = 59;
    bus.emit('player:track', { track: tracks[58], previous: tracks[45], direction: 1, transition: 'standard', requestId: 1 });
    bus.emit('player:time', { position: 95, duration: 180, buffered: .7 });
    expect(root.querySelector('.mf-fb__title')?.textContent).toContain('キミの記憶');
    expect(root.querySelector('.mf-fb__time')?.textContent).toBe('1:35');
    expect(root.querySelector('#mf-np-title')?.textContent).toBe(tracks[58].title);
    ui.dispose();
    prefs.flush();
  });

  it('allows skipping an unresolved 3D intro and imposes a hard deadline', async () => {
    vi.useFakeTimers();
    const { ui, root, prefs } = fixture();
    const unresolved = new Promise<void>(() => {});
    const first = ui.runIntro({ reducedMotion: false, sceneReady: unresolved });
    root.querySelector<HTMLButtonElement>('.mf-intro__skip')!.click();
    await first;
    expect(root.querySelector<HTMLElement>('.mf-intro')!.hidden).toBe(true);
    const second = ui.runIntro({ reducedMotion: false, sceneReady: unresolved });
    await vi.advanceTimersByTimeAsync(2800);
    await second;
    expect(root.querySelector<HTMLElement>('.mf-intro')!.hidden).toBe(true);
    ui.dispose();
    prefs.flush();
  });
});
