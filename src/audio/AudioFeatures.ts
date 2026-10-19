import { CONFIG } from '../config/config';
import type { AudioFeatures } from '../core/types';

/** A zeroed feature frame sized from CONFIG.sync. */
export function createAudioFeatures(): AudioFeatures {
  return {
    level: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    beat: false,
    kick: 0,
    bpm: CONFIG.sync.defaultBpm,
    spectrum: new Float32Array(CONFIG.sync.spectrumBins),
    waveform: new Float32Array(CONFIG.sync.waveformSize),
  };
}

export const clamp01 = (value: number): number => (value > 1 ? 1 : value > 0 ? value : 0);

/** Frame-rate independent exponential approach: `rate` is in 1/s. */
export function smoothTowards(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Envelope follower: rises with `attack`, falls with `release` (both 1/s). */
export function attackRelease(current: number, target: number, attack: number, release: number, dt: number): number {
  return smoothTowards(current, target, target > current ? attack : release, dt);
}

/** Frequency bands shared by the analyser (Hz). */
export const BANDS = {
  bass: [20, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 12000],
} as const satisfies Record<'bass' | 'lowMid' | 'mid' | 'high', readonly [number, number]>;

export type BandName = keyof typeof BANDS;

export const BAND_NAMES: readonly BandName[] = ['bass', 'lowMid', 'mid', 'high'];
