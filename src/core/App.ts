import { LicensedAudioProvider } from '../audio/LicensedAudioProvider';
import { AudioFeatureEngine } from '../audio/AudioFeatureEngine';
import { YouTubeProvider } from '../audio/YouTubeProvider';
import { CONFIG } from '../config/config';
import { SOURCE_MAP } from '../config/source-map';
import { TRACKS } from '../config/tracks';
import { PlayerController } from '../player/PlayerController';
import { SceneManager } from '../scene/SceneManager';
import { SourceResolver } from '../sources/SourceResolver';
import { fontsReady } from '../ui/fonts';
import { UIManager } from '../ui/UIManager';
import { EventBus } from './EventBus';
import { PreferencesStore } from './Preferences';
import { Ticker } from './Ticker';
import type { AppEvents, Preferences } from './types';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Composition root: builds every subsystem, wires them through the event
 * bus and drives the per-frame loop. Contains no rendering or UI logic.
 */
export class App {
  private readonly bus = new EventBus<AppEvents>();
  private readonly prefs: PreferencesStore;
  private readonly resolver = new SourceResolver(TRACKS, SOURCE_MAP);
  private player: PlayerController | null = null;
  private sync: AudioFeatureEngine | null = null;
  private ui: UIManager | null = null;
  private scene: SceneManager | null = null;
  private readonly ticker = new Ticker((dt, time, now) => this.frame(dt, time, now));
  private readonly cleanups: Array<() => void> = [];
  private reducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    prefs?: PreferencesStore,
  ) {
    this.prefs = prefs ?? new PreferencesStore();
  }

  async start(): Promise<void> {
    this.motionQuery = typeof matchMedia === 'function' ? matchMedia(REDUCED_QUERY) : null;
    this.reducedMotion = this.computeReducedMotion(this.prefs.get());
    this.applyDocumentState(this.prefs.get());

    await this.resolver.loadOverrides(CONFIG.sources.overridesUrl);
    if (this.disposed) return;

    const initial = this.prefs.get();
    const player = new PlayerController({
      bus: this.bus,
      resolver: this.resolver,
      initial: {
        trackId: initial.lastTrackId,
        volume: initial.volume,
        muted: initial.muted,
        repeat: initial.repeat,
      },
      sourcePreference: initial.sourcePreference,
      createYouTubeProvider: () => new YouTubeProvider({ host: () => this.requireUI().getSignalHost() }),
      createLicensedProvider: () => new LicensedAudioProvider(),
    });
    this.player = player;

    this.sync = new AudioFeatureEngine({
      bus: this.bus,
      player,
      getTapTempo: () => this.prefs.get().tapTempo,
      setTapTempo: (trackId, bpm) => {
        const next = { ...this.prefs.get().tapTempo };
        if (bpm === null) delete next[trackId];
        else next[trackId] = bpm;
        this.prefs.set({ tapTempo: next });
      },
    });

    const ui = new UIManager({
      root: this.root,
      bus: this.bus,
      player,
      sync: this.sync,
      prefs: this.prefs,
      isDev: import.meta.env.DEV,
      getSceneStats: () => this.scene?.getStats() ?? null,
    });
    this.ui = ui;
    ui.mount();

    this.wireEvents();

    // Playback initialisation never waits for the intro or the 3D scene.
    void player.init().catch((error: unknown) => console.error('[App] player init failed', error));
    // Capture always starts from a fresh, explicit action in the sync panel.

    const sceneReady = this.startScene();
    this.ticker.start();
    await ui.runIntro({ reducedMotion: this.reducedMotion, sceneReady });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ticker.stop();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.scene?.dispose();
    this.scene = null;
    this.sync?.dispose();
    this.player?.dispose();
    this.ui?.dispose();
    this.prefs.flush();
    this.bus.clear();
  }

  private requireUI(): UIManager {
    if (!this.ui) throw new Error('UI not mounted');
    return this.ui;
  }

  /** Resolves once the 3D scene is running or the 2D fallback is shown. */
  private async startScene(): Promise<void> {
    const ui = this.requireUI();
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('renderer') === '2d') {
      ui.showFallback('2D preview requested. Playback remains available.');
      return;
    }
    if (!SceneManager.isSupported()) {
      ui.showFallback('WebGL is not available in this browser.');
      return;
    }
    const prefs = this.prefs.get();
    const scene = new SceneManager({
      host: ui.getCanvasHost(),
      heroElement: ui.getHeroElement(),
      bus: this.bus,
      quality: prefs.quality,
      visualMode: prefs.visualMode,
      reducedMotion: this.reducedMotion,
      fontsReady,
    });
    try {
      await scene.init();
    } catch (error) {
      console.error('[App] 3D scene failed, using 2D fallback', error);
      scene.dispose();
      if (this.disposed) return;
      ui.showFallback('The 3D renderer could not start on this device.');
      return;
    }
    if (this.disposed) {
      scene.dispose();
      return;
    }
    this.scene = scene;
    // Let the intro's first beat (00:00 / THE DARK HOUR) play before the walkman descends.
    if (!this.reducedMotion) await delay(900);
    await this.scene?.playIntro();
  }

  private frame(dt: number, time: number, now: number): void {
    const player = this.player;
    const sync = this.sync;
    if (!player || !sync) return;
    const features = sync.update(dt, now);
    const position = player.getInterpolatedPosition(now);
    this.scene?.update({
      dt,
      time,
      features,
      playback: player.getState(),
      position,
      track: player.getCurrentTrack(),
      syncReal: sync.getStatus().real,
    });
    this.ui?.update({ dt, time, features, position });
  }

  private wireEvents(): void {
    const { bus } = this;
    const on = <K extends keyof AppEvents>(type: K, fn: (payload: AppEvents[K]) => void) =>
      this.cleanups.push(bus.on(type, fn));

    on('walkman:activate', () => void this.player?.toggle());
    on('walkman:reset-pose', () => this.scene?.resetPose());
    on('player:track', (change) => this.scene?.onTrackChange(change));
    on('player:state', (state) => {
      this.prefs.set({ volume: state.volume, muted: state.muted, repeat: state.repeat, lastTrackId: state.trackId });
    });
    on('visual:mode', (mode) => {
      document.documentElement.dataset.mode = mode;
      this.scene?.setVisualMode(mode);
    });
    on('sync:status', (status) => {
      if (status.mode === 'simulated' || status.mode === 'mic') this.prefs.set({ syncMode: status.mode });
    });
    on('scene:fallback', ({ reason }) => {
      this.scene?.dispose();
      this.scene = null;
      this.ui?.showFallback(reason);
    });

    let previous = this.prefs.get();
    this.cleanups.push(
      this.prefs.subscribe((prefs) => {
        if (prefs.quality !== previous.quality) this.scene?.setQuality(prefs.quality);
        if (prefs.visualMode !== previous.visualMode) {
          document.documentElement.dataset.mode = prefs.visualMode;
          this.scene?.setVisualMode(prefs.visualMode);
        }
        if (prefs.motion !== previous.motion) this.updateReducedMotion();
        if (prefs.sourcePreference !== previous.sourcePreference) this.player?.setSourcePreference(prefs.sourcePreference);
        previous = prefs;
      }),
    );

    if (this.motionQuery) {
      const onMotion = () => this.updateReducedMotion();
      this.motionQuery.addEventListener('change', onMotion);
      this.cleanups.push(() => this.motionQuery?.removeEventListener('change', onMotion));
    }

    const onVisibility = () => {
      const visible = document.visibilityState === 'visible';
      this.scene?.setActive(visible);
      if (visible) this.ticker.start();
      else {
        this.ticker.stop();
        this.prefs.flush();
      }
    };
    const onPageHide = () => this.prefs.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });
  }

  private computeReducedMotion(prefs: Preferences): boolean {
    if (prefs.motion === 'reduce') return true;
    if (prefs.motion === 'full') return false;
    return this.motionQuery?.matches ?? false;
  }

  private updateReducedMotion(): void {
    const reduced = this.computeReducedMotion(this.prefs.get());
    if (reduced === this.reducedMotion) return;
    this.reducedMotion = reduced;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    this.scene?.setReducedMotion(reduced);
    this.ui?.setReducedMotion(reduced);
    this.bus.emit('motion:reduced', reduced);
  }

  private applyDocumentState(prefs: Preferences): void {
    const html = document.documentElement;
    html.dataset.mode = prefs.visualMode;
    html.dataset.motion = this.reducedMotion ? 'reduced' : 'full';
  }
}
