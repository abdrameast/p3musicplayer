import { MODES } from '../config/config';
import { formatTrackNumber } from '../config/tracks';
import type { PlaybackState, RepeatMode, VisualMode } from '../core/types';
import type { UIContext } from './context';
import { Scope, h, run } from './dom';
import { icon, swapIcon } from './icons';
import { STATUS_LABEL, isPlayingLike } from './status';
import { Timeline } from './Timeline';
import { VolumeControl } from './VolumeControl';

const MODE_ORDER: readonly VisualMode[] = ['moonlight', 'darkhour', 'bluememory'];
const REPEAT_LABEL: Readonly<Record<RepeatMode, string>> = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

export function nextVisualMode(mode: VisualMode): VisualMode {
  return MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
}

const titleCase = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

/** Bottom bar: timeline, dominant transport, secondary actions. */
export class PlayerControls {
  readonly el: HTMLElement;
  readonly timeline: Timeline;
  readonly volume: VolumeControl;
  private readonly play: HTMLButtonElement;
  private readonly repeat: HTMLButtonElement;
  private readonly mode: HTMLButtonElement;
  private readonly fullscreen: HTMLButtonElement | null;
  private readonly stateText: HTMLElement;
  private readonly channel: HTMLElement;
  private readonly scope = new Scope();
  private playingLike: boolean | null = null;

  constructor(ctx: UIContext) {
    const { player, sounds } = ctx;
    this.timeline = new Timeline(ctx);
    this.volume = new VolumeControl(ctx);

    const previous = this.transportButton('previous', 'Previous track', 'ArrowLeft', 'Previous · ←');
    this.play = h(
      'button',
      { type: 'button', class: 'mf-play', 'aria-label': 'Play', 'aria-keyshortcuts': 'Space', 'data-tip': 'Play · Space' },
      h('span', { class: 'mf-play__shape', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-play__ring', 'aria-hidden': 'true' }),
      icon('play'),
    );
    const next = this.transportButton('next', 'Next track', 'ArrowRight', 'Next · →');
    this.scope.listen(previous, 'click', () => run(player.previous(), 'previous'));
    this.scope.listen(next, 'click', () => run(player.next(), 'next'));
    this.scope.listen(this.play, 'click', () => {
      sounds.play('toggle');
      run(player.toggle(), 'toggle');
    });

    this.repeat = h(
      'button',
      { type: 'button', class: 'mf-iconbtn mf-repeat', 'aria-pressed': 'false', 'data-tip': 'Repeat' },
      icon('repeat'),
      h('span', { class: 'mf-repeat__badge', 'aria-hidden': 'true' }, '1'),
    );
    this.scope.listen(this.repeat, 'click', () => {
      player.cycleRepeat();
      sounds.play('toggle');
    });

    const tracklist = h(
      'button',
      { type: 'button', class: 'mf-iconbtn mf-tracklist-btn', 'aria-label': 'Tracklist', 'aria-keyshortcuts': 'T', 'data-tip': 'Tracklist · T' },
      icon('list'),
      h('span', { class: 'mf-tracklist-btn__label', 'aria-hidden': 'true' }, 'TRACKLIST'),
    );
    ctx.bindPanelOpener('tracklist', tracklist);
    this.scope.listen(tracklist, 'click', () => ctx.togglePanel('tracklist', tracklist));

    const sync = h(
      'button',
      { type: 'button', class: 'mf-iconbtn', 'aria-label': 'Audio sync', 'aria-keyshortcuts': 'S', 'data-tip': 'Audio sync · S' },
      icon('sync'),
    );
    ctx.bindPanelOpener('sync', sync);
    this.scope.listen(sync, 'click', () => ctx.togglePanel('sync', sync));

    this.mode = h(
      'button',
      { type: 'button', class: 'mf-iconbtn mf-modebtn' },
      icon('mode'),
      h('span', { class: 'mf-modebtn__glyph', lang: 'ja', 'aria-hidden': 'true' }),
    );
    this.scope.listen(this.mode, 'click', () => {
      ctx.setVisualMode(nextVisualMode(ctx.prefs.get().visualMode));
      sounds.play('select');
    });

    this.fullscreen = document.fullscreenEnabled
      ? h('button', { type: 'button', class: 'mf-iconbtn', 'aria-pressed': 'false', 'aria-keyshortcuts': 'F' }, icon('fullscreen'))
      : null;
    if (this.fullscreen) {
      const button = this.fullscreen;
      this.scope.listen(button, 'click', () => toggleFullscreen());
      this.scope.listen(document, 'fullscreenchange', () => this.applyFullscreen());
      this.applyFullscreen();
    }

    this.stateText = h('span', { class: 'mf-dock__status' });
    this.channel = h('span', { class: 'mf-dock__channel' });
    this.el = h(
      'footer',
      { class: 'mf-dock', 'aria-label': 'Playback controls' },
      this.timeline.el,
      h(
        'div',
        { class: 'mf-dock__row' },
        h(
          'div',
          { class: 'mf-dock__readout', 'aria-hidden': 'true' },
          h('span', { class: 'mf-dock__diamond' }),
          this.stateText,
          this.channel,
          h('span', { class: 'mf-dock__jp', lang: 'ja' }, '再生'),
        ),
        h('div', { class: 'mf-transport', role: 'group', 'aria-label': 'Transport' }, previous, this.play, next),
        h(
          'div',
          { class: 'mf-secondary', role: 'group', 'aria-label': 'Playback options' },
          this.volume.el,
          this.repeat,
          sync,
          this.mode,
          this.fullscreen,
          tracklist,
        ),
      ),
    );

    this.scope.add(ctx.bus.on('player:state', (state) => this.applyState(state)));
    this.scope.add(ctx.bus.on('visual:mode', (mode) => this.applyMode(mode)));
    this.applyState(player.getState());
    this.applyMode(ctx.prefs.get().visualMode);
  }

  update(position: number): void {
    this.timeline.update(position);
  }

  /** Closes the mobile volume popover; true if it was open. */
  closePopover(): boolean {
    if (!this.volume.isPopoverOpen()) return false;
    this.volume.setPopover(false);
    return true;
  }

  dispose(): void {
    this.scope.dispose();
    this.timeline.dispose();
    this.volume.dispose();
  }

  private transportButton(name: 'previous' | 'next', label: string, key: string, tip: string): HTMLButtonElement {
    return h(
      'button',
      { type: 'button', class: `mf-skip mf-skip--${name}`, 'aria-label': label, 'aria-keyshortcuts': key, 'data-tip': tip },
      h('span', { class: 'mf-skip__shape', 'aria-hidden': 'true' }),
      icon(name),
    );
  }

  private applyState(state: Readonly<PlaybackState>): void {
    const playingLike = isPlayingLike(state.status);
    if (playingLike !== this.playingLike) {
      this.playingLike = playingLike;
      swapIcon(this.play, playingLike ? 'pause' : 'play');
      this.play.setAttribute('aria-label', playingLike ? 'Pause' : 'Play');
      this.play.dataset.tip = playingLike ? 'Pause · Space' : 'Play · Space';
    }
    this.play.dataset.status = state.status.toLowerCase();
    this.el.dataset.status = state.status.toLowerCase();
    this.stateText.textContent = STATUS_LABEL[state.status];
    this.channel.textContent = `CH ${formatTrackNumber(state.trackId)}`;

    this.repeat.dataset.mode = state.repeat;
    this.repeat.setAttribute('aria-pressed', String(state.repeat !== 'off'));
    this.repeat.setAttribute('aria-label', `${REPEAT_LABEL[state.repeat]} — change repeat mode`);
    this.repeat.dataset.tip = REPEAT_LABEL[state.repeat];
  }

  private applyMode(mode: VisualMode): void {
    const current = MODES[mode];
    const upcoming = MODES[nextVisualMode(mode)];
    this.mode.setAttribute('aria-label', `Visual mode: ${titleCase(current.label)}. Switch to ${titleCase(upcoming.label)}`);
    this.mode.dataset.tip = `${current.label} → ${upcoming.label}`;
    const glyph = this.mode.querySelector('.mf-modebtn__glyph');
    if (glyph) glyph.textContent = current.kanji.charAt(0);
  }

  private applyFullscreen(): void {
    if (!this.fullscreen) return;
    const active = Boolean(document.fullscreenElement);
    swapIcon(this.fullscreen, active ? 'fullscreenExit' : 'fullscreen');
    this.fullscreen.setAttribute('aria-pressed', String(active));
    this.fullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    this.fullscreen.dataset.tip = active ? 'Exit fullscreen · F' : 'Fullscreen · F';
  }
}

export function toggleFullscreen(): void {
  if (!document.fullscreenEnabled) return;
  try {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    run(Promise.resolve(request), 'fullscreen');
  } catch (error) {
    console.warn('[ui] fullscreen failed', error);
  }
}
