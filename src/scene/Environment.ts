import * as THREE from 'three';
import { PALETTE } from '../config/config';
import type { QualitySpec } from '../config/config';
import type { CameraRig, ScreenFocus } from './CameraRig';
import type { ScenePalette } from './Lighting';
import { buildSkylineLayer, buildTower } from './Skyline';
import type { SkylineLayerSpec } from './Skyline';
import {
  BACKGROUND_FRAGMENT,
  BACKGROUND_VERTEX,
  SHARD_FRAGMENT,
  SHARD_VERTEX,
  SKYLINE_FRAGMENT,
  SKYLINE_VERTEX,
} from './shaders/environment';

export interface EnvironmentFrame {
  dt: number;
  time: number;
  palette: ScenePalette;
  /** 0..1 dramatic darkening (DARK HOUR transition). */
  dip: number;
  /** Smoothed pointer position −1..1 (zero under reduced motion). */
  parallax: THREE.Vector2;
  reducedMotion: boolean;
  /** Smoothed décor intensity 0..1 (track energy profile). */
  energy: number;
  /** Intro reveal 0..1. */
  reveal: number;
}

type LayerKey = 'far' | 'mid' | 'near';

interface LayerDef {
  /** Depth in multiples of the walkman focus radius (negative = behind). */
  depth: number;
  /** 0 = skylineNear colour, 1 = skylineFar colour. */
  tone: number;
  haze: number;
  windowLevel: number;
  /** Parallax travel, in layer units per unit of pointer offset. */
  parallax: number;
  spec: SkylineLayerSpec;
}

const SPAN = 2.6;

const LAYERS: Readonly<Record<LayerKey, LayerDef>> = {
  far: {
    depth: -18,
    tone: 1,
    haze: 0.55,
    windowLevel: 0.55,
    parallax: 0.004,
    spec: {
      seed: 0x5eed01,
      halfSpan: SPAN,
      height: [0.08, 0.27],
      width: [0.028, 0.08],
      windows: { density: 0.025, w: 0.0035, h: 0.0045, pitchX: 0.008, pitchY: 0.011 },
      setbacks: 0.35,
      tanks: 0,
      huts: 0.2,
      antennas: 0.18,
      signs: 0,
      poles: false,
      rims: false,
      centreDip: 0.25,
    },
  },
  mid: {
    depth: -11,
    tone: 0.5,
    haze: 0.32,
    windowLevel: 0.8,
    parallax: 0.007,
    spec: {
      seed: 0x5eed02,
      halfSpan: SPAN,
      height: [0.06, 0.2],
      width: [0.04, 0.11],
      windows: { density: 0.05, w: 0.005, h: 0.0065, pitchX: 0.011, pitchY: 0.015 },
      setbacks: 0.3,
      tanks: 0.3,
      huts: 0.25,
      antennas: 0.25,
      signs: 0.28,
      poles: false,
      rims: false,
      centreDip: 0.35,
    },
  },
  near: {
    depth: -6,
    tone: 0,
    haze: 0.12,
    windowLevel: 1,
    parallax: 0.012,
    spec: {
      seed: 0x5eed03,
      halfSpan: SPAN,
      height: [0.03, 0.13],
      width: [0.06, 0.16],
      windows: { density: 0.04, w: 0.0065, h: 0.0085, pitchX: 0.015, pitchY: 0.02 },
      setbacks: 0.2,
      tanks: 0.35,
      huts: 0.25,
      antennas: 0.3,
      signs: 0.22,
      poles: true,
      rims: true,
      centreDip: 0.4,
    },
  },
};

/** Which layers survive at each QUALITY.skylineLayers count (near always stays). */
const LAYERS_BY_COUNT: Readonly<Record<number, readonly LayerKey[]>> = {
  1: ['near'],
  2: ['far', 'near'],
  3: ['far', 'mid', 'near'],
};

const SHARD_DEPTH = -26;

interface ShardDef {
  /** Centre, normalised to the visible rect (0..1). */
  u: number;
  v: number;
  /** Height / width in visible heights. */
  height: number;
  width: number;
  alpha: number;
}

/** Large slanted white forms à la P3R menus, partly off-frame. */
const SHARDS: readonly ShardDef[] = [
  { u: 0.07, v: 0.64, height: 1.3, width: 0.2, alpha: 1 },
  { u: 0.97, v: 0.2, height: 0.95, width: 0.12, alpha: 0.8 },
  { u: 0.24, v: 0.98, height: 0.55, width: 0.035, alpha: 1.2 },
];
const SHARD_SLANT = 0.42;
/** Thin guide lines parallel to the shards: [u, v] start in the visible rect, length in heights. */
const GUIDE_LINES: readonly (readonly [number, number, number])[] = [
  [0.02, 0.08, 1.4],
  [0.86, -0.05, 1.1],
];

/** Moon radius as a share of the mean viewport side. */
const MOON_SIZE = 0.105;
/** Extra clearance between the moon disc and the walkman's projected capsule. */
const KEEP_OUT_MARGIN_PX = 14;

interface SkylineLayer {
  key: LayerKey;
  def: LayerDef;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  tower: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  base: THREE.Vector3;
  scale: number;
}

const ink = new THREE.Color(PALETTE.ink);

function backgroundDefines(spec: QualitySpec): Record<string, number> {
  return {
    CAUSTICS: spec.caustics ? 1 : 0,
    GOD_RAYS: spec.godRays ? 1 : 0,
    // backgroundScale lowers the cost of the secondary shader detail.
    CAUSTIC_OCTAVES: spec.backgroundScale >= 1 ? 2 : 1,
  };
}

/**
 * The Dark Hour world: deep gradient, cropped moon and its light fragments,
 * water-ceiling caustics and god rays (one full-screen pass), several skyline
 * parallax layers, and far white shards. Everything is procedural with fixed
 * seeds; colours come from the blended mode palette every frame.
 */
export class Environment {
  readonly group = new THREE.Group();
  private readonly background: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly skylineMaterialProto: THREE.ShaderMaterial;
  private readonly shardMaterial: THREE.ShaderMaterial;
  private shards: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private layers: SkylineLayer[] = [];
  private spec: QualitySpec;
  private flow = 0;
  private rig: CameraRig | null = null;
  private focus: ScreenFocus = { x: 0, y: 0, radius: 1, angle: 0 };
  private pixelRatio = 1;
  private readonly rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  /** Visible height at the shard depth (parallax travel reference). */
  private shardPlaneHeight = 1;
  private readonly tmpColor = new THREE.Color();

  constructor(
    quality: QualitySpec,
    private readonly focusRadius: number,
  ) {
    this.spec = quality;

    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backgroundMaterial = new THREE.ShaderMaterial({
      name: 'DarkHourBackground',
      vertexShader: BACKGROUND_VERTEX,
      fragmentShader: BACKGROUND_FRAGMENT,
      defines: backgroundDefines(quality),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uSkyTop: { value: new THREE.Color() },
        uSkyMid: { value: new THREE.Color() },
        uSkyBottom: { value: new THREE.Color() },
        uInk: { value: ink.clone() },
        uMoonColor: { value: new THREE.Color() },
        uMoonIntensity: { value: 1 },
        uMoon: { value: new THREE.Vector3(0, 0, 100) },
        uHaloColor: { value: new THREE.Color() },
        uFrameAngle: { value: 0 },
        uCausticColor: { value: new THREE.Color() },
        uCausticIntensity: { value: 0 },
        uGodRays: { value: 0 },
        uFade: { value: 0 },
        uDim: { value: 1 },
      },
    });
    this.background = new THREE.Mesh(triangle, backgroundMaterial);
    this.background.name = 'environment:background';
    this.background.frustumCulled = false;
    this.background.renderOrder = -1000;
    this.group.add(this.background);

    this.skylineMaterialProto = new THREE.ShaderMaterial({
      name: 'Skyline',
      vertexShader: SKYLINE_VERTEX,
      fragmentShader: SKYLINE_FRAGMENT,
      side: THREE.DoubleSide,
      uniforms: {
        uBody: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uHaze: { value: 0 },
        uWindow: { value: new THREE.Color() },
        uWindowLevel: { value: 1 },
        uSign: { value: new THREE.Color() },
        uRim: { value: new THREE.Color() },
        uInk: { value: ink.clone() },
        uTime: { value: 0 },
        uFade: { value: 0 },
        uDim: { value: 1 },
      },
    });

    this.shardMaterial = new THREE.ShaderMaterial({
      name: 'WhiteShards',
      vertexShader: SHARD_VERTEX,
      fragmentShader: SHARD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.white) },
        uLine: { value: new THREE.Color(PALETTE.cyan) },
        uOpacity: { value: 0.06 },
        uFade: { value: 0 },
      },
    });
    this.shards = new THREE.Mesh(new THREE.BufferGeometry(), this.shardMaterial);
    this.shards.name = 'environment:shards';
    this.shards.renderOrder = 1;
    this.group.add(this.shards);

    this.buildLayers();
  }

  setQuality(spec: QualitySpec): void {
    const layersChanged = spec.skylineLayers !== this.spec.skylineLayers;
    this.spec = spec;
    const material = this.background.material;
    material.defines = backgroundDefines(spec);
    material.needsUpdate = true;
    if (layersChanged) {
      this.buildLayers();
      if (this.rig) this.layout(this.rig, this.pixelRatio);
    }
  }

  /** Re-anchors every depth plane to the current framing (resize / hero move). */
  layout(rig: CameraRig, pixelRatio: number): void {
    this.rig = rig;
    this.pixelRatio = pixelRatio;
    this.focus = rig.getScreenFocus();
    const w = rig.viewportWidth;
    const h = rig.viewportHeight;
    const uniforms = this.background.material.uniforms;
    uniforms.uResolution.value.set(Math.round(w * pixelRatio), Math.round(h * pixelRatio));
    uniforms.uPixelRatio.value = pixelRatio;

    const aspect = w / h;
    for (const layer of this.layers) {
      const z = layer.def.depth * this.focusRadius;
      const rect = rig.visibleRectAt(z, this.rect);
      layer.scale = rect.maxY - rect.minY;
      layer.base.set((rect.minX + rect.maxX) / 2, rect.minY, z);
      layer.group.scale.setScalar(layer.scale);
      layer.group.position.copy(layer.base);
      if (layer.tower) {
        // Off the walkman column: left third on landscape, right side on portrait.
        layer.tower.position.x = aspect >= 1 ? -(aspect / 2) * 0.6 : (aspect / 2) * 0.62;
      }
    }
    this.layoutShards(rig);
  }

  update(frame: EnvironmentFrame): void {
    const { palette, reducedMotion } = frame;
    const motion = reducedMotion ? 0.3 : 1;
    this.flow += frame.dt * motion * palette.ambientMotion * (0.8 + 0.3 * frame.energy);

    const revealSky = THREE.MathUtils.smoothstep(frame.reveal, 0, 0.6);
    const revealCity = THREE.MathUtils.smoothstep(frame.reveal, 0.2, 0.85);
    const dim = 1 - frame.dip;

    const u = this.background.material.uniforms;
    u.uTime.value = frame.time;
    u.uFlow.value = this.flow;
    u.uSkyTop.value.copy(palette.skyTop);
    u.uSkyMid.value.copy(palette.skyMid);
    u.uSkyBottom.value.copy(palette.skyBottom);
    u.uMoonColor.value.copy(palette.moonColor);
    u.uMoonIntensity.value = palette.moonIntensity;
    u.uHaloColor.value.copy(palette.haloColor);
    u.uCausticColor.value.copy(palette.causticColor);
    u.uCausticIntensity.value = palette.causticIntensity;
    u.uGodRays.value = palette.godRays;
    u.uFade.value = revealSky;
    u.uDim.value = dim;
    this.placeMoon(palette, frame.parallax);

    for (const layer of this.layers) {
      const lu = layer.mesh.material.uniforms;
      lu.uBody.value.copy(palette.skylineNear).lerp(palette.skylineFar, layer.def.tone);
      lu.uFog.value.copy(palette.fog);
      lu.uHaze.value = layer.def.haze;
      lu.uWindow.value.copy(palette.windowLight);
      lu.uWindowLevel.value = layer.def.windowLevel;
      lu.uSign.value.copy(palette.haloColor);
      lu.uRim.value.copy(palette.haloColor);
      lu.uTime.value = frame.time;
      lu.uFade.value = revealCity;
      lu.uDim.value = dim;
      const travel = layer.def.parallax * layer.scale;
      layer.group.position.set(
        layer.base.x - frame.parallax.x * travel,
        layer.base.y - frame.parallax.y * travel * 0.4,
        layer.base.z,
      );
    }

    const su = this.shardMaterial.uniforms;
    su.uColor.value.copy(this.tmpColor.set(PALETTE.white)).lerp(palette.causticColor, 0.25);
    su.uLine.value.copy(palette.haloColor);
    su.uFade.value = revealCity * dim;
    const shardTravel = 0.003 * this.shardPlaneHeight;
    this.shards.position.set(-frame.parallax.x * shardTravel, -frame.parallax.y * shardTravel * 0.4, 0);
  }

  dispose(): void {
    this.disposeLayers();
    this.background.geometry.dispose();
    this.background.material.dispose();
    this.shards.geometry.dispose();
    this.shardMaterial.dispose();
    this.skylineMaterialProto.dispose();
    this.group.clear();
  }

  /**
   * Moon at the palette position, pushed out of a capsule around the
   * walkman's projected diagonal so it is never behind the silhouette (it may
   * end up cropped by the viewport edge — intended).
   */
  private placeMoon(palette: ScenePalette, parallax: THREE.Vector2): void {
    const rig = this.rig;
    if (!rig) return;
    const w = rig.viewportWidth;
    const h = rig.viewportHeight;
    const radius = MOON_SIZE * (w + h) * 0.5 * (w < h ? 0.85 : 1);
    // Canvas CSS px, y down.
    let mx = palette.moonPosition.x * w - parallax.x * 6;
    let my = (1 - palette.moonPosition.y) * h - parallax.y * 3;

    const f = this.focus;
    const ax = Math.cos(f.angle);
    const ay = -Math.sin(f.angle);
    const half = f.radius * 0.95;
    const capsule = f.radius * 0.3;
    const t = THREE.MathUtils.clamp((mx - f.x) * ax + (my - f.y) * ay, -half, half);
    const px = f.x + ax * t;
    const py = f.y + ay * t;
    let dx = mx - px;
    let dy = my - py;
    let d = Math.hypot(dx, dy);
    const minDistance = radius + capsule + KEEP_OUT_MARGIN_PX;
    if (d < minDistance) {
      if (d < 1e-3) {
        dx = 0.7;
        dy = -0.7;
        d = Math.hypot(dx, dy);
      }
      mx = px + (dx / d) * minDistance;
      my = py + (dy / d) * minDistance;
    }

    const u = this.background.material.uniforms;
    const pr = this.pixelRatio;
    u.uMoon.value.set(mx * pr, (h - my) * pr, radius * pr);
    // Light fragments open away from the walkman (y up in shader space).
    u.uFrameAngle.value = Math.atan2(-(my - f.y), mx - f.x);
  }

  private buildLayers(): void {
    this.disposeLayers();
    const keys = LAYERS_BY_COUNT[THREE.MathUtils.clamp(this.spec.skylineLayers, 1, 3)];
    keys.forEach((key, index) => {
      const def = LAYERS[key];
      const material = this.skylineMaterialProto.clone();
      const mesh = new THREE.Mesh(buildSkylineLayer(def.spec), material);
      mesh.name = `environment:skyline-${key}`;
      mesh.renderOrder = -900 + index;
      const group = new THREE.Group();
      group.add(mesh);
      let tower: SkylineLayer['tower'] = null;
      if (key === 'far' || keys.length === 1) {
        // The distant tower belongs to the farthest available layer.
        tower = new THREE.Mesh(buildTower(), material);
        tower.name = 'environment:tower';
        tower.renderOrder = mesh.renderOrder;
        group.add(tower);
      }
      this.group.add(group);
      this.layers.push({ key, def, group, mesh, tower, base: new THREE.Vector3(), scale: 1 });
    });
  }

  private disposeLayers(): void {
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose();
      layer.mesh.material.dispose();
      layer.tower?.geometry.dispose();
      this.group.remove(layer.group);
    }
    this.layers = [];
  }

  private layoutShards(rig: CameraRig): void {
    const z = SHARD_DEPTH * this.focusRadius;
    const rect = rig.visibleRectAt(z, this.rect);
    const vw = rect.maxX - rect.minX;
    const vh = rect.maxY - rect.minY;
    this.shardPlaneHeight = vh;
    const positions: number[] = [];
    const edges: number[] = [];
    const kinds: number[] = [];
    const alphas: number[] = [];
    const indices: number[] = [];
    const push = (x: number, y: number, edge: number, kind: number, alpha: number): void => {
      positions.push(x, y, z);
      edges.push(edge);
      kinds.push(kind);
      alphas.push(alpha);
    };
    const quad = (): void => {
      const base = positions.length / 3 - 4;
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (const s of SHARDS) {
      const cx = rect.minX + s.u * vw;
      const cy = rect.minY + s.v * vh;
      const hh = (s.height * vh) / 2;
      const hw = (s.width * vh) / 2;
      const lean = SHARD_SLANT * hh;
      // Parallelogram, leaning right as it rises; aEdge 0 → 1 across its width.
      push(cx - hw - lean, cy - hh, 0, 0, s.alpha);
      push(cx + hw - lean, cy - hh, 1, 0, s.alpha);
      push(cx + hw + lean, cy + hh, 1, 0, s.alpha);
      push(cx - hw + lean, cy + hh, 0, 0, s.alpha);
      quad();
    }
    const lineHalf = 0.0011 * vh;
    for (const [lu, lv, length] of GUIDE_LINES) {
      const x0 = rect.minX + lu * vw;
      const y0 = rect.minY + lv * vh;
      const len = length * vh;
      const dirX = SHARD_SLANT / Math.hypot(SHARD_SLANT, 1);
      const dirY = 1 / Math.hypot(SHARD_SLANT, 1);
      const x1 = x0 + dirX * len;
      const y1 = y0 + dirY * len;
      push(x0 - lineHalf, y0, 0, 1, 1);
      push(x0 + lineHalf, y0, 0, 1, 1);
      push(x1 + lineHalf, y1, 0, 1, 1);
      push(x1 - lineHalf, y1, 0, 1, 1);
      quad();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
    geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.shards.geometry.dispose();
    this.shards.geometry = geometry;
  }
}
