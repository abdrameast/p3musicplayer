import { CONFIG } from '../config/config';
import type { EventBus } from '../core/EventBus';
import type { AppEvents, AudioFeatures, AudioSyncApi, PlayerApi, SyncMode, SyncResult, SyncStatus } from '../core/types';
import { AudioAnalyzer } from './AudioAnalyzer';
import { createAudioFeatures } from './AudioFeatures';
import { SimulatedSync } from './SimulatedSync';

export interface AudioFeatureEngineOptions {
  bus: EventBus<AppEvents>;
  player: PlayerApi;
  getTapTempo: () => Record<number, number>;
  setTapTempo: (trackId: number, bpm: number | null) => void;
  /** Dependency seams for permission and audio-graph tests. */
  createContext?: () => AudioContext;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
}

const details: Record<SyncMode, string> = {
  simulated: 'Approximate visuals from playback time and a tempo grid. No audio is analysed.',
  tab: 'Shared audio is analysed locally. Nothing is recorded, uploaded, or played twice.',
  mic: 'Microphone audio is analysed locally. Nothing is recorded or uploaded.',
  direct: 'The authorised audio file is analysed directly in this browser.',
};

/** Owns analysis permissions and graphs; never accesses audio inside the YouTube iframe. */
export class AudioFeatureEngine implements AudioSyncApi {
  private readonly features = createAudioFeatures();
  private readonly simulated = new SimulatedSync();
  private readonly mediaSources = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
  private readonly taps = new Map<number, number[]>();
  private readonly anchors = new Map<number, number>();
  private readonly cleanups: Array<() => void> = [];
  private readonly captureCleanups: Array<() => void> = [];
  private status: SyncStatus = this.makeStatus('simulated');
  private context: AudioContext | null = null;
  private analyzer: AudioAnalyzer | null = null;
  private stream: MediaStream | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private directElement: HTMLMediaElement | null = null;
  private requestId = 0;
  private disposed = false;

  constructor(private readonly options: AudioFeatureEngineOptions) {
    this.cleanups.push(options.bus.on('player:track', () => this.analyzer?.reset()));
    this.cleanups.push(options.bus.on('player:state', () => {
      if (this.status.mode === 'direct' && this.directElement !== options.player.getMediaElement()) {
        void this.setMode('simulated');
      }
    }));
  }

  getStatus(): SyncStatus { return { ...this.status }; }
  getFeatures(): Readonly<AudioFeatures> { return this.features; }

  isSupported(mode: SyncMode): boolean {
    if (mode === 'simulated') return true;
    if (!this.options.createContext && typeof globalThis.AudioContext !== 'function') return false;
    if (mode === 'direct') return this.options.player.getMediaElement() !== null;
    const devices = this.devices();
    return mode === 'tab' ? typeof devices?.getDisplayMedia === 'function' : typeof devices?.getUserMedia === 'function';
  }

  async setMode(mode: SyncMode): Promise<SyncResult> {
    if (this.disposed) return { ok: false, status: this.getStatus(), error: 'cancelled' };
    const requestId = ++this.requestId;
    this.releaseInput();
    this.publish('simulated');
    if (mode === 'simulated') return { ok: true, status: this.getStatus() };
    if (!this.isSupported(mode)) return this.failure('unsupported', 'This audio sync mode is unavailable here. Simulated visuals remain available.');

    let acquired: MediaStream | null = null;
    try {
      const context = this.ensureContext();
      // Start both requests during the click handler: display capture requires transient activation.
      const resumed = context.resume().then(() => true, () => false);
      if (mode === 'tab') {
        acquired = await this.devices()!.getDisplayMedia({ video: true, audio: true });
      } else if (mode === 'mic') {
        acquired = await this.devices()!.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
        });
      }
      if (this.stale(requestId)) return { ok: false, status: this.getStatus(), error: 'cancelled' };
      if (!(await resumed) || context.state !== 'running') {
        return this.failure('unavailable', 'The browser did not start audio analysis. Try again using the sync button.');
      }
      if (this.stale(requestId)) return { ok: false, status: this.getStatus(), error: 'cancelled' };
      this.analyzer ??= new AudioAnalyzer(context);
      this.analyzer.reset();
      if (mode === 'direct') {
        const element = this.options.player.getMediaElement();
        if (!element) return this.failure('unavailable', 'Direct analysis needs an authorised audio file.');
        let source = this.mediaSources.get(element);
        if (!source) {
          source = context.createMediaElementSource(element);
          this.mediaSources.set(element, source);
        }
        // A media element can have only one source node, ever. Reuse it across mode changes.
        source.disconnect();
        source.connect(context.destination);
        source.connect(this.analyzer.node);
        this.directElement = element;
      } else {
        if (!acquired?.getAudioTracks().some((track) => track.readyState === 'live')) {
          return this.failure('no-audio-track', 'The shared source contains no audio. Share a browser tab and enable its audio checkbox.');
        }
        this.streamSource = context.createMediaStreamSource(acquired);
        // Analysis branch only: never connect a microphone/shared stream to the speakers.
        this.streamSource.connect(this.analyzer.node);
        this.stream = acquired;
        acquired = null;
        for (const track of this.stream.getTracks()) {
          const ended = () => {
            if (this.stale(requestId)) return;
            void this.setMode('simulated');
            this.options.bus.emit('player:notice', {
              id: 'sync:ended', level: 'info', message: 'Audio sharing ended. Visual sync is now simulated.', ttl: 5000,
            });
          };
          track.addEventListener('ended', ended);
          this.captureCleanups.push(() => track.removeEventListener('ended', ended));
        }
      }
      this.publish(mode);
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      if (this.stale(requestId)) return { ok: false, status: this.getStatus(), error: 'cancelled' };
      this.releaseInput();
      const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      return this.failure(denied ? 'denied' : name === 'NotFoundError' ? 'unavailable' : 'unknown',
        denied ? 'Audio permission was declined. Playback and simulated visuals still work.' : 'Audio analysis could not start. Simulated visuals remain available.');
    } finally {
      // Also closes a permission dialog's late result after another mode was selected/disposal.
      acquired?.getTracks().forEach((track) => track.stop());
    }
  }

  update(dt: number, now: number): AudioFeatures {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    if (this.status.real && this.analyzer && this.context?.state === 'running') {
      this.analyzer.update(step, now, this.features);
    } else {
      const state = this.options.player.getState();
      this.simulated.update(step, {
        trackId: state.trackId, position: this.options.player.getInterpolatedPosition(now),
        playing: state.status === 'PLAYING', duration: state.duration,
        bpm: this.getBpm(state.trackId), beatAnchor: this.anchors.get(state.trackId) ?? 0,
      }, this.features);
    }
    return this.features;
  }

  tap(trackId: number, now = performance.now()): number | null {
    if (!Number.isFinite(now) || !this.options.player.tracks.some((track) => track.id === trackId)) return null;
    let times = this.taps.get(trackId) ?? [];
    const last = times.at(-1);
    if (last !== undefined && (now - last > CONFIG.sync.tapResetMs || now <= last)) times = [];
    // Ignore button bounce, rather than turning it into a 500 BPM estimate.
    if (times.length && now - times[times.length - 1] < 150) return null;
    times.push(now);
    if (times.length > 8) times.shift();
    this.taps.set(trackId, times);
    if (this.options.player.getState().trackId === trackId) {
      this.anchors.set(trackId, this.options.player.getInterpolatedPosition(now));
    }
    if (times.length < 3) return null;
    const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    const middle = Math.floor(intervals.length / 2);
    const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
    const bpm = Math.round(Math.min(CONFIG.sync.maxBpm, Math.max(CONFIG.sync.minBpm, 60000 / median)));
    this.options.setTapTempo(trackId, bpm);
    return bpm;
  }

  getBpm(trackId: number): number {
    const value = this.options.getTapTempo()[trackId];
    return Number.isFinite(value) && value >= CONFIG.sync.minBpm && value <= CONFIG.sync.maxBpm ? value : CONFIG.sync.defaultBpm;
  }

  resetBpm(trackId: number): void {
    this.taps.delete(trackId);
    this.anchors.delete(trackId);
    this.options.setTapTempo(trackId, null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestId += 1;
    this.releaseInput();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const source of this.mediaSources.values()) source.disconnect();
    this.mediaSources.clear();
    this.analyzer?.node.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.analyzer = null;
  }

  private devices(): AudioFeatureEngineOptions['mediaDevices'] {
    return this.options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = this.options.createContext?.() ?? new AudioContext();
      this.context.onstatechange = () => {
        if (this.disposed || this.status.mode === 'simulated') return;
        this.publish(this.status.mode);
      };
    }
    return this.context;
  }

  private releaseInput(): void {
    for (const cleanup of this.captureCleanups.splice(0)) cleanup();
    this.streamSource?.disconnect();
    this.streamSource = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.directElement && this.context) {
      const source = this.mediaSources.get(this.directElement);
      source?.disconnect();
      // Preserve music playback after leaving DIRECT mode.
      source?.connect(this.context.destination);
    }
    this.directElement = null;
  }

  private makeStatus(mode: SyncMode): SyncStatus {
    const real = mode !== 'simulated' && this.context?.state === 'running';
    return {
      mode, real,
      label: mode !== 'simulated' && !real ? `${CONFIG.sync.labels.simulated} · ANALYSIS SUSPENDED` : CONFIG.sync.labels[mode],
      detail: mode !== 'simulated' && !real ? 'Audio analysis is suspended by the browser; visuals are simulated.' : details[mode],
    };
  }

  private publish(mode: SyncMode): void {
    this.status = this.makeStatus(mode);
    this.options.bus.emit('sync:status', this.getStatus());
  }

  private failure(error: NonNullable<SyncResult['error']>, message: string): SyncResult {
    this.publish('simulated');
    return { ok: false, status: this.getStatus(), error, message };
  }

  private stale(requestId: number): boolean { return this.disposed || this.requestId !== requestId; }
}
