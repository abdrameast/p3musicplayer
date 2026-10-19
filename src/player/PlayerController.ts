import type { MusicProvider, ProviderError, ProviderSnapshot, ProviderStatus } from '../audio/MusicProvider';
import { CONFIG, getVisualProfile } from '../config/config';
import type { EventBus } from '../core/EventBus';
import { createPlaybackMachine } from '../core/StateMachine';
import type {
  AppEvents,
  Notice,
  PlaybackError,
  PlaybackErrorCode,
  PlaybackState,
  PlaybackStatus,
  PlayerApi,
  RepeatMode,
  ResolvedTrack,
  SelectResult,
  SourceKind,
  SourcePreference,
  TrackChange,
} from '../core/types';
import { UNMAPPED_REASON, type SourceResolver } from '../sources/SourceResolver';

export interface PlayerControllerOptions {
  bus: EventBus<AppEvents>;
  resolver: SourceResolver;
  initial: { trackId: number; volume: number; muted: boolean; repeat: RepeatMode };
  sourcePreference: SourcePreference;
  /** Providers are created lazily, the first time a track needs them. */
  createYouTubeProvider: () => MusicProvider;
  createLicensedProvider: () => MusicProvider;
  /** Millisecond clock (performance.now by default). */
  now?: () => number;
}

interface ProviderSlot {
  provider: MusicProvider;
  ready: Promise<MusicProvider>;
  isReady: boolean;
  unsubscribe: Array<() => void>;
}

interface LoadRequest {
  autoplay: boolean;
  startSeconds?: number;
}

interface SelectRequest {
  autoplay: boolean;
  direction: 1 | -1 | 0;
  /** Made by auto-advance (track end / auto-skip) rather than by the user. */
  auto: boolean;
}

const STATUS_FROM_PROVIDER: Readonly<Record<ProviderStatus, PlaybackStatus | null>> = {
  idle: null,
  cued: 'READY',
  playing: 'PLAYING',
  paused: 'PAUSED',
  buffering: 'BUFFERING',
  ended: 'ENDED',
  error: null,
};

const REPEAT_CYCLE: Readonly<Record<RepeatMode, RepeatMode>> = { off: 'all', all: 'one', one: 'off' };

const ACTIVE_STATUSES: ReadonlySet<PlaybackStatus> = new Set<PlaybackStatus>(['PLAYING', 'BUFFERING']);

const NOTICE_ID = {
  source: 'player:source',
  provider: 'player:provider',
  autoplay: 'player:autoplay',
  skipped: 'player:skipped',
  signal: 'player:signal',
  advance: 'player:advance',
  catalogue: 'player:catalogue',
} as const;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * The playback engine: single source of truth for PlaybackState.
 *
 * - Status only changes through the playback state machine, fed by provider
 *   events and snapshots — never from a local "isPlaying" flag.
 * - Every selection gets a monotonic requestId; results of superseded async
 *   work and events from a source that is no longer expected are dropped.
 * - A track without a READY source is never played, and nothing else is ever
 *   loaded under its name.
 */
export class PlayerController implements PlayerApi {
  readonly tracks: readonly ResolvedTrack[];

  private readonly bus: EventBus<AppEvents>;
  private readonly resolver: SourceResolver;
  private readonly factories: Readonly<Record<SourceKind, () => MusicProvider>>;
  private readonly now: () => number;
  private readonly machine = createPlaybackMachine();
  private readonly state: PlaybackState;
  private readonly slots = new Map<SourceKind, ProviderSlot>();

  private view: Readonly<PlaybackState> | null = null;
  private lastSignature = '';
  private lastTimeEmit = Number.NEGATIVE_INFINITY;
  private current: ResolvedTrack;
  private requestId = 0;
  private activeKind: SourceKind | null = null;
  private expectedSourceId: string | null = null;
  private sourcePreference: SourcePreference;
  private signalOpen = true;
  /** User intent to hear music (play / autoplaying selection vs pause). Intent only — status always comes from providers. */
  private wantsPlayback = false;
  /** play() arrived while the provider was still initialising. */
  private playWhenReady = false;
  /** play() is waiting for the UI to open the signal window. */
  private playWhenSignalOpens = false;
  private autoAdvance = false;
  private consecutiveFailures = 0;
  private autoSkipTimer: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: PlayerControllerOptions) {
    this.bus = options.bus;
    this.resolver = options.resolver;
    this.factories = { youtube: options.createYouTubeProvider, licensed: options.createLicensedProvider };
    this.now = options.now ?? (() => performance.now());
    this.sourcePreference = options.sourcePreference;
    this.tracks = options.resolver.getResolvedTracks();
    const first = this.tracks[0];
    if (!first) throw new Error('PlayerController needs a non-empty catalogue.');
    this.current = this.trackById(options.initial.trackId) ?? first;
    this.state = {
      status: this.machine.state,
      trackId: this.current.id,
      provider: null,
      position: 0,
      duration: this.current.source.durationHint ?? 0,
      buffered: 0,
      volume: clamp01(options.initial.volume),
      muted: options.initial.muted,
      repeat: options.initial.repeat,
      canSeek: false,
      error: null,
      sampledAt: this.now(),
    };
  }

  /** Announces the restored track and cues it (never autoplays). Idempotent. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      const requestId = ++this.requestId;
      this.bus.emit('player:track', this.trackChange(this.current, null, 0, requestId));
      this.emitState(true);
      await this.loadCurrent(requestId, { autoplay: false });
    })();
    return this.initPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.clearAutoSkip();
    for (const [kind, slot] of [...this.slots]) this.releaseSlot(kind, slot);
  }

  // ─────────────────────────────────────────────────────────────── queries ──

  getState(): Readonly<PlaybackState> {
    this.view ??= Object.freeze({ ...this.state, error: this.state.error ? { ...this.state.error } : null });
    return this.view;
  }

  getCurrentTrack(): ResolvedTrack {
    return this.current;
  }

  getInterpolatedPosition(now: number = this.now()): number {
    const { status, position, sampledAt, duration } = this.state;
    if (status !== 'PLAYING') return position;
    const extrapolated = position + Math.max(0, now - sampledAt) / 1000;
    return duration > 0 ? Math.min(extrapolated, duration) : extrapolated;
  }

  isPlayable(trackId: number): boolean {
    return this.resolver.isPlayable(trackId, this.sourcePreference);
  }

  isSignalWindowOpen(): boolean {
    return this.signalOpen;
  }

  getMediaElement(): HTMLMediaElement | null {
    if (this.activeKind !== 'licensed') return null;
    const slot = this.slots.get('licensed');
    return slot?.isReady ? slot.provider.getMediaElement() : null;
  }

  // ────────────────────────────────────────────────────────────── commands ──

  async play(): Promise<void> {
    if (this.disposed) return;
    this.wantsPlayback = true;
    const status = this.state.status;
    if (status === 'SOURCE_UNAVAILABLE') {
      this.notifyCurrentProblem();
      return;
    }
    if (status === 'ERROR') {
      await this.retry();
      return;
    }
    if (this.activeKind === 'youtube' && !this.requestSignalWindow()) return;
    const slot = this.activeSlot();
    if (status === 'INITIALIZING' || !slot?.isReady || slot.provider.getPlaybackState().sourceId !== this.expectedSourceId) {
      this.playWhenReady = true;
      return;
    }
    if (status === 'AUTOPLAY_BLOCKED') {
      this.state.error = null;
      this.emitState();
    }
    if (status === 'ENDED') slot.provider.seek(0);
    await slot.provider.play();
  }

  async pause(): Promise<void> {
    this.wantsPlayback = false;
    this.playWhenReady = false;
    this.playWhenSignalOpens = false;
    this.clearAutoSkip();
    const slot = this.activeSlot();
    if (slot?.isReady) slot.provider.pause();
  }

  async toggle(): Promise<void> {
    if (ACTIVE_STATUSES.has(this.state.status) || this.playWhenReady) await this.pause();
    else await this.play();
  }

  async next(): Promise<void> {
    const target = this.findPlayable(this.current.id, 1, { wrap: true, includeSelf: false });
    if (!target) {
      this.reportNothingElsePlayable();
      return;
    }
    this.noticeSkipped(target.skipped);
    await this.selectTrack(target.id, { autoplay: this.wantsPlayback, direction: 1, auto: false });
  }

  async previous(): Promise<void> {
    if (this.activeSlot()?.isReady && this.state.canSeek && this.getInterpolatedPosition() > CONFIG.playback.previousRestartThreshold) {
      await this.seek(0);
      return;
    }
    const target = this.findPlayable(this.current.id, -1, { wrap: true, includeSelf: false });
    if (!target) {
      this.reportNothingElsePlayable();
      return;
    }
    this.noticeSkipped(target.skipped);
    await this.selectTrack(target.id, { autoplay: this.wantsPlayback, direction: -1, auto: false });
  }

  select(trackId: number, opts: { autoplay?: boolean } = {}): Promise<SelectResult> {
    return this.selectTrack(trackId, { autoplay: opts.autoplay ?? true, direction: 0, auto: false });
  }

  async seek(seconds: number): Promise<void> {
    const slot = this.activeSlot();
    if (!slot?.isReady || !this.state.canSeek || !Number.isFinite(seconds)) return;
    const target = Math.min(Math.max(0, seconds), this.state.duration);
    slot.provider.seek(target);
    this.state.position = target;
    this.state.sampledAt = this.now();
    this.view = null;
    this.emitTime(true);
  }

  setVolume(volume: number): void {
    const next = Math.round(clamp01(volume) * 1000) / 1000;
    if (next === this.state.volume) return;
    this.state.volume = next;
    for (const slot of this.slots.values()) slot.provider.setVolume(next);
    this.emitState();
  }

  changeVolume(delta: number): void {
    this.setVolume(this.state.volume + delta);
  }

  setMuted(muted: boolean): void {
    if (muted === this.state.muted) return;
    this.state.muted = muted;
    for (const slot of this.slots.values()) slot.provider.setMuted(muted);
    this.emitState();
  }

  toggleMute(): void {
    this.setMuted(!this.state.muted);
  }

  setRepeat(mode: RepeatMode): void {
    if (mode === this.state.repeat) return;
    this.state.repeat = mode;
    this.emitState();
  }

  cycleRepeat(): RepeatMode {
    const next = REPEAT_CYCLE[this.state.repeat];
    this.setRepeat(next);
    return next;
  }

  /**
   * Called by the UI whenever the signal window (the visible YouTube player)
   * opens or closes. Closing it pauses YouTube playback: the player must stay
   * visible while it plays.
   */
  setSignalWindowOpen(open: boolean): void {
    if (open === this.signalOpen) return;
    this.signalOpen = open;
    if (open) {
      if (this.playWhenSignalOpens) {
        this.playWhenSignalOpens = false;
        void this.play();
      }
      return;
    }
    this.playWhenSignalOpens = false;
    if (this.activeKind !== 'youtube') return;
    if (!ACTIVE_STATUSES.has(this.state.status) && !this.playWhenReady) return;
    this.playWhenReady = false;
    this.wantsPlayback = false;
    const slot = this.activeSlot();
    if (slot?.isReady) slot.provider.pause();
    this.notify({
      id: NOTICE_ID.signal,
      level: 'info',
      message: 'Signal window closed — YouTube playback paused (the video player must stay visible).',
      ttl: 6000,
    });
  }

  async retry(): Promise<void> {
    if (this.disposed) return;
    this.clearAutoSkip();
    const track = this.current;
    // An explicit retry gives runtime-failed sources of this track another chance.
    for (const kind of ['youtube', 'licensed'] as const) {
      const before = track.source.status;
      const updated = this.resolver.markRuntimeStatus(track.id, 'READY', '', kind);
      if (updated.status !== before) this.bus.emit('source:update', { ...updated });
    }
    this.state.error = null;
    this.autoAdvance = false;
    this.consecutiveFailures = 0;
    const requestId = ++this.requestId;
    await this.loadCurrent(requestId, { autoplay: this.wantsPlayback });
  }

  /** Applies Settings → Source; reloads the current track if its provider changes. */
  setSourcePreference(pref: SourcePreference): void {
    if (pref === this.sourcePreference) return;
    this.sourcePreference = pref;
    if (this.initPromise) {
      const kind = this.resolver.chooseKind(this.current.id, pref);
      if (kind !== this.activeKind || this.state.status === 'SOURCE_UNAVAILABLE') {
        const requestId = ++this.requestId;
        void this.loadCurrent(requestId, { autoplay: this.wantsPlayback && ACTIVE_STATUSES.has(this.state.status) });
      }
    }
    // Track playability changed even if this track's state did not.
    this.emitState(true);
  }

  // ───────────────────────────────────────────────────────────── selection ──

  private async selectTrack(trackId: number, request: SelectRequest): Promise<SelectResult> {
    if (this.disposed) return { ok: false, status: this.state.status, reason: 'The player was disposed.' };
    const track = this.trackById(trackId);
    if (!track) return { ok: false, status: this.state.status, reason: `Unknown track ${trackId}.` };
    this.clearAutoSkip();
    const requestId = ++this.requestId;
    const previous = this.current;
    // Stop and invalidate the previous source before publishing the new canonical title.
    this.stopActive();
    this.current = track;
    this.autoAdvance = request.auto;
    if (!request.auto) this.consecutiveFailures = 0;
    this.wantsPlayback = request.autoplay;
    this.playWhenReady = false;
    this.playWhenSignalOpens = false;
    Object.assign(this.state, {
      trackId: track.id,
      position: 0,
      duration: track.source.durationHint ?? 0,
      buffered: 0,
      canSeek: false,
      error: null,
      sampledAt: this.now(),
    });
    this.view = null;
    // UI and scene animate right away; audio never waits for animations.
    this.bus.emit('player:track', this.trackChange(track, previous, request.direction, requestId));
    this.emitTime(true);
    return this.loadCurrent(requestId, { autoplay: request.autoplay });
  }

  private async loadCurrent(requestId: number, request: LoadRequest): Promise<SelectResult> {
    const track = this.current;
    const kind = this.resolver.chooseKind(track.id, this.sourcePreference);
    const sourceId = kind === 'youtube' ? track.source.videoId : kind === 'licensed' ? track.source.audioUrl : null;
    if (!kind || !sourceId) return this.enterUnavailable(track);

    if (this.activeKind && this.activeKind !== kind) this.slots.get(this.activeKind)?.provider.stop();
    this.activeKind = kind;
    this.expectedSourceId = sourceId;
    this.state.provider = kind;
    this.state.error = null;

    let intendsPlay = request.autoplay || this.playWhenReady;
    if (intendsPlay && kind === 'youtube' && !this.requestSignalWindow()) intendsPlay = false;
    if (this.state.status !== 'INITIALIZING') this.transition(intendsPlay ? 'BUFFERING' : 'READY');
    this.emitState();

    let provider: MusicProvider;
    try {
      provider = await this.ensureProvider(kind);
    } catch (error) {
      if (this.isStale(requestId)) return this.staleResult();
      return this.failProviderLoad(kind, error);
    }
    if (this.isStale(requestId)) return this.staleResult();

    // Intent may have changed while the provider was loading (pause, window closed, play pressed).
    const autoplay = this.wantsPlayback && (intendsPlay || this.playWhenReady) && (kind !== 'youtube' || this.signalOpen);
    this.playWhenReady = false;
    try {
      await provider.load(kind === 'youtube' ? { videoId: sourceId } : { audioUrl: sourceId }, {
        autoplay,
        startSeconds: request.startSeconds,
      });
    } catch (error) {
      if (this.isStale(requestId)) return this.staleResult();
      return this.failLoad(error);
    }
    if (this.isStale(requestId)) return this.staleResult();
    const slot = this.slots.get(kind);
    if (slot) this.applySnapshot(slot, provider.getPlaybackState());
    return { ok: true, status: this.state.status };
  }

  private enterUnavailable(track: ResolvedTrack): SelectResult {
    this.stopActive();
    const error = this.unavailableError(track);
    this.state.error = error;
    this.transition('SOURCE_UNAVAILABLE');
    this.emitState();
    this.notifyProblem(track, error, 8000);
    if (this.autoAdvance) this.scheduleAutoSkip();
    return { ok: false, status: this.state.status, reason: error.message };
  }

  private unavailableError(track: ResolvedTrack): PlaybackError {
    const { source } = track;
    if (source.status === 'READY') {
      const wanted = this.sourcePreference === 'licensed' ? 'licensed audio file' : 'YouTube source';
      return {
        code: 'UNMAPPED',
        message: `No ${wanted} for this track with the current source preference.`,
        trackId: track.id,
        externalUrl: source.externalUrl,
      };
    }
    const code: PlaybackErrorCode =
      source.status === 'UNMAPPED' || source.status === 'UNAVAILABLE' || source.status === 'EMBED_BLOCKED' ? source.status : 'UNKNOWN';
    return { code, message: source.reason ?? UNMAPPED_REASON, trackId: track.id, externalUrl: source.externalUrl };
  }

  private findPlayable(
    fromId: number,
    direction: 1 | -1,
    options: { wrap: boolean; includeSelf: boolean },
  ): { id: number; skipped: number } | null {
    const count = this.tracks.length;
    const start = Math.max(0, this.tracks.findIndex((track) => track.id === fromId));
    for (let step = 1; step <= count; step += 1) {
      let index = start + direction * step;
      if (!options.wrap && (index < 0 || index >= count)) return null;
      index = ((index % count) + count) % count;
      if (index === start && !options.includeSelf) return null;
      const id = this.tracks[index].id;
      if (this.isPlayable(id)) return { id, skipped: step - 1 };
    }
    return null;
  }

  private handleEnded(): void {
    const slot = this.activeSlot();
    if (!slot) return;
    if (this.state.repeat === 'one') {
      slot.provider.seek(0);
      void slot.provider.play();
      return;
    }
    const wrap = this.state.repeat === 'all';
    const target = this.findPlayable(this.current.id, 1, { wrap, includeSelf: wrap });
    if (!target) {
      // repeat 'off' at the end of the catalogue: stay ENDED on the last track.
      if (!this.hasAnyPlayable()) this.reportNoPlayableTracks();
      return;
    }
    if (target.id === this.current.id) {
      // repeat 'all' with a single playable track: loop it.
      slot.provider.seek(0);
      void slot.provider.play();
      return;
    }
    this.noticeSkipped(target.skipped);
    void this.selectTrack(target.id, { autoplay: true, direction: 1, auto: true });
  }

  /** A failure while auto-advancing moves on after a pause — bounded, never an endless error loop. */
  private scheduleAutoSkip(): void {
    this.clearAutoSkip();
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CONFIG.playback.maxConsecutiveFailures) {
      this.autoAdvance = false;
      this.wantsPlayback = false;
      this.notify({
        id: NOTICE_ID.advance,
        level: 'error',
        message: `Auto-advance stopped: ${this.consecutiveFailures} tracks in a row could not be played.`,
        ttl: 0,
      });
      return;
    }
    const failedRequest = this.requestId;
    this.autoSkipTimer = setTimeout(() => {
      this.autoSkipTimer = null;
      if (this.disposed || failedRequest !== this.requestId) return;
      const target = this.findPlayable(this.current.id, 1, { wrap: this.state.repeat !== 'off', includeSelf: false });
      if (!target) {
        if (!this.hasAnyPlayable()) this.reportNoPlayableTracks();
        return;
      }
      this.noticeSkipped(target.skipped);
      void this.selectTrack(target.id, { autoplay: true, direction: 1, auto: true });
    }, CONFIG.playback.autoSkipDelayMs);
  }

  private clearAutoSkip(): void {
    if (!this.autoSkipTimer) return;
    clearTimeout(this.autoSkipTimer);
    this.autoSkipTimer = null;
  }

  // ───────────────────────────────────────────────────────────── providers ──

  private ensureProvider(kind: SourceKind): Promise<MusicProvider> {
    const existing = this.slots.get(kind);
    if (existing) return existing.ready;
    let provider: MusicProvider;
    try {
      provider = this.factories[kind]();
    } catch (error) {
      return Promise.reject(error);
    }
    const slot: ProviderSlot = { provider, ready: Promise.resolve(provider), isReady: false, unsubscribe: [] };
    slot.unsubscribe.push(
      provider.on('state', (snapshot) => this.applySnapshot(slot, snapshot)),
      provider.on('time', (snapshot) => this.onProviderTime(slot, snapshot)),
      provider.on('error', (error) => this.onProviderError(slot, error)),
      provider.on('autoplay-blocked', ({ sourceId }) => this.onAutoplayBlocked(slot, sourceId)),
    );
    slot.ready = provider.initialize().then(
      () => {
        slot.isReady = true;
        provider.setVolume(this.state.volume);
        provider.setMuted(this.state.muted);
        return provider;
      },
      (error: unknown) => {
        this.releaseSlot(kind, slot);
        throw error;
      },
    );
    this.slots.set(kind, slot);
    return slot.ready;
  }

  private releaseSlot(kind: SourceKind, slot: ProviderSlot): void {
    if (this.slots.get(kind) === slot) this.slots.delete(kind);
    for (const off of slot.unsubscribe.splice(0)) off();
    try {
      slot.provider.destroy();
    } catch (error) {
      console.warn(`[player] ${kind} provider destroy failed`, error);
    }
  }

  private activeSlot(): ProviderSlot | undefined {
    return this.activeKind ? this.slots.get(this.activeKind) : undefined;
  }

  private stopActive(): void {
    const slot = this.activeSlot();
    this.activeKind = null;
    this.expectedSourceId = null;
    this.state.provider = null;
    slot?.provider.stop();
  }

  /** Drops events of a replaced provider, of another kind, or of a source that is no longer expected. */
  private isCurrent(slot: ProviderSlot, sourceId: string | null): boolean {
    const kind = slot.provider.kind;
    return (
      !this.disposed &&
      this.activeKind === kind &&
      this.slots.get(kind) === slot &&
      sourceId !== null &&
      sourceId === this.expectedSourceId
    );
  }

  private applySnapshot(slot: ProviderSlot, snapshot: ProviderSnapshot): void {
    if (!this.isCurrent(slot, snapshot.sourceId)) return;
    this.sample(snapshot);
    const mapped = STATUS_FROM_PROVIDER[snapshot.status];
    let ended = false;
    if (mapped && this.accepts(mapped)) {
      const changed = this.transition(mapped);
      if (mapped === 'PLAYING') {
        // Playback can also be started from the visible provider's own controls.
        this.wantsPlayback = true;
        this.consecutiveFailures = 0;
        if (this.state.error?.code === 'AUTOPLAY_BLOCKED') this.state.error = null;
      }
      if (mapped === 'PAUSED') this.wantsPlayback = false;
      ended = mapped === 'ENDED' && changed;
    }
    this.emitState();
    this.emitTime(false);
    if (ended) this.handleEnded();
  }

  /** Keeps explicit problem states from being overwritten by incidental provider chatter. */
  private accepts(next: PlaybackStatus): boolean {
    const status = this.state.status;
    if (status === 'AUTOPLAY_BLOCKED') return next === 'PLAYING' || next === 'BUFFERING' || next === 'ENDED';
    if ((status === 'ERROR' || status === 'SOURCE_UNAVAILABLE') && this.state.error) return next === 'PLAYING';
    return true;
  }

  private onProviderTime(slot: ProviderSlot, snapshot: ProviderSnapshot): void {
    if (!this.isCurrent(slot, snapshot.sourceId)) return;
    this.sample(snapshot);
    this.emitState();
    this.emitTime(false);
  }

  private onProviderError(slot: ProviderSlot, error: ProviderError): void {
    if (!this.isCurrent(slot, error.sourceId)) return;
    const track = this.current;
    if (error.persistent) {
      const updated = this.resolver.markRuntimeStatus(track.id, error.status, error.message, slot.provider.kind);
      this.bus.emit('source:update', { ...updated });
    }
    const playbackError: PlaybackError = {
      code: error.code,
      message: error.message,
      trackId: track.id,
      externalUrl: track.source.externalUrl,
    };
    this.state.error = playbackError;
    this.transition(error.status === 'ERROR' ? 'ERROR' : 'SOURCE_UNAVAILABLE');
    this.emitState();
    this.notifyProblem(track, playbackError, this.autoAdvance ? CONFIG.playback.autoSkipDelayMs + 2000 : 0, !error.persistent);
    if (this.autoAdvance) this.scheduleAutoSkip();
  }

  private onAutoplayBlocked(slot: ProviderSlot, sourceId: string | null): void {
    if (!this.isCurrent(slot, sourceId)) return;
    this.state.error = {
      code: 'AUTOPLAY_BLOCKED',
      message: 'The browser blocked automatic playback. Press Play to start.',
      trackId: this.current.id,
    };
    this.transition('AUTOPLAY_BLOCKED');
    this.emitState();
    this.notify({
      id: NOTICE_ID.autoplay,
      level: 'info',
      message: 'Autoplay was blocked by the browser — press Play to start the music.',
      action: { label: 'Play', command: 'play' },
      ttl: 0,
    });
  }

  private failProviderLoad(kind: SourceKind, error: unknown): SelectResult {
    console.warn(`[player] ${kind} provider failed to load`, error);
    const message =
      kind === 'youtube'
        ? 'The YouTube player could not be loaded (blocked by an extension, a network filter, or offline).'
        : 'The audio engine could not be started in this browser.';
    this.state.error = { code: 'PROVIDER_LOAD_FAILED', message, trackId: this.current.id, externalUrl: this.current.source.externalUrl };
    this.transition('ERROR');
    this.emitState();
    this.notify({ id: NOTICE_ID.provider, level: 'error', message, action: { label: 'Retry', command: 'retry' }, ttl: 0 });
    return { ok: false, status: this.state.status, reason: message };
  }

  private failLoad(error: unknown): SelectResult {
    console.warn('[player] load failed', error);
    const message = 'This source could not be loaded.';
    this.state.error = { code: 'UNKNOWN', message, trackId: this.current.id, externalUrl: this.current.source.externalUrl };
    this.transition('ERROR');
    this.emitState();
    this.notifyProblem(this.current, this.state.error, 0, true);
    return { ok: false, status: this.state.status, reason: message };
  }

  // ─────────────────────────────────────────────────────────────── helpers ──

  /** Asks the UI to show the signal window; true when it is open (the UI confirms synchronously or later). */
  private requestSignalWindow(): boolean {
    if (this.signalOpen) return true;
    this.bus.emit('signal:visibility', { open: true });
    if (this.signalOpen) return true;
    this.playWhenSignalOpens = true;
    return false;
  }

  private isStale(requestId: number): boolean {
    return this.disposed || requestId !== this.requestId;
  }

  private staleResult(): SelectResult {
    return { ok: false, status: this.state.status, reason: 'Superseded by a newer selection.' };
  }

  private trackById(trackId: number): ResolvedTrack | undefined {
    return this.tracks.find((track) => track.id === trackId);
  }

  private hasAnyPlayable(): boolean {
    return this.tracks.some((track) => this.isPlayable(track.id));
  }

  private trackChange(track: ResolvedTrack, previous: ResolvedTrack | null, direction: 1 | -1 | 0, requestId: number): TrackChange {
    return {
      track,
      previous,
      direction,
      transition: getVisualProfile(track.id).featured ? 'featured' : 'standard',
      requestId,
    };
  }

  /** Returns true when the machine moved to a different status. */
  private transition(to: PlaybackStatus): boolean {
    const from = this.machine.state;
    if (!this.machine.transition(to)) return false;
    this.state.status = this.machine.state;
    this.view = null;
    return from !== to;
  }

  private sample(snapshot: ProviderSnapshot): void {
    this.state.position = snapshot.position;
    if (snapshot.duration > 0) this.state.duration = snapshot.duration;
    this.state.buffered = snapshot.buffered;
    this.state.canSeek = snapshot.canSeek;
    this.state.sampledAt = this.now();
    this.view = null;
  }

  /** Emits 'player:state' when a non-time field changed (or when forced). */
  private emitState(force = false): void {
    this.view = null;
    const s = this.state;
    const signature = [s.status, s.trackId, s.provider, s.volume, s.muted, s.repeat, s.canSeek, Math.round(s.duration), s.error?.code, s.error?.message].join('|');
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.bus.emit('player:state', this.getState());
  }

  private emitTime(force: boolean): void {
    const now = this.now();
    // Small tolerance so a 4 Hz provider clock is not throttled down to 2 Hz.
    if (!force && now - this.lastTimeEmit < 1000 / CONFIG.playback.timeUpdateHz - 30) return;
    this.lastTimeEmit = now;
    this.bus.emit('player:time', { position: this.state.position, duration: this.state.duration, buffered: this.state.buffered });
  }

  private notify(notice: Notice): void {
    this.bus.emit('player:notice', notice);
  }

  private notifyProblem(track: ResolvedTrack, error: PlaybackError, ttl: number, offerRetry = false): void {
    const action: Notice['action'] =
      error.code === 'EMBED_BLOCKED' && error.externalUrl
        ? { label: 'Open on YouTube', href: error.externalUrl }
        : offerRetry
          ? { label: 'Retry', command: 'retry' }
          : undefined;
    this.notify({
      id: NOTICE_ID.source,
      level: error.code === 'UNMAPPED' ? 'warn' : 'error',
      message: `“${track.title}” — ${error.message}`,
      ...(action ? { action } : {}),
      ttl,
    });
  }

  private notifyCurrentProblem(): void {
    const error = this.state.error ?? this.unavailableError(this.current);
    this.notifyProblem(this.current, error, 8000);
  }

  private noticeSkipped(skipped: number): void {
    if (skipped <= 0) return;
    this.notify({
      id: NOTICE_ID.skipped,
      level: 'info',
      message: `Skipped ${skipped} track${skipped === 1 ? '' : 's'} without a playable source.`,
      ttl: 4000,
    });
  }

  private reportNothingElsePlayable(): void {
    if (!this.hasAnyPlayable()) {
      this.reportNoPlayableTracks();
      return;
    }
    this.notify({ id: NOTICE_ID.catalogue, level: 'info', message: 'No other track has a playable source right now.', ttl: 4000 });
  }

  private reportNoPlayableTracks(): void {
    this.wantsPlayback = false;
    this.state.error = {
      code: 'NO_PLAYABLE_TRACKS',
      message: 'No track in the catalogue has a playable source right now.',
      trackId: this.current.id,
    };
    this.emitState();
    this.notify({ id: NOTICE_ID.catalogue, level: 'error', message: this.state.error.message, ttl: 0 });
  }
}
