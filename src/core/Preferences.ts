import { CONFIG } from '../config/config';
import { COLLECTIONS, TRACK_COUNT } from '../config/tracks';
import type {
  CollectionFilter,
  MotionPreference,
  Preferences,
  QualitySetting,
  RepeatMode,
  SourcePreference,
  VisualMode,
} from './types';

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  version: 1,
  volume: CONFIG.playback.defaultVolume,
  muted: false,
  repeat: 'all',
  lastTrackId: 46,
  visualMode: 'moonlight',
  quality: 'auto',
  uiSounds: true,
  motion: 'system',
  sourcePreference: 'auto',
  tapTempo: {},
  tracklistFilter: 'ALL',
  syncMode: 'simulated',
});

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

/** Validates untrusted stored data field by field; unknown fields are dropped. */
export function sanitizePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  if (!raw || typeof raw !== 'object') return { ...d, tapTempo: {} };
  const r = raw as Record<string, unknown>;

  const lastTrackId =
    typeof r.lastTrackId === 'number' && Number.isInteger(r.lastTrackId) && r.lastTrackId >= 1 && r.lastTrackId <= TRACK_COUNT
      ? r.lastTrackId
      : d.lastTrackId;

  const tapTempo: Record<number, number> = {};
  if (r.tapTempo && typeof r.tapTempo === 'object') {
    for (const [key, bpm] of Object.entries(r.tapTempo as Record<string, unknown>)) {
      const id = Number(key);
      if (
        Number.isInteger(id) &&
        id >= 1 &&
        id <= TRACK_COUNT &&
        typeof bpm === 'number' &&
        bpm >= CONFIG.sync.minBpm &&
        bpm <= CONFIG.sync.maxBpm
      ) {
        tapTempo[id] = Math.round(bpm * 10) / 10;
      }
    }
  }

  const filters: CollectionFilter[] = ['ALL', ...COLLECTIONS.map((c) => c.id)];

  return {
    version: 1,
    volume: clamp01(r.volume, d.volume),
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    repeat: oneOf<RepeatMode>(r.repeat, ['off', 'all', 'one'], d.repeat),
    lastTrackId,
    visualMode: oneOf<VisualMode>(r.visualMode, ['moonlight', 'darkhour', 'bluememory'], d.visualMode),
    quality: oneOf<QualitySetting>(r.quality, ['auto', 'high', 'medium', 'low'], d.quality),
    uiSounds: typeof r.uiSounds === 'boolean' ? r.uiSounds : d.uiSounds,
    motion: oneOf<MotionPreference>(r.motion, ['system', 'reduce', 'full'], d.motion),
    sourcePreference: oneOf<SourcePreference>(r.sourcePreference, ['auto', 'youtube', 'licensed'], d.sourcePreference),
    tapTempo,
    tracklistFilter: oneOf<CollectionFilter>(r.tracklistFilter, filters, d.tracklistFilter),
    syncMode: oneOf<'simulated' | 'mic'>(r.syncMode, ['simulated', 'mic'], d.syncMode),
  };
}

function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    const probe = '__mf_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Local preference store. Persistence is best-effort: private windows or
 * blocked storage silently fall back to in-memory preferences.
 */
export class PreferencesStore {
  private value: Preferences;
  private readonly listeners = new Set<(prefs: Preferences) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: Storage | null = safeStorage(),
    private readonly key: string = CONFIG.storageKey,
  ) {
    this.value = this.load();
  }

  get(): Readonly<Preferences> {
    return this.value;
  }

  set(patch: Partial<Omit<Preferences, 'version'>>): void {
    const next = sanitizePreferences({ ...this.value, ...patch });
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    this.scheduleSave();
    for (const listener of [...this.listeners]) listener(this.value);
  }

  subscribe(listener: (prefs: Preferences) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.value = { ...DEFAULT_PREFERENCES, tapTempo: {} };
    this.flush();
    for (const listener of [...this.listeners]) listener(this.value);
  }

  /** Writes pending changes immediately (also called on pagehide). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.value));
    } catch {
      /* quota or privacy mode — keep in-memory value */
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  private load(): Preferences {
    try {
      const raw = this.storage?.getItem(this.key);
      return sanitizePreferences(raw ? JSON.parse(raw) : null);
    } catch {
      return sanitizePreferences(null);
    }
  }
}
