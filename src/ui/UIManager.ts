import { CONFIG, getVisualProfile } from '../config/config';
import type { EventBus } from '../core/EventBus';
import type { PreferencesStore } from '../core/Preferences';
import type { AppEvents, AudioFeatures, AudioSyncApi, PlayerApi } from '../core/types';
import { BeatTypography } from './BeatTypography';
import type { UIContext } from './context';
import { DebugPanel, type SceneStatsLike } from './DebugPanel';
import { h, matches, run, Scope } from './dom';
import { Fallback2D } from './Fallback2D';
import { IdentityZone } from './IdentityZone';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { Notices, type NoticeCommand } from './Notices';
import { NowPlaying } from './NowPlaying';
import { PanelManager } from './Panel';
import { PlayerControls, toggleFullscreen } from './PlayerControls';
import { SettingsPanel } from './SettingsPanel';
import { SignalWindow } from './SignalWindow';
import { SyncPanel } from './SyncPanel';
import { Tracklist } from './Tracklist';
import { TransitionFx } from './TransitionFx';
import { UISounds } from './UISounds';
import { VisualsPanel } from './VisualsPanel';

export interface UIManagerOptions {
  root: HTMLElement;
  bus: EventBus<AppEvents>;
  player: PlayerApi;
  sync: AudioSyncApi;
  prefs: PreferencesStore;
  isDev: boolean;
  getSceneStats(): SceneStatsLike | null;
}

/** Owns the DOM composition and component lifetimes; all playback stays in the player. */
export class UIManager {
  private readonly scope = new Scope();
  private readonly canvasHost = h('div', { class: 'mf-canvas', 'aria-hidden': 'true' });
  private readonly hero = h('div', {
    class: 'mf-hero', role: 'button', tabindex: 0,
    'aria-label': 'Walkman. Enter or Space to play or pause. Drag to rotate.',
  });
  private readonly signalHost = h('div', { id: 'mf-youtube-host' });
  private readonly shell = h('main', { class: 'mf-shell', id: 'mf-main' });
  private readonly layer = h('div', { class: 'mf-panel-layer' });
  private readonly sounds: UISounds;
  private readonly panels: PanelManager;
  private readonly notices: Notices;
  private readonly identity: IdentityZone;
  private readonly nowPlaying: NowPlaying;
  private readonly controls: PlayerControls;
  private readonly signal: SignalWindow;
  private readonly shortcuts: KeyboardShortcuts;
  private readonly beat: BeatTypography;
  private readonly fx = new TransitionFx();
  private readonly components: Array<{ dispose(): void }> = [];
  private readonly intro: HTMLElement;
  private fallback: Fallback2D | null = null;
  private reduced = document.documentElement.dataset.motion === 'reduced';
  private mounted = false;
  private finishIntro: (() => void) | null = null;

  constructor(private readonly opts: UIManagerOptions) {
    this.sounds = new UISounds(() => opts.prefs.get().uiSounds);
    this.notices = new Notices((command) => this.command(command), () => this.reduced);
    this.panels = new PanelManager({
      layer: this.layer, inertTarget: this.shell, bus: opts.bus, sounds: this.sounds,
      isCompact: () => matches('(max-width: 767px)'), isReducedMotion: () => this.reduced,
    });
    const ctx: UIContext = {
      bus: opts.bus, player: opts.player, sync: opts.sync, prefs: opts.prefs,
      sounds: this.sounds, isDev: opts.isDev,
      isReducedMotion: () => this.reduced, isCompact: () => matches('(max-width: 767px)'),
      openPanel: (id, opener) => this.panels.open(id, opener),
      togglePanel: (id, opener) => this.panels.toggle(id, opener),
      closePanels: () => this.panels.close(),
      bindPanelOpener: (id, button) => this.panels.bindOpener(id, button),
      notify: (notice) => this.notices.push(notice),
      setVisualMode: (mode) => {
        opts.prefs.set({ visualMode: mode });
        opts.bus.emit('visual:mode', mode);
      },
    };
    this.identity = new IdentityZone(ctx);
    this.signal = new SignalWindow(ctx, this.signalHost);
    this.nowPlaying = new NowPlaying(ctx, () => this.signal.reveal(this.reduced));
    this.controls = new PlayerControls(ctx);
    this.beat = new BeatTypography(() => opts.player.getCurrentTrack().id, () => opts.player.getInterpolatedPosition());
    this.hero.append(
      h('span', { class: 'mf-hero__coordinate', 'aria-hidden': 'true' }, 'P3 / PERSONAL AUDIO SYSTEM'),
      h('span', { class: 'mf-hero__annotation', lang: 'ja', 'aria-hidden': 'true' }, '記憶の中へ'),
      h('span', { class: 'mf-hero__hint', 'aria-hidden': 'true' }, 'DRAG TO ROTATE', h('i'), 'CLICK TO PLAY'),
      this.beat.el,
    );
    const rail = h('div', { class: 'mf-edition', 'aria-hidden': 'true' },
      h('span', null, 'PERSONA 3 / SOUND ARCHIVE'), h('span', null, 'BETWEEN MIDNIGHT & MEMORY'),
      h('span', null, 'VOL. 01 — 67 TRACKS'));
    this.shell.append(rail, this.identity.el, this.hero, this.nowPlaying.el, this.controls.el, this.signal.el,
      h('p', { class: 'mf-colophon' }, 'UNOFFICIAL FAN EXPERIENCE', h('span', null, 'THE NIGHT IS YOURS.')));

    const tracklist = new Tracklist(ctx);
    const sync = new SyncPanel(ctx);
    const visuals = new VisualsPanel(ctx, () => opts.getSceneStats()?.profile ?? null);
    const settings = new SettingsPanel(ctx);
    this.panels.create({ id: 'tracklist', index: '01', title: 'TRACKLIST', jp: '曲目', kicker: 'THE COMPLETE P3 MUSIC ARCHIVE', variant: 'wide' }, {
      onOpen: () => tracklist.onOpen(), initialFocus: (compact) => tracklist.initialFocus(compact),
    }).body.append(tracklist.el);
    this.panels.create({ id: 'visuals', index: '02', title: 'VISUALS', jp: '映像', kicker: 'CHANGE THE ATMOSPHERE' }).body.append(visuals.el);
    this.panels.create({ id: 'settings', index: '03', title: 'SETTINGS', jp: '設定', kicker: 'MAKE THE NIGHT YOURS' }).body.append(settings.el);
    this.panels.create({ id: 'sync', index: '04', title: 'AUDIO SYNC', jp: '同期', kicker: 'FIND YOUR FREQUENCY' }, { onOpen: () => sync.onOpen() }).body.append(sync.el);
    this.components.push(tracklist, sync, visuals, settings);
    if (opts.isDev) {
      const debug = new DebugPanel(ctx, opts.getSceneStats);
      this.panels.create({ id: 'debug', index: 'D', title: 'DIAGNOSTICS', jp: '計測' }, {
        onOpen: () => debug.onOpen(), onClose: () => debug.onClose(),
      }).body.append(debug.el);
      this.components.push(debug);
    }

    const skip = h('button', { type: 'button', class: 'mf-intro__skip' }, 'SKIP INTRO', h('span', null, '↗'));
    this.intro = h('div', { class: 'mf-intro', hidden: true },
      h('p', { class: 'mf-intro__time', 'aria-hidden': 'true' }, '00:00'),
      h('p', { class: 'mf-intro__title' }, 'THE DARK HOUR'),
      h('p', { class: 'mf-intro__sub' }, 'A MOMENT BETWEEN MIDNIGHT & MEMORY'), skip);
    this.scope.listen(skip, 'click', () => this.finishIntro?.());
    this.scope.listen<KeyboardEvent>(this.hero, 'keydown', (event) => {
      if (event.target !== this.hero || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      run(opts.player.toggle(), 'walkman keyboard');
    });
    this.shortcuts = new KeyboardShortcuts({
      'toggle-play': () => run(opts.player.toggle(), 'toggle'),
      previous: () => run(opts.player.previous(), 'previous'), next: () => run(opts.player.next(), 'next'),
      'volume-up': () => opts.player.changeVolume(CONFIG.playback.volumeStep),
      'volume-down': () => opts.player.changeVolume(-CONFIG.playback.volumeStep),
      mute: () => opts.player.toggleMute(), tracklist: () => this.panels.toggle('tracklist'),
      sync: () => this.panels.toggle('sync'), fullscreen: toggleFullscreen,
      debug: () => this.panels.toggle('debug'),
      close: () => {
        if (this.finishIntro) this.finishIntro();
        else if (this.controls.closePopover() || this.identity.closeMenu()) return;
        else this.panels.close();
      },
    }, { isDev: opts.isDev });
    this.scope.listen(window, 'resize', () => this.panels.refreshMode());
    this.scope.add(opts.bus.on('player:notice', (notice) => this.notices.push(notice)));
    this.scope.add(opts.bus.on('player:track', (change) => {
      this.identity.transition(change, this.reduced);
      this.nowPlaying.transition(change, this.reduced);
      if (!this.reduced) this.fx.play({
        direction: change.direction, featured: change.transition === 'featured',
        label: getVisualProfile(change.track.id).accentLabel,
        durationMs: change.transition === 'featured' ? CONFIG.transitions.featuredMs : CONFIG.transitions.standardMs,
      });
    }));
    this.scope.add(opts.bus.on('player:state', (state) => {
      this.shell.dataset.playing = String(state.status === 'PLAYING');
      this.hero.setAttribute('aria-label', `Walkman. ${state.status === 'PLAYING' ? 'Pause' : 'Play'} with Enter or Space. Drag to rotate.`);
    }));
    this.scope.add(opts.bus.on('walkman:hover', (hover) => this.hero.classList.toggle('is-hover', hover)));
    this.scope.add(opts.bus.on('visual:accent', (accent) => this.beat.accent(accent, performance.now())));
    this.setReducedMotion(this.reduced);
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.opts.root.classList.add('mf-app');
    this.opts.root.replaceChildren(this.canvasHost, this.fx.el, this.shell, this.layer, this.notices.el, this.intro);
    this.shortcuts.attach();
  }

  getCanvasHost(): HTMLElement { return this.canvasHost; }
  getHeroElement(): HTMLElement { return this.hero; }
  getSignalHost(): HTMLElement { return this.signalHost; }

  /** The intro is bounded and skippable; it never waits indefinitely for WebGL. */
  runIntro(opts: { reducedMotion: boolean; sceneReady: Promise<void> }): Promise<void> {
    this.setReducedMotion(opts.reducedMotion);
    if (opts.reducedMotion) return Promise.resolve();
    this.intro.hidden = false;
    return new Promise((resolve) => {
      let ended = false;
      const started = performance.now();
      let readyTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (ended) return;
        ended = true;
        clearTimeout(cap);
        if (readyTimer) clearTimeout(readyTimer);
        this.intro.hidden = true;
        this.finishIntro = null;
        if (this.intro.contains(document.activeElement)) this.hero.focus({ preventScroll: true });
        resolve();
      };
      const cap = setTimeout(finish, CONFIG.intro.maxMs);
      this.finishIntro = finish;
      void opts.sceneReady.then(() => {
        if (!ended) readyTimer = setTimeout(finish, Math.max(0, 1500 - (performance.now() - started)));
      }, finish);
    });
  }

  showFallback(reason: string): void {
    if (this.fallback) return;
    this.canvasHost.hidden = true;
    this.hero.classList.add('has-fallback');
    this.hero.removeAttribute('role');
    this.hero.removeAttribute('tabindex');
    this.fallback = new Fallback2D({ player: this.opts.player, bus: this.opts.bus, reason });
    this.fallback.mount(this.hero);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.beat.setReducedMotion(reduced);
    if (reduced) { this.fx.cancel(); this.finishIntro?.(); }
  }

  update(frame: { dt: number; time: number; features: Readonly<AudioFeatures>; position: number }): void {
    this.controls.update(frame.position);
    this.nowPlaying.update(frame.features, frame.dt);
    this.beat.update(frame.features, performance.now());
  }

  dispose(): void {
    this.finishIntro?.();
    this.scope.dispose();
    for (const component of this.components) component.dispose();
    for (const component of [this.identity, this.nowPlaying, this.controls, this.signal, this.shortcuts, this.beat, this.fx, this.notices, this.panels, this.sounds]) component.dispose();
    this.fallback?.dispose();
    this.opts.root.replaceChildren();
    this.mounted = false;
  }

  private command(command: NoticeCommand): void {
    if (command === 'play') run(this.opts.player.play(), 'play');
    else if (command === 'retry') run(this.opts.player.retry(), 'retry');
    else this.panels.open(command === 'open-sync' ? 'sync' : 'tracklist');
  }
}
