import type { PlaybackState } from '../core/types';
import type { UIContext } from './context';
import { Scope, clamp, formatTime, h, run } from './dom';

/**
 * Seek bar: a native <input type="range"> (keyboard + screen readers) laid
 * over a drawn rail. Progress is a CSS variable written from the
 * interpolated position each frame; text updates follow 'player:time'.
 */
export class Timeline {
  readonly el: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly current: HTMLElement;
  private readonly total: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly buffering: HTMLElement;
  private readonly scope = new Scope();
  private duration = 0;
  private canSeek = false;
  private scrubbing = false;
  private lastProgress = -1;
  private lastBuffered = -1;
  private lastWholeSecond = -1;

  constructor(private readonly ctx: UIContext) {
    this.input = h('input', {
      type: 'range',
      class: 'mf-timeline__input',
      min: 0,
      max: 1,
      step: 0.1,
      value: 0,
      'aria-label': 'Seek',
      'aria-keyshortcuts': 'Home End',
    });
    this.tip = h('span', { class: 'mf-timeline__tip', 'aria-hidden': 'true' }, '0:00');
    this.rail = h(
      'div',
      { class: 'mf-timeline__rail' },
      h('span', { class: 'mf-timeline__track', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-timeline__buffer', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-timeline__progress', 'aria-hidden': 'true' }),
      h('span', { class: 'mf-timeline__thumb', 'aria-hidden': 'true' }),
      this.input,
      this.tip,
    );
    this.current = h('span', { class: 'mf-timeline__time mf-timeline__time--current' }, '0:00');
    this.total = h('span', { class: 'mf-timeline__time mf-timeline__time--total' }, '0:00');
    this.buffering = h('span', { class: 'mf-timeline__buffering', role: 'status' });
    this.el = h('div', { class: 'mf-timeline' }, this.current, this.rail, this.total, this.buffering);

    this.scope.listen(this.input, 'input', () => this.onScrub());
    this.scope.listen(this.input, 'change', () => this.commitSeek());
    this.scope.listen(this.input, 'pointerdown', () => {
      this.scrubbing = true;
    });
    // A press released without moving fires no 'change': end the scrub after
    // the browser had its chance to dispatch one.
    const endPress = () => setTimeout(() => (this.scrubbing = false), 0);
    this.scope.listen(this.input, 'pointerup', endPress);
    this.scope.listen(this.input, 'pointercancel', endPress);
    this.scope.listen(this.input, 'blur', () => {
      this.scrubbing = false;
    });
    this.scope.listen<PointerEvent>(this.rail, 'pointermove', (event) => this.onHover(event));
    this.scope.listen(this.rail, 'pointerleave', () => this.rail.classList.remove('is-hover'));

    const { bus, player } = ctx;
    this.scope.add(bus.on('player:state', (state) => this.applyState(state)));
    this.scope.add(bus.on('player:time', ({ position, duration, buffered }) => this.applyTime(position, duration, buffered)));
    this.scope.add(bus.on('player:track', () => this.resetForTrack()));
    this.applyState(player.getState());
  }

  /** Per-frame: progress from the interpolated playback position. */
  update(position: number): void {
    if (this.scrubbing || this.duration <= 0) return;
    const progress = clamp(position / this.duration, 0, 1);
    if (Math.abs(progress - this.lastProgress) < 0.0004) return;
    this.lastProgress = progress;
    this.rail.style.setProperty('--progress', progress.toFixed(4));
  }

  dispose(): void {
    this.scope.dispose();
  }

  private applyState(state: Readonly<PlaybackState>): void {
    this.canSeek = state.canSeek && state.duration > 0;
    this.input.disabled = !this.canSeek;
    this.el.classList.toggle('is-disabled', !this.canSeek);
    const buffering = state.status === 'BUFFERING';
    this.el.classList.toggle('is-buffering', buffering);
    this.buffering.textContent = buffering ? 'BUFFERING' : '';
    this.applyTime(state.position, state.duration, state.buffered);
  }

  private applyTime(position: number, duration: number, buffered: number): void {
    if (duration !== this.duration) {
      this.duration = duration > 0 ? duration : 0;
      this.input.max = String(Math.max(1, this.duration));
      this.total.textContent = formatTime(this.duration);
    }
    if (Math.abs(buffered - this.lastBuffered) > 0.002) {
      this.lastBuffered = buffered;
      this.rail.style.setProperty('--buffered', clamp(buffered, 0, 1).toFixed(3));
    }
    if (this.scrubbing) return;
    const whole = Math.floor(position);
    if (whole !== this.lastWholeSecond) {
      this.lastWholeSecond = whole;
      this.current.textContent = formatTime(position);
      this.input.value = String(position);
      this.input.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(this.duration)}`);
    }
  }

  private resetForTrack(): void {
    this.scrubbing = false;
    this.lastWholeSecond = -1;
    this.lastProgress = -1;
    this.rail.style.setProperty('--progress', '0');
    this.applyTime(0, 0, 0);
  }

  private onScrub(): void {
    this.scrubbing = true;
    const value = Number(this.input.value);
    const progress = this.duration > 0 ? clamp(value / this.duration, 0, 1) : 0;
    this.rail.style.setProperty('--progress', progress.toFixed(4));
    this.current.textContent = formatTime(value);
    this.input.setAttribute('aria-valuetext', `${formatTime(value)} of ${formatTime(this.duration)}`);
  }

  private commitSeek(): void {
    const target = Number(this.input.value);
    this.scrubbing = false;
    this.lastWholeSecond = -1;
    if (!this.canSeek || !Number.isFinite(target)) return;
    run(this.ctx.player.seek(target), 'seek');
  }

  private onHover(event: PointerEvent): void {
    if (!this.canSeek) return;
    const rect = this.rail.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    this.rail.classList.add('is-hover');
    this.rail.style.setProperty('--hover', ratio.toFixed(4));
    this.tip.textContent = formatTime(ratio * this.duration);
  }
}
