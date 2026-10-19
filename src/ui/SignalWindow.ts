import type { PlaybackState } from '../core/types';
import type { UIContext } from './context';
import { Scope, h } from './dom';
import { icon, swapIcon } from './icons';

/**
 * SIGNAL WINDOW — the visible, unobstructed home of the official YouTube
 * IFrame player (controls on, ≥ 200×200 CSS px). Collapsing it pauses
 * YouTube playback through player.setSignalWindowOpen(false); nothing we
 * draw ever sits on top of the mount (decoration lives on pseudo-elements
 * outside it, the placeholder sits underneath it).
 */
export class SignalWindow {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly toggleLabel: HTMLElement;
  private readonly provider: HTMLElement;
  private readonly external: HTMLAnchorElement;
  private readonly frame: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private readonly scope = new Scope();
  private open: boolean;

  constructor(
    private readonly ctx: UIContext,
    readonly mount: HTMLElement,
  ) {
    const bodyId = 'mf-signal-body';
    this.open = ctx.player.isSignalWindowOpen();
    this.provider = h('span', { class: 'mf-signal__provider' }, 'YOUTUBE EMBED');
    this.toggleLabel = h('span', { class: 'mf-signal__toggle-label' });
    this.toggle = h(
      'button',
      { type: 'button', class: 'mf-signal__toggle', 'aria-controls': bodyId, 'aria-expanded': String(this.open) },
      icon('chevronUp'),
      this.toggleLabel,
    );
    this.external = h(
      'a',
      { class: 'mf-signal__external', target: '_blank', rel: 'noopener noreferrer' },
      'OPEN ON YOUTUBE',
      icon('external'),
    );
    this.empty = h(
      'p',
      { class: 'mf-signal__empty', hidden: true },
      h('span', { class: 'mf-signal__empty-title' }, 'NO VIDEO SOURCE'),
      h('span', { class: 'mf-signal__empty-sub' }, 'LICENSED AUDIO · ', h('span', { lang: 'ja' }, '音声のみ')),
    );
    mount.classList.add('mf-signal__mount');
    this.frame = h(
      'div',
      { class: 'mf-signal__frame' },
      h('span', { class: 'mf-signal__placeholder', 'aria-hidden': 'true' }, h('span', null, 'AWAITING SIGNAL'), h('span', { lang: 'ja' }, '映像信号待機')),
      mount,
    );
    this.body = h('div', { class: 'mf-signal__body', id: bodyId }, this.frame, this.empty);
    this.note = h('p', { class: 'mf-signal__note' }, 'Collapsing pauses playback — the YouTube player must stay visible.');
    this.el = h(
      'section',
      { class: 'mf-signal', id: 'mf-signal', 'aria-labelledby': 'mf-signal-title', tabindex: '-1' },
      h(
        'header',
        { class: 'mf-signal__head' },
        h(
          'h2',
          { class: 'mf-signal__title', id: 'mf-signal-title' },
          h('span', { class: 'mf-signal__title-main' }, 'SIGNAL WINDOW'),
          h('span', { class: 'mf-signal__title-sub' }, 'VIDEO SOURCE · ', h('span', { lang: 'ja' }, '映像信号')),
        ),
        this.provider,
      ),
      this.body,
      h('div', { class: 'mf-signal__foot' }, this.toggle, this.external),
      this.note,
    );

    this.scope.listen(this.toggle, 'click', () => {
      this.setOpen(!this.open);
      ctx.sounds.play('toggle');
    });
    this.scope.add(ctx.bus.on('signal:visibility', ({ open }) => this.setOpen(open)));
    this.scope.add(ctx.bus.on('player:state', (state) => this.applyState(state)));
    this.scope.add(ctx.bus.on('player:track', () => this.applyState(ctx.player.getState())));
    this.scope.add(
      ctx.bus.on('source:update', (source) => {
        if (source.trackId === ctx.player.getCurrentTrack().id) this.applyState(ctx.player.getState());
      }),
    );
    this.render();
    this.applyState(ctx.player.getState());
  }

  /** Brings the window into view (mobile "SIGNAL ↓" chip). */
  reveal(reducedMotion: boolean): void {
    this.el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    this.el.focus({ preventScroll: true });
  }

  dispose(): void {
    this.scope.dispose();
  }

  private setOpen(open: boolean): void {
    if (open !== this.open) {
      this.open = open;
      this.render();
    }
    // The player owns the policy (pause on close, allow play on open). Only
    // forward real differences, so a player that re-emits 'signal:visibility'
    // from setSignalWindowOpen can never loop.
    if (this.ctx.player.isSignalWindowOpen() !== open) this.ctx.player.setSignalWindowOpen(open);
  }

  private render(): void {
    this.body.hidden = !this.open;
    this.el.classList.toggle('is-collapsed', !this.open);
    this.toggle.setAttribute('aria-expanded', String(this.open));
    this.toggleLabel.textContent = this.open ? 'COLLAPSE' : 'EXPAND';
    swapIcon(this.toggle, this.open ? 'chevronUp' : 'chevronDown');
  }

  private applyState(state: Readonly<PlaybackState>): void {
    const track = this.ctx.player.getCurrentTrack();
    const kind = state.trackId === track.id && state.provider ? state.provider : track.source.kind;
    const licensed = kind === 'licensed';
    this.el.dataset.provider = kind ?? 'none';
    this.provider.textContent = licensed ? 'LICENSED AUDIO' : kind === 'youtube' ? 'YOUTUBE EMBED' : 'NO SOURCE';
    // Licensed audio has no video: show the empty state instead of an idle player.
    this.frame.hidden = licensed;
    this.empty.hidden = !licensed;
    this.note.hidden = licensed;
    const url = track.source.externalUrl;
    this.external.hidden = !url;
    if (url) this.external.href = url;
    else this.external.removeAttribute('href');
  }
}
