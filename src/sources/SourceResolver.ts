import { CONFIG } from '../config/config';
import { TRACK_COUNT } from '../config/tracks';
import type {
  ResolvedTrack,
  SourceKind,
  SourceMapEntry,
  SourceOverridesFile,
  SourcePreference,
  SourceStatus,
  SourceVerification,
  Track,
  TrackSourceState,
  VerificationMethod,
} from '../core/types';

/**
 * Source resolution: associates each canonical track with a verified,
 * playable source — or explains why there is none. Layers, lowest priority
 * first: inline Track.videoId/audioUrl → static SOURCE_MAP → runtime
 * overrides (public/source-overrides.json). A mapping under the confidence
 * threshold is never playable, and nothing is ever guessed.
 */

const VIDEO_ID = /^[\w-]{11}$/;
const METHODS: readonly VerificationMethod[] = ['manual-title-match', 'auto-title-match', 'manual-override', 'licensed-declaration'];
const FORCED_STATUSES: readonly Exclude<SourceStatus, 'READY'>[] = ['UNMAPPED', 'UNAVAILABLE', 'EMBED_BLOCKED', 'ERROR'];
const EMBED_CHECKS: readonly NonNullable<SourceVerification['embedCheck']>[] = ['oembed-200', 'oembed-401', 'oembed-404', 'unknown'];

export const UNMAPPED_REASON = 'No verified source associated yet.';

const FORCED_REASON: Readonly<Record<Exclude<SourceStatus, 'READY'>, string>> = {
  UNMAPPED: UNMAPPED_REASON,
  UNAVAILABLE: 'The mapped video is no longer available (removed or private).',
  EMBED_BLOCKED: 'The rights holder does not allow this video to be embedded. Open on YouTube to listen.',
  ERROR: 'The mapped source is known to fail.',
};

/** Absolute http(s) URL or a same-origin absolute path ("/audio/x.mp3", never "//host"). */
export function isAllowedAudioUrl(url: string): boolean {
  if (/^\/(?!\/)/.test(url)) return !url.includes('\\');
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface OverridesParseResult {
  entries: SourceMapEntry[];
  /** Human-readable reasons for rejected or trimmed entries. */
  problems: string[];
  /** Set when the file as a whole is unusable. */
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseVerification(raw: unknown): SourceVerification | string {
  if (!isRecord(raw)) return 'missing verification object';
  const { method, checkedAt, confidence, observedTitle, observedChannel, embedCheck, note } = raw;
  if (typeof method !== 'string' || !(METHODS as readonly string[]).includes(method)) return `unknown verification method ${JSON.stringify(method)}`;
  if (typeof checkedAt !== 'string' || checkedAt.trim() === '') return 'verification.checkedAt must be a date string';
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return 'verification.confidence must be a number between 0 and 1';
  }
  const verification: SourceVerification = { method: method as VerificationMethod, checkedAt, confidence };
  if (typeof observedTitle === 'string') verification.observedTitle = observedTitle;
  if (typeof observedChannel === 'string') verification.observedChannel = observedChannel;
  if (typeof embedCheck === 'string' && (EMBED_CHECKS as readonly string[]).includes(embedCheck)) {
    verification.embedCheck = embedCheck as SourceVerification['embedCheck'];
  }
  if (typeof note === 'string') verification.note = note;
  return verification;
}

/**
 * Validates an untrusted overrides document entry by entry. Invalid entries
 * are dropped with a reason; unknown fields are discarded.
 */
export function parseSourceOverrides(raw: unknown, maxTrackId: number = TRACK_COUNT): OverridesParseResult {
  if (!isRecord(raw)) return { entries: [], problems: [], error: 'the file is not a JSON object' };
  if (raw.version !== 1) return { entries: [], problems: [], error: `unsupported version ${JSON.stringify(raw.version)} (expected 1)` };
  if (!Array.isArray(raw.entries)) return { entries: [], problems: [], error: '"entries" must be an array' };

  const entries: SourceMapEntry[] = [];
  const problems: string[] = [];
  raw.entries.forEach((item: unknown, index) => {
    const where = `entries[${index}]`;
    if (!isRecord(item)) {
      problems.push(`${where}: not an object`);
      return;
    }
    const { trackId, videoId, audioUrl, status, durationHint } = item;
    if (typeof trackId !== 'number' || !Number.isInteger(trackId) || trackId < 1 || trackId > maxTrackId) {
      problems.push(`${where}: trackId must be an integer 1..${maxTrackId}`);
      return;
    }
    const verification = parseVerification(item.verification);
    if (typeof verification === 'string') {
      problems.push(`${where} (track ${trackId}): ${verification}`);
      return;
    }
    const entry: SourceMapEntry = { trackId, verification };
    if (videoId !== undefined) {
      if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) {
        problems.push(`${where} (track ${trackId}): invalid videoId ${JSON.stringify(videoId)}`);
        return;
      }
      entry.videoId = videoId;
    }
    if (audioUrl !== undefined) {
      if (typeof audioUrl !== 'string' || !isAllowedAudioUrl(audioUrl)) {
        problems.push(`${where} (track ${trackId}): audioUrl must be an http(s) URL or a same-origin path`);
        return;
      }
      if (verification.method !== 'licensed-declaration') {
        problems.push(`${where} (track ${trackId}): audioUrl ignored — only "licensed-declaration" entries may declare audio files`);
      } else {
        entry.audioUrl = audioUrl;
      }
    }
    if (status !== undefined) {
      if (typeof status !== 'string' || !(FORCED_STATUSES as readonly string[]).includes(status)) {
        problems.push(`${where} (track ${trackId}): invalid status ${JSON.stringify(status)}`);
        return;
      }
      entry.status = status as Exclude<SourceStatus, 'READY'>;
    }
    if (typeof durationHint === 'number' && Number.isFinite(durationHint) && durationHint > 0) entry.durationHint = durationHint;
    if (!entry.videoId && !entry.audioUrl && !entry.status) {
      problems.push(`${where} (track ${trackId}): nothing to apply (no videoId, audioUrl or status)`);
      return;
    }
    entries.push(entry);
  });
  return { entries, problems };
}

// ──────────────────────────────────────────────────────────────── resolver ──

interface Candidate {
  kind: SourceKind;
  /** Video id or audio URL; null for a status-only entry without a known id. */
  id: string | null;
  entry: SourceMapEntry;
  forced: Exclude<SourceStatus, 'READY'> | null;
}

interface Evaluation {
  status: SourceStatus;
  reason: string | null;
  verified: boolean;
}

interface TrackRecord {
  resolved: ResolvedTrack;
  base: Partial<Record<SourceKind, Candidate>>;
  merged: Partial<Record<SourceKind, Candidate>>;
}

export interface OverridesLoadResult {
  applied: number;
  error?: string;
}

export class SourceResolver {
  private readonly minConfidence: number;
  private readonly records = new Map<number, TrackRecord>();
  private readonly resolved: ResolvedTrack[] = [];
  /** Runtime failures, keyed by `${trackId}|${kind}|${sourceId}` so a new mapping starts clean. */
  private readonly runtime = new Map<string, { status: Exclude<SourceStatus, 'READY'>; reason: string }>();

  constructor(
    tracks: readonly Track[],
    map: readonly SourceMapEntry[],
    opts: { minConfidence?: number } = {},
  ) {
    this.minConfidence = opts.minConfidence ?? CONFIG.sources.minConfidence;
    for (const track of tracks) {
      const base: Partial<Record<SourceKind, Candidate>> = {};
      for (const entry of inlineEntries(track)) applyEntry(base, entry);
      const resolved: ResolvedTrack = { ...track, source: emptyState(track.id) };
      this.records.set(track.id, { resolved, base, merged: { ...base } });
      this.resolved.push(resolved);
    }
    for (const entry of map) {
      const record = this.records.get(entry.trackId);
      if (!record) {
        console.warn(`[sources] SOURCE_MAP entry for unknown track ${entry.trackId} ignored`);
        continue;
      }
      applyEntry(record.base, entry);
    }
    for (const record of this.records.values()) {
      record.merged = { ...record.base };
      this.refresh(record);
    }
  }

  /** Fetches and applies optional runtime overrides. Never throws: problems are reported and ignored. */
  async loadOverrides(url: string, fetchImpl: typeof fetch | undefined = globalThis.fetch): Promise<OverridesLoadResult> {
    if (typeof fetchImpl !== 'function') return this.overridesProblem('fetch is not available');
    let raw: unknown;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Overrides are optional. A stalled request must not block the entire application startup.
      const response = await Promise.race([
        (async () => {
          const result = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
          return { ok: result.ok, status: result.status, body: result.ok ? await result.text() : '' };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('source overrides timed out after 4 seconds'));
          }, 4000);
        }),
      ]);
      if (!response.ok) return this.overridesProblem(`HTTP ${response.status}`, response.status === 404);
      raw = JSON.parse(response.body);
    } catch (error) {
      return this.overridesProblem(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
    const parsed = parseSourceOverrides(raw, this.maxTrackId());
    if (parsed.error) return this.overridesProblem(parsed.error);
    for (const problem of parsed.problems) console.warn(`[sources] ${url}: ${problem}`);
    return { applied: this.applyEntries(parsed.entries) };
  }

  /**
   * Replaces the current override layer with `file` (validated) and
   * re-resolves every track in place. Returns the number of applied entries.
   */
  applyOverrides(file: SourceOverridesFile): number {
    const parsed = parseSourceOverrides(file, this.maxTrackId());
    if (parsed.error) {
      console.warn(`[sources] overrides rejected: ${parsed.error}`);
      return 0;
    }
    for (const problem of parsed.problems) console.warn(`[sources] overrides: ${problem}`);
    return this.applyEntries(parsed.entries);
  }

  /** Stable array: the same ResolvedTrack objects are updated in place. */
  getResolvedTracks(): ResolvedTrack[] {
    return this.resolved;
  }

  getSource(trackId: number): TrackSourceState {
    return this.record(trackId).resolved.source;
  }

  /**
   * Records a runtime failure reported by a provider (removed video, embed
   * blocked, broken file). `READY` clears it. `kind` defaults to the
   * provider currently chosen for the track.
   */
  markRuntimeStatus(trackId: number, status: SourceStatus, reason: string, kind?: SourceKind): TrackSourceState {
    const record = this.record(trackId);
    const targetKind = kind ?? record.resolved.source.kind ?? (record.merged.youtube ? 'youtube' : record.merged.licensed ? 'licensed' : null);
    const candidate = targetKind ? record.merged[targetKind] : undefined;
    if (!candidate?.id) return record.resolved.source;
    const key = runtimeKey(trackId, candidate);
    if (status === 'READY') this.runtime.delete(key);
    else this.runtime.set(key, { status, reason: reason || FORCED_REASON[status] });
    this.refresh(record);
    return record.resolved.source;
  }

  isPlayable(trackId: number, pref: SourcePreference): boolean {
    return this.chooseKind(trackId, pref) !== null;
  }

  /**
   * 'auto' prefers licensed audio when READY, else YouTube. An explicit
   * preference is strict: 'licensed' never falls back to YouTube and vice versa.
   */
  chooseKind(trackId: number, pref: SourcePreference): SourceKind | null {
    const record = this.records.get(trackId);
    if (!record) return null;
    const youtubeReady = this.evaluate(trackId, record.merged.youtube).status === 'READY';
    const licensedReady = this.evaluate(trackId, record.merged.licensed).status === 'READY';
    if (pref === 'youtube') return youtubeReady ? 'youtube' : null;
    if (pref === 'licensed') return licensedReady ? 'licensed' : null;
    if (licensedReady) return 'licensed';
    return youtubeReady ? 'youtube' : null;
  }

  // ───────────────────────────────────────────────────────────── internals ──

  private maxTrackId(): number {
    return Math.max(TRACK_COUNT, ...this.records.keys());
  }

  private overridesProblem(error: string, missing = false): OverridesLoadResult {
    if (missing) console.info('[sources] no source-overrides.json — using the static source map only');
    else console.warn(`[sources] source overrides ignored: ${error}`);
    return { applied: 0, error };
  }

  private applyEntries(entries: readonly SourceMapEntry[]): number {
    for (const record of this.records.values()) record.merged = { ...record.base };
    let applied = 0;
    for (const entry of entries) {
      const record = this.records.get(entry.trackId);
      if (!record) continue;
      applyEntry(record.merged, entry);
      applied += 1;
    }
    for (const record of this.records.values()) this.refresh(record);
    return applied;
  }

  private record(trackId: number): TrackRecord {
    const record = this.records.get(trackId);
    if (!record) throw new RangeError(`Unknown canonical track ${trackId}`);
    return record;
  }

  private evaluate(trackId: number, candidate: Candidate | undefined): Evaluation {
    if (!candidate) return { status: 'UNMAPPED', reason: UNMAPPED_REASON, verified: false };
    const { confidence, note } = candidate.entry.verification;
    const verified = candidate.id !== null && confidence >= this.minConfidence;
    if (candidate.forced) return { status: candidate.forced, reason: note || FORCED_REASON[candidate.forced], verified };
    if (!verified) {
      return {
        status: 'UNMAPPED',
        reason: `Unverified candidate (confidence ${confidence.toFixed(2)} < ${this.minConfidence.toFixed(2)}) — not playable until verified.`,
        verified: false,
      };
    }
    const failure = this.runtime.get(runtimeKey(trackId, candidate));
    if (failure) return { status: failure.status, reason: failure.reason, verified };
    return { status: 'READY', reason: null, verified };
  }

  private refresh(record: TrackRecord): void {
    const trackId = record.resolved.id;
    const youtube = record.merged.youtube;
    const licensed = record.merged.licensed;
    const yt = this.evaluate(trackId, youtube);
    const li = this.evaluate(trackId, licensed);
    const kind = this.chooseKind(trackId, 'auto');

    // The state describes the chosen source, else the most informative failing one.
    const describe: Candidate | undefined =
      kind === 'licensed' ? licensed : kind === 'youtube' ? youtube : youtube ?? licensed;
    const evaluation = describe === licensed && licensed ? li : yt;
    const videoId = youtube && yt.verified ? youtube.id : null;
    const audioUrl = licensed && li.verified ? licensed.id : null;

    const next: TrackSourceState = {
      trackId,
      status: kind ? 'READY' : evaluation.status,
      kind,
      videoId,
      audioUrl,
      reason: kind ? null : evaluation.reason,
      durationHint: describe?.entry.durationHint ?? youtube?.entry.durationHint ?? licensed?.entry.durationHint ?? null,
      verification: describe?.entry.verification ?? null,
      externalUrl: videoId ? CONFIG.youtube.watchUrl(videoId) : null,
    };
    Object.assign(record.resolved.source, next);
  }
}

function emptyState(trackId: number): TrackSourceState {
  return {
    trackId,
    status: 'UNMAPPED',
    kind: null,
    videoId: null,
    audioUrl: null,
    reason: UNMAPPED_REASON,
    durationHint: null,
    verification: null,
    externalUrl: null,
  };
}

function runtimeKey(trackId: number, candidate: Candidate): string {
  return `${trackId}|${candidate.kind}|${candidate.id ?? ''}`;
}

/** Inline catalogue fields are declarations by the site owner (src/config/tracks.ts). */
function inlineEntries(track: Track): SourceMapEntry[] {
  const entries: SourceMapEntry[] = [];
  if (track.videoId && VIDEO_ID.test(track.videoId)) {
    entries.push({
      trackId: track.id,
      videoId: track.videoId,
      verification: { method: 'manual-title-match', checkedAt: 'inline', confidence: 1, note: 'Declared inline in the catalogue.' },
    });
  }
  if (track.audioUrl && isAllowedAudioUrl(track.audioUrl)) {
    entries.push({
      trackId: track.id,
      audioUrl: track.audioUrl,
      verification: { method: 'licensed-declaration', checkedAt: 'inline', confidence: 1, note: 'Declared inline in the catalogue.' },
    });
  }
  return entries;
}

/** Applies one entry over lower layers: ids replace, a status-only entry flags the known YouTube source. */
function applyEntry(layer: Partial<Record<SourceKind, Candidate>>, entry: SourceMapEntry): void {
  const forced = entry.status ?? null;
  if (entry.videoId) layer.youtube = { kind: 'youtube', id: entry.videoId, entry, forced };
  if (entry.audioUrl && entry.verification.method === 'licensed-declaration') {
    layer.licensed = { kind: 'licensed', id: entry.audioUrl, entry, forced };
  }
  if (!entry.videoId && !entry.audioUrl && forced) {
    const known = layer.youtube;
    layer.youtube = { kind: 'youtube', id: known?.id ?? null, entry: known ? { ...known.entry, status: forced, verification: entry.verification } : entry, forced };
  }
}
