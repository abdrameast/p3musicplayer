import type { QualityProfile, QualitySetting } from '../core/types';

/** What the initial 'auto' guess is based on. Injected in tests. */
export interface DeviceInfo {
  coarsePointer: boolean;
  mobile: boolean;
  viewportWidth: number;
  viewportHeight: number;
  /** navigator.deviceMemory (GiB), when exposed. */
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

const ORDER: readonly QualityProfile[] = ['high', 'medium', 'low'];

/** Frames measured before the monitor starts judging (shader warm-up, intro). */
const WARMUP_S = 4;
/** Averaging window. */
const WINDOW_S = 3;
/** Average frame time that triggers a step down (≈45 fps). */
const SLOW_FRAME_MS = 22;
/** Minimum delay between two automatic step downs. */
const COOLDOWN_S = 6;
/** Longer intervals are stalls (tab switch, GC, debugger), not render cost. */
const STALL_S = 0.25;
const SMALL_VIEWPORT_PX = 600;

export function detectDevice(): DeviceInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const coarsePointer =
    typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false;
  const uaMobile = (nav as (Navigator & { userAgentData?: { mobile?: boolean } }) | undefined)?.userAgentData?.mobile;
  const mobile = uaMobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav?.userAgent ?? '');
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return {
    coarsePointer,
    mobile,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
    deviceMemory: typeof memory === 'number' ? memory : undefined,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}

export function pickInitialProfile(device: DeviceInfo): QualityProfile {
  const lowEnd =
    device.mobile &&
    ((device.deviceMemory !== undefined && device.deviceMemory <= 4) ||
      (device.hardwareConcurrency !== undefined && device.hardwareConcurrency <= 4));
  if (lowEnd) return 'low';
  const small = Math.min(device.viewportWidth, device.viewportHeight) < SMALL_VIEWPORT_PX;
  if (device.coarsePointer || device.mobile || small) return 'medium';
  return 'high';
}

/**
 * Resolves the quality setting to a profile. In 'auto' it watches real frame
 * intervals and steps down one profile when the average frame time stays too
 * high; explicit settings are never changed.
 */
export class QualityManager {
  private currentSetting: QualitySetting;
  private currentProfile: QualityProfile;
  private elapsed = 0;
  private windowTime = 0;
  private windowFrames = 0;
  private sinceStepDown = Number.POSITIVE_INFINITY;

  constructor(
    setting: QualitySetting,
    private readonly device: DeviceInfo = detectDevice(),
  ) {
    this.currentSetting = setting;
    this.currentProfile = setting === 'auto' ? pickInitialProfile(device) : setting;
  }

  get profile(): QualityProfile {
    return this.currentProfile;
  }

  get setting(): QualitySetting {
    return this.currentSetting;
  }

  /** Returns the resolved profile. Re-selecting 'auto' restarts from the device guess. */
  setSetting(setting: QualitySetting): QualityProfile {
    this.currentSetting = setting;
    this.currentProfile = setting === 'auto' ? pickInitialProfile(this.device) : setting;
    this.resetMonitoring();
    return this.currentProfile;
  }

  /** Call after the loop was paused so the gap is not mistaken for slowness. */
  resetMonitoring(): void {
    this.elapsed = 0;
    this.windowTime = 0;
    this.windowFrames = 0;
  }

  /**
   * Feed the real (unclamped) interval between two rendered frames, in seconds.
   * Returns the new profile when an automatic step down happened, else null.
   */
  sample(intervalS: number): QualityProfile | null {
    if (this.currentSetting !== 'auto' || !(intervalS > 0) || intervalS > STALL_S) return null;
    this.sinceStepDown += intervalS;
    this.elapsed += intervalS;
    if (this.elapsed < WARMUP_S) return null;

    this.windowTime += intervalS;
    this.windowFrames += 1;
    if (this.windowTime < WINDOW_S) return null;

    const averageMs = (this.windowTime / this.windowFrames) * 1000;
    this.windowTime = 0;
    this.windowFrames = 0;
    if (averageMs <= SLOW_FRAME_MS || this.sinceStepDown < COOLDOWN_S) return null;

    const next = ORDER[ORDER.indexOf(this.currentProfile) + 1];
    if (!next) return null;
    this.currentProfile = next;
    this.sinceStepDown = 0;
    // The new profile gets its own warm-up (pipelines are rebuilt).
    this.elapsed = 0;
    return next;
  }
}
