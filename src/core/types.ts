/**
 * Shared domain types for MIDNIGHT FREQUENCY.
 *
 * Three concepts are kept strictly apart:
 *  1. The canonical music catalogue (`Track`, src/config/tracks.ts).
 *  2. Source resolution (`TrackSourceState`, src/sources/*): which verified,
 *     playable source — if any — belongs to a canonical track.
 *  3. The playback engine (`PlaybackState`, src/player/*), driven by providers.
 */

// ─────────────────────────────────────────────────────────────── Catalogue ──

export type TrackCollection =
  | 'ORIGINAL'
  | 'FES'
  | 'PORTABLE'
  | 'PERSONA_Q'
  | 'MOVIES'
  | 'DANCING'
  | 'PERSONA_Q2'
  | 'RELOAD'
  | 'P5X';

export interface Track {
  /** Canonical position, 1..67. Never derived from a YouTube index. */
  id: number;
  /** Official title exactly as provided (Japanese preserved, no number). */
  title: string;
  artist: string;
  collection: TrackCollection;
  /** Inline verified YouTube source. Prefer src/config/source-map.ts. */
  videoId?: string | null;
  /** Inline licensed audio file URL. Only for audio the site may stream. */
  audioUrl?: string | null;
}

export interface CollectionInfo {
  id: TrackCollection;
  /** Full display name, e.g. "PERSONA 3 RELOAD". */
  label: string;
  /** Short filter label, e.g. "Reload". */
  short: string;
  /** Small Japanese / technical annotation used by the HUD. */
  note: string;
}

export type CollectionFilter = 'ALL' | TrackCollection;

// ──────────────────────────────────────────────────────── Source resolution ──

export type SourceStatus = 'READY' | 'UNMAPPED' | 'UNAVAILABLE' | 'EMBED_BLOCKED' | 'ERROR';

export type SourceKind = 'youtube' | 'licensed';

export type VerificationMethod =
  /** A human compared the observed YouTube title/channel with the canonical title. */
  | 'manual-title-match'
  /** The automatic matcher found a high-confidence match. */
  | 'auto-title-match'
  /** Explicit mapping provided in source-overrides.json. */
  | 'manual-override'
  /** Licensed audio file declared by the site owner. */
  | 'licensed-declaration';

export interface SourceVerification {
  method: VerificationMethod;
  /** Title observed on the source when the mapping was established. */
  observedTitle?: string;
  observedChannel?: string;
  /** ISO date (YYYY-MM-DD). */
  checkedAt: string;
  /** 0..1 — mappings under CONFIG.sources.minConfidence are never playable. */
  confidence: number;
  /** Result of the embeddability probe at verification time. */
  embedCheck?: 'oembed-200' | 'oembed-401' | 'oembed-404' | 'unknown';
  note?: string;
}

/** One entry of the static source map or of public/source-overrides.json. */
export interface SourceMapEntry {
  trackId: number;
  videoId?: string;
  audioUrl?: string;
  /** Forces a status (e.g. a video known to be removed). */
  status?: Exclude<SourceStatus, 'READY'>;
  /** Duration observed on the source, seconds. Display hint only. */
  durationHint?: number;
  verification: SourceVerification;
}

export interface SourceOverridesFile {
  version: 1;
  generatedAt?: string;
  entries: SourceMapEntry[];
}

/** Runtime source state of one canonical track. */
export interface TrackSourceState {
  trackId: number;
  status: SourceStatus;
  /** Provider that would play this track, null when not playable. */
  kind: SourceKind | null;
  videoId: string | null;
  audioUrl: string | null;
  /** Human readable explanation for non-READY states. */
  reason: string | null;
  durationHint: number | null;
  verification: SourceVerification | null;
  /** youtube.com watch URL when the video id is known (even if blocked). */
  externalUrl: string | null;
}

export interface ResolvedTrack extends Track {
  source: TrackSourceState;
}

// ────────────────────────────────────────────────────────────────── Playback ──

export type PlaybackStatus =
  | 'INITIALIZING'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'BUFFERING'
  | 'ENDED'
  | 'SOURCE_UNAVAILABLE'
  | 'AUTOPLAY_BLOCKED'
  | 'ERROR';

export type RepeatMode = 'off' | 'all' | 'one';

export type PlaybackErrorCode =
  | 'UNMAPPED'
  | 'UNAVAILABLE'
  | 'EMBED_BLOCKED'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'DECODE'
  | 'PROVIDER_LOAD_FAILED'
  | 'AUTOPLAY_BLOCKED'
  | 'NO_PLAYABLE_TRACKS'
  | 'SIGNAL_WINDOW_CLOSED'
  | 'UNKNOWN';

export interface PlaybackError {
  code: PlaybackErrorCode;
  message: string;
  trackId: number;
  /** Link to the source on YouTube when known. */
  externalUrl?: string | null;
}

export interface PlaybackState {
  status: PlaybackStatus;
  /** Canonical id of the selected track. */
  trackId: number;
  /** Provider currently bound to the selected track. */
  provider: SourceKind | null;
  /** Seconds, as last reported by the provider. */
  position: number;
  /** Seconds, 0 when unknown. */
  duration: number;
  /** Buffered fraction 0..1. */
  buffered: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  canSeek: boolean;
  error: PlaybackError | null;
  /** performance.now() when `position` was sampled — for interpolation. */
  sampledAt: number;
}

export type TransitionVariant = 'standard' | 'featured';

export interface TrackChange {
  track: ResolvedTrack;
  previous: ResolvedTrack | null;
  /** +1 next, -1 previous, 0 direct selection / restore. */
  direction: 1 | -1 | 0;
  transition: TransitionVariant;
  /** Monotonic selection counter; stale async work compares against it. */
  requestId: number;
}

export interface SelectResult {
  ok: boolean;
  status: PlaybackStatus;
  reason?: string;
}

/** Commands the UI may issue. Implemented by src/player/PlayerController.ts. */
export interface PlayerApi {
  readonly tracks: readonly ResolvedTrack[];
  getState(): Readonly<PlaybackState>;
  getCurrentTrack(): ResolvedTrack;
  /** Position extrapolated from the last sample while PLAYING (seconds). */
  getInterpolatedPosition(now?: number): number;
  isPlayable(trackId: number): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  select(trackId: number, opts?: { autoplay?: boolean }): Promise<SelectResult>;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): void;
  changeVolume(delta: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  setRepeat(mode: RepeatMode): void;
  cycleRepeat(): RepeatMode;
  /**
   * YouTube policy hook: the visible player must not be hidden while playing.
   * Closing the signal window pauses YouTube playback.
   */
  setSignalWindowOpen(open: boolean): void;
  isSignalWindowOpen(): boolean;
  /** After ERROR / PROVIDER_LOAD_FAILED: re-initialise the provider and reload the current track. */
  retry(): Promise<void>;
  /** Media element of the licensed-audio provider (direct analysis), if active. */
  getMediaElement(): HTMLMediaElement | null;
}

// ─────────────────────────────────────────────────────────── Audio features ──

export interface AudioFeatures {
  /** Overall loudness 0..1 (smoothed). */
  level: number;
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  /** True during the frame a beat onset is detected / scheduled. */
  beat: boolean;
  /** Kick envelope 0..1: jumps on a beat and decays. */
  kick: number;
  /** Detected (real modes) or configured (simulated) tempo. */
  bpm: number;
  /** Normalised magnitudes 0..1, CONFIG.sync.spectrumBins long. */
  spectrum: Float32Array;
  /** -1..1, CONFIG.sync.waveformSize long. */
  waveform: Float32Array;
}

export type SyncMode = 'simulated' | 'tab' | 'mic' | 'direct';

export interface SyncStatus {
  mode: SyncMode;
  /** Exact HUD label, e.g. "VISUAL SYNC · SIMULATED". */
  label: string;
  /** True only when visuals are driven by real analysed audio. */
  real: boolean;
  detail?: string;
}

export interface SyncResult {
  ok: boolean;
  status: SyncStatus;
  /** Why the requested mode could not be enabled. */
  error?: 'unsupported' | 'denied' | 'no-audio-track' | 'unavailable' | 'cancelled' | 'unknown';
  message?: string;
}

/** What the UI needs from the audio feature engine. */
export interface AudioSyncApi {
  getStatus(): SyncStatus;
  isSupported(mode: SyncMode): boolean;
  setMode(mode: SyncMode): Promise<SyncResult>;
  /** Registers a tap for tap-tempo; returns the current estimate when ≥ 3 taps. */
  tap(trackId: number, now?: number): number | null;
  getBpm(trackId: number): number;
  resetBpm(trackId: number): void;
  getFeatures(): Readonly<AudioFeatures>;
}

// ──────────────────────────────────────────────────────── Visuals & settings ──

export type VisualMode = 'moonlight' | 'darkhour' | 'bluememory';
export type QualityProfile = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityProfile;
export type MotionPreference = 'system' | 'reduce' | 'full';
export type SourcePreference = 'auto' | 'youtube' | 'licensed';

export type EnergyProfile = 'calm' | 'mid' | 'high';

export interface VisualProfile {
  energy: EnergyProfile;
  /** Uses the featured (more expressive) transition. Explicit config only. */
  featured?: boolean;
  /** Short typographic accent shown during a featured transition. */
  accentLabel?: string;
}

export interface Preferences {
  version: 1;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  lastTrackId: number;
  visualMode: VisualMode;
  quality: QualitySetting;
  uiSounds: boolean;
  motion: MotionPreference;
  sourcePreference: SourcePreference;
  /** Tap-tempo results, trackId → bpm. */
  tapTempo: Record<number, number>;
  tracklistFilter: CollectionFilter;
  /** Microphone is the only real sync mode restorable without a fresh gesture-bound share. */
  syncMode: 'simulated' | 'mic';
}

// ──────────────────────────────────────────────────────────────────── Events ──

export type PanelId = 'tracklist' | 'visuals' | 'settings' | 'sync' | 'debug';

export interface Notice {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
  action?: { label: string; href?: string; command?: 'play' | 'retry' | 'open-sync' | 'open-tracklist' };
  /** Milliseconds before auto-dismiss; 0 = sticky. */
  ttl?: number;
}

export interface VisualAccent {
  kind: 'beat' | 'transition' | 'featured';
  /** 0..1 */
  strength: number;
  label?: string;
}

export interface AppEvents {
  /** Any non-time change of PlaybackState (status, volume, repeat, track…). */
  'player:state': PlaybackState;
  /** Throttled time updates (CONFIG.playback.timeUpdateHz). */
  'player:time': { position: number; duration: number; buffered: number };
  /** Emitted synchronously when a new track is selected, before loading. */
  'player:track': TrackChange;
  'player:notice': Notice;
  /** Runtime source status change for one track (e.g. embed blocked). */
  'source:update': TrackSourceState;
  'sync:status': SyncStatus;
  'visual:mode': VisualMode;
  'visual:accent': VisualAccent;
  'quality:profile': QualityProfile;
  'motion:reduced': boolean;
  'ui:panel': PanelId | null;
  /** Click/tap on the 3D walkman that was not a drag. */
  'walkman:activate': undefined;
  'walkman:hover': boolean;
  'walkman:reset-pose': undefined;
  'scene:ready': undefined;
  'scene:fallback': { reason: string };
  'prefs:change': Preferences;
  'signal:visibility': { open: boolean };
}
