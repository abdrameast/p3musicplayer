import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { AppEvents } from '../core/types';
import type { IWalkman } from './contracts';

/** Beyond this travel a press is a drag (CSS px). */
export const DRAG_THRESHOLD_PX = 6;
/** A press held longer than this is not a click. */
export const CLICK_MAX_MS = 450;
/** Release velocity is measured over the last part of the gesture. */
export const VELOCITY_WINDOW_MS = 80;
/** Mouse only: a second click within this delay is a double-click (reset pose). */
export const DOUBLE_CLICK_MS = 260;

export type GestureResult =
  | { kind: 'click' }
  | { kind: 'drag-end'; vx: number; vy: number }
  | { kind: 'none' };

interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * Pure click-vs-drag classification (no DOM), so the rule that a deliberate
 * rotation never toggles playback is unit-testable.
 */
export class GestureTracker {
  private active = false;
  private dragging = false;
  private start: Sample = { x: 0, y: 0, t: 0 };
  private last: Sample = { x: 0, y: 0, t: 0 };
  private samples: Sample[] = [];

  get isActive(): boolean {
    return this.active;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  down(x: number, y: number, t: number): void {
    this.active = true;
    this.dragging = false;
    this.start = { x, y, t };
    this.last = { x, y, t };
    this.samples = [{ x, y, t }];
  }

  /** Returns the drag delta to apply, or null while it is still a potential click. */
  move(x: number, y: number, t: number): { started: boolean; dx: number; dy: number } | null {
    if (!this.active) return null;
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW_MS * 2) this.samples.shift();
    let started = false;
    if (!this.dragging) {
      if (Math.hypot(x - this.start.x, y - this.start.y) <= DRAG_THRESHOLD_PX) return null;
      this.dragging = true;
      started = true;
      // The travel before the threshold is applied too: no dead zone in the rotation.
      this.last = this.start;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last = { x, y, t };
    return { started, dx, dy };
  }

  up(x: number, y: number, t: number): GestureResult {
    if (!this.active) return { kind: 'none' };
    this.active = false;
    if (this.dragging) {
      this.dragging = false;
      const from = this.samples.find((s) => t - s.t <= VELOCITY_WINDOW_MS);
      const elapsed = from ? (t - from.t) / 1000 : 0;
      // Held still before release → no fling.
      if (!from || elapsed < 0.008) return { kind: 'drag-end', vx: 0, vy: 0 };
      return { kind: 'drag-end', vx: (x - from.x) / elapsed, vy: (y - from.y) / elapsed };
    }
    return t - this.start.t <= CLICK_MAX_MS ? { kind: 'click' } : { kind: 'none' };
  }

  /** Returns true when a drag was interrupted (caller must end it). */
  cancel(): boolean {
    const wasDragging = this.dragging;
    this.active = false;
    this.dragging = false;
    return wasDragging;
  }
}

export interface PointerControlsOptions {
  heroElement: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  walkman: IWalkman;
  bus: EventBus<AppEvents>;
}

/**
 * DOM pointer handling for the walkman. Listens on the hero slot (which the
 * UI keeps empty and pointer-enabled) and raycasts with NDC computed from the
 * canvas rect, so the page can still scroll elsewhere on touch screens.
 */
export class PointerControls {
  /** Smoothed pointer position −1..1 (fine pointers), for background parallax. */
  readonly parallax = new THREE.Vector2();
  private readonly parallaxTarget = new THREE.Vector2();
  private readonly hero: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly walkman: IWalkman;
  private readonly bus: EventBus<AppEvents>;
  private readonly tracker = new GestureTracker();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly finePointer: boolean;
  private readonly previousTouchAction: string;
  private readonly previousCursor: string;
  private pointerId: number | null = null;
  private pointerType = '';
  private hovered = false;
  private pendingHover: { x: number; y: number } | null = null;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClickAt = Number.NEGATIVE_INFINITY;

  constructor(opts: PointerControlsOptions) {
    this.hero = opts.heroElement;
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.walkman = opts.walkman;
    this.bus = opts.bus;
    this.finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
    this.previousTouchAction = this.hero.style.touchAction;
    this.previousCursor = this.hero.style.cursor;
    this.hero.style.touchAction = 'none';

    this.hero.addEventListener('pointerdown', this.onPointerDown);
    this.hero.addEventListener('pointermove', this.onPointerMove);
    this.hero.addEventListener('pointerup', this.onPointerUp);
    this.hero.addEventListener('pointercancel', this.onPointerCancel);
    this.hero.addEventListener('lostpointercapture', this.onPointerCancel);
    this.hero.addEventListener('pointerleave', this.onPointerLeave);
    this.hero.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointermove', this.onWindowPointerMove, { passive: true });
    window.addEventListener('pointerout', this.onWindowPointerOut, { passive: true });
    window.addEventListener('blur', this.onBlur);
  }

  /** Per frame: at most one hover raycast, smoothed parallax. */
  update(dt: number, reducedMotion: boolean): void {
    if (this.pendingHover && !this.tracker.isDragging) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      this.setHovered(this.hitTest(x, y));
    }
    const target = reducedMotion ? 0 : 1;
    const k = 1 - Math.exp(-2.5 * dt);
    this.parallax.x += (this.parallaxTarget.x * target - this.parallax.x) * k;
    this.parallax.y += (this.parallaxTarget.y * target - this.parallax.y) * k;
  }

  dispose(): void {
    this.hero.removeEventListener('pointerdown', this.onPointerDown);
    this.hero.removeEventListener('pointermove', this.onPointerMove);
    this.hero.removeEventListener('pointerup', this.onPointerUp);
    this.hero.removeEventListener('pointercancel', this.onPointerCancel);
    this.hero.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.hero.removeEventListener('pointerleave', this.onPointerLeave);
    this.hero.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerout', this.onWindowPointerOut);
    window.removeEventListener('blur', this.onBlur);
    if (this.clickTimer !== null) clearTimeout(this.clickTimer);
    this.clickTimer = null;
    this.hero.style.touchAction = this.previousTouchAction;
    this.hero.style.cursor = this.previousCursor;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'mouse') event.preventDefault(); // no text selection while rotating
    this.pointerId = event.pointerId;
    this.pointerType = event.pointerType;
    try {
      this.hero.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an enhancement (keeps the drag outside the slot); safe to lose.
    }
    this.tracker.down(event.clientX, event.clientY, event.timeStamp);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      if (event.pointerType !== 'touch' && this.finePointer) this.pendingHover = { x: event.clientX, y: event.clientY };
      return;
    }
    const delta = this.tracker.move(event.clientX, event.clientY, event.timeStamp);
    if (!delta) return;
    if (delta.started) {
      this.walkman.beginDrag();
      this.updateCursor();
    }
    this.walkman.drag(delta.dx, delta.dy, this.viewportHeight());
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const result = this.tracker.up(event.clientX, event.clientY, event.timeStamp);
    if (result.kind === 'drag-end') {
      this.walkman.endDrag(result.vx, result.vy, this.viewportHeight());
      this.updateCursor();
      return;
    }
    if (result.kind !== 'click' || !this.hitTest(event.clientX, event.clientY)) return;
    if (this.pointerType !== 'mouse') {
      // Touch / pen: immediate; the HUD offers a reset-pose button.
      this.bus.emit('walkman:activate', undefined);
      return;
    }
    if (this.clickTimer !== null && event.timeStamp - this.lastClickAt <= DOUBLE_CLICK_MS) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
      this.walkman.resetPose();
      return;
    }
    // Wait out the double-click window so a double-click never toggles playback twice.
    this.lastClickAt = event.timeStamp;
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      this.bus.emit('walkman:activate', undefined);
    }, DOUBLE_CLICK_MS);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.tracker.cancel()) {
      this.walkman.endDrag(0, 0, this.viewportHeight());
      this.updateCursor();
    }
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    this.pendingHover = null;
    if (!this.tracker.isDragging) this.setHovered(false);
  };

  private readonly onContextMenu = (event: Event): void => {
    // Long-press on touch would open the menu mid-rotation.
    if (this.tracker.isActive) event.preventDefault();
  };

  private readonly onWindowPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || !this.finePointer) return;
    const nx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
    this.parallaxTarget.set(nx, ny);
    this.walkman.setPointerInfluence(nx, ny);
  };

  private readonly onWindowPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget !== null || event.pointerType === 'touch') return;
    // Pointer left the window: let the walkman and the parallax settle.
    this.parallaxTarget.set(0, 0);
    this.walkman.setPointerInfluence(0, 0);
  };

  private readonly onBlur = (): void => {
    if (this.pointerId !== null) {
      try {
        this.hero.releasePointerCapture(this.pointerId);
      } catch {
        // Already released.
      }
    }
    this.pointerId = null;
    if (this.tracker.cancel()) this.walkman.endDrag(0, 0, this.viewportHeight());
    this.setHovered(false);
  };

  private hitTest(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.walkman.hitTest(this.raycaster);
  }

  private setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.walkman.setHover(hovered);
    this.bus.emit('walkman:hover', hovered);
    this.updateCursor();
  }

  private updateCursor(): void {
    if (!this.finePointer) return;
    this.hero.style.cursor = this.tracker.isDragging ? 'grabbing' : this.hovered ? 'grab' : this.previousCursor;
  }

  private viewportHeight(): number {
    return this.canvas.clientHeight || window.innerHeight || 1;
  }
}
