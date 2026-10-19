import type { AudioFeatures } from '../core/types';
import { h } from './dom';

const BARS = 24;
const MAX_DPR = 2;

/**
 * Small HUD bar meter. It renders whatever AudioFeatures the sync engine
 * provides — in SIMULATED mode that is the approximate rhythm model, and the
 * adjacent sync indicator says so. Allocation-free per frame; skips drawing
 * while off-screen or settled at rest.
 */
export class MiniVisualizer {
  readonly el: HTMLCanvasElement;
  /** undefined = not requested yet (created on first draw). */
  private ctx: CanvasRenderingContext2D | null | undefined;
  private readonly values = new Float32Array(BARS);
  private readonly binStart = new Uint16Array(BARS);
  private readonly binEnd = new Uint16Array(BARS);
  private mappedBins = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private visible = true;
  private resting = false;
  private color = '#48ddf5';
  private dim = 'rgba(169, 245, 255, 0.22)';
  private readonly resize: ResizeObserver | null;
  private readonly intersection: IntersectionObserver | null;

  constructor() {
    this.el = h('canvas', { class: 'mf-minivis', 'aria-hidden': 'true', width: 1, height: 1 });
    this.resize =
      typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => this.onResize(entries[0]?.contentRect)) : null;
    this.resize?.observe(this.el);
    this.intersection =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            this.visible = entries[entries.length - 1]?.isIntersecting ?? true;
          })
        : null;
    this.intersection?.observe(this.el);
  }

  /** Re-reads the accent colour (after a visual mode change). */
  refreshColors(): void {
    try {
      const styles = getComputedStyle(this.el);
      this.color = styles.getPropertyValue('--accent').trim() || this.color;
      this.dim = styles.getPropertyValue('--line').trim() || this.dim;
    } catch {
      /* computed styles unavailable */
    }
    this.resting = false;
  }

  draw(features: Readonly<AudioFeatures>, dt: number): void {
    if (!this.visible || this.width === 0) return;
    if (this.ctx === undefined) this.ctx = this.el.getContext('2d');
    const ctx = this.ctx;
    if (!ctx) return;
    const spectrum = features.spectrum;
    if (spectrum.length !== this.mappedBins) this.mapBins(spectrum.length);

    let energy = 0;
    const attack = Math.min(1, dt * 18);
    const release = Math.min(1, dt * 5);
    for (let i = 0; i < BARS; i++) {
      let sum = 0;
      const start = this.binStart[i];
      const end = this.binEnd[i];
      for (let b = start; b < end; b++) sum += spectrum[b];
      const target = end > start ? sum / (end - start) : 0;
      const current = this.values[i];
      const next = current + (target - current) * (target > current ? attack : release);
      this.values[i] = next;
      energy += next;
    }
    // At rest (paused / silent) the meter is a flat line: draw it once, then idle.
    const atRest = energy < 0.002;
    if (atRest && this.resting) return;
    this.resting = atRest;

    const w = this.width;
    const hgt = this.height;
    ctx.clearRect(0, 0, w, hgt);
    const gap = Math.max(2, Math.round(w / BARS / 2.6));
    const barW = Math.max(1, (w - gap * (BARS - 1)) / BARS);
    ctx.fillStyle = this.dim;
    ctx.fillRect(0, hgt - this.dpr, w, this.dpr);
    ctx.fillStyle = this.color;
    for (let i = 0; i < BARS; i++) {
      const barH = Math.max(this.dpr, Math.round(this.values[i] * hgt));
      ctx.fillRect(Math.round(i * (barW + gap)), hgt - barH, Math.ceil(barW), barH);
    }
  }

  dispose(): void {
    this.resize?.disconnect();
    this.intersection?.disconnect();
  }

  /** Log-spaced spectrum groups so the low end is not crammed into one bar. */
  private mapBins(bins: number): void {
    this.mappedBins = bins;
    if (bins === 0) {
      this.binStart.fill(0);
      this.binEnd.fill(0);
      return;
    }
    // Skip the DC bin; one bin per bar at the low end until the log curve
    // spreads wider than that, so no two bars mirror the same bin.
    const minBin = Math.min(1, bins - 1);
    const ratio = bins / Math.max(1, minBin);
    let previousEnd = minBin;
    for (let i = 0; i < BARS; i++) {
      const lo = Math.floor(minBin * ratio ** (i / BARS));
      const hi = Math.floor(minBin * ratio ** ((i + 1) / BARS));
      const start = Math.min(bins - 1, Math.max(previousEnd, lo));
      const end = Math.min(bins, Math.max(start + 1, hi));
      this.binStart[i] = start;
      this.binEnd[i] = end;
      previousEnd = end;
    }
  }

  private onResize(rect: DOMRectReadOnly | undefined): void {
    if (!rect) return;
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.width = Math.round(rect.width * this.dpr);
    this.height = Math.round(rect.height * this.dpr);
    this.el.width = Math.max(1, this.width);
    this.el.height = Math.max(1, this.height);
    this.resting = false;
  }
}
