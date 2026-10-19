/** Small DOM helpers shared by the HUD components (no framework). */

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function setAttrs(el: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
}

function appendChildren(el: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
}

/** Creates an HTML element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes and children. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) setAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/** Collects cleanups (listeners, timers, subscriptions) and runs them once. */
export class Scope {
  private cleanups: Array<() => void> = [];

  add(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  listen<E extends Event = Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  timeout(fn: () => void, ms: number): void {
    const id = setTimeout(fn, ms);
    this.cleanups.push(() => clearTimeout(id));
  }

  dispose(): void {
    const cleanups = this.cleanups;
    this.cleanups = [];
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
      } catch (error) {
        console.error('[ui] cleanup failed', error);
      }
    }
  }
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** "m:ss" (or "h:mm:ss"); invalid or negative input renders as 0:00. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = String(safe % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** "Azumi Takahashi & Lotus Juice" → "Azumi Takahashi × Lotus Juice". */
export function formatArtist(artist: string): string {
  return artist.replace(/\s*&\s*|,\s*/g, ' × ');
}

const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/** Marks mixed-script text so Japanese glyphs use Japanese (not Chinese) forms. */
export function applyLang(el: HTMLElement, text: string): void {
  if (hasJapanese(text)) el.lang = 'ja';
  else el.removeAttribute('lang');
}

export type EaseName = 'float' | 'snap' | 'exit' | 'elastic' | 'panel';

// Fallbacks mirror src/styles/tokens.css; the live value is read from CSS so
// tokens.css stays the single source of truth for motion curves.
const EASE_FALLBACK: Record<EaseName, string> = {
  float: 'cubic-bezier(0.37, 0, 0.63, 1)',
  snap: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
  exit: 'cubic-bezier(0.6, 0, 0.9, 0.3)',
  elastic: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  panel: 'cubic-bezier(0.16, 1, 0.3, 1)',
};
const easeCache = new Map<EaseName, string>();

export function ease(name: EaseName): string {
  const cached = easeCache.get(name);
  if (cached) return cached;
  let value = '';
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(`--ease-${name}`).trim();
  } catch {
    /* no computed styles (tests) */
  }
  const resolved = value || EASE_FALLBACK[name];
  easeCache.set(name, resolved);
  return resolved;
}

/** Element.animate when available (absent in jsdom / very old engines). */
export function animate(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    return null;
  }
}

/** Fire-and-forget for player/sync commands: failures are logged, never thrown into UI handlers. */
export function run(task: Promise<unknown>, label: string): void {
  task.catch((error: unknown) => console.warn(`[ui] ${label} failed`, error));
}

/** Runs after the next paint-relevant frame (setTimeout where rAF is missing). */
export function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
}

export function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
