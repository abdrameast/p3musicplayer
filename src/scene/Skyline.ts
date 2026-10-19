import * as THREE from 'three';
import { createRng, range } from './random';
import type { Rng } from './random';

/**
 * Procedural silhouettes of a fictional Japanese city at night. Each layer is
 * merged into ONE flat-shaded geometry (one draw call) in "layer units":
 * 1 unit = the visible height at the layer's depth, y = 0 = bottom of frame.
 * Element types are encoded per vertex (aKind) for the skyline shader.
 */
export const SKYLINE_KIND = {
  body: 0,
  window: 1,
  signLine: 2,
  signPanel: 3,
  rim: 4,
} as const;

type Kind = (typeof SKYLINE_KIND)[keyof typeof SKYLINE_KIND];

/** Buildings extend below the frame so breathing/parallax never reveal a gap. */
const BASE_Y = -0.22;
/** Details sit a hair in front of bodies (no reliance on draw order for depth). */
const DETAIL_Z = 0.0004;
const RIM = 0.0016;
/** Windows that never toggle (phase chosen below the shader's toggle threshold). */
const STEADY_PHASE = 0.05;

export interface SkylineLayerSpec {
  seed: number;
  /** Half width in layer units; ±2.6 covers ultrawide aspect ratios plus parallax. */
  halfSpan: number;
  height: readonly [number, number];
  width: readonly [number, number];
  windows: { density: number; w: number; h: number; pitchX: number; pitchY: number };
  setbacks: number;
  tanks: number;
  huts: number;
  antennas: number;
  signs: number;
  /** Utility poles with sagging cables between them. */
  poles: boolean;
  /** Thin lit rooftop edge. */
  rims: boolean;
  /** 0..1 — lowers buildings around x = 0 so the hanging strap stays readable. */
  centreDip: number;
}

class SilhouetteBuilder {
  private readonly positions: number[] = [];
  private readonly kinds: number[] = [];
  private readonly phases: number[] = [];
  private readonly indices: number[] = [];

  rect(x0: number, y0: number, x1: number, y1: number, kind: Kind, phase = 0): void {
    this.quad(x0, y0, x1, y0, x1, y1, x0, y1, kind, phase);
  }

  /** Quad from four corners (counter-clockwise). */
  quad(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
    kind: Kind, phase = 0,
  ): void {
    const z = kind === SKYLINE_KIND.body ? 0 : DETAIL_Z;
    const base = this.positions.length / 3;
    this.positions.push(ax, ay, z, bx, by, z, cx, cy, z, dx, dy, z);
    for (let i = 0; i < 4; i++) {
      this.kinds.push(kind);
      this.phases.push(phase);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Thin polyline as one quad per segment (cables, bracing). */
  polyline(points: readonly (readonly [number, number])[], width: number, kind: Kind): void {
    const half = width / 2;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = (-(y1 - y0) / len) * half;
      const ny = ((x1 - x0) / len) * half;
      this.quad(x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, x0 + nx, y0 + ny, kind);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kinds, 1));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phases, 1));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function envelope(x: number, spec: SkylineLayerSpec, phase: number): number {
  const clusters = (0.5 + 0.5 * Math.sin(x * 2.3 + phase)) * (0.6 + 0.4 * Math.sin(x * 5.1 + phase * 1.7));
  const dip = 1 - spec.centreDip * Math.exp(-((x / 0.38) ** 2));
  return (0.55 + 0.45 * clusters) * dip;
}

function addWindows(b: SilhouetteBuilder, rng: Rng, spec: SkylineLayerSpec, x0: number, x1: number, top: number): void {
  const { density, w, h, pitchX, pitchY } = spec.windows;
  if (density <= 0) return;
  const margin = pitchX * 0.6;
  const cols = Math.floor((x1 - x0 - margin * 2 + (pitchX - w)) / pitchX);
  const rows = Math.floor((top - 0.012 - pitchY) / pitchY);
  if (cols < 1 || rows < 1) return;
  const startX = x0 + (x1 - x0 - (cols * pitchX - (pitchX - w))) / 2;
  for (let r = 0; r < rows; r++) {
    // Whole floors are dark more often than not — lit windows come in runs.
    const floorLit = rng() < 0.45;
    for (let c = 0; c < cols; c++) {
      const chance = floorLit ? density * 2.2 : density * 0.35;
      if (rng() >= chance) continue;
      const wx = startX + c * pitchX;
      const wy = top - 0.012 - (r + 1) * pitchY;
      b.rect(wx, wy, wx + w, wy + h, SKYLINE_KIND.window, rng());
    }
  }
}

function addWaterTank(b: SilhouetteBuilder, rng: Rng, cx: number, roof: number): void {
  const size = range(rng, 0.012, 0.02);
  const legs = size * 0.45;
  const leg = Math.max(0.0012, size * 0.09);
  b.rect(cx - size * 0.38, roof - 0.001, cx - size * 0.38 + leg, roof + legs, SKYLINE_KIND.body);
  b.rect(cx + size * 0.38 - leg, roof - 0.001, cx + size * 0.38, roof + legs, SKYLINE_KIND.body);
  const bodyTop = roof + legs + size * 0.62;
  b.rect(cx - size / 2, roof + legs, cx + size / 2, bodyTop, SKYLINE_KIND.body);
  // Conical cap.
  b.quad(cx - size / 2, bodyTop, cx + size / 2, bodyTop, cx + size * 0.12, bodyTop + size * 0.22, cx - size * 0.12, bodyTop + size * 0.22, SKYLINE_KIND.body);
}

function addAntenna(b: SilhouetteBuilder, rng: Rng, x: number, roof: number): void {
  const height = range(rng, 0.025, 0.07);
  const mast = 0.0014;
  b.rect(x - mast / 2, roof - 0.001, x + mast / 2, roof + height, SKYLINE_KIND.body);
  const bars = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < bars; i++) {
    const y = roof + height * (0.62 + i * 0.13);
    const half = range(rng, 0.004, 0.01) * (1 - i * 0.25);
    b.rect(x - half, y, x + half, y + 0.0011, SKYLINE_KIND.body);
  }
}

function addSignPanel(b: SilhouetteBuilder, rng: Rng, x0: number, x1: number, top: number): void {
  if (rng() < 0.6) {
    // Vertical blade sign protruding from a facade.
    const w = range(rng, 0.011, 0.017);
    const h = Math.min(top * 0.55, range(rng, 0.035, 0.075));
    const y0 = top - 0.012 - h;
    if (y0 < 0.01) return;
    const right = rng() < 0.5;
    const sx0 = right ? x1 - 0.002 : x0 - w + 0.002;
    b.rect(sx0, y0, sx0 + w, y0 + h, SKYLINE_KIND.signPanel);
    const line = 0.0011;
    b.rect(sx0 + w * 0.22, y0 + h * 0.1, sx0 + w * 0.22 + line, y0 + h * 0.9, SKYLINE_KIND.signLine);
    b.rect(sx0 + w * 0.22, y0 + h * 0.9 - line, sx0 + w * 0.8, y0 + h * 0.9, SKYLINE_KIND.signLine);
  } else {
    // Blank rooftop billboard on two legs, a single cyan rule along its base.
    const w = Math.min(x1 - x0, range(rng, 0.035, 0.07));
    const cx = (x0 + x1) / 2 + range(rng, -0.2, 0.2) * (x1 - x0 - w);
    const legH = range(rng, 0.006, 0.012);
    const h = range(rng, 0.014, 0.022);
    b.rect(cx - w * 0.35, top - 0.001, cx - w * 0.35 + 0.0014, top + legH, SKYLINE_KIND.body);
    b.rect(cx + w * 0.35 - 0.0014, top - 0.001, cx + w * 0.35, top + legH, SKYLINE_KIND.body);
    b.rect(cx - w / 2, top + legH, cx + w / 2, top + legH + h, SKYLINE_KIND.signPanel);
    b.rect(cx - w / 2, top + legH + h * 0.16, cx + w / 2, top + legH + h * 0.16 + 0.0011, SKYLINE_KIND.signLine);
  }
}

function addPolesAndCables(b: SilhouetteBuilder, rng: Rng, spec: SkylineLayerSpec): void {
  const poles: { x: number; top: number }[] = [];
  for (let x = -spec.halfSpan + range(rng, 0, 0.2); x < spec.halfSpan; x += range(rng, 0.3, 0.46)) {
    poles.push({ x, top: range(rng, 0.17, 0.215) });
  }
  for (const pole of poles) {
    const w = 0.0034;
    b.rect(pole.x - w / 2, BASE_Y, pole.x + w / 2, pole.top, SKYLINE_KIND.body);
    b.rect(pole.x - 0.015, pole.top - 0.009, pole.x + 0.015, pole.top - 0.0065, SKYLINE_KIND.body);
    b.rect(pole.x - 0.011, pole.top - 0.024, pole.x + 0.011, pole.top - 0.0215, SKYLINE_KIND.body);
    // Transformer drum on some poles.
    if (rng() < 0.35) b.rect(pole.x + 0.002, pole.top - 0.05, pole.x + 0.0085, pole.top - 0.036, SKYLINE_KIND.body);
  }
  const attach = [
    { dx: -0.013, dy: -0.009 },
    { dx: 0.013, dy: -0.009 },
    { dx: 0.009, dy: -0.024 },
  ];
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i];
    const c = poles[i + 1];
    for (const point of attach) {
      const sag = range(rng, 0.012, 0.03);
      const x0 = a.x + point.dx;
      const x1 = c.x + point.dx;
      const y0 = a.top + point.dy;
      const y1 = c.top + point.dy;
      const pts: [number, number][] = [];
      const steps = 16;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // Parabolic approximation of a catenary.
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t)]);
      }
      b.polyline(pts, 0.0012, SKYLINE_KIND.body);
    }
  }
}

export function buildSkylineLayer(spec: SkylineLayerSpec): THREE.BufferGeometry {
  const rng = createRng(spec.seed);
  const b = new SilhouetteBuilder();
  const phase = rng() * Math.PI * 2;
  let x = -spec.halfSpan;
  while (x < spec.halfSpan) {
    const w = range(rng, spec.width[0], spec.width[1]);
    if (rng() < 0.07) {
      x += w * 0.35;
      continue;
    }
    const h = Math.max(spec.height[0], (spec.height[0] + (spec.height[1] - spec.height[0]) * rng() ** 1.5) * envelope(x, spec, phase));
    const x0 = x;
    const x1 = x + w;
    b.rect(x0, BASE_Y, x1, h, SKYLINE_KIND.body);

    let roof = h;
    let roofX0 = x0;
    let roofX1 = x1;
    if (h > 0.07 && rng() < spec.setbacks) {
      roofX0 = x0 + w * range(rng, 0.1, 0.28);
      roofX1 = x1 - w * range(rng, 0.05, 0.28);
      roof = h + h * range(rng, 0.07, 0.18);
      b.rect(roofX0, h - 0.001, roofX1, roof, SKYLINE_KIND.body);
    }
    if (spec.rims) b.rect(roofX0, roof - RIM, roofX1, roof, SKYLINE_KIND.rim);
    addWindows(b, rng, spec, x0, x1, h);

    const roll = rng();
    if (roll < spec.tanks) addWaterTank(b, rng, range(rng, roofX0 + 0.012, Math.max(roofX0 + 0.013, roofX1 - 0.012)), roof);
    else if (roll < spec.tanks + spec.huts) {
      const hw = (roofX1 - roofX0) * range(rng, 0.15, 0.3);
      const hx = range(rng, roofX0, roofX1 - hw);
      b.rect(hx, roof - 0.001, hx + hw, roof + range(rng, 0.008, 0.016), SKYLINE_KIND.body);
    }
    if (rng() < spec.antennas) addAntenna(b, rng, range(rng, roofX0 + 0.004, roofX1 - 0.004), roof);
    if (rng() < spec.signs) addSignPanel(b, rng, x0, x1, h);

    x = x1 + (rng() < 0.25 ? range(rng, 0.003, 0.02) : -range(rng, 0, w * 0.15));
  }
  if (spec.poles) addPolesAndCables(b, rng, spec);
  return b.build();
}

/**
 * A single fictional broadcast tower (distant layer): splayed legs, tapering
 * shaft, two decks, needle with a cyan beacon. Local origin at its base centre.
 */
export function buildTower(): THREE.BufferGeometry {
  const b = new SilhouetteBuilder();
  const body = SKYLINE_KIND.body;
  b.quad(-0.034, BASE_Y, 0.034, BASE_Y, 0.012, 0.34, -0.012, 0.34, body);
  // Splayed legs.
  b.quad(-0.06, BASE_Y, -0.044, BASE_Y, -0.016, 0.12, -0.024, 0.12, body);
  b.quad(0.044, BASE_Y, 0.06, BASE_Y, 0.024, 0.12, 0.016, 0.12, body);
  // Lattice hints, lighter than the silhouette.
  for (const [ya, yb, xa, xb] of [
    [0.02, 0.12, 0.028, 0.022],
    [0.12, 0.22, 0.022, 0.018],
    [0.22, 0.32, 0.018, 0.013],
  ] as const) {
    b.polyline([[-xa, ya], [xb, yb]], 0.0012, SKYLINE_KIND.rim);
    b.polyline([[xa, ya], [-xb, yb]], 0.0012, SKYLINE_KIND.rim);
  }
  b.rect(-0.026, 0.34, 0.026, 0.366, body);
  b.rect(-0.022, 0.351, 0.022, 0.355, SKYLINE_KIND.window, STEADY_PHASE);
  b.quad(-0.009, 0.366, 0.009, 0.366, 0.005, 0.49, -0.005, 0.49, body);
  b.rect(-0.012, 0.49, 0.012, 0.503, body);
  b.rect(-0.009, 0.495, 0.009, 0.4975, SKYLINE_KIND.window, STEADY_PHASE);
  b.quad(-0.0028, 0.503, 0.0028, 0.503, 0.0008, 0.635, -0.0008, 0.635, body);
  b.rect(-0.0022, 0.62, 0.0022, 0.626, SKYLINE_KIND.signLine);
  return b.build();
}
