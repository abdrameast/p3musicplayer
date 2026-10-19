import { CONFIG, ENERGY_SCALE, getVisualProfile } from '../config/config';
import type { AudioFeatures } from '../core/types';
import { attackRelease, clamp01, smoothTowards } from './AudioFeatures';

/**
 * SIMULATED visual sync — the default mode, used whenever no real audio can
 * be analysed (a YouTube iframe is cross-origin). Features are derived from
 * the playback position, a tempo grid (tapped BPM or the default), slow
 * per-track intensity curves and the track's hand-assigned energy profile.
 * Being a pure function of the position, it stays phase-consistent through
 * seeks and pauses. It is an approximation and is never labelled as analysis.
 */

export interface SimulatedInput {
  trackId: number;
  /** Interpolated playback position, seconds. */
  position: number;
  playing: boolean;
  /** Seconds, 0 when unknown. */
  duration: number;
  bpm: number;
  /** Position (s) of a known beat, e.g. the last tap-tempo tap. */
  beatAnchor: number;
}

const TAU = Math.PI * 2;
const BINS = CONFIG.sync.spectrumBins;

/** Deterministic per-track pseudo-random values in [0, 1). */
function seeded(trackId: number, salt: number): number {
  let h = Math.imul(trackId ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const gauss = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));

/** Spectral weight of each band across the log-spaced spectrum bins. */
const BIN_WEIGHTS = Array.from({ length: BINS }, (_, i) => {
  const x = i / Math.max(1, BINS - 1);
  return {
    tilt: 0.12 + 0.3 * (1 - x) ** 1.4,
    bass: gauss(x, 0.07, 0.09),
    lowMid: gauss(x, 0.24, 0.11),
    mid: gauss(x, 0.47, 0.15),
    high: gauss(x, 0.77, 0.19),
  };
});

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

export class SimulatedSync {
  private lastBeat = Number.NaN;
  private lastPosition = 0;
  private lastTrackId = -1;
  private clock = 0;
  private wavePhase = 0;

  /** Writes one frame of simulated features into `out`. */
  update(dt: number, input: SimulatedInput, out: AudioFeatures): void {
    this.clock += dt;
    const energy = ENERGY_SCALE[getVisualProfile(input.trackId).energy];
    const bpm = input.bpm;
    out.bpm = bpm;

    let targets: { level: number; bass: number; lowMid: number; mid: number; high: number };
    if (input.playing) {
      const beats = ((input.position - input.beatAnchor) * bpm) / 60;
      const beatIndex = Math.floor(beats);
      const phase = beats - beatIndex;
      // A seek or a track change re-anchors the grid without firing a fake beat.
      const jumped =
        input.trackId !== this.lastTrackId || input.position < this.lastPosition - 0.05 || input.position - this.lastPosition > 1;
      out.beat = !jumped && !Number.isNaN(this.lastBeat) && beatIndex !== this.lastBeat;
      this.lastBeat = beatIndex;

      const accent = mod(beatIndex, 4) === 0 ? 1 : 0.72;
      const kick = Math.exp(-phase * 5.5) * accent;
      const hat = Math.exp(-mod(beats * 2, 1) * 9);
      const intensity = this.intensity(input) * energy;
      out.kick = clamp01(kick * intensity);
      const sway = 0.5 + 0.5 * Math.sin(TAU * (input.position / 7.3 + seeded(input.trackId, 3)));
      targets = {
        bass: clamp01(intensity * (0.28 + 0.72 * kick)),
        lowMid: clamp01(intensity * (0.34 + 0.26 * kick + 0.18 * sway)),
        mid: clamp01(intensity * (0.4 + 0.3 * sway)),
        high: clamp01(intensity * (0.18 + 0.5 * hat)),
        level: 0,
      };
    } else {
      // Paused / stopped: decay to a quiet breathing floor.
      out.beat = false;
      this.lastBeat = Number.NaN;
      out.kick = smoothTowards(out.kick, 0, 5, dt);
      const breath = 0.045 + 0.025 * (0.5 + 0.5 * Math.sin(this.clock * 0.9));
      targets = { bass: breath * 0.9, lowMid: breath * 0.8, mid: breath * 0.6, high: breath * 0.4, level: 0 };
    }
    targets.level = 0.4 * targets.bass + 0.25 * targets.lowMid + 0.2 * targets.mid + 0.15 * targets.high;
    this.lastPosition = input.position;
    this.lastTrackId = input.trackId;

    out.bass = attackRelease(out.bass, targets.bass, 22, 6, dt);
    out.lowMid = attackRelease(out.lowMid, targets.lowMid, 16, 5, dt);
    out.mid = attackRelease(out.mid, targets.mid, 10, 4, dt);
    out.high = attackRelease(out.high, targets.high, 20, 7, dt);
    out.level = attackRelease(out.level, targets.level, 12, 4, dt);

    this.writeSpectrum(input.trackId, dt, out);
    this.writeWaveform(dt, out);
  }

  /** Slow, track-seeded section dynamics with a soft intro and outro (0..1). */
  private intensity(input: SimulatedInput): number {
    const { trackId, position, duration } = input;
    const section = 18 + seeded(trackId, 1) * 14;
    const arc = 47 + seeded(trackId, 2) * 30;
    let value =
      0.64 +
      0.22 * Math.sin(TAU * (position / section + seeded(trackId, 4))) +
      0.12 * Math.sin(TAU * (position / arc + seeded(trackId, 5)));
    value *= Math.min(1, 0.45 + (0.55 * position) / 8);
    if (duration > 0) value *= Math.min(1, 0.35 + (0.65 * Math.max(0, duration - position)) / 6);
    return clamp01(value);
  }

  private writeSpectrum(trackId: number, dt: number, out: AudioFeatures): void {
    const seed = seeded(trackId, 6) * 10;
    for (let i = 0; i < out.spectrum.length; i += 1) {
      const w = BIN_WEIGHTS[i] ?? BIN_WEIGHTS[BIN_WEIGHTS.length - 1];
      const shape = w.tilt * out.level + w.bass * out.bass + w.lowMid * out.lowMid + w.mid * out.mid + w.high * out.high;
      const shimmer = 0.85 + 0.15 * Math.sin(i * 1.7 + this.clock * 1.3 + seed) * Math.sin(i * 0.37 + this.clock * 0.6);
      out.spectrum[i] = attackRelease(out.spectrum[i], clamp01(shape * shimmer), 18, 6, dt);
    }
  }

  private writeWaveform(dt: number, out: AudioFeatures): void {
    this.wavePhase = mod(this.wavePhase + dt * TAU * 1.5, TAU * 1000);
    const size = out.waveform.length;
    for (let j = 0; j < size; j += 1) {
      const t = j / size;
      const value =
        0.55 * Math.sin(TAU * t * 2 + this.wavePhase) * (0.4 + out.bass) +
        0.3 * Math.sin(TAU * t * 5.5 + this.wavePhase * 1.7) * out.mid +
        0.15 * Math.sin(TAU * t * 17 + this.wavePhase * 3.1) * out.high;
      out.waveform[j] = Math.max(-1, Math.min(1, value * (0.3 + out.level)));
    }
  }
}
