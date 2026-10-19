import { formatTrackNumber } from '../config/tracks';
import type { AudioFeatures, VisualAccent } from '../core/types';
import { animate, ease, formatTime, h } from './dom';

const BEAT_COOLDOWN_MS = 6000;
const MIN_GAP_MS = 1200;
const KICK_THRESHOLD = 0.85;
const POOL_SIZE = 3;
const ANNOTATIONS = ['鼓動', '影時間', '月光', '共鳴', '周波数', '記憶'] as const;

/** Anchors near the hero's edges, clear of the walkman's central area (percent of the hero box). */
const ANCHORS: ReadonlyArray<readonly [x: number, y: number]> = [
  [6, 12],
  [70, 9],
  [5, 78],
  [68, 82],
  [80, 46],
  [4, 44],
];

interface Fragment {
  el: HTMLElement;
  code: HTMLElement;
  jp: HTMLElement;
  anim: Animation | null;
}

/**
 * Effect F: brief angular fragments (number / timecode / small kanji) near
 * the hero's edges on strong kicks (with a ≥ 6 s cooldown), featured
 * transitions and scene accents. Pooled elements; disabled in reduced motion.
 */
export class BeatTypography {
  readonly el: HTMLElement;
  private readonly pool: Fragment[] = [];
  private nextSlot = 0;
  private anchor = 0;
  private lastBeatAt = -Infinity;
  private lastAnyAt = -Infinity;
  private reduced = false;

  constructor(
    private readonly getTrackId: () => number,
    private readonly getPosition: () => number,
  ) {
    this.el = h('div', { class: 'mf-beat', 'aria-hidden': 'true' });
    for (let i = 0; i < POOL_SIZE; i++) {
      const code = h('span', { class: 'mf-beat__code' });
      const jp = h('span', { class: 'mf-beat__jp', lang: 'ja' });
      const el = h('span', { class: 'mf-beat__frag' }, h('span', { class: 'mf-beat__shape' }), code, jp);
      this.pool.push({ el, code, jp, anim: null });
      this.el.append(el);
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) for (const fragment of this.pool) fragment.anim?.cancel();
  }

  /** Per frame; cheap unless a strong kick lands after the cooldown. */
  update(features: Readonly<AudioFeatures>, now: number): void {
    if (this.reduced || !features.beat || features.kick <= KICK_THRESHOLD) return;
    if (now - this.lastBeatAt < BEAT_COOLDOWN_MS) return;
    this.lastBeatAt = now;
    this.emit(now, 0.7);
  }

  accent(accent: VisualAccent, now: number): void {
    if (accent.kind === 'beat') {
      if (now - this.lastBeatAt < BEAT_COOLDOWN_MS) return;
      this.lastBeatAt = now;
    }
    this.emit(now, accent.strength, accent.label);
  }

  dispose(): void {
    for (const fragment of this.pool) fragment.anim?.cancel();
  }

  private emit(now: number, strength: number, label?: string): void {
    if (this.reduced || now - this.lastAnyAt < MIN_GAP_MS) return;
    this.lastAnyAt = now;
    const fragment = this.pool[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % POOL_SIZE;
    this.anchor = (this.anchor + 1 + Math.floor(Math.random() * 2)) % ANCHORS.length;
    const [x, y] = ANCHORS[this.anchor];

    fragment.code.textContent =
      label ?? (Math.random() < 0.5 ? formatTrackNumber(this.getTrackId()) : formatTime(this.getPosition()));
    fragment.jp.textContent = ANNOTATIONS[Math.floor(Math.random() * ANNOTATIONS.length)];
    fragment.el.style.left = `${x}%`;
    fragment.el.style.top = `${y}%`;
    fragment.el.style.setProperty('--strength', String(Math.max(0.4, Math.min(1, strength))));

    fragment.anim?.cancel();
    fragment.anim = animate(
      fragment.el,
      [
        { opacity: 0, transform: 'translateX(-14px) skewX(-12deg)', clipPath: 'inset(0 100% 0 0)' },
        { opacity: 1, transform: 'skewX(-12deg)', clipPath: 'inset(0 0 0 0)', offset: 0.18 },
        { opacity: 1, transform: 'skewX(-12deg)', clipPath: 'inset(0 0 0 0)', offset: 0.7 },
        { opacity: 0, transform: 'translateY(-10px) skewX(-12deg)', clipPath: 'inset(0 0 0 0)' },
      ],
      { duration: 1100, easing: ease('snap') },
    );
  }
}
