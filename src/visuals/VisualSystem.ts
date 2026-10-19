import * as THREE from 'three';
import { MODES, getVisualProfile } from '../config/config';
import type { QualitySpec } from '../config/config';
import type { AudioFeatures, TrackChange, TransitionVariant, VisualMode } from '../core/types';
import type { BoundsAt } from './Particles';
import { Aura } from './Aura';
import { BackdropType, modeWord } from './BackdropType';
import { Particles } from './Particles';
import { Ripples } from './Ripples';
import { Spectrum } from './Spectrum';
import type { ScenePalette } from '../scene/Lighting';

export interface VisualFrame {
  dt: number;
  time: number;
  features: Readonly<AudioFeatures>;
  playing: boolean;
  /** Canonical id of the selected track (keeps the backdrop in sync even without a TrackChange). */
  trackId: number;
  palette: ScenePalette;
  /** 0..1 dramatic dip of a DARK HOUR transition. */
  dip: number;
  /** Smoothed décor intensity 0..1. */
  energy: number;
  reducedMotion: boolean;
  parallax: THREE.Vector2;
  /** Intro reveal 0..1. */
  reveal: number;
}

export interface VisualSystemOptions {
  quality: QualitySpec;
  focusRadius: number;
  boundsAt: BoundsAt;
  mode: VisualMode;
  fontsReady: Promise<unknown>;
}

/** What each transition variant triggers. Add a variant here, not in code paths. */
interface TransitionSpec {
  ripples: number;
  rippleStagger: number;
  rippleStrength: number;
  auraAccent: number;
  sweep: number;
}

const TRANSITIONS: Readonly<Record<TransitionVariant, TransitionSpec>> = {
  standard: { ripples: 1, rippleStagger: 0, rippleStrength: 0.7, auraAccent: 0.3, sweep: 0 },
  featured: { ripples: 3, rippleStagger: 0.17, rippleStrength: 0.9, auraAccent: 0.9, sweep: 1 },
};

/**
 * Orchestrates the audio-reactive layer around the walkman: Lunar Pulse aura,
 * water ripples, spectral arc, floating particles and backdrop typography.
 * Everything reads the same AudioFeatures and blended palette; transitions are
 * configuration-driven (TRANSITIONS).
 */
export class VisualSystem {
  readonly group = new THREE.Group();
  private readonly aura: Aura;
  private readonly ripples: Ripples;
  private readonly spectrum: Spectrum;
  private readonly particles: Particles;
  private readonly backdrop: BackdropType;
  private mode: VisualMode;
  private trackId = 0;
  private accentLabel: string | null = null;

  constructor(opts: VisualSystemOptions) {
    const r = opts.focusRadius;
    this.mode = opts.mode;
    this.group.name = 'visuals';
    this.aura = new Aura(r);
    this.ripples = new Ripples(r, opts.quality.ripples);
    this.spectrum = new Spectrum(r, opts.quality.spectrumSegments);
    this.particles = new Particles(r, opts.quality.particles, opts.boundsAt);
    this.backdrop = new BackdropType(r, opts.fontsReady);
    this.group.add(this.backdrop.group, this.ripples.mesh, this.particles.group, this.aura.mesh, this.spectrum.group);
  }

  setQuality(spec: QualitySpec): void {
    this.ripples.setMax(spec.ripples);
    this.spectrum.setSegments(spec.spectrumSegments);
    this.particles.setBaseCount(spec.particles);
  }

  setPixelRatio(pixelRatio: number): void {
    this.ripples.setPixelRatio(pixelRatio);
  }

  /** Framing changed (resize / hero slot moved). */
  relayout(): void {
    this.particles.relayout();
  }

  setMode(mode: VisualMode, reducedMotion: boolean): void {
    this.mode = mode;
    this.refreshWord(true, reducedMotion);
  }

  onTrackChange(change: TrackChange, reducedMotion: boolean): void {
    const spec = TRANSITIONS[change.transition];
    this.trackId = change.track.id;
    this.accentLabel = getVisualProfile(change.track.id).accentLabel ?? null;
    const featured = change.transition === 'featured';
    this.backdrop.setNumber(change.track.id, change.direction, featured, true, reducedMotion);
    this.refreshWord(true, reducedMotion);
    this.aura.accent(spec.auraAccent);
    if (reducedMotion) return;
    for (let i = 0; i < spec.ripples; i++) this.ripples.emit(spec.rippleStrength * (1 - i * 0.18), i * spec.rippleStagger);
    if (spec.sweep > 0) this.spectrum.sweep(spec.sweep);
  }

  update(frame: VisualFrame): void {
    if (frame.trackId !== this.trackId) {
      // Initial track (or a change that arrived without an event): no animation.
      this.trackId = frame.trackId;
      this.accentLabel = getVisualProfile(frame.trackId).accentLabel ?? null;
      this.backdrop.setNumber(frame.trackId, 0, false, false, frame.reducedMotion);
      this.refreshWord(false, frame.reducedMotion);
    }
    const fade = THREE.MathUtils.smoothstep(frame.reveal, 0.4, 1) * (1 - frame.dip * 0.5);
    const base = { dt: frame.dt, palette: frame.palette, reducedMotion: frame.reducedMotion, fade };
    this.aura.update({ ...base, time: frame.time, features: frame.features, energy: frame.energy });
    this.ripples.update({ ...base, features: frame.features, playing: frame.playing });
    this.spectrum.update({ ...base, features: frame.features, playing: frame.playing, energy: frame.energy });
    this.particles.update({ ...base, time: frame.time, features: frame.features, energy: frame.energy });
    this.backdrop.update({ ...base, parallax: frame.parallax });
  }

  dispose(): void {
    this.aura.dispose();
    this.ripples.dispose();
    this.spectrum.dispose();
    this.particles.dispose();
    this.backdrop.dispose();
    this.group.clear();
  }

  private refreshWord(animate: boolean, reducedMotion: boolean): void {
    const word = this.accentLabel ?? modeWord(this.mode);
    this.backdrop.setWord(word, MODES[this.mode].kanji, animate, reducedMotion);
  }
}
