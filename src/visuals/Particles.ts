import * as THREE from 'three';
import { MODES } from '../config/config';
import type { AudioFeatures } from '../core/types';
import type { VisibleRect } from '../scene/CameraRig';
import type { ScenePalette } from '../scene/Lighting';
import { createRng, range } from '../scene/random';
import type { Rng } from '../scene/random';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from '../scene/shaders/effects';

export interface ParticleFrame {
  dt: number;
  time: number;
  features: Readonly<AudioFeatures>;
  palette: ScenePalette;
  energy: number;
  reducedMotion: boolean;
  fade: number;
}

/** Visible area at a depth — supplied by the camera rig. */
export type BoundsAt = (z: number, out: VisibleRect) => VisibleRect;

/** Capacity covers the densest mode so a mode blend never reallocates. */
const MAX_DENSITY = Math.max(...Object.values(MODES).map((m) => m.particleDensity));
/** Share of particles allowed in front of the walkman (small and sparse). */
const FRONT_SHARE = 0.07;
const BUBBLE_SHARE = 0.16;

/**
 * Effect E — Floating Memory. Soft discs and thin bubbles drifting in a
 * divergence-free flow (curl of a moving stream function) while rising at the
 * mode's particleRise, each fading in and out over its lifetime. Mostly behind
 * the walkman; a few small ones float in front. The level of the music only
 * nudges speed and brightness. CPU-simulated, one InstancedMesh.
 */
export class Particles {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;
  private scattered = false;
  private readonly rng: Rng = createRng(0x9a271c);
  private readonly rect: VisibleRect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private capacity = 0;
  private baseCount: number;
  private level = 0;
  // Struct-of-arrays state.
  private pos = new Float32Array(0);
  private size = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private alpha = new Float32Array(0);
  private seed = new Float32Array(0);
  private alive = new Uint8Array(0);
  private alphaAttr!: THREE.InstancedBufferAttribute;

  constructor(
    private readonly focusRadius: number,
    baseCount: number,
    private readonly boundsAt: BoundsAt,
  ) {
    this.baseCount = baseCount;
    this.material = new THREE.ShaderMaterial({
      name: 'FloatingMemory',
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
      },
    });
    this.mesh = this.createMesh();
    this.group.add(this.mesh);
  }

  /** Quality change: rebuilds the pool; the new particles fade in. */
  setBaseCount(count: number): void {
    if (count === this.baseCount) return;
    this.baseCount = count;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.mesh = this.createMesh();
    this.group.add(this.mesh);
  }

  /** Framing changed: particles left outside the new viewport are re-seeded inside it. */
  relayout(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const p = i * 3;
      const b = this.boundsAt(this.pos[p + 2], this.rect);
      const x = this.pos[p];
      const y = this.pos[p + 1];
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) this.spawn(i, true);
    }
  }

  update(frame: ParticleFrame): void {
    const { dt, palette, reducedMotion } = frame;
    const r = this.focusRadius;
    const target = Math.min(this.capacity, Math.round(this.baseCount * palette.particleDensity));
    this.level += (frame.features.level - this.level) * (1 - Math.exp(-3 * dt));
    const speed = (reducedMotion ? 0.25 : 1) * palette.ambientMotion * (0.85 + 0.35 * this.level) * (0.85 + 0.3 * frame.energy);
    const rise = palette.particleRise * r;
    const t = frame.time * (reducedMotion ? 0.25 : 1);
    const flow = 0.07 * r;
    const k1 = 0.55 / r;
    const k2 = 1.3 / r;
    const brightness = (0.42 + 0.3 * this.level) * frame.fade;
    const elements = this.mesh.instanceMatrix.array as Float32Array;
    const alphaOut = this.alphaAttr.array as Float32Array;

    // First frame: fill the field at random life stages instead of a synchronised fade-in.
    const scatter = !this.scattered;
    this.scattered = true;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) {
        if (i < target) this.spawn(i, scatter);
        else {
          alphaOut[i] = 0;
          elements[i * 16] = 0;
          elements[i * 16 + 5] = 0;
          continue;
        }
      }
      const p = i * 3;
      let x = this.pos[p];
      let y = this.pos[p + 1];
      const z = this.pos[p + 2];
      const s = this.seed[i];
      // Velocity = curl of ψ = sin(kx + a t) cos(ky + b t) (two octaves): swirling, never converging.
      const ax = k1 * x + t * 0.11 + s;
      const ay = k1 * y - t * 0.08 + s * 1.7;
      const bx = k2 * x - t * 0.17 + s * 2.3;
      const by = k2 * y + t * 0.13 + s * 0.6;
      const vx = -Math.sin(ax) * Math.sin(ay) - 0.45 * Math.sin(bx) * Math.sin(by);
      const vy = -Math.cos(ax) * Math.cos(ay) - 0.45 * Math.cos(bx) * Math.cos(by);
      x += vx * flow * speed * dt;
      y += (vy * flow * 0.7 + rise) * speed * dt;
      this.pos[p] = x;
      this.pos[p + 1] = y;

      this.age[i] += dt * (reducedMotion ? 0.5 : 1);
      const lifeT = this.age[i] / this.life[i];
      const bounds = this.boundsAt(z, this.rect);
      const out = y > bounds.maxY + r * 0.3 || x < bounds.minX - r || x > bounds.maxX + r;
      if (lifeT >= 1 || out) {
        if (i < target) this.spawn(i, false);
        else this.alive[i] = 0;
        alphaOut[i] = 0;
        continue;
      }
      const fadeIn = Math.min(1, lifeT / 0.15);
      const fadeOut = Math.min(1, (1 - lifeT) / 0.3);
      alphaOut[i] = this.alpha[i] * fadeIn * fadeOut * brightness;

      const m = i * 16;
      elements[m] = this.size[i];
      elements[m + 5] = this.size[i];
      elements[m + 12] = x;
      elements[m + 13] = y;
      elements[m + 14] = z;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.material.uniforms.uColor.value.copy(palette.particleColor);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }

  private createMesh(): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const n = Math.max(1, Math.ceil(this.baseCount * MAX_DENSITY));
    this.capacity = n;
    this.scattered = false;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.alive = new Uint8Array(n);

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    const kinds = new Float32Array(n);
    for (let i = 0; i < n; i++) kinds[i] = this.rng() < BUBBLE_SHARE ? 1 : 0;
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));

    const mesh = new THREE.InstancedMesh(geometry, this.material, n);
    mesh.name = 'visuals:particles';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    const elements = mesh.instanceMatrix.array as Float32Array;
    elements.fill(0);
    for (let i = 0; i < n; i++) {
      elements[i * 16 + 10] = 1;
      elements[i * 16 + 15] = 1;
    }
    return mesh;
  }

  /** `scatter` places it anywhere in its life (initial fill); otherwise it is born now. */
  private spawn(i: number, scatter: boolean): void {
    const r = this.focusRadius;
    const rng = this.rng;
    const front = rng() < FRONT_SHARE;
    // Behind: biased towards the walkman so depth reads; front: just before it.
    const z = front ? range(rng, 0.9, 2.4) * r : -(0.9 + 6.5 * rng() ** 1.6) * r;
    const bounds = this.boundsAt(z, this.rect);
    const p = i * 3;
    this.pos[p] = range(rng, bounds.minX, bounds.maxX);
    this.pos[p + 1] = range(rng, bounds.minY, bounds.maxY);
    this.pos[p + 2] = z;
    const depthScale = front ? 0.55 : 1 + (-z / r) * 0.12;
    this.size[i] = range(rng, 0.018, 0.062) * r * depthScale;
    this.life[i] = range(rng, 7, 16);
    this.age[i] = scatter ? rng() * this.life[i] : 0;
    this.alpha[i] = front ? range(rng, 0.2, 0.45) : range(rng, 0.22, 0.7);
    this.seed[i] = rng() * 100;
    this.alive[i] = 1;
  }
}
