import type { Notice } from '../core/types';
import { animate, ease, h } from './dom';
import { icon } from './icons';

export type NoticeCommand = NonNullable<NonNullable<Notice['action']>['command']>;

const DEFAULT_TTL: Readonly<Record<Notice['level'], number>> = { info: 5000, warn: 8000, error: 0 };
const MAX_VISIBLE = 4;

interface Entry {
  notice: Notice;
  el: HTMLElement;
  listeners: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  /** Remaining lifetime in ms; 0 = sticky. */
  remaining: number;
  startedAt: number;
}

/**
 * Notice stack (top-centre over the hero zone, never over the signal
 * window). Polite live region; timers pause while hovered or focused so
 * nobody has to race a disappearing message; errors are sticky by default.
 */
export class Notices {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly runCommand: (command: NoticeCommand) => void,
    private readonly isReducedMotion: () => boolean,
  ) {
    this.list = h('ol', { class: 'mf-notices__list' });
    this.el = h(
      'section',
      { class: 'mf-notices', 'aria-label': 'Notifications', 'aria-live': 'polite', 'aria-relevant': 'additions text' },
      this.list,
    );
  }

  push(notice: Notice): void {
    const replacing = this.entries.has(notice.id);
    if (replacing) this.remove(notice.id, false);
    const listeners = new AbortController();
    const el = this.render(notice, listeners.signal);
    const ttl = notice.ttl ?? DEFAULT_TTL[notice.level];
    const entry: Entry = { notice, el, listeners, timer: null, remaining: Math.max(0, ttl), startedAt: 0 };
    this.entries.set(notice.id, entry);
    this.list.append(el);
    if (!replacing && !this.isReducedMotion()) {
      animate(el, [{ opacity: 0, transform: 'translateY(-14px) skewX(-8deg)' }, { opacity: 1, transform: 'none' }], {
        duration: 320,
        easing: ease('snap'),
      });
    }
    if (entry.remaining > 0) this.startTimer(entry);
    this.trim();
  }

  dismiss(id: string): void {
    this.remove(id, true);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id, false);
  }

  private render(notice: Notice, signal: AbortSignal): HTMLElement {
    const on = (target: EventTarget, type: string, fn: () => void) => target.addEventListener(type, fn, { signal });
    const actions = h('div', { class: 'mf-notice__actions' });
    const action = notice.action;
    if (action?.href) {
      actions.append(
        h('a', { class: 'mf-notice__action', href: action.href, target: '_blank', rel: 'noopener noreferrer' }, action.label),
      );
    } else if (action?.command) {
      const command = action.command;
      const button = h('button', { type: 'button', class: 'mf-notice__action' }, action.label);
      on(button, 'click', () => {
        this.dismiss(notice.id);
        this.runCommand(command);
      });
      actions.append(button);
    }
    const close = h('button', { type: 'button', class: 'mf-notice__close', 'aria-label': 'Dismiss notification' }, icon('close'));
    on(close, 'click', () => this.dismiss(notice.id));
    actions.append(close);

    const el = h(
      'li',
      { class: `mf-notice mf-notice--${notice.level}`, role: notice.level === 'error' ? 'alert' : null },
      h('span', { class: 'mf-notice__mark', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'mf-notice__body' },
        h('p', { class: 'mf-notice__message' }, notice.message),
        notice.detail ? h('p', { class: 'mf-notice__detail' }, notice.detail) : null,
      ),
      actions,
    );
    const pause = () => this.pauseTimer(notice.id);
    const resume = () => this.resumeTimer(notice.id);
    on(el, 'pointerenter', pause);
    on(el, 'pointerleave', resume);
    on(el, 'focusin', pause);
    on(el, 'focusout', resume);
    return el;
  }

  private startTimer(entry: Entry): void {
    entry.startedAt = performance.now();
    entry.timer = setTimeout(() => this.remove(entry.notice.id, true), entry.remaining);
  }

  private pauseTimer(id: string): void {
    const entry = this.entries.get(id);
    if (!entry?.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.remaining = Math.max(1500, entry.remaining - (performance.now() - entry.startedAt));
  }

  private resumeTimer(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.timer || entry.remaining <= 0) return;
    if (entry.el.matches(':hover') || entry.el.contains(document.activeElement)) return;
    this.startTimer(entry);
  }

  /** Oldest auto-dismissing notices go first when the stack is full. */
  private trim(): void {
    while (this.entries.size > MAX_VISIBLE) {
      const all = [...this.entries.values()];
      const victim = all.find((entry) => entry.remaining > 0) ?? all[0];
      this.remove(victim.notice.id, false);
    }
  }

  private remove(id: string, animated: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.listeners.abort();
    const exit =
      animated && !this.isReducedMotion()
        ? animate(entry.el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], {
            duration: 180,
            easing: ease('exit'),
            fill: 'forwards',
          })
        : null;
    if (exit) exit.finished.then(() => entry.el.remove(), () => entry.el.remove());
    else entry.el.remove();
  }
}
