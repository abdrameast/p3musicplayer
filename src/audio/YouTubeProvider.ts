import { CONFIG } from '../config/config';
import { EventBus } from '../core/EventBus';
import {
  ProviderLoadError,
  clampVolume,
  emptySnapshot,
  toProviderLoadError,
  type MusicProvider,
  type ProviderError,
  type ProviderEvents,
  type ProviderLoadOptions,
  type ProviderSnapshot,
  type ProviderSource,
  type ProviderStatus,
} from './MusicProvider';
import type { YTNamespace, YTPlayer } from './youtube-iframe';

/** YT.PlayerState values (the API exposes them on window.YT.PlayerState). */
const YT_UNSTARTED = -1;
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_CUED = 5;

const POLL_MS = 250;
const VIDEO_ID = /^[\w-]{11}$/;

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Loads the official IFrame Player API once per page. Chains any existing
 * window.onYouTubeIframeAPIReady handler instead of replacing it. A failed or
 * timed-out load is forgotten so a later call (Retry) injects a fresh script.
 */
export function loadYouTubeIframeApi(
  src: string = CONFIG.youtube.apiSrc,
  timeoutMs: number = CONFIG.youtube.apiLoadTimeoutMs,
): Promise<YTNamespace> {
  const existing = window.YT;
  if (existing && typeof existing.Player === 'function') return Promise.resolve(existing);
  if (apiPromise) return apiPromise;

  let script: HTMLScriptElement | null = null;
  const promise = new Promise<YTNamespace>((resolve, reject) => {
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const api = window.YT;
      if (!error && api && typeof api.Player === 'function') resolve(api);
      else reject(error ?? new ProviderLoadError('The YouTube IFrame API loaded without a player constructor.'));
    };
    const timer = setTimeout(
      () => settle(new ProviderLoadError(`The YouTube IFrame API did not load within ${Math.round(timeoutMs / 1000)} s.`)),
      timeoutMs,
    );

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } catch (error) {
        console.error('[YouTube] previous onYouTubeIframeAPIReady handler failed', error);
      }
      settle(null);
    };

    script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener(
      'error',
      () => settle(new ProviderLoadError('The YouTube IFrame API could not be loaded (blocked or offline).')),
      { once: true },
    );
  });

  apiPromise = promise;
  promise.catch(() => {
    if (apiPromise === promise) apiPromise = null;
    script?.remove();
  });
  return promise;
}

/** Maps IFrame API onError codes onto playback / source semantics. */
export function mapYouTubeError(code: number, sourceId: string | null): ProviderError {
  switch (code) {
    case 2:
      return { code: 'NOT_FOUND', status: 'ERROR', persistent: true, sourceId, detail: code, message: 'YouTube rejected the video id (invalid parameter).' };
    case 5:
      return { code: 'UNKNOWN', status: 'ERROR', persistent: false, sourceId, detail: code, message: 'The YouTube HTML5 player failed to play this video.' };
    case 100:
      return { code: 'NOT_FOUND', status: 'UNAVAILABLE', persistent: true, sourceId, detail: code, message: 'This video is no longer available (removed or private).' };
    case 101:
    case 150:
      return {
        code: 'EMBED_BLOCKED',
        status: 'EMBED_BLOCKED',
        persistent: true,
        sourceId,
        detail: code,
        message: 'The owner does not allow this video to be played on other sites. Open on YouTube to listen.',
      };
    case 153:
      return {
        code: 'PROVIDER_LOAD_FAILED', status: 'ERROR', persistent: false, sourceId, detail: code,
        message: 'YouTube requires a valid site origin and HTTP Referer. Open this site over HTTP(S) and allow the embedded player.',
      };
    default:
      return { code: 'UNKNOWN', status: 'ERROR', persistent: false, sourceId, detail: code, message: `The YouTube player reported error ${code}.` };
  }
}

/** Video id of the media the player actually holds, from the documented getVideoUrl(). */
function playerVideoId(player: YTPlayer): string | null {
  try {
    return new URL(player.getVideoUrl()).searchParams.get('v');
  } catch {
    return null;
  }
}

export interface YouTubeProviderOptions {
  /** Signal-window element that receives the visible player (or a getter, resolved at initialize()). */
  host: HTMLElement | (() => HTMLElement);
  /** `origin` player parameter; defaults to location.origin. */
  playerHostOrigin?: string;
  /** Test seam: replaces the script loader. */
  loadApi?: () => Promise<YTNamespace>;
}

interface PendingLoad {
  videoId: string;
  autoplay: boolean;
  startSeconds: number;
}

/**
 * Provider A — the official YouTube IFrame Player, mounted visibly (controls
 * on, never resized to zero) inside the UI's signal window. The audio of this
 * cross-origin iframe is never extracted or analysed.
 */
export class YouTubeProvider implements MusicProvider {
  readonly kind = 'youtube' as const;

  private readonly events = new EventBus<ProviderEvents>();
  private player: YTPlayer | null = null;
  private frame: HTMLElement | null = null;
  private ready = false;
  private destroyed = false;
  private initPromise: Promise<void> | null = null;
  private snapshot: ProviderSnapshot = emptySnapshot();
  private volume = 1;
  private muted = false;
  private pendingLoad: PendingLoad | null = null;
  private pendingPlay: boolean | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelReady: (() => void) | null = null;

  constructor(private readonly options: YouTubeProviderOptions) {}

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.createPlayer().catch((error: unknown) => {
        this.teardownPlayer();
        this.initPromise = null;
        throw toProviderLoadError(error, 'The YouTube player could not be created.');
      });
    }
    return this.initPromise;
  }

  async load(source: ProviderSource, options: ProviderLoadOptions): Promise<void> {
    const videoId = source.videoId;
    if (!videoId || !VIDEO_ID.test(videoId)) throw new Error('YouTubeProvider.load() needs a valid 11-character video id.');
    const startSeconds = Math.max(0, options.startSeconds ?? 0);
    this.clearAutoplayCheck();
    this.stopPolling();
    this.snapshot = {
      sourceId: videoId,
      status: options.autoplay ? 'buffering' : 'cued',
      position: startSeconds,
      duration: 0,
      buffered: 0,
      canSeek: false,
    };
    const player = this.player;
    if (!this.ready || !player) {
      this.pendingLoad = { videoId, autoplay: options.autoplay, startSeconds };
      this.pendingPlay = null;
      return;
    }
    if (options.autoplay) {
      player.loadVideoById({ videoId, startSeconds });
      this.armAutoplayCheck();
    } else {
      player.cueVideoById({ videoId, startSeconds });
    }
  }

  async play(): Promise<void> {
    const player = this.player;
    if (!this.ready || !player) {
      this.pendingPlay = true;
      return;
    }
    if (!this.snapshot.sourceId) return;
    const alreadyPlaying = player.getPlayerState() === YT_PLAYING;
    player.playVideo();
    if (!alreadyPlaying) this.armAutoplayCheck();
  }

  pause(): void {
    this.clearAutoplayCheck();
    if (!this.ready || !this.player) {
      this.pendingPlay = false;
      return;
    }
    this.player.pauseVideo();
  }

  stop(): void {
    this.clearAutoplayCheck();
    this.stopPolling();
    this.pendingLoad = null;
    this.pendingPlay = null;
    if (this.ready && this.player) this.player.stopVideo();
    this.snapshot = emptySnapshot();
  }

  seek(seconds: number): void {
    if (!this.ready || !this.player || !this.snapshot.sourceId) return;
    const target = Math.max(0, seconds);
    this.player.seekTo(target, true);
    this.snapshot.position = target;
    this.events.emit('time', this.getPlaybackState());
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (this.ready && this.player) this.player.setVolume(Math.round(this.volume * 100));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ready || !this.player) return;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  getPlaybackState(): ProviderSnapshot {
    return { ...this.snapshot };
  }

  on<K extends keyof ProviderEvents>(event: K, handler: (payload: ProviderEvents[K]) => void): () => void {
    return this.events.on(event, handler);
  }

  /** Cross-origin iframe: its audio is not reachable by Web Audio, by design. */
  getMediaElement(): HTMLMediaElement | null {
    return null;
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownPlayer();
    this.events.clear();
  }

  // ───────────────────────────────────────────────────────────── internals ──

  private async createPlayer(): Promise<void> {
    const api = await (this.options.loadApi ?? loadYouTubeIframeApi)();
    if (this.destroyed) throw new ProviderLoadError('The YouTube provider was destroyed during initialisation.');
    const host = typeof this.options.host === 'function' ? this.options.host() : this.options.host;

    // YT.Player replaces its target element with the iframe; the frame wrapper stays ours.
    const frame = document.createElement('div');
    frame.className = 'yt-frame';
    frame.style.width = '100%';
    frame.style.height = '100%';
    const target = document.createElement('div');
    frame.append(target);
    host.append(frame);
    this.frame = frame;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelReady = null;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new ProviderLoadError('The YouTube player did not become ready in time.')),
        CONFIG.youtube.apiLoadTimeoutMs,
      );
      this.cancelReady = () => finish(new ProviderLoadError('The YouTube provider was destroyed during initialisation.'));
      try {
        this.player = new api.Player(target, {
          width: '100%',
          height: '100%',
          host: CONFIG.youtube.host,
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 1,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: this.options.playerHostOrigin ?? location.origin,
          },
          events: {
            onReady: () => {
              if (settled) return;
              if (this.destroyed) {
                finish(new ProviderLoadError('The YouTube provider was destroyed during initialisation.'));
                return;
              }
              this.ready = true;
              finish();
            },
            onStateChange: (event) => this.handleStateChange(event.data),
            onError: (event) => this.handleError(event.data),
            onAutoplayBlocked: () => this.reportAutoplayBlocked(),
          },
        });
      } catch (error) {
        finish(error);
      }
    });

    this.labelIframe();
    this.setVolume(this.volume);
    this.setMuted(this.muted);
    this.flushPending();
  }

  private labelIframe(): void {
    try {
      const iframe = this.player?.getIframe();
      if (iframe) iframe.title = 'YouTube video player — signal window';
    } catch {
      /* cosmetic only */
    }
  }

  private flushPending(): void {
    const load = this.pendingLoad;
    const play = this.pendingPlay;
    this.pendingLoad = null;
    this.pendingPlay = null;
    if (load) {
      void this.load({ videoId: load.videoId }, { autoplay: play ?? load.autoplay, startSeconds: load.startSeconds });
    } else if (play === true) {
      void this.play();
    } else if (play === false) {
      this.pause();
    }
  }

  private handleStateChange(code: number): void {
    if (!this.snapshot.sourceId) return;
    if (!this.holdsExpectedVideo()) return;
    switch (code) {
      case YT_UNSTARTED:
        // Also emitted right after loadVideoById(); only meaningful when no start is pending.
        if (!this.autoplayTimer && this.snapshot.status !== 'buffering') this.setStatus('cued');
        break;
      case YT_CUED:
        this.setStatus('cued');
        break;
      case YT_PLAYING:
        this.clearAutoplayCheck();
        this.setStatus('playing');
        this.startPolling();
        break;
      case YT_BUFFERING:
        this.clearAutoplayCheck();
        this.setStatus('buffering');
        this.startPolling();
        break;
      case YT_PAUSED:
        this.stopPolling();
        this.setStatus('paused');
        break;
      case YT_ENDED: {
        // A late "ended" of the previous video must not trigger auto-advance for the new one.
        const held = this.player ? playerVideoId(this.player) : null;
        if (held && held !== this.snapshot.sourceId) return;
        this.stopPolling();
        this.setStatus('ended');
        break;
      }
      default:
        break;
    }
  }

  private handleError(code: number): void {
    if (!this.snapshot.sourceId || !this.holdsExpectedVideo()) return;
    this.clearAutoplayCheck();
    this.stopPolling();
    const sourceId = this.snapshot.sourceId;
    this.snapshot.status = 'error';
    this.events.emit('error', mapYouTubeError(code, sourceId));
  }

  private reportAutoplayBlocked(): void {
    if (!this.holdsExpectedVideo()) return;
    this.clearAutoplayCheck();
    if (!this.snapshot.sourceId) return;
    if (this.snapshot.status === 'buffering') this.snapshot.status = 'paused';
    this.events.emit('autoplay-blocked', { sourceId: this.snapshot.sourceId });
  }

  private setStatus(status: ProviderStatus): void {
    this.readTime();
    if (this.snapshot.status === status) return;
    this.snapshot.status = status;
    this.events.emit('state', this.getPlaybackState());
  }

  private readTime(): void {
    const player = this.player;
    if (!this.ready || !player || !this.holdsExpectedVideo()) return;
    try {
      const position = player.getCurrentTime();
      const duration = player.getDuration();
      const buffered = player.getVideoLoadedFraction();
      if (Number.isFinite(position)) this.snapshot.position = Math.max(0, position);
      if (Number.isFinite(duration) && duration > 0) this.snapshot.duration = duration;
      if (Number.isFinite(buffered)) this.snapshot.buffered = Math.min(1, Math.max(0, buffered));
      this.snapshot.canSeek = this.snapshot.duration > 0;
    } catch {
      /* the iframe may be mid-navigation; keep the last sample */
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.readTime();
      this.events.emit('time', this.getPlaybackState());
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Fallback for browsers without onAutoplayBlocked: a start that never happens is a block. */
  private armAutoplayCheck(): void {
    this.clearAutoplayCheck();
    this.autoplayTimer = setTimeout(() => {
      this.autoplayTimer = null;
      this.reportAutoplayBlocked();
    }, CONFIG.youtube.autoplayCheckMs);
  }

  private clearAutoplayCheck(): void {
    if (!this.autoplayTimer) return;
    clearTimeout(this.autoplayTimer);
    this.autoplayTimer = null;
  }

  private teardownPlayer(): void {
    this.cancelReady?.();
    this.clearAutoplayCheck();
    this.stopPolling();
    this.ready = false;
    try {
      this.player?.destroy();
    } catch (error) {
      console.warn('[YouTube] player.destroy() failed', error);
    }
    this.player = null;
    this.frame?.remove();
    this.frame = null;
    this.snapshot = emptySnapshot();
  }

  private holdsExpectedVideo(): boolean {
    const held = this.player ? playerVideoId(this.player) : null;
    // Some errors arrive before a video is fully cued; only reject a known different source.
    return held === null || held === this.snapshot.sourceId;
  }
}
