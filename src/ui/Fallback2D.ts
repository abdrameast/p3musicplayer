import { formatTrackNumber } from '../config/tracks';
import type { EventBus } from '../core/EventBus';
import type { AppEvents, PlaybackState, PlaybackStatus, PlayerApi, ResolvedTrack } from '../core/types';
import { Scope, formatTime, h, run, s } from './dom';
import { STATUS_LABEL, isPlayingLike } from './status';

const STATE_ICON: Readonly<Record<PlaybackStatus, string>> = {
  INITIALIZING: '…',
  READY: '■',
  PLAYING: '▶',
  PAUSED: '❚❚',
  BUFFERING: '◌',
  ENDED: '■',
  SOURCE_UNAVAILABLE: '×',
  AUTOPLAY_BLOCKED: '▶',
  ERROR: '!',
};

/** Titles longer than this scroll on the LCD (CSS marquee with pauses at both ends). */
const MARQUEE_MIN_CHARS = 18;

/**
 * Original flat SVG walkman in the illustration language (thick ink
 * outlines, white/silver flats, hard shadow side, dark end cap + clip, split
 * ring and navy strap) drawn horizontally, then posed on a diagonal by CSS.
 * Coordinates use a 640×220 box; the LCD overlay is positioned with the
 * same percentages as the drawn window.
 */
function walkmanSvg(): SVGSVGElement {
  const ink = { stroke: '#050B1A', 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  return s(
    'svg',
    { class: 'mf-fb__svg', viewBox: '0 0 640 220', 'aria-hidden': 'true', focusable: 'false' },
    s(
      'defs',
      null,
      s(
        'pattern',
        { id: 'mf-fb-pixels', width: 4, height: 4, patternUnits: 'userSpaceOnUse' },
        s('rect', { width: 4, height: 4, fill: '#A9F5FF' }),
        s('rect', { width: 3, height: 3, fill: '#BFF8FF' }),
      ),
    ),
    // Strap: wide navy ribbon looping out of frame, with a light stitch line.
    s('path', {
      class: 'mf-fb__strap',
      d: 'M-20 40 C40 34 70 64 104 96 L118 112 C88 132 52 150 -20 150 Z',
      fill: '#092B65',
      ...ink,
    }),
    s('path', { d: 'M-12 62 C40 60 66 82 98 108', fill: 'none', stroke: '#668EB8', 'stroke-width': 2, 'stroke-dasharray': '6 6' }),
    // Crimp + split ring.
    s('rect', { x: 100, y: 94, width: 26, height: 22, rx: 3, fill: '#B8CEDF', ...ink, transform: 'rotate(-28 113 105)' }),
    s('circle', { cx: 140, cy: 108, r: 13, fill: 'none', ...ink, 'stroke-width': 6 }),
    s('circle', { cx: 140, cy: 108, r: 13, fill: 'none', stroke: '#F8FCFF', 'stroke-width': 2 }),
    // L-shaped clip under the end cap.
    s('path', { d: 'M168 128 L168 176 L232 176 Q244 176 244 164 L244 152 L196 152 L196 128 Z', fill: '#0B1424', ...ink }),
    // Dark gunmetal end cap.
    s('path', { d: 'M156 68 Q156 58 166 58 L228 58 L228 158 L166 158 Q156 158 156 148 Z', fill: '#2B3A52', ...ink }),
    s('path', { d: 'M164 72 L222 72', stroke: '#668EB8', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    // Body: long white/silver cylinder with a rounded dome on the right.
    s('path', {
      class: 'mf-fb__body',
      d: 'M226 56 L566 56 Q616 56 616 108 Q616 160 566 160 L226 160 Z',
      fill: '#F8FCFF',
      ...ink,
    }),
    // Hard shadow side (lower third), the illustration's black flat.
    s('path', { d: 'M228 128 L590 128 Q608 128 612 120 Q606 160 566 160 L228 160 Z', fill: '#050B1A' }),
    s('path', { d: 'M232 120 L586 120', stroke: '#B8CEDF', 'stroke-width': 6, 'stroke-linecap': 'round' }),
    // Joint between body and dome.
    s('path', { d: 'M548 58 Q558 108 548 158', fill: 'none', stroke: '#050B1A', 'stroke-width': 3 }),
    // Specular highlight band on the top.
    s('path', { d: 'M240 66 L536 66', stroke: '#FFFFFF', 'stroke-width': 5, 'stroke-linecap': 'round' }),
    // Buttons on the top edge.
    ...[262, 300, 338, 376, 414].map((x) =>
      s('rect', { x, y: 44, width: 26, height: 12, rx: 4, fill: '#0B1424', ...ink, 'stroke-width': 3 }),
    ),
    // LCD window: frame + backlit pixel glass.
    s('rect', { x: 248, y: 72, width: 282, height: 50, rx: 4, fill: '#050B1A' }),
    s('rect', { class: 'mf-fb__glass', x: 254, y: 77, width: 270, height: 40, rx: 2, fill: 'url(#mf-fb-pixels)' }),
  );
}

export interface Fallback2DOptions {
  player: PlayerApi;
  bus: EventBus<AppEvents>;
  reason: string;
}

/** 2D walkman used when WebGL is missing or lost. The whole object is the play/pause button. */
export class Fallback2D {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly stateIcon: HTMLElement;
  private readonly stateText: HTMLElement;
  private readonly number: HTMLElement;
  private readonly marquee: HTMLElement;
  private readonly time: HTMLElement;
  private readonly scope = new Scope();

  constructor(opts: Fallback2DOptions) {
    this.stateIcon = h('span', { class: 'mf-fb__icon', 'aria-hidden': 'true' });
    this.stateText = h('span', { class: 'mf-fb__state' });
    this.number = h('span', { class: 'mf-fb__num' });
    this.marquee = h('span', { class: 'mf-fb__marquee' });
    this.time = h('span', { class: 'mf-fb__time' }, '0:00');
    const lcd = h(
      'span',
      { class: 'mf-fb__lcd' },
      h('span', { class: 'mf-fb__row' }, this.stateIcon, this.stateText, this.number),
      h('span', { class: 'mf-fb__title' }, this.marquee),
      h('span', { class: 'mf-fb__row mf-fb__row--end' }, this.time),
    );
    this.button = h(
      'button',
      { type: 'button', class: 'mf-fb__object', 'aria-label': 'Play — walkman' },
      h('span', { class: 'mf-fb__pose' }, walkmanSvg(), lcd),
    );
    this.el = h(
      'div',
      { class: 'mf-fb' },
      this.button,
      h('p', { class: 'mf-fb__reason' }, h('span', { class: 'mf-micro' }, '2D MODE · '), opts.reason),
    );

    const { player, bus } = opts;
    this.scope.listen(this.button, 'click', () => run(player.toggle(), 'toggle'));
    this.scope.add(bus.on('player:state', (state) => this.applyState(state)));
    this.scope.add(bus.on('player:track', (change) => this.applyTrack(change.track)));
    this.scope.add(bus.on('player:time', ({ position }) => this.applyTime(position)));
    this.applyTrack(player.getCurrentTrack());
    this.applyState(player.getState());
  }

  mount(parent: HTMLElement): void {
    parent.append(this.el);
  }

  dispose(): void {
    this.scope.dispose();
    this.el.remove();
  }

  private applyTrack(track: ResolvedTrack): void {
    const title = track.title.toUpperCase();
    const scrolls = [...title].length > MARQUEE_MIN_CHARS;
    // Two copies make the loop seamless: at -50 % the second copy sits exactly where the first began.
    const copies = [h('span', { class: 'mf-fb__copy' }, title)];
    if (scrolls) copies.push(h('span', { class: 'mf-fb__copy', 'aria-hidden': 'true' }, title));
    this.marquee.replaceChildren(...copies);
    this.marquee.classList.toggle('is-scrolling', scrolls);
    this.marquee.style.setProperty('--marquee-s', `${Math.max(8, [...title].length * 0.42).toFixed(1)}s`);
    this.number.textContent = formatTrackNumber(track.id);
    this.applyTime(0);
  }

  private applyState(state: Readonly<PlaybackState>): void {
    const playingLike = isPlayingLike(state.status);
    this.stateIcon.textContent = STATE_ICON[state.status];
    this.stateText.textContent = STATUS_LABEL[state.status];
    this.button.setAttribute('aria-label', playingLike ? 'Pause — walkman' : 'Play — walkman');
    this.el.dataset.status = state.status.toLowerCase();
    this.el.classList.toggle('is-playing', state.status === 'PLAYING');
    this.applyTime(state.position);
  }

  private applyTime(position: number): void {
    this.time.textContent = formatTime(position);
  }
}
