import * as THREE from 'three';
import type { AudioFeatures } from '../core/types';
import { PRESENTATION_ANGLE } from '../scene/CameraRig';
import type { ScenePalette } from '../scene/Lighting';
import { AURA_FRAGMENT, LOCAL_QUAD_VERTEX } from '../scene/shaders/effects';

export interface AuraFrame {
  dt: number;
  time: number;
  features: Readonly<AudioFeatures>;
  palette: ScenePalette;
  energy: number;
  reducedMotion: boolean;
  /** Global visibility (intro reveal × dramatic dip). */
  fade: number;
}

/** One slow breath every ~6.5 s. */
const BREATH_PERIOD_S = 6.5;

/**
 * Effect A — Lunar Pulse. A soft capsule glow just behind the walkman, along
 * its presentation diagonal: always breathing slowly, lifting a little with
 * bass, brightening on kicks and on transition accents. It sits behind the
 * opaque body (depth-tested), so it frames the silhouette without covering it.
 */
export class Aura {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private bass = 0;
  private kick = 0;
  private flash = 0;
  private flashTarget = 0;

  constructor(focusRadius: number) {
    const r = focusRadius;
    const material = new THREE.ShaderMaterial({
      name: 'LunarPulse',
      vertexShader: LOCAL_QUAD_VERTEX,
      fragmentShader: AURA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uStrength: { value: 0 },
        uHalfLength: { value: 0.9 * r },
        uRadius: { value: 0.42 * r },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2 * r, 2.6 * r), material);
    this.mesh.name = 'visuals:aura';
    this.mesh.position.set(0, 0, -0.55 * r);
    this.mesh.rotation.z = PRESENTATION_ANGLE;
    this.mesh.renderOrder = 5;
  }

  /** Transition accent (0..1); decays on its own. */
  accent(strength: number): void {
    this.flashTarget = Math.max(this.flashTarget, strength);
  }

  update(frame: AuraFrame): void {
    const { dt, features, palette, reducedMotion } = frame;
    const follow = (current: number, target: number, up: number, down: number): number =>
      current + (target - current) * (1 - Math.exp(-(target > current ? up : down) * dt));

    this.bass = follow(this.bass, features.bass, 6, 2);
    this.kick = follow(this.kick, reducedMotion ? 0 : features.kick, 18, 4);
    // Reduced motion: accents swell and fade gently — never a flash.
    this.flash = follow(this.flash, this.flashTarget, reducedMotion ? 2.5 : 14, 3);
    this.flashTarget = Math.max(0, this.flashTarget - dt * (reducedMotion ? 0.9 : 2.2));

    const breath = 0.5 + 0.5 * Math.sin((frame.time / BREATH_PERIOD_S) * Math.PI * 2);
    const breathing = reducedMotion ? 0.04 : 0.12;
    const strength =
      palette.auraStrength *
      (0.3 + breathing * breath + 0.12 * this.bass + 0.2 * this.kick + 0.42 * this.flash) *
      (0.75 + 0.25 * frame.energy);

    const u = this.mesh.material.uniforms;
    u.uColor.value.copy(palette.auraColor);
    u.uStrength.value = strength * frame.fade;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
