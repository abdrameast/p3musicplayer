import * as THREE from 'three';
import { QUALITY } from '../config/config';
import type { AudioFeatures } from '../core/types';
import { PRESENTATION_ANGLE } from '../scene/CameraRig';
import type { ScenePalette } from '../scene/Lighting';
import { createRng } from '../scene/random';
import type { Rng } from '../scene/random';
import { LOCAL_QUAD_VERTEX, RIPPLE_FRAGMENT } from '../scene/shaders/effects';

/** Shader array size: the largest pool any quality profile may use. */
const MAX_RIPPLES = Math.max(...Object.values(QUALITY).map((q) => q.ripples));

export interface RippleRules {
  /** Kick envelope needed on the beat frame. */
  kickThreshold: number;
  /** Minimum seconds between two musical ripples. */
  cooldownS: number;
  /** A ripple marks roughly every 2nd–4th qualifying beat. */
  minBeatGap: number;
  maxBeatGap: number;
}

export const DEFAULT_RIPPLE_RULES: Readonly<RippleRules> = {
  kickThreshold: 0.75,
  cooldownS: 0.8,
  minBeatGap: 2,
  maxBeatGap: 4,
};

/**
 * Decides when the music deserves a ripple. Pure and deterministic (seeded),
 * so the "musical moments" rule is testable without WebGL.
 */
export class RippleScheduler {
  private sinceLast = Number.POSITIVE_INFINITY;
  private beats = 0;
  private gap: number;
  private readonly rng: Rng;

  constructor(
    private readonly rules: Readonly<RippleRules> = DEFAULT_RIPPLE_RULES,
    seed = 0x71991e,
  ) {
    this.rng = createRng(seed);
    this.gap = this.nextGap();
  }

  /** True when a musical ripple should start this frame. */
  step(dt: number, features: Readonly<AudioFeatures>, playing: boolean): boolean {
    this.sinceLast += dt;
    if (!playing || !features.beat) return false;
    this.beats += 1;
    if (features.kick < this.rules.kickThreshold) return false;
    if (this.sinceLast < this.rules.cooldownS || this.beats < this.gap) return false;
    this.sinceLast = 0;
    this.beats = 0;
    this.gap = this.nextGap();
    return true;
  }

  private nextGap(): number {
    const { minBeatGap, maxBeatGap } = this.rules;
    return minBeatGap + Math.floor(this.rng() * (maxBeatGap - minBeatGap + 1));
  }
}

interface Ripple {
  age: number;
  /** Seconds before it starts (staggered featured rings). */
  delay: number;
  strength: number;
}

export interface RippleFrame {
  dt: number;
  features: Readonly<AudioFeatures>;
  playing: boolean;
  palette: ScenePalette;
  reducedMotion: boolean;
  fade: number;
}

const LIFE_S = 2.6;
/** Ellipse ratio: rings read as lying on a water plane seen at an angle. */
const SQUASH = 0.6;
const START_RADIUS = 0.85;
const END_RADIUS = 3.1;

/**
 * Effect B — Water Ripples. A small pool of thin rings expanding behind the
 * walkman, drawn by one quad / one draw call. Rings only exist after a musical
 * moment or a transition; the pool is empty (and the mesh hidden) otherwise.
 */
export class Ripples {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly scheduler = new RippleScheduler();
  private readonly ripples: Ripple[] = [];
  private readonly slots: THREE.Vector3[];
  private max: number;

  constructor(
    private readonly focusRadius: number,
    maxRipples: number,
  ) {
    this.max = Math.min(MAX_RIPPLES, maxRipples);
    this.slots = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3());
    const r = focusRadius;
    const material = new THREE.ShaderMaterial({
      name: 'WaterRipples',
      vertexShader: LOCAL_QUAD_VERTEX,
      fragmentShader: RIPPLE_FRAGMENT,
      defines: { MAX_RIPPLES },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uRipples: { value: this.slots },
        uCount: { value: 0 },
        uSquash: { value: SQUASH },
        uPixelRatio: { value: 1 },
        uFade: { value: 1 },
      },
    });
    const extent = END_RADIUS * 2.15 * r;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent * SQUASH), material);
    this.mesh.name = 'visuals:ripples';
    this.mesh.position.set(0, 0, -1.3 * r);
    this.mesh.rotation.z = PRESENTATION_ANGLE;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  setMax(maxRipples: number): void {
    this.max = Math.min(MAX_RIPPLES, maxRipples);
    if (this.ripples.length > this.max) this.ripples.splice(0, this.ripples.length - this.max);
  }

  setPixelRatio(pixelRatio: number): void {
    this.mesh.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  /** Queues a ring; when the pool is full the oldest ring gives way. */
  emit(strength: number, delay = 0): void {
    if (this.ripples.length >= this.max) this.ripples.shift();
    this.ripples.push({ age: 0, delay, strength });
  }

  update(frame: RippleFrame): void {
    const { dt, reducedMotion } = frame;
    const musical = this.scheduler.step(dt, frame.features, frame.playing);
    // Reduced motion: no expanding rings at all.
    if (reducedMotion) this.ripples.length = 0;
    else if (musical) this.emit(0.55 + 0.35 * frame.features.kick);

    let count = 0;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i];
      if (ripple.delay > 0) {
        ripple.delay -= dt;
        continue;
      }
      ripple.age += dt;
      if (ripple.age >= LIFE_S) this.ripples.splice(i, 1);
    }
    for (const ripple of this.ripples) {
      if (ripple.delay > 0 || count >= MAX_RIPPLES) continue;
      const t = ripple.age / LIFE_S;
      const eased = 1 - (1 - t) ** 3;
      const radius = (START_RADIUS + (END_RADIUS - START_RADIUS) * eased) * this.focusRadius;
      const fadeIn = Math.min(1, ripple.age / 0.12);
      const alpha = ripple.strength * 0.5 * fadeIn * (1 - t) ** 1.6;
      this.slots[count].set(radius, alpha, 0);
      count += 1;
    }

    const u = this.mesh.material.uniforms;
    u.uCount.value = count;
    u.uColor.value.copy(frame.palette.rippleColor);
    u.uFade.value = frame.fade;
    this.mesh.visible = count > 0 && frame.fade > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
