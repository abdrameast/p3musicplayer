import { h, s } from './dom';

export const SYNODIC_MONTH_DAYS = 29.530588853;
/** Reference new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export const MOON_PHASES = [
  { name: 'NEW MOON', jp: '新月' },
  { name: 'WAXING CRESCENT', jp: '三日月' },
  { name: 'FIRST QUARTER', jp: '上弦' },
  { name: 'WAXING GIBBOUS', jp: '十三夜' },
  { name: 'FULL MOON', jp: '満月' },
  { name: 'WANING GIBBOUS', jp: '居待月' },
  { name: 'LAST QUARTER', jp: '下弦' },
  { name: 'WANING CRESCENT', jp: '有明月' },
] as const;

export interface MoonPhase {
  /** Days since the last new moon, 0..29.53. */
  age: number;
  /** Fraction of the synodic cycle, 0 = new, 0.5 = full. */
  phase: number;
  /** Illuminated fraction of the disc, 0..1. */
  illumination: number;
  index: number;
  name: string;
  jp: string;
}

export function getMoonPhase(date: Date): MoonPhase {
  const days = (date.getTime() - REFERENCE_NEW_MOON_MS) / DAY_MS;
  const age = ((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const phase = age / SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const index = Math.floor(phase * 8 + 0.5) % 8;
  return { age, phase, illumination, index, ...MOON_PHASES[index] };
}

/**
 * SVG path of the lit part of the disc (northern-hemisphere view: waxing lit
 * on the right). Outer limb = half circle; terminator = half ellipse whose
 * width follows cos(phase).
 */
export function moonLitPath(phase: number, cx: number, cy: number, r: number): string {
  const c = Math.cos(2 * Math.PI * phase);
  const rx = Math.abs(c) * r;
  const waxing = phase < 0.5;
  const limbSweep = waxing ? 1 : 0;
  const terminatorSweep = waxing ? (c > 0 ? 0 : 1) : c > 0 ? 1 : 0;
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  return `M${top}A${r} ${r} 0 0 ${limbSweep} ${bottom}A${rx.toFixed(3)} ${r} 0 0 ${terminatorSweep} ${top}Z`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time HH:MM (+ seconds) and the current moon phase glyph. */
export class HudClock {
  readonly el: HTMLElement;
  private readonly hhmm: HTMLElement;
  private readonly seconds: HTMLElement;
  private readonly moonLit: SVGPathElement;
  private readonly moonName: HTMLElement;
  private readonly moonJp: HTMLElement;
  private readonly moonAge: HTMLElement;
  private readonly time: HTMLTimeElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastMoonMinute = -1;

  constructor() {
    this.hhmm = h('span', { class: 'mf-clock__hhmm' }, '00:00');
    this.seconds = h('span', { class: 'mf-clock__ss' }, ':00');
    this.time = h('time', { class: 'mf-clock__time' }, this.hhmm, this.seconds);
    this.moonLit = s('path', { class: 'mf-moon__lit', d: '' });
    const glyph = s(
      'svg',
      { class: 'mf-moon__glyph', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
      s('circle', { class: 'mf-moon__disc', cx: 12, cy: 12, r: 9.5 }),
      this.moonLit,
    );
    this.moonName = h('span', { class: 'mf-moon__name' });
    this.moonJp = h('span', { class: 'mf-moon__jp', lang: 'ja' });
    this.moonAge = h('span', { class: 'mf-moon__age' });
    this.el = h(
      'div',
      { class: 'mf-clock' },
      h('span', { class: 'mf-micro mf-clock__label' }, 'LOCAL TIME'),
      this.time,
      h('div', { class: 'mf-moon' }, glyph, h('span', { class: 'mf-moon__text' }, this.moonName, this.moonJp, this.moonAge)),
    );
  }

  start(): void {
    this.stop();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
  }

  private tick = (): void => {
    const now = new Date();
    this.hhmm.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    this.seconds.textContent = `:${pad(now.getSeconds())}`;
    this.time.dateTime = now.toISOString();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute !== this.lastMoonMinute) {
      this.lastMoonMinute = minute;
      this.renderMoon(now);
    }
    // Re-align on the next second boundary so the display never drifts.
    this.timer = setTimeout(this.tick, 1000 - (now.getTime() % 1000) + 5);
  };

  private renderMoon(now: Date): void {
    const moon = getMoonPhase(now);
    this.moonLit.setAttribute('d', moon.illumination < 0.01 ? '' : moonLitPath(moon.phase, 12, 12, 9.5));
    this.moonName.textContent = moon.name;
    this.moonJp.textContent = moon.jp;
    this.moonAge.textContent = `AGE ${moon.age.toFixed(1)} D · ${Math.round(moon.illumination * 100)}%`;
  }
}
