import { animate, ease, h } from './dom';

export interface SweepOptions {
  direction: 1 | -1 | 0;
  featured: boolean;
  /** Accent word for featured transitions (getVisualProfile().accentLabel). */
  label?: string;
  durationMs: number;
}

/**
 * Full-composition graphics for track changes: a slanted cyan band sweeping
 * across, and — for featured tracks — a large outlined accent word gliding
 * through the upper or lower band (never across the walkman's centre).
 * Lives in a fixed layer BEHIND the HUD so it can never cover the YouTube
 * player or any control.
 */
export class TransitionFx {
  readonly el: HTMLElement;
  private readonly band: HTMLElement;
  private readonly line: HTMLElement;
  private readonly word: HTMLElement;
  private running: Animation[] = [];
  private lowerBand = false;

  constructor() {
    this.band = h('span', { class: 'mf-fx__band' });
    this.line = h('span', { class: 'mf-fx__line' });
    this.word = h('span', { class: 'mf-fx__word' });
    this.el = h('div', { class: 'mf-fx', 'aria-hidden': 'true' }, this.band, this.line, this.word);
  }

  play(opts: SweepOptions): void {
    this.cancel();
    const dir = opts.direction === -1 ? -1 : 1;
    const from = dir > 0 ? '-30vw' : '130vw';
    const to = dir > 0 ? '130vw' : '-30vw';
    const sweepMs = Math.round(opts.durationMs * (opts.featured ? 0.62 : 0.55));
    this.el.dataset.featured = String(opts.featured);

    const anims = [
      animate(
        this.band,
        [
          { transform: `translateX(${from}) skewX(-12deg)`, opacity: 0 },
          { opacity: opts.featured ? 0.7 : 0.5, offset: 0.2 },
          { opacity: opts.featured ? 0.7 : 0.5, offset: 0.75 },
          { transform: `translateX(${to}) skewX(-12deg)`, opacity: 0 },
        ],
        { duration: sweepMs, easing: ease('snap') },
      ),
      animate(
        this.line,
        [
          { transform: `translateX(${from}) skewX(-12deg)`, opacity: 0 },
          { opacity: 1, offset: 0.25 },
          { transform: `translateX(${to}) skewX(-12deg)`, opacity: 0 },
        ],
        { duration: sweepMs, delay: 70, easing: ease('snap') },
      ),
    ];

    if (opts.featured && opts.label) {
      this.lowerBand = !this.lowerBand;
      this.word.textContent = opts.label;
      this.word.dataset.band = this.lowerBand ? 'lower' : 'upper';
      anims.push(
        animate(
          this.word,
          [
            { transform: `translateX(${dir > 0 ? '18vw' : '-18vw'}) skewX(-12deg)`, opacity: 0 },
            { opacity: 0.55, offset: 0.25 },
            { opacity: 0.55, offset: 0.7 },
            { transform: `translateX(${dir > 0 ? '-14vw' : '14vw'}) skewX(-12deg)`, opacity: 0 },
          ],
          { duration: opts.durationMs, easing: ease('panel') },
        ),
      );
    }
    this.running = anims.filter((a): a is Animation => a !== null);
  }

  cancel(): void {
    for (const anim of this.running) anim.cancel();
    this.running = [];
  }

  dispose(): void {
    this.cancel();
  }
}
