import { CONFIG } from '../config/config';
import type { AudioFeatures } from '../core/types';
import { BANDS, BAND_NAMES, attackRelease, clamp01, type BandName } from './AudioFeatures';

/**
 * Real-time analysis of an audio graph through an AnalyserNode: log-spaced
 * spectrum, four bands with adaptive normalisation, spectral-flux onsets on
 * the low end (beat / kick) and a tempo estimate from inter-onset intervals.
 * Everything happens locally on the frames already flowing through the node;
 * nothing is recorded or sent anywhere.
 */

const SPECTRUM_MIN_HZ = 30;
const SPECTRUM_MAX_HZ = 16000;
const ONSET_MIN_HZ = 20;
const ONSET_MAX_HZ = 500;
/** Shortest allowed gap between two onsets (≈ 214 BPM). */
const REFRACTORY_MS = 280;
const FLUX_HISTORY = 48;
const ONSET_WINDOW_MS = 10000;
const BPM_FOLD_MIN = 70;
const BPM_FOLD_MAX = 180;
/** Running maxima decay with this time constant (s): adapts to quiet and loud passages. */
const NORMALISE_TAU = 4;
const BAND_FLOOR = 0.08;

export class AudioAnalyzer {
  /** Connect sources here. */
  readonly node: AnalyserNode;

  private readonly frequency: Uint8Array<ArrayBuffer>;
  private readonly previous: Float32Array<ArrayBuffer>;
  private readonly time: Float32Array<ArrayBuffer>;
  private readonly spectrumRanges: Array<[number, number]>;
  private readonly spectrumValues = new Float32Array(CONFIG.sync.spectrumBins);
  private readonly bandRanges: Record<BandName, [number, number]>;
  private readonly onsetRange: [number, number];
  private readonly bandMax: Record<BandName, number> = { bass: BAND_FLOOR, lowMid: BAND_FLOOR, mid: BAND_FLOOR, high: BAND_FLOOR };
  private readonly fluxHistory = new Float32Array(FLUX_HISTORY);
  private fluxIndex = 0;
  private fluxCount = 0;
  private spectrumMax = BAND_FLOOR;
  private levelMax = 0.05;
  private peakMax = 0.1;
  private lastOnset = Number.NEGATIVE_INFINITY;
  private onsets: number[] = [];
  private bpm: number = CONFIG.sync.defaultBpm;
  private lastTempoUpdate = 0;

  constructor(context: BaseAudioContext) {
    this.node = context.createAnalyser();
    this.node.fftSize = CONFIG.sync.fftSize;
    this.node.smoothingTimeConstant = CONFIG.sync.smoothingTimeConstant;
    this.node.minDecibels = -90;
    this.node.maxDecibels = -20;
    const bins = this.node.frequencyBinCount;
    this.frequency = new Uint8Array(bins);
    this.previous = new Float32Array(bins);
    this.time = new Float32Array(this.node.fftSize);

    const hzPerBin = context.sampleRate / this.node.fftSize;
    const toBin = (hz: number) => Math.min(bins - 1, Math.max(1, Math.round(hz / hzPerBin)));
    const range = (low: number, high: number): [number, number] => {
      const start = toBin(low);
      return [start, Math.max(start + 1, toBin(high))];
    };
    this.bandRanges = {
      bass: range(...BANDS.bass),
      lowMid: range(...BANDS.lowMid),
      mid: range(...BANDS.mid),
      high: range(...BANDS.high),
    };
    this.onsetRange = range(ONSET_MIN_HZ, ONSET_MAX_HZ);
    const count = CONFIG.sync.spectrumBins;
    const ratio = SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ;
    this.spectrumRanges = Array.from({ length: count }, (_, i) =>
      range(SPECTRUM_MIN_HZ * ratio ** (i / count), SPECTRUM_MIN_HZ * ratio ** ((i + 1) / count)),
    );
  }

  /** Forget adaptive state (new source). */
  reset(): void {
    this.previous.fill(0);
    this.fluxHistory.fill(0);
    this.fluxIndex = 0;
    this.fluxCount = 0;
    this.spectrumMax = BAND_FLOOR;
    this.levelMax = 0.05;
    this.peakMax = 0.1;
    for (const band of BAND_NAMES) this.bandMax[band] = BAND_FLOOR;
    this.lastOnset = Number.NEGATIVE_INFINITY;
    this.onsets = [];
    this.bpm = CONFIG.sync.defaultBpm;
    this.lastTempoUpdate = 0;
  }

  /** Reads the analyser and writes one smoothed feature frame into `out`. `now` in ms. */
  update(dt: number, now: number, out: AudioFeatures): void {
    this.node.getByteFrequencyData(this.frequency);
    this.node.getFloatTimeDomainData(this.time);
    const decay = Math.exp(-dt / NORMALISE_TAU);

    for (const band of BAND_NAMES) {
      const raw = this.mean(this.bandRanges[band]);
      this.bandMax[band] = Math.max(raw, this.bandMax[band] * decay, BAND_FLOOR);
      out[band] = attackRelease(out[band], clamp01(raw / this.bandMax[band]), 24, 6, dt);
    }

    let frameMax = 0;
    const spectrum = this.spectrumValues;
    for (let i = 0; i < this.spectrumRanges.length; i += 1) {
      spectrum[i] = this.mean(this.spectrumRanges[i]);
      frameMax = Math.max(frameMax, spectrum[i]);
    }
    this.spectrumMax = Math.max(frameMax, this.spectrumMax * decay, BAND_FLOOR);
    for (let i = 0; i < spectrum.length && i < out.spectrum.length; i += 1) {
      out.spectrum[i] = attackRelease(out.spectrum[i], clamp01(spectrum[i] / this.spectrumMax), 20, 6, dt);
    }

    this.writeWaveformAndLevel(dt, decay, out);
    this.detectOnset(dt, now, out);
    out.bpm = this.bpm;
  }

  private mean([start, end]: [number, number]): number {
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += this.frequency[i];
    return sum / (255 * (end - start));
  }

  private writeWaveformAndLevel(dt: number, decay: number, out: AudioFeatures): void {
    const samples = this.time;
    let energy = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(energy / samples.length);
    this.levelMax = Math.max(rms, this.levelMax * decay, 0.02);
    out.level = attackRelease(out.level, clamp01(rms / this.levelMax), 18, 5, dt);

    this.peakMax = Math.max(peak, this.peakMax * decay, 0.05);
    const size = out.waveform.length;
    const stride = samples.length / size;
    for (let j = 0; j < size; j += 1) {
      const value = samples[Math.floor(j * stride)] / this.peakMax;
      out.waveform[j] = value > 1 ? 1 : value < -1 ? -1 : value;
    }
  }

  /** Spectral flux over the low end with an adaptive threshold and a refractory period. */
  private detectOnset(dt: number, now: number, out: AudioFeatures): void {
    const [start, end] = this.onsetRange;
    let flux = 0;
    for (let i = start; i < end; i += 1) {
      const magnitude = this.frequency[i] / 255;
      const rise = magnitude - this.previous[i];
      if (rise > 0) flux += rise;
      this.previous[i] = magnitude;
    }
    flux /= end - start;

    let mean = 0;
    for (let i = 0; i < this.fluxCount; i += 1) mean += this.fluxHistory[i];
    mean = this.fluxCount > 0 ? mean / this.fluxCount : 0;
    let variance = 0;
    for (let i = 0; i < this.fluxCount; i += 1) variance += (this.fluxHistory[i] - mean) ** 2;
    const deviation = this.fluxCount > 1 ? Math.sqrt(variance / this.fluxCount) : 0;
    const threshold = mean + 1.5 * deviation + 0.012;

    this.fluxHistory[this.fluxIndex] = flux;
    this.fluxIndex = (this.fluxIndex + 1) % FLUX_HISTORY;
    this.fluxCount = Math.min(FLUX_HISTORY, this.fluxCount + 1);

    const isOnset = this.fluxCount >= 8 && flux > threshold && now - this.lastOnset >= REFRACTORY_MS;
    out.beat = isOnset;
    if (isOnset) {
      this.lastOnset = now;
      out.kick = Math.max(out.kick, clamp01(0.55 + (flux - threshold) / (threshold + 1e-6)));
      this.onsets.push(now);
      while (this.onsets.length > 0 && now - this.onsets[0] > ONSET_WINDOW_MS) this.onsets.shift();
    } else {
      out.kick *= Math.exp(-dt * 7);
    }
    if (now - this.lastTempoUpdate > 500) {
      this.lastTempoUpdate = now;
      const estimate = estimateBpm(this.onsets);
      if (estimate !== null) this.bpm += (estimate - this.bpm) * 0.35;
    }
  }
}

/** Folds a tempo into [70, 180] BPM by octaves. */
export function foldBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return CONFIG.sync.defaultBpm;
  let value = bpm;
  while (value < BPM_FOLD_MIN) value *= 2;
  while (value > BPM_FOLD_MAX) value /= 2;
  return value;
}

/**
 * Tempo from onset times (ms): intervals between onsets up to four apart are
 * folded into 70–180 BPM and voted into a 1-BPM histogram; the peak wins.
 * Returns null with fewer than 6 onsets.
 */
export function estimateBpm(onsets: readonly number[]): number | null {
  if (onsets.length < 6) return null;
  const histogram = new Float32Array(BPM_FOLD_MAX - BPM_FOLD_MIN + 1);
  for (let i = 0; i < onsets.length; i += 1) {
    for (let gap = 1; gap <= 4 && i + gap < onsets.length; gap += 1) {
      const interval = (onsets[i + gap] - onsets[i]) / gap;
      if (interval <= 0) continue;
      const bin = Math.round(foldBpm(60000 / interval)) - BPM_FOLD_MIN;
      const weight = 1 / gap;
      histogram[bin] += weight;
      if (bin > 0) histogram[bin - 1] += weight * 0.5;
      if (bin < histogram.length - 1) histogram[bin + 1] += weight * 0.5;
    }
  }
  let best = 0;
  for (let i = 1; i < histogram.length; i += 1) if (histogram[i] > histogram[best]) best = i;
  return histogram[best] > 0 ? best + BPM_FOLD_MIN : null;
}
