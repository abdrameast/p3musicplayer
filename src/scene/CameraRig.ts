import * as THREE from 'three';

/** Narrow lens: flattens perspective like the reference illustration. */
export const CAMERA_FOV = 30;
/**
 * Share of the hero rect's limiting dimension covered by the walkman's focus
 * sphere. Kept a little lower on narrow (portrait) slots, where the lanyard
 * and the spectral arc need room on both sides.
 */
const FILL_WIDE = 0.86;
const FILL_NARROW = 0.8;
/** Camera breathing on bass, as a fraction of the camera distance (Effect G, ≤ 1.5 %). */
const BREATH_MAX = 0.013;
/** Damping of re-framing when only the hero slot moves (CSS layout changes). */
const REFRAME_RATE = 7;
/**
 * On-screen angle (radians, counter-clockwise from +X) of the walkman body in
 * its presentation pose: the reference illustration's lower-left → upper-right
 * diagonal. IWalkman exposes no orientation, so décor that must align with or
 * avoid the silhouette (aura, arc, ripples, moon keep-out) uses this constant.
 */
export const PRESENTATION_ANGLE = THREE.MathUtils.degToRad(30);

export interface CanvasRect {
  /** CSS px relative to the canvas' top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Framing {
  /** Camera distance from the origin along +Z. */
  distance: number;
  /** setViewOffset x / y (CSS px) that moves the optical centre onto the hero centre. */
  offsetX: number;
  offsetY: number;
}

/** World-space rectangle visible at a given depth. */
export interface VisibleRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Where the walkman lands on screen — used to keep décor clear of its silhouette. */
export interface ScreenFocus {
  /** Hero centre in CSS px from the canvas top-left. */
  x: number;
  y: number;
  /** Projected radius of the focus sphere, CSS px. */
  radius: number;
  /** Screen angle of the body axis (PRESENTATION_ANGLE). */
  angle: number;
}

/**
 * Pure framing maths (exported for tests): puts the world origin at the centre
 * of `hero` and sizes the focus sphere to `fill` of the hero's limiting side.
 */
export function computeFraming(
  viewportWidth: number,
  viewportHeight: number,
  hero: CanvasRect,
  focusRadius: number,
  fovDeg = CAMERA_FOV,
  fill = fillFor(hero),
): Framing {
  const cx = hero.x + hero.width / 2;
  const cy = hero.y + hero.height / 2;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const targetDiameterPx = Math.max(1, fill * Math.min(hero.width, hero.height));
  // Angular radius whose tangent spans targetDiameter/2 on a viewport of height H.
  const k = (targetDiameterPx / viewportHeight) * tanHalf;
  const distance = (focusRadius * Math.sqrt(1 + k * k)) / k;
  return { distance, offsetX: viewportWidth / 2 - cx, offsetY: viewportHeight / 2 - cy };
}

function fillFor(hero: CanvasRect): number {
  const aspect = hero.width / Math.max(1, hero.height);
  return aspect < 1.05 ? FILL_NARROW : FILL_WIDE;
}

/**
 * Owns the perspective camera. The camera always sits on +Z looking at the
 * origin without rotation; setViewOffset shifts the optical centre so the
 * walkman appears centred in the hero slot wherever the UI places it.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private width = 1;
  private height = 1;
  private hero: CanvasRect = { x: 0, y: 0, width: 1, height: 1 };
  private focusRadius = 1;
  private readonly target: Framing = { distance: 10, offsetX: 0, offsetY: 0 };
  private readonly current: Framing = { distance: 10, offsetX: 0, offsetY: 0 };
  private breath = 0;
  private bassEnvelope = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
    this.camera.position.set(0, 0, 10);
  }

  /** Canvas CSS size changed: the next frame snaps instead of easing. */
  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
  }

  /**
   * Frames the focus sphere into `hero` (canvas-relative CSS px). Easing is
   * used when only the slot moved; `snap` jumps (first frame, canvas resize).
   */
  setTarget(hero: CanvasRect, focusRadius: number, snap: boolean): void {
    const valid = hero.width >= 8 && hero.height >= 8;
    this.hero = valid ? { ...hero } : this.defaultHero();
    this.focusRadius = focusRadius;
    Object.assign(this.target, computeFraming(this.width, this.height, this.hero, focusRadius));
    // Far plane comfortably behind the deepest décor layer.
    this.camera.far = this.target.distance + focusRadius * 60;
    if (snap) Object.assign(this.current, this.target);
    this.apply();
  }

  getScreenFocus(): ScreenFocus {
    const k = this.focusRadius / Math.sqrt(Math.max(1e-6, this.target.distance ** 2 - this.focusRadius ** 2));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    return {
      x: this.hero.x + this.hero.width / 2,
      y: this.hero.y + this.hero.height / 2,
      radius: (k / tanHalf) * (this.height / 2),
      angle: PRESENTATION_ANGLE,
    };
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  /** Visible world rect on the plane z = `z`, for the settled framing (no breathing). */
  visibleRectAt(z: number, out: VisibleRect = { minX: 0, maxX: 0, minY: 0, maxY: 0 }): VisibleRect {
    const depth = Math.max(0.01, this.target.distance - z);
    const unitsPerPx = (2 * depth * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2)) / this.height;
    const { offsetX, offsetY } = this.target;
    out.minX = (offsetX - this.width / 2) * unitsPerPx;
    out.maxX = (offsetX + this.width / 2) * unitsPerPx;
    out.maxY = (this.height / 2 - offsetY) * unitsPerPx;
    out.minY = (-this.height / 2 - offsetY) * unitsPerPx;
    return out;
  }

  /** Bass-driven micro dolly (smoothed), eased re-framing, projection update. */
  update(dt: number, bass: number, energy: number, reducedMotion: boolean): void {
    const k = 1 - Math.exp(-REFRAME_RATE * dt);
    this.current.distance += (this.target.distance - this.current.distance) * k;
    this.current.offsetX += (this.target.offsetX - this.current.offsetX) * k;
    this.current.offsetY += (this.target.offsetY - this.current.offsetY) * k;

    const input = reducedMotion ? 0 : THREE.MathUtils.clamp(bass, 0, 1);
    // Fast attack, slow release: the camera "inhales" on low end, never jolts.
    const rate = input > this.bassEnvelope ? 9 : 2.2;
    this.bassEnvelope += (input - this.bassEnvelope) * (1 - Math.exp(-rate * dt));
    const breathTarget = this.bassEnvelope * BREATH_MAX * THREE.MathUtils.clamp(energy, 0, 1);
    this.breath += (breathTarget - this.breath) * (1 - Math.exp(-6 * dt));
    this.apply();
  }

  private apply(): void {
    const cam = this.camera;
    cam.position.set(0, 0, this.current.distance * (1 - this.breath));
    cam.setViewOffset(this.width, this.height, this.current.offsetX, this.current.offsetY, this.width, this.height);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private defaultHero(): CanvasRect {
    // No usable slot (hidden/collapsed): frame into the central area.
    const w = this.width * 0.5;
    const h = this.height * 0.6;
    return { x: (this.width - w) / 2, y: (this.height - h) / 2, width: w, height: h };
  }
}
