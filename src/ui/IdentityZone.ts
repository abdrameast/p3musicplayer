import { CONFIG } from '../config/config';
import { formatTrackNumber } from '../config/tracks';
import type { PanelId, PlaybackState, TrackChange } from '../core/types';
import type { UIContext } from './context';
import { Scope, animate, ease, h } from './dom';
import { HudClock } from './HudClock';
import { icon } from './icons';

const NAV: ReadonlyArray<readonly [id: PanelId, index: string, label: string, jp: string, key: string | null]> = [
  ['tracklist', '01', 'TRACKLIST', '曲目', 'T'],
  ['visuals', '02', 'VISUALS', '映像', null],
  ['settings', '03', 'SETTINGS', '設定', null],
  ['sync', '04', 'AUDIO SYNC', '同期', 'S'],
];

/**
 * Left zone (desktop) / condensed brand bar (mobile): logo lockup, the
 * DARK HOUR block (local clock, moon phase, ACTIVE/STANDBY), the current
 * number as huge outlined numerals and the slanted section menu.
 */
export class IdentityZone {
  readonly el: HTMLElement;
  private readonly clock = new HudClock();
  private readonly status: HTMLElement;
  private readonly statusState: HTMLElement;
  private readonly bignum: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly nav: HTMLElement;
  private readonly scope = new Scope();

  constructor(private readonly ctx: UIContext) {
    const logo = h(
      'h1',
      { class: 'mf-logo' },
      h(
        'span',
        { class: 'mf-logo__full' },
        h('span', { class: 'mf-logo__l1' }, 'MIDNIGHT'),
        ' ',
        h('span', { class: 'mf-logo__l2' }, 'FREQUENCY'),
      ),
      h('span', { class: 'mf-logo__short', 'aria-hidden': 'true' }, 'MIDNIGHT FREQ.'),
    );
    const brand = h(
      'div',
      { class: 'mf-brand' },
      h('span', { class: 'mf-brand__mark', 'aria-hidden': 'true' }),
      logo,
      h(
        'p',
        { class: 'mf-brand__sub' },
        h('span', { class: 'mf-brand__archive' }, CONFIG.app.subtitle),
        h('span', { class: 'mf-brand__jp', lang: 'ja' }, CONFIG.app.kanji),
      ),
      h('p', { class: 'mf-brand__tagline' }, CONFIG.app.tagline),
    );

    this.statusState = h('span', { class: 'mf-dh__state' }, 'STANDBY');
    this.status = h(
      'p',
      { class: 'mf-dh__status', 'data-active': 'false' },
      h('span', { class: 'mf-dh__diamond', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-dh__name' }, 'DARK HOUR'),
      this.statusState,
      h('span', { class: 'mf-dh__jp', lang: 'ja' }, '影時間'),
    );
    const darkHour = h('div', { class: 'mf-dh' }, this.clock.el, this.status);

    this.nav = h('nav', { class: 'mf-nav', id: 'mf-nav', 'aria-label': 'Sections' });
    const list = h('ul', { class: 'mf-nav__list' });
    for (const [id, index, label, jp, key] of NAV) {
      const item = h(
        'button',
        { type: 'button', class: 'mf-nav__item', 'data-panel': id, 'aria-keyshortcuts': key },
        h('span', { class: 'mf-nav__index' }, index),
        h('span', { class: 'mf-nav__label' }, label),
        h('span', { class: 'mf-nav__jp', lang: 'ja' }, jp),
      );
      ctx.bindPanelOpener(id, item);
      this.scope.listen(item, 'click', () => {
        this.setMenuOpen(false);
        ctx.togglePanel(id, ctx.isCompact() ? this.menuButton : item);
      });
      list.append(h('li', null, item));
    }
    this.nav.append(list);

    this.menuButton = h(
      'button',
      { type: 'button', class: 'mf-menubtn', 'aria-expanded': 'false', 'aria-controls': 'mf-nav', 'aria-label': 'Menu' },
      icon('menu'),
    );
    this.scope.listen(this.menuButton, 'click', () => this.setMenuOpen(!this.isMenuOpen()));
    this.scope.listen<PointerEvent>(document, 'pointerdown', (event) => {
      if (this.isMenuOpen() && !this.el.contains(event.target as Node)) this.setMenuOpen(false);
    });

    this.bignum = h('span', { class: 'mf-bignum__value' }, '000');
    this.el = h(
      'header',
      { class: 'mf-identity' },
      h('div', { class: 'mf-bignum', 'aria-hidden': 'true' }, this.bignum),
      brand,
      darkHour,
      this.menuButton,
      this.nav,
    );

    this.scope.add(ctx.bus.on('player:state', (state) => this.applyState(state)));
    this.bignum.textContent = formatTrackNumber(ctx.player.getCurrentTrack().id);
    this.applyState(ctx.player.getState());
    this.clock.start();
  }

  transition(change: TrackChange, reduced: boolean): void {
    this.bignum.textContent = formatTrackNumber(change.track.id);
    if (reduced) return;
    const dir = change.direction === -1 ? -1 : 1;
    animate(
      this.bignum,
      [
        { transform: `translateY(${dir * 18}%) skewX(-10deg)`, opacity: 0, clipPath: 'inset(0 0 100% 0)' },
        { transform: 'skewX(-10deg)', opacity: 1, clipPath: 'inset(0 0 0 0)' },
      ],
      { duration: 520, delay: 140, easing: ease('snap'), fill: 'backwards' },
    );
  }

  isMenuOpen(): boolean {
    return this.el.classList.contains('is-menu-open');
  }

  /** Mobile section menu (disclosure). Returns whether anything changed. */
  setMenuOpen(open: boolean): boolean {
    if (open === this.isMenuOpen()) return false;
    this.el.classList.toggle('is-menu-open', open);
    this.menuButton.setAttribute('aria-expanded', String(open));
    if (open) this.nav.querySelector<HTMLButtonElement>('.mf-nav__item')?.focus({ preventScroll: true });
    this.ctx.sounds.play('panel');
    return true;
  }

  /** Esc: closes the menu and returns focus to its button. */
  closeMenu(): boolean {
    if (!this.setMenuOpen(false)) return false;
    this.menuButton.focus({ preventScroll: true });
    return true;
  }

  dispose(): void {
    this.scope.dispose();
    this.clock.dispose();
  }

  private applyState(state: Readonly<PlaybackState>): void {
    const active = state.status === 'PLAYING';
    this.status.dataset.active = String(active);
    this.statusState.textContent = active ? 'ACTIVE' : 'STANDBY';
  }
}
