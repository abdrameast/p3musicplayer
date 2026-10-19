import type { QualityProfile, SourceStatus } from '../core/types';
import type { UIContext } from './context';
import { sectionTitle } from './controls';
import { formatTime, h } from './dom';

export interface SceneStatsLike {
  fps: number;
  drawCalls: number;
  triangles: number;
  dpr: number;
  profile: QualityProfile;
}

const REFRESH_MS = 500;
const SOURCE_STATUSES: readonly SourceStatus[] = ['READY', 'UNMAPPED', 'UNAVAILABLE', 'EMBED_BLOCKED', 'ERROR'];

/** Dev-only diagnostics (D key). Polls twice a second while open, never otherwise. */
export class DebugPanel {
  readonly el: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: UIContext,
    private readonly getSceneStats: () => SceneStatsLike | null,
  ) {
    const table = h('dl', { class: 'mf-debug__table' });
    const keys = ['fps', 'profile', 'draw calls', 'triangles', 'dpr', 'status', 'track', 'provider', 'time', 'buffered', 'sync', ...SOURCE_STATUSES];
    for (const key of keys) {
      const value = h('dd', null, '—');
      this.values.set(key, value);
      table.append(h('div', { class: 'mf-debug__row' }, h('dt', null, key.toUpperCase()), value));
    }
    this.el = h(
      'div',
      { class: 'mf-debug' },
      h('section', { class: 'mf-section' }, sectionTitle('RUNTIME', '計測'), table),
      h(
        'section',
        { class: 'mf-section' },
        sectionTitle('SOURCES', '音源'),
        h('a', { class: 'mf-textbtn', href: '/validator.html', target: '_blank', rel: 'noopener' }, 'OPEN SOURCE VALIDATOR'),
      ),
    );
  }

  onOpen(): void {
    this.refresh();
    if (!this.timer) this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  onClose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.onClose();
  }

  private set(key: string, value: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== value) el.textContent = value;
  }

  private refresh(): void {
    const { player, sync } = this.ctx;
    const stats = this.getSceneStats();
    this.set('fps', stats ? stats.fps.toFixed(0) : 'no scene');
    this.set('profile', stats?.profile.toUpperCase() ?? '—');
    this.set('draw calls', stats ? String(stats.drawCalls) : '—');
    this.set('triangles', stats ? stats.triangles.toLocaleString('en-US') : '—');
    this.set('dpr', stats ? stats.dpr.toFixed(2) : '—');
    const state = player.getState();
    this.set('status', state.status);
    this.set('track', String(state.trackId));
    this.set('provider', state.provider ?? 'none');
    this.set('time', `${formatTime(player.getInterpolatedPosition())} / ${formatTime(state.duration)}`);
    this.set('buffered', `${Math.round(state.buffered * 100)}%`);
    this.set('sync', sync.getStatus().label);
    const counts = new Map<SourceStatus, number>(SOURCE_STATUSES.map((s) => [s, 0]));
    for (const track of player.tracks) counts.set(track.source.status, (counts.get(track.source.status) ?? 0) + 1);
    for (const status of SOURCE_STATUSES) this.set(status, String(counts.get(status) ?? 0));
  }
}
