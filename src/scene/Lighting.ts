import * as THREE from 'three';
import { MODES } from '../config/config';
import type { ModePalette } from '../config/config';
import type { VisualMode } from '../core/types';
import { toonGlobals } from './contracts';

const COLOR_KEYS = [
  'skyTop',
  'skyMid',
  'skyBottom',
  'fog',
  'skylineNear',
  'skylineFar',
  'windowLight',
  'moonColor',
  'haloColor',
  'causticColor',
  'rimColor',
  'shadowTint',
  'rippleColor',
  'particleColor',
  'auraColor',
  'spectrumColor',
] as const satisfies readonly (keyof ModePalette)[];

const NUMBER_KEYS = [
  'moonIntensity',
  'causticIntensity',
  'rimStrength',
  'particleDensity',
  'particleRise',
  'auraStrength',
  'ambientMotion',
  'godRays',
] as const satisfies readonly (keyof ModePalette)[];

type ColorKey = (typeof COLOR_KEYS)[number];
type NumberKey = (typeof NUMBER_KEYS)[number];

/** Live, blended values of every mode-dependent parameter (colours in linear space). */
export type ScenePalette = { [K in ColorKey]: THREE.Color } & { [K in NumberKey]: number } & {
  /** Normalised screen position (0,0 = bottom-left). */
  moonPosition: THREE.Vector2;
  /** World direction towards the key light. */
  lightDir: THREE.Vector3;
};

/**
 * Key light per mode: cold moonlight from the upper left / front so the hard
 * toon shadow lands on the lower-right of the body, as in the illustration.
 * DARK HOUR rakes a little more from the side (harder contrast), BLUE MEMORY
 * is more frontal (softer, submerged).
 */
const LIGHT_DIRECTIONS: Readonly<Record<VisualMode, readonly [number, number, number]>> = {
  moonlight: [-0.45, 0.75, 0.5],
  darkhour: [-0.62, 0.68, 0.38],
  bluememory: [-0.36, 0.78, 0.6],
};

const BLEND_S = 1.4;
const BLEND_DRAMATIC_S = 1.6;
const BLEND_REDUCED_S = 0.35;
/** How far the scene dims at the middle of a transition into DARK HOUR. */
const DARK_DIP = 0.42;

function createPalette(mode: VisualMode): ScenePalette {
  const spec = MODES[mode];
  const palette = {
    moonPosition: new THREE.Vector2(spec.moonPosition[0], spec.moonPosition[1]),
    lightDir: new THREE.Vector3(...LIGHT_DIRECTIONS[mode]).normalize(),
  } as ScenePalette;
  for (const key of COLOR_KEYS) palette[key] = new THREE.Color(spec[key]);
  for (const key of NUMBER_KEYS) palette[key] = spec[key];
  return palette;
}

function copyPalette(target: ScenePalette, source: ScenePalette): void {
  for (const key of COLOR_KEYS) target[key].copy(source[key]);
  for (const key of NUMBER_KEYS) target[key] = source[key];
  target.moonPosition.copy(source.moonPosition);
  target.lightDir.copy(source.lightDir);
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Mode-dependent lighting state of the whole scene. Blends every palette
 * value between visual modes (interruptible: a new mode blends from wherever
 * the previous blend was) and writes the shared toon uniforms.
 */
export class Lighting {
  /** Read by Environment and visuals every frame. */
  readonly palette: ScenePalette;
  private readonly from: ScenePalette;
  private to: ScenePalette;
  private targetMode: VisualMode;
  private progress = 1;
  private duration = BLEND_S;
  private dramatic = false;
  private currentDip = 0;

  constructor(mode: VisualMode) {
    this.targetMode = mode;
    this.palette = createPalette(mode);
    this.from = createPalette(mode);
    this.to = createPalette(mode);
    this.writeToonGlobals();
  }

  get mode(): VisualMode {
    return this.targetMode;
  }

  /** 0..1 extra darkening during a dramatic (DARK HOUR) transition. */
  get dip(): number {
    return this.currentDip;
  }

  setMode(mode: VisualMode, reducedMotion: boolean): void {
    if (mode === this.targetMode) return;
    this.targetMode = mode;
    copyPalette(this.from, this.palette);
    this.to = createPalette(mode);
    this.progress = 0;
    this.dramatic = mode === 'darkhour' && !reducedMotion;
    this.duration = reducedMotion ? BLEND_REDUCED_S : this.dramatic ? BLEND_DRAMATIC_S : BLEND_S;
  }

  update(dt: number): void {
    if (this.progress >= 1) {
      this.currentDip = 0;
      return;
    }
    this.progress = Math.min(1, this.progress + dt / this.duration);
    // The dramatic blend lingers in the dark before resolving.
    const eased = this.dramatic ? easeInOutCubic(this.progress) ** 1.25 : easeInOutCubic(this.progress);
    const p = this.palette;
    for (const key of COLOR_KEYS) p[key].copy(this.from[key]).lerp(this.to[key], eased);
    for (const key of NUMBER_KEYS) p[key] = THREE.MathUtils.lerp(this.from[key], this.to[key], eased);
    p.moonPosition.copy(this.from.moonPosition).lerp(this.to.moonPosition, eased);
    p.lightDir.copy(this.from.lightDir).lerp(this.to.lightDir, eased).normalize();
    this.currentDip = this.dramatic ? Math.sin(Math.PI * this.progress) * DARK_DIP : 0;
    this.writeToonGlobals();
  }

  private writeToonGlobals(): void {
    const p = this.palette;
    toonGlobals.uLightDir.value.copy(p.lightDir);
    toonGlobals.uRimColor.value.copy(p.rimColor);
    // Rim fades with the dip so the walkman darkens with the scene, never pops.
    toonGlobals.uRimStrength.value = p.rimStrength * (1 - this.currentDip * 0.5);
    toonGlobals.uShadowTint.value.copy(p.shadowTint);
  }
}
