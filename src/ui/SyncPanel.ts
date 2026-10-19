import { CONFIG } from '../config/config';
import { formatTrackNumber } from '../config/tracks';
import type { SyncMode, SyncResult, SyncStatus } from '../core/types';
import type { UIContext } from './context';
import { sectionTitle } from './controls';
import { Scope, h } from './dom';

interface ModeCopy {
  name: string;
  jp: string;
  description: string;
  action: string;
  unsupported: string;
}

const MODE_COPY: Readonly<Record<SyncMode, ModeCopy>> = {
  simulated: {
    name: 'SIMULATED',
    jp: '模擬',
    description:
      'Visuals follow an approximate rhythm grid from the playback time and tempo — not real audio analysis. Always available.',
    action: 'USE SIMULATED',
    unsupported: '',
  },
  tab: {
    name: 'LIVE TAB AUDIO',
    jp: 'タブ音声',
    description:
      'Your browser will ask you to share this tab — tick “Share tab audio”. Audio is analysed locally, never recorded or sent.',
    action: 'SHARE TAB AUDIO',
    unsupported: 'This browser cannot share tab audio (desktop Chrome or Edge can).',
  },
  mic: {
    name: 'MICROPHONE',
    jp: 'マイク',
    description:
      'Listens to your speakers through the microphone. Accuracy depends on the room; audio stays on this device.',
    action: 'USE MICROPHONE',
    unsupported: 'Microphone capture is not available in this browser or context.',
  },
  direct: {
    name: 'DIRECT ANALYSIS',
    jp: '直接解析',
    description: 'Exact analysis of a licensed audio file played by this site.',
    action: 'ANALYSE DIRECTLY',
    unsupported: 'Only while licensed audio is playing — a YouTube embed is cross-origin and cannot be analysed.',
  },
};

const ERROR_TEXT: Readonly<Record<NonNullable<SyncResult['error']>, string>> = {
  unsupported: 'Not supported by this browser.',
  denied: 'Permission was denied — visuals stay on the simulated rhythm.',
  'no-audio-track': 'No audio was shared. Share again and tick “Share tab audio”.',
  unavailable: 'Not available right now.',
  cancelled: 'Sharing was cancelled.',
  unknown: 'This mode could not start.',
};

const MODES: readonly SyncMode[] = ['simulated', 'tab', 'mic', 'direct'];
const TAPS_FOR_ESTIMATE = 3;

interface ModeRow {
  li: HTMLElement;
  button: HTMLButtonElement;
  why: HTMLElement;
}

/** AUDIO SYNC · 同期 — honest choice of what drives the visuals, plus tap tempo. */
export class SyncPanel {
  readonly el: HTMLElement;
  private readonly rows = new Map<SyncMode, ModeRow>();
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly result: HTMLElement;
  private readonly bpmValue: HTMLElement;
  private readonly bpmSource: HTMLElement;
  private readonly tapDots: HTMLElement;
  private readonly tempoTrack: HTMLElement;
  private readonly scope = new Scope();
  private busy = false;
  private taps = 0;
  private lastTapAt = -Infinity;

  constructor(private readonly ctx: UIContext) {
    const { sync, bus } = ctx;
    this.label = h('p', { class: 'mf-sync__label' });
    this.detail = h('p', { class: 'mf-sync__detail' });
    this.result = h('p', { class: 'mf-sync__result', role: 'status' });

    const list = h('ul', { class: 'mf-sync__modes' });
    for (const mode of MODES) {
      const copy = MODE_COPY[mode];
      const button = h('button', { type: 'button', class: 'mf-textbtn' }, copy.action);
      const why = h('p', { class: 'mf-syncmode__why', hidden: true }, copy.unsupported);
      const li = h(
        'li',
        { class: 'mf-syncmode', 'data-mode': mode },
        h('p', { class: 'mf-syncmode__name' }, copy.name, h('span', { class: 'mf-syncmode__jp', lang: 'ja' }, copy.jp)),
        h('p', { class: 'mf-syncmode__desc' }, copy.description),
        why,
        button,
      );
      this.rows.set(mode, { li, button, why });
      list.append(li);
      this.scope.listen(button, 'click', () => void this.choose(mode));
    }

    this.bpmValue = h('span', { class: 'mf-bpm__value' });
    this.bpmSource = h('span', { class: 'mf-bpm__source' });
    this.tempoTrack = h('span', { class: 'mf-bpm__track' });
    this.tapDots = h('span', { class: 'mf-tap__dots', 'aria-hidden': 'true' });
    const tap = h('button', { type: 'button', class: 'mf-tap' }, h('span', { class: 'mf-tap__label' }, 'TAP'), this.tapDots);
    const reset = h('button', { type: 'button', class: 'mf-textbtn' }, 'RESET TEMPO');
    // Pointer taps register on press for timing accuracy; keyboard activation arrives as a click with detail 0.
    this.scope.listen<PointerEvent>(tap, 'pointerdown', (event) => {
      if (event.button === 0) this.tap(event.timeStamp);
    });
    this.scope.listen<MouseEvent>(tap, 'click', (event) => {
      if (event.detail === 0) this.tap(performance.now());
    });
    this.scope.listen(reset, 'click', () => {
      sync.resetBpm(ctx.player.getCurrentTrack().id);
      this.taps = 0;
      this.renderTempo();
    });

    this.el = h(
      'div',
      { class: 'mf-sync' },
      h('div', { class: 'mf-sync__current' }, h('span', { class: 'mf-micro' }, 'ACTIVE SIGNAL'), this.label, this.detail),
      h('section', { class: 'mf-section' }, sectionTitle('SOURCE OF MOTION', '同期方式'), list, this.result),
      h(
        'section',
        { class: 'mf-section' },
        sectionTitle('TEMPO', '拍子'),
        h('p', { class: 'mf-bpm' }, this.bpmValue, h('span', { class: 'mf-bpm__unit' }, 'BPM'), this.bpmSource, this.tempoTrack),
        h('div', { class: 'mf-tap__row' }, tap, reset),
        h(
          'p',
          { class: 'mf-hint' },
          `Tap at least ${TAPS_FOR_ESTIMATE} times on the beat. The tempo shapes the simulated rhythm grid for the current track.`,
        ),
      ),
    );

    this.scope.add(bus.on('sync:status', (status) => this.applyStatus(status)));
    this.scope.add(bus.on('player:state', () => this.refreshSupport()));
    this.scope.add(
      bus.on('player:track', () => {
        this.taps = 0;
        this.renderTempo();
      }),
    );
    this.applyStatus(sync.getStatus());
    this.renderTempo();
  }

  onOpen(): void {
    this.refreshSupport();
    this.renderTempo();
  }

  dispose(): void {
    this.scope.dispose();
  }

  private async choose(mode: SyncMode): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.result.textContent = mode === 'tab' ? 'Waiting for your browser’s share dialog…' : 'Switching…';
    this.refreshSupport();
    this.ctx.sounds.play('select');
    try {
      const result = await this.ctx.sync.setMode(mode);
      this.result.textContent = result.ok
        ? `${MODE_COPY[result.status.mode].name} active.`
        : (result.message ?? ERROR_TEXT[result.error ?? 'unknown']);
      this.applyStatus(result.status);
    } catch (error) {
      console.warn('[ui] sync mode failed', error);
      this.result.textContent = ERROR_TEXT.unknown;
    } finally {
      this.busy = false;
      this.refreshSupport();
    }
  }

  private applyStatus(status: SyncStatus): void {
    this.label.textContent = status.label;
    this.label.dataset.real = String(status.real);
    this.detail.textContent = status.detail ?? (status.real ? 'Driven by analysed audio.' : 'Approximate — no audio is analysed.');
    for (const [mode, row] of this.rows) row.li.classList.toggle('is-active', mode === status.mode);
    this.refreshSupport();
  }

  private refreshSupport(): void {
    const active = this.ctx.sync.getStatus().mode;
    for (const [mode, row] of this.rows) {
      const supported = mode === 'simulated' || (this.ctx.sync.isSupported(mode) && (mode !== 'direct' || this.hasLicensedAudio()));
      const isActive = mode === active;
      row.why.hidden = supported;
      row.li.classList.toggle('is-disabled', !supported);
      row.button.disabled = !supported || isActive || this.busy;
      row.button.textContent = isActive ? 'ACTIVE' : MODE_COPY[mode].action;
    }
  }

  private tap(now: number): void {
    const trackId = this.ctx.player.getCurrentTrack().id;
    if (now - this.lastTapAt > CONFIG.sync.tapResetMs) this.taps = 0;
    this.lastTapAt = now;
    this.taps += 1;
    this.renderTempo(this.ctx.sync.tap(trackId, now));
  }

  private hasLicensedAudio(): boolean {
    return this.ctx.player.getMediaElement() !== null;
  }

  /** `estimate` is the fresh tap-tempo result, when the last tap produced one. */
  private renderTempo(estimate: number | null = null): void {
    const trackId = this.ctx.player.getCurrentTrack().id;
    const bpm = estimate ?? this.ctx.sync.getBpm(trackId);
    const tapped = estimate !== null || trackId in this.ctx.prefs.get().tapTempo;
    this.bpmValue.textContent = bpm.toFixed(bpm % 1 === 0 ? 0 : 1);
    this.bpmSource.textContent = tapped ? 'TAPPED' : 'CONFIGURED';
    this.tempoTrack.textContent = `TRACK ${formatTrackNumber(trackId)}`;
    const shown = Math.min(this.taps, TAPS_FOR_ESTIMATE);
    this.tapDots.textContent = '●'.repeat(shown) + '○'.repeat(TAPS_FOR_ESTIMATE - shown);
  }
}
