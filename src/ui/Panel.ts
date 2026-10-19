import type { EventBus } from '../core/EventBus';
import type { AppEvents, PanelId } from '../core/types';
import { Scope, h, uid } from './dom';
import { icon } from './icons';
import type { UISounds } from './UISounds';

export interface PanelSpec {
  id: PanelId;
  /** Menu index shown as a large ghost numeral, e.g. "01". */
  index: string;
  title: string;
  jp: string;
  kicker?: string;
  variant?: 'wide' | 'regular';
}

export interface PanelHooks {
  onOpen?(): void;
  onClose?(): void;
  /** Element focused on open; defaults to the close button. */
  initialFocus?(compact: boolean): HTMLElement | null;
}

/** View of one dialog. Opening/closing is owned by PanelManager. */
export class Panel {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly head: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  private readonly kicker: HTMLElement;

  constructor(
    readonly spec: PanelSpec,
    readonly hooks: PanelHooks,
  ) {
    const titleId = uid(`mf-panel-title-${spec.id}`);
    this.kicker = h('p', { class: 'mf-panel__kicker' }, spec.kicker ?? '');
    this.closeButton = h(
      'button',
      { type: 'button', class: 'mf-panel__close', 'aria-label': `Close ${spec.title.toLowerCase()}` },
      icon('close'),
      h('span', { class: 'mf-panel__esc', 'aria-hidden': 'true' }, 'ESC'),
    );
    this.head = h(
      'header',
      { class: 'mf-panel__head' },
      h('span', { class: 'mf-panel__grip', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-panel__index', 'aria-hidden': 'true' }, spec.index),
      h(
        'h2',
        { class: 'mf-panel__title', id: titleId },
        h('span', { class: 'mf-panel__title-text' }, spec.title),
        h('span', { class: 'mf-panel__jp', lang: 'ja' }, spec.jp),
      ),
      this.kicker,
      this.closeButton,
    );
    this.body = h('div', { class: 'mf-panel__body' });
    this.el = h(
      'section',
      {
        class: `mf-panel mf-panel--${spec.variant ?? 'regular'}`,
        id: `mf-panel-${spec.id}`,
        role: 'dialog',
        'aria-labelledby': titleId,
        'data-panel': spec.id,
        tabindex: '-1',
        hidden: true,
      },
      h('span', { class: 'mf-panel__edge', 'aria-hidden': 'true' }),
      this.head,
      this.body,
    );
  }

  setKicker(text: string): void {
    this.kicker.textContent = text;
  }
}

export interface PanelManagerOptions {
  /** Fixed layer that holds the panels and the scrim. */
  layer: HTMLElement;
  /** Made inert while a modal sheet is open (mobile). */
  inertTarget: HTMLElement;
  bus: EventBus<AppEvents>;
  sounds: UISounds;
  isCompact(): boolean;
  isReducedMotion(): boolean;
}

const CLOSE_MS = 420;
const SHEET_DISMISS_PX = 90;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One dialog at a time. Desktop/tablet: non-modal side panel (the transport
 * stays usable). Mobile: modal bottom sheet with scrim, focus trap, inert
 * background and swipe-down to dismiss. Focus moves in on open and returns
 * to the opener on close; Esc closes.
 */
export class PanelManager {
  private readonly panels = new Map<PanelId, Panel>();
  private readonly openers = new Map<PanelId, Set<HTMLElement>>();
  private readonly scrim: HTMLElement;
  private readonly scope = new Scope();
  private currentId: PanelId | null = null;
  private opener: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private closing: Panel | null = null;

  constructor(private readonly opts: PanelManagerOptions) {
    this.scrim = h('div', { class: 'mf-scrim', 'aria-hidden': 'true' });
    opts.layer.append(this.scrim);
    this.scope.listen(this.scrim, 'click', () => this.close());
  }

  get current(): PanelId | null {
    return this.currentId;
  }

  create(spec: PanelSpec, hooks: PanelHooks = {}): Panel {
    const panel = new Panel(spec, hooks);
    this.panels.set(spec.id, panel);
    this.opts.layer.append(panel.el);
    this.scope.listen(panel.closeButton, 'click', () => this.close());
    this.scope.listen<KeyboardEvent>(panel.el, 'keydown', (event) => this.onKeydown(panel, event));
    this.bindSheetDrag(panel);
    return panel;
  }

  bindOpener(id: PanelId, button: HTMLElement): void {
    let set = this.openers.get(id);
    if (!set) {
      set = new Set();
      this.openers.set(id, set);
    }
    set.add(button);
    button.setAttribute('aria-controls', `mf-panel-${id}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', String(this.currentId === id));
  }

  toggle(id: PanelId, opener?: HTMLElement | null): void {
    if (this.currentId === id) this.close();
    else this.open(id, opener);
  }

  open(id: PanelId, opener?: HTMLElement | null): void {
    const panel = this.panels.get(id);
    if (!panel || this.currentId === id) return;
    const previousOpener = this.opener;
    if (this.currentId) this.close({ restoreFocus: false, silent: true });
    this.cancelHide();

    const compact = this.opts.isCompact();
    this.currentId = id;
    this.opener = opener ?? previousOpener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    panel.el.hidden = false;
    this.applyMode(panel, compact);
    // Commit the closed position first so the slide-in transition runs.
    void panel.el.offsetWidth;
    panel.el.classList.add('is-open');
    panel.el.style.removeProperty('--drag');
    this.syncOpeners();
    panel.hooks.onOpen?.();
    const target = panel.hooks.initialFocus?.(compact) ?? panel.closeButton;
    target.focus({ preventScroll: true });
    this.opts.bus.emit('ui:panel', id);
    this.opts.sounds.play('panel');
  }

  close(options: { restoreFocus?: boolean; silent?: boolean } = {}): void {
    const id = this.currentId;
    if (!id) return;
    const panel = this.panels.get(id);
    this.currentId = null;
    if (panel) {
      panel.el.classList.remove('is-open');
      panel.hooks.onClose?.();
      this.scheduleHide(panel);
    }
    this.opts.layer.classList.remove('has-sheet');
    this.opts.inertTarget.removeAttribute('inert');
    this.syncOpeners();
    const opener = this.opener;
    this.opener = null;
    if (options.restoreFocus !== false && opener?.isConnected) opener.focus({ preventScroll: true });
    if (!options.silent) {
      this.opts.bus.emit('ui:panel', null);
      this.opts.sounds.play('panel');
    }
  }

  /** Re-applies modal/non-modal behaviour after a breakpoint change. */
  refreshMode(): void {
    const panel = this.currentId ? this.panels.get(this.currentId) : undefined;
    if (panel) this.applyMode(panel, this.opts.isCompact());
  }

  dispose(): void {
    this.cancelHide();
    this.scope.dispose();
    this.opts.inertTarget.removeAttribute('inert');
    this.panels.clear();
    this.openers.clear();
  }

  private applyMode(panel: Panel, compact: boolean): void {
    panel.el.setAttribute('aria-modal', String(compact));
    this.opts.layer.classList.toggle('has-sheet', compact);
    if (compact) this.opts.inertTarget.setAttribute('inert', '');
    else this.opts.inertTarget.removeAttribute('inert');
  }

  private syncOpeners(): void {
    for (const [id, set] of this.openers) {
      for (const button of set) button.setAttribute('aria-expanded', String(this.currentId === id));
    }
  }

  private scheduleHide(panel: Panel): void {
    this.cancelHide();
    if (this.opts.isReducedMotion()) {
      panel.el.hidden = true;
      return;
    }
    this.closing = panel;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.closing = null;
      if (!panel.el.classList.contains('is-open')) panel.el.hidden = true;
    }, CLOSE_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.closing && !this.closing.el.classList.contains('is-open')) this.closing.el.hidden = true;
    this.closing = null;
  }

  private onKeydown(panel: Panel, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      const target = event.target;
      // Let a filled search field clear itself first.
      if (target instanceof HTMLInputElement && target.type === 'search' && target.value) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab' && panel.el.getAttribute('aria-modal') === 'true') this.trapFocus(panel, event);
  }

  private trapFocus(panel: Panel, event: KeyboardEvent): void {
    const focusables = [...panel.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.closest('[hidden]') && el.getClientRects().length > 0,
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.el)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Mobile sheets: dragging the header down past a threshold dismisses the sheet. */
  private bindSheetDrag(panel: Panel): void {
    let startY = 0;
    let dy = 0;
    let pointerId: number | null = null;
    this.scope.listen<PointerEvent>(panel.head, 'pointerdown', (event) => {
      if (panel.el.getAttribute('aria-modal') !== 'true' || event.button !== 0) return;
      if ((event.target as Element).closest('button, a, input')) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      dy = 0;
      panel.head.setPointerCapture(pointerId);
      panel.el.classList.add('is-dragging');
    });
    this.scope.listen<PointerEvent>(panel.head, 'pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      dy = Math.max(0, event.clientY - startY);
      panel.el.style.setProperty('--drag', `${dy}px`);
    });
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      panel.el.classList.remove('is-dragging');
      panel.el.style.removeProperty('--drag');
      if (dy > SHEET_DISMISS_PX && this.currentId === panel.spec.id) this.close();
    };
    this.scope.listen<PointerEvent>(panel.head, 'pointerup', end);
    this.scope.listen<PointerEvent>(panel.head, 'pointercancel', end);
  }
}
