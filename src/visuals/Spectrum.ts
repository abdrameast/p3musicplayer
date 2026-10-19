import * as THREE from 'three';
import type { AudioFeatures } from '../core/types';
import { PRESENTATION_ANGLE } from '../scene/CameraRig';
import type { ScenePalette } from '../scene/Lighting';
import { SPECTRUM_FRAGMENT, SPECTRUM_VERTEX } from '../scene/shaders/effects';

export interface SpectrumFrame {
  dt: number;
  features: Readonly<AudioFeatures>;
  playing: boolean;
  palette: ScenePalette;
  energy: number;
  reducedMotion: boolean;
  fade: number;
}

/**
 * The arc is a portion of an ellipse hugging the capsule (major axis along
 * the body), on its lower-right side — deliberately incomplete (~132°).
 */
const SEMI_MAJOR = 1.28;
const SEMI_MINOR = 0.62;
const ARC_START = -Math.PI + 0.42;
const ARC_END = -0.42;
const GAP = 0.03;
const MIN_HEIGHT = 0.028;
const MAX_HEIGHT = 0.34;
const BAR_FILL = 0.42;
const SWEEP_S = 0.95;

/**
 * Effect C — Spectral Arc. N thin bars (QUALITY.spectrumSegments, one
 * InstancedMesh) rising from a partial elliptical arc close to the walkman.
 * The arc is symmetric: low frequencies in its middle, highs at both ends, so
 * the composition stays balanced under the object.
 */
export class Spectrum {
  readonly group = new THREE.Group();
  private bars!: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private baseline!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly material: THREE.ShaderMaterial;
  private values = new Float32Array(0);
  private valueAttr!: THREE.InstancedBufferAttribute;
  /** Per bar: base position, outward normal angle, width. */
  private layout = new Float32Array(0);
  private sweepT = 1;
  private sweepStrength = 0;

  constructor(
    private readonly focusRadius: number,
    segments: number,
  ) {
    this.group.name = 'visuals:spectrum';
    this.group.rotation.z = PRESENTATION_ANGLE;
    this.group.position.z = -0.35 * focusRadius;
    this.material = new THREE.ShaderMaterial({
      name: 'SpectralArc',
      vertexShader: SPECTRUM_VERTEX,
      fragmentShader: SPECTRUM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uSweep: { value: -1 },
        uSweepStrength: { value: 0 },
      },
    });
    this.build(segments);
  }

  setSegments(segments: number): void {
    if (segments === this.values.length) return;
    this.disposeMeshes();
    this.build(segments);
  }

  /** Featured transition: a light runs along the arc once. */
  sweep(strength: number): void {
    this.sweepT = 0;
    this.sweepStrength = strength;
  }

  update(frame: SpectrumFrame): void {
    const { dt, features, reducedMotion } = frame;
    const spectrum = features.spectrum;
    const bins = spectrum.length;
    const n = this.values.length;
    const attack = reducedMotion ? 3 : 20;
    const release = reducedMotion ? 1.5 : 6;
    const half = (n - 1) / 2;
    const r = this.focusRadius;
    const elements = this.bars.instanceMatrix.array as Float32Array;
    const amplitude = (0.7 + 0.3 * frame.energy) * (reducedMotion ? 0.6 : 1);

    for (let i = 0; i < n; i++) {
      // Symmetric, log-ish: centre = lowest bins, ends = highs.
      const t = Math.abs(i - half) / Math.max(1, half);
      let target = 0;
      if (bins > 0 && frame.playing) {
        const pos = t ** 1.35 * (bins - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(bins - 1, i0 + 1);
        const raw = spectrum[i0] + (spectrum[i1] - spectrum[i0]) * (pos - i0);
        target = Math.min(1, Math.max(0, raw)) ** 0.75;
      }
      const current = this.values[i];
      const rate = target > current ? attack : release;
      const value = current + (target - current) * (1 - Math.exp(-rate * dt));
      this.values[i] = value;

      const o = i * 4;
      const height = (MIN_HEIGHT + MAX_HEIGHT * value * amplitude) * r;
      const angle = this.layout[o + 2];
      const width = this.layout[o + 3];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Column-major 2D rotation (+Y → outward normal) with scale (width, height).
      const m = i * 16;
      elements[m] = c * width;
      elements[m + 1] = s * width;
      elements[m + 4] = -s * height;
      elements[m + 5] = c * height;
      elements[m + 12] = this.layout[o];
      elements[m + 13] = this.layout[o + 1];
    }
    this.bars.instanceMatrix.needsUpdate = true;
    (this.valueAttr.array as Float32Array).set(this.values);
    this.valueAttr.needsUpdate = true;

    if (this.sweepT < 1) this.sweepT = Math.min(1, this.sweepT + dt / SWEEP_S);
    const u = this.material.uniforms;
    u.uColor.value.copy(frame.palette.spectrumColor);
    u.uOpacity.value = 0.34 * frame.fade;
    u.uSweep.value = this.sweepT < 1 ? this.sweepT * 1.2 - 0.1 : -1;
    u.uSweepStrength.value = this.sweepT < 1 && !reducedMotion ? this.sweepStrength * Math.sin(Math.PI * this.sweepT) : 0;

    const line = this.baseline.material;
    line.color.copy(frame.palette.spectrumColor);
    line.opacity = 0.26 * frame.fade;
  }

  dispose(): void {
    this.disposeMeshes();
    this.material.dispose();
  }

  private build(segments: number): void {
    const n = Math.max(2, Math.round(segments));
    const r = this.focusRadius;
    const a = SEMI_MAJOR * r;
    const b = SEMI_MINOR * r;
    this.values = new Float32Array(n);
    this.layout = new Float32Array(n * 4);
    const params = new Float32Array(n);
    const step = (ARC_END - ARC_START) / (n - 1);

    for (let i = 0; i < n; i++) {
      const phi = ARC_START + step * i;
      const nx = b * Math.cos(phi);
      const ny = a * Math.sin(phi);
      const len = Math.hypot(nx, ny);
      const ux = nx / len;
      const uy = ny / len;
      const o = i * 4;
      this.layout[o] = a * Math.cos(phi) + ux * GAP * r;
      this.layout[o + 1] = b * Math.sin(phi) + uy * GAP * r;
      // Rotation that maps +Y to the outward normal.
      this.layout[o + 2] = Math.atan2(uy, ux) - Math.PI / 2;
      // Local arc length between neighbours sets the bar width.
      const speed = Math.hypot(a * Math.sin(phi), b * Math.cos(phi));
      this.layout[o + 3] = Math.max(0.006 * r, speed * step * BAR_FILL);
      params[i] = i / (n - 1);
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);
    this.valueAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.valueAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aValue', this.valueAttr);
    geometry.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 1));

    this.bars = new THREE.InstancedMesh(geometry, this.material, n);
    this.bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 6;
    const elements = this.bars.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      elements[i * 16 + 10] = 1;
      elements[i * 16 + 15] = 1;
    }

    // Thin baseline arc with a short tick at each end ("repères techniques").
    const points: number[] = [];
    const lineSteps = 96;
    const baseOffset = GAP * 0.4 * r;
    const point = (phi: number, extra: number): [number, number] => {
      const nx = b * Math.cos(phi);
      const ny = a * Math.sin(phi);
      const len = Math.hypot(nx, ny);
      return [a * Math.cos(phi) + (nx / len) * (baseOffset + extra), b * Math.sin(phi) + (ny / len) * (baseOffset + extra)];
    };
    for (let s = 0; s < lineSteps; s++) {
      const p0 = point(ARC_START + ((ARC_END - ARC_START) * s) / lineSteps, 0);
      const p1 = point(ARC_START + ((ARC_END - ARC_START) * (s + 1)) / lineSteps, 0);
      points.push(p0[0], p0[1], 0, p1[0], p1[1], 0);
    }
    for (const phi of [ARC_START, ARC_END]) {
      const inner = point(phi, -0.05 * r);
      const outer = point(phi, 0.09 * r);
      points.push(inner[0], inner[1], 0, outer[0], outer[1], 0);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.baseline = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    this.baseline.renderOrder = 6;
    this.group.add(this.bars, this.baseline);
  }

  private disposeMeshes(): void {
    this.group.remove(this.bars, this.baseline);
    this.bars.geometry.dispose();
    this.bars.dispose();
    this.baseline.geometry.dispose();
    this.baseline.material.dispose();
  }
}
