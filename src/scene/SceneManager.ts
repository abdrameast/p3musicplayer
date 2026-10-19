import * as THREE from 'three';
import { CONFIG, ENERGY_SCALE, QUALITY, getVisualProfile } from '../config/config';
import type { QualitySpec } from '../config/config';
import type { EventBus } from '../core/EventBus';
import type {
  AppEvents,
  AudioFeatures,
  PlaybackState,
  QualityProfile,
  QualitySetting,
  ResolvedTrack,
  TrackChange,
  VisualMode,
} from '../core/types';
import { CameraRig } from './CameraRig';
import type { CanvasRect } from './CameraRig';
import { toonGlobals } from './contracts';
import type { IWalkman, ScreenData, WalkmanFrame } from './contracts';
import { Environment } from './Environment';
import { Lighting } from './Lighting';
import { PointerControls } from './PointerControls';
import { QualityManager } from './QualityManager';
import { Walkman } from './Walkman';
import { VisualSystem } from '../visuals/VisualSystem';

export interface SceneFrame {
  dt: number;
  time: number;
  features: Readonly<AudioFeatures>;
  playback: Readonly<PlaybackState>;
  position: number;
  track: ResolvedTrack;
  syncReal: boolean;
}

export interface SceneStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  dpr: number;
  profile: QualityProfile;
}

export interface SceneManagerOptions {
  host: HTMLElement;
  heroElement: HTMLElement;
  bus: EventBus<AppEvents>;
  quality: QualitySetting;
  visualMode: VisualMode;
  reducedMotion: boolean;
  fontsReady: Promise<unknown>;
}

type Phase = 'idle' | 'initializing' | 'running' | 'lost' | 'disposed';

/** Intro reveal of the world around the walkman. */
const INTRO_S = 1.6;
const INTRO_REDUCED_S = 0.3;
/** Décor intensity follows a new track's energy profile over ~1 s. */
const ENERGY_RATE = 3.2;
/** The hero slot is re-measured at this interval in case layout moved it silently. */
const HERO_POLL_S = 0.5;

/**
 * Hosts the WebGL canvas and owns the 3D world: renderer, camera rig,
 * lighting/palette blend, Dark Hour environment, audio-reactive visuals,
 * pointer controls, adaptive quality and the hero walkman (through IWalkman).
 */
export class SceneManager {
  /** WebGL 2 probe (three r163+ requires WebGL 2). Never throws. */
  static isSupported(): boolean {
    try {
      if (typeof document === 'undefined') return false;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch {
      return false;
    }
  }

  private readonly opts: SceneManagerOptions;
  private readonly bus: EventBus<AppEvents>;
  private readonly quality: QualityManager;
  private phase: Phase = 'idle';
  private active = true;
  private reducedMotion: boolean;
  private mode: VisualMode;

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private rig: CameraRig | null = null;
  private lighting: Lighting | null = null;
  private environment: Environment | null = null;
  private visuals: VisualSystem | null = null;
  private walkman: IWalkman | null = null;
  private pointer: PointerControls | null = null;
  private focusRadius = 1;
  private shaderError: string | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private layoutDirty = true;
  private canvasDirty = true;
  private heroPoll = 0;
  private lastHeroRect: CanvasRect = { x: 0, y: 0, width: 0, height: 0 };

  private energy = ENERGY_SCALE.mid;
  private reveal = 0;
  private revealTarget = 0;
  private revealDuration = INTRO_S;
  private introWaiters: (() => void)[] = [];
  private autoRevealTimer: ReturnType<typeof setTimeout> | null = null;

  private lastFrameAt = 0;
  private fps = 60;

  constructor(opts: SceneManagerOptions) {
    this.opts = opts;
    this.bus = opts.bus;
    this.reducedMotion = opts.reducedMotion;
    this.mode = opts.visualMode;
    this.quality = new QualityManager(opts.quality);
  }

  async init(): Promise<void> {
    if (this.phase !== 'idle') throw new Error(`SceneManager.init() called while ${this.phase}`);
    this.phase = 'initializing';
    try {
      const profile = this.quality.profile;
      const spec = QUALITY[profile];
      const renderer = this.createRenderer(spec);
      this.renderer = renderer;

      const walkman = new Walkman({ quality: profile, reducedMotion: this.reducedMotion, fontsReady: this.opts.fontsReady });
      this.walkman = walkman;
      this.scene.add(walkman.root);
      const bounds = walkman.getFocusBounds(new THREE.Sphere());
      this.focusRadius = Number.isFinite(bounds.radius) && bounds.radius > 0 ? bounds.radius : 1;

      const rig = new CameraRig();
      this.rig = rig;
      this.lighting = new Lighting(this.mode);
      this.environment = new Environment(spec, this.focusRadius);
      this.visuals = new VisualSystem({
        quality: spec,
        focusRadius: this.focusRadius,
        boundsAt: (z, out) => rig.visibleRectAt(z, out),
        mode: this.mode,
        fontsReady: this.opts.fontsReady,
      });
      this.scene.add(this.environment.group, this.visuals.group);

      this.pointer = new PointerControls({
        heroElement: this.opts.heroElement,
        canvas: renderer.domElement,
        camera: rig.camera,
        walkman,
        bus: this.bus,
      });
      this.attachLayoutListeners();
      this.syncLayout();

      // Compile every program now (parallel where supported), then a first
      // render surfaces shader failures before the scene is declared ready.
      await renderer.compileAsync(this.scene, rig.camera);
      if (this.phase !== 'initializing') throw new Error('Scene disposed during initialisation');
      renderer.render(this.scene, rig.camera);
      if (this.shaderError) throw new Error(`Shader compilation failed: ${this.shaderError}`);

      this.phase = 'running';
      // Fail-safe: if nobody plays the intro, the world still reveals itself.
      this.autoRevealTimer = setTimeout(() => {
        this.autoRevealTimer = null;
        if (this.revealTarget === 0) this.startReveal();
      }, CONFIG.intro.maxMs);
      this.bus.emit('quality:profile', profile);
      this.bus.emit('scene:ready', undefined);
    } catch (error) {
      this.teardown();
      this.phase = 'disposed';
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  update(frame: SceneFrame): void {
    if (this.phase !== 'running' || !this.active) return;
    const renderer = this.renderer!;
    const rig = this.rig!;
    const lighting = this.lighting!;
    const walkman = this.walkman!;

    const now = performance.now();
    if (this.lastFrameAt > 0) {
      const interval = (now - this.lastFrameAt) / 1000;
      if (interval > 0 && interval < 0.25) this.fps += (1 / interval - this.fps) * 0.08;
      const stepped = this.quality.sample(interval);
      if (stepped) this.applyProfile(stepped);
    }
    this.lastFrameAt = now;

    const dt = Math.min(0.1, Math.max(0, frame.dt));
    this.heroPoll += dt;
    if (this.heroPoll >= HERO_POLL_S) {
      this.heroPoll = 0;
      if (this.heroMoved()) this.layoutDirty = true;
    }
    if (this.layoutDirty || this.canvasDirty) this.syncLayout();

    lighting.update(dt);
    const palette = lighting.palette;
    const profile = getVisualProfile(frame.track.id);
    this.energy += (ENERGY_SCALE[profile.energy] - this.energy) * (1 - Math.exp(-ENERGY_RATE * dt));
    const ambientEnergy = THREE.MathUtils.clamp(this.energy * palette.ambientMotion, 0, 1);
    this.advanceReveal(dt);

    const playing = frame.playback.status === 'PLAYING';
    const features = frame.features;
    this.pointer!.update(dt, this.reducedMotion);
    rig.update(dt, playing ? features.bass : 0, this.energy, this.reducedMotion);
    toonGlobals.uTime.value = frame.time;

    walkman.update(this.buildWalkmanFrame(frame, dt, playing, ambientEnergy));

    const parallax = this.pointer!.parallax;
    this.environment!.update({
      dt,
      time: frame.time,
      palette,
      dip: lighting.dip,
      parallax,
      reducedMotion: this.reducedMotion,
      energy: this.energy,
      reveal: this.reveal,
    });
    this.visuals!.update({
      dt,
      time: frame.time,
      features,
      playing,
      trackId: frame.track.id,
      palette,
      dip: lighting.dip,
      energy: this.energy,
      reducedMotion: this.reducedMotion,
      parallax,
      reveal: this.reveal,
    });

    renderer.render(this.scene, rig.camera);
    if (this.shaderError) this.fail(`Shader compilation failed: ${this.shaderError}`);
  }

  onTrackChange(change: TrackChange): void {
    if (this.phase !== 'running') return;
    this.walkman!.onTrackChange(change);
    this.visuals!.onTrackChange(change, this.reducedMotion);
  }

  playIntro(): Promise<void> {
    if (this.phase !== 'running') return Promise.resolve();
    if (this.autoRevealTimer !== null) {
      clearTimeout(this.autoRevealTimer);
      this.autoRevealTimer = null;
    }
    const revealed = this.startReveal();
    const walkmanIntro = this.walkman!.playIntro(this.reducedMotion).catch((error: unknown) => {
      console.warn('[SceneManager] walkman intro failed', error);
    });
    // The intro never blocks longer than the cap, even if frames stop (hidden tab).
    const cap = new Promise<void>((resolve) => setTimeout(resolve, CONFIG.intro.maxMs));
    return Promise.race([Promise.all([revealed, walkmanIntro]).then(() => undefined), cap]);
  }

  setVisualMode(mode: VisualMode): void {
    this.mode = mode;
    if (this.phase !== 'running') return;
    this.lighting!.setMode(mode, this.reducedMotion);
    this.visuals!.setMode(mode, this.reducedMotion);
  }

  setQuality(setting: QualitySetting): void {
    const before = this.quality.profile;
    const profile = this.quality.setSetting(setting);
    if (this.phase !== 'running') return;
    if (profile !== before) this.applyProfile(profile);
    else this.bus.emit('quality:profile', profile);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  resetPose(): void {
    this.walkman?.resetPose();
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      // The pause is not a slow frame.
      this.lastFrameAt = 0;
      this.quality.resetMonitoring();
    }
  }

  getStats(): SceneStats {
    const info = this.renderer?.info.render;
    return {
      fps: Math.round(this.fps * 10) / 10,
      drawCalls: info?.calls ?? 0,
      triangles: info?.triangles ?? 0,
      dpr: this.renderer?.getPixelRatio() ?? 1,
      profile: this.quality.profile,
    };
  }

  dispose(): void {
    if (this.phase === 'disposed') return;
    this.teardown();
    this.phase = 'disposed';
  }

  // ───────────────────────────────────────────────────────────── internals ──

  private createRenderer(spec: QualitySpec): THREE.WebGLRenderer {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: spec.antialias,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (error) {
      throw new Error(`WebGL unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x050b1a, 1);
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader)]
        .filter((entry): entry is string => !!entry && entry.trim() !== '')
        .join('\n');
      this.shaderError = log || 'unknown shader error';
      console.error('[SceneManager] shader compilation failed\n' + this.shaderError);
    };
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.opts.host.appendChild(canvas);
    return renderer;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.fail('WebGL context lost');
  };

  /** Stops rendering for good and lets the UI show the 2D fallback. */
  private fail(reason: string): void {
    if (this.phase !== 'running') return;
    this.phase = 'lost';
    this.bus.emit('scene:fallback', { reason });
  }

  private readonly markCanvasDirty = (): void => {
    this.canvasDirty = true;
  };

  private readonly markLayoutDirty = (): void => {
    this.layoutDirty = true;
  };

  private attachLayoutListeners(): void {
    window.addEventListener('resize', this.markCanvasDirty);
    // The hero slot moves with page scroll on small screens; the canvas is fixed.
    window.addEventListener('scroll', this.markLayoutDirty, { capture: true, passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.opts.host) this.canvasDirty = true;
          else this.layoutDirty = true;
        }
      });
      this.resizeObserver.observe(this.opts.host);
      this.resizeObserver.observe(this.opts.heroElement);
    }
  }

  /** Canvas size, pixel ratio, toon resolution uniforms and framing. */
  private syncLayout(): void {
    const renderer = this.renderer;
    const rig = this.rig;
    if (!renderer || !rig) return;
    const snap = this.canvasDirty;
    if (this.canvasDirty) {
      const width = Math.max(1, this.opts.host.clientWidth || window.innerWidth);
      const height = Math.max(1, this.opts.host.clientHeight || window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.quality.profile].maxDpr));
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(toonGlobals.uResolution.value);
      toonGlobals.uPixelRatio.value = renderer.getPixelRatio();
      rig.setViewport(width, height);
      this.visuals?.setPixelRatio(renderer.getPixelRatio());
    }
    this.lastHeroRect = this.measureHero();
    rig.setTarget(this.lastHeroRect, this.focusRadius, snap);
    this.environment?.layout(rig, renderer.getPixelRatio());
    this.visuals?.relayout();
    this.canvasDirty = false;
    this.layoutDirty = false;
  }

  private measureHero(): CanvasRect {
    const canvasRect = this.renderer!.domElement.getBoundingClientRect();
    const heroRect = this.opts.heroElement.getBoundingClientRect();
    return {
      x: heroRect.left - canvasRect.left,
      y: heroRect.top - canvasRect.top,
      width: heroRect.width,
      height: heroRect.height,
    };
  }

  private heroMoved(): boolean {
    const next = this.measureHero();
    const prev = this.lastHeroRect;
    return (
      Math.abs(next.x - prev.x) > 0.5 ||
      Math.abs(next.y - prev.y) > 0.5 ||
      Math.abs(next.width - prev.width) > 0.5 ||
      Math.abs(next.height - prev.height) > 0.5
    );
  }

  private applyProfile(profile: QualityProfile): void {
    const spec = QUALITY[profile];
    this.canvasDirty = true; // DPR cap
    this.environment?.setQuality(spec);
    this.visuals?.setQuality(spec);
    this.walkman?.setQuality(profile);
    this.bus.emit('quality:profile', profile);
  }

  private buildWalkmanFrame(frame: SceneFrame, dt: number, playing: boolean, energy: number): WalkmanFrame {
    const { playback, track } = frame;
    const screen: ScreenData = {
      status: playback.status,
      trackNumber: track.id,
      title: track.title,
      artist: track.artist,
      position: frame.position,
      duration: playback.duration || track.source.durationHint || 0,
      volume: playback.volume,
      muted: playback.muted,
      repeat: playback.repeat,
      signal: track.source.status === 'READY' ? track.source.kind : null,
      syncReal: frame.syncReal,
    };
    return { dt, time: frame.time, features: frame.features, playing, reducedMotion: this.reducedMotion, energy, screen };
  }

  private startReveal(): Promise<void> {
    this.revealTarget = 1;
    this.revealDuration = this.reducedMotion ? INTRO_REDUCED_S : INTRO_S;
    if (this.reveal >= 1) return Promise.resolve();
    return new Promise<void>((resolve) => this.introWaiters.push(resolve));
  }

  private advanceReveal(dt: number): void {
    if (this.reveal >= this.revealTarget) return;
    this.reveal = Math.min(this.revealTarget, this.reveal + dt / this.revealDuration);
    if (this.reveal >= 1) this.resolveIntro();
  }

  private resolveIntro(): void {
    const waiters = this.introWaiters;
    this.introWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private teardown(): void {
    if (this.autoRevealTimer !== null) clearTimeout(this.autoRevealTimer);
    this.autoRevealTimer = null;
    this.resolveIntro();
    window.removeEventListener('resize', this.markCanvasDirty);
    window.removeEventListener('scroll', this.markLayoutDirty, { capture: true });
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pointer?.dispose();
    this.pointer = null;
    this.visuals?.dispose();
    this.visuals = null;
    this.environment?.dispose();
    this.environment = null;
    if (this.walkman) {
      this.scene.remove(this.walkman.root);
      this.walkman.dispose();
      this.walkman = null;
    }
    this.scene.clear();
    const renderer = this.renderer;
    if (renderer) {
      const canvas = renderer.domElement;
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      renderer.dispose();
      // Free the context now instead of waiting for GC (browsers cap live contexts).
      renderer.forceContextLoss();
      canvas.remove();
      this.renderer = null;
    }
    this.rig = null;
    this.lighting = null;
  }
}
