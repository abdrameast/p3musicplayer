import type { PlaybackState } from '../core/types';
import type { UIContext } from './context';
import { Scope, h, uid } from './dom';
import { icon, swapIcon } from './icons';

/**
 * Mute toggle + volume slider. Desktop/tablet: inline. Mobile: the pair lives
 * in a popover opened by a dedicated button (CSS decides which is shown).
 */
export class VolumeControl {
  readonly el: HTMLElement;
  private readonly opener: HTMLButtonElement;
  private readonly group: HTMLElement;
  private readonly mute: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly scope = new Scope();
  private muted = false;

  constructor(ctx: UIContext) {
    const groupId = uid('mf-volume');
    this.mute = h(
      'button',
      { type: 'button', class: 'mf-iconbtn mf-volume__mute', 'aria-pressed': 'false', 'aria-keyshortcuts': 'M', 'data-tip': 'Mute · M' },
      icon('volume'),
    );
    this.slider = h('input', {
      type: 'range',
      class: 'mf-volume__slider',
      min: 0,
      max: 100,
      step: 1,
      value: 100,
      'aria-label': 'Volume',
      'aria-keyshortcuts': 'ArrowUp ArrowDown',
    });
    this.group = h(
      'div',
      { class: 'mf-volume__group', id: groupId, role: 'group', 'aria-label': 'Volume' },
      this.mute,
      h('span', { class: 'mf-volume__rail' }, this.slider),
    );
    this.opener = h(
      'button',
      {
        type: 'button',
        class: 'mf-iconbtn mf-volume__opener',
        'aria-expanded': 'false',
        'aria-controls': groupId,
        'aria-label': 'Volume',
      },
      icon('volume'),
    );
    this.el = h('div', { class: 'mf-volume' }, this.opener, this.group);

    this.scope.listen(this.mute, 'click', () => {
      ctx.player.toggleMute();
      ctx.sounds.play('toggle');
    });
    this.scope.listen(this.slider, 'input', () => {
      const volume = Number(this.slider.value) / 100;
      if (this.muted && volume > 0) ctx.player.setMuted(false);
      ctx.player.setVolume(volume);
      this.paintSlider(volume);
    });
    this.scope.listen(this.opener, 'click', () => this.setPopover(!this.isPopoverOpen()));
    this.scope.listen<PointerEvent>(document, 'pointerdown', (event) => {
      if (this.isPopoverOpen() && !this.el.contains(event.target as Node)) this.setPopover(false);
    });
    this.scope.listen<KeyboardEvent>(this.group, 'keydown', (event) => {
      if (event.key === 'Escape' && this.isPopoverOpen()) {
        event.stopPropagation();
        this.setPopover(false);
        this.opener.focus();
      }
    });

    this.scope.add(ctx.bus.on('player:state', (state) => this.applyState(state)));
    this.applyState(ctx.player.getState());
  }

  isPopoverOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  setPopover(open: boolean): void {
    this.el.classList.toggle('is-open', open);
    this.opener.setAttribute('aria-expanded', String(open));
    if (open) this.slider.focus({ preventScroll: true });
  }

  dispose(): void {
    this.scope.dispose();
  }

  private applyState(state: Readonly<PlaybackState>): void {
    this.muted = state.muted;
    if (document.activeElement !== this.slider) this.slider.value = String(Math.round(state.volume * 100));
    this.paintSlider(state.volume);
    this.mute.setAttribute('aria-pressed', String(state.muted));
    this.mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
    this.mute.dataset.tip = state.muted ? 'Unmute · M' : 'Mute · M';
    const percent = Math.round(state.volume * 100);
    this.slider.setAttribute('aria-valuetext', state.muted ? `${percent} percent, muted` : `${percent} percent`);
    this.opener.setAttribute('aria-label', state.muted ? `Volume (muted)` : `Volume ${percent} percent`);
    const name = state.muted || state.volume === 0 ? 'muted' : 'volume';
    if (this.mute.dataset.icon !== name) {
      swapIcon(this.mute, name);
      swapIcon(this.opener, name);
      this.mute.dataset.icon = name;
    }
  }

  private paintSlider(volume: number): void {
    this.el.style.setProperty('--volume', this.muted ? '0' : volume.toFixed(3));
  }
}
