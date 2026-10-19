export type UISound = 'select' | 'toggle' | 'panel';

const GAIN = 0.03;
const MIN_GAP_MS = 45;

type AudioContextCtor = typeof AudioContext;

/**
 * Tiny synthesised interface blips (no samples, no game sounds). The
 * AudioContext is created lazily from inside a user gesture, so it never
 * triggers autoplay restrictions; nothing plays when the preference is off.
 */
export class UISounds {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = 0;
  private failed = false;

  constructor(private readonly isEnabled: () => boolean) {}

  play(kind: UISound): void {
    if (!this.isEnabled() || this.failed) return;
    const now = performance.now();
    if (now - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = now;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t = ctx.currentTime + 0.005;
    switch (kind) {
      case 'select':
        this.tone(ctx, 'sine', 880, t, 0.02);
        this.tone(ctx, 'sine', 1320, t + 0.02, 0.02);
        break;
      case 'toggle':
        this.tone(ctx, 'triangle', 660, t, 0.03);
        break;
      case 'panel':
        this.swish(ctx, t, 0.12);
        break;
    }
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.noise = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: AudioContextCtor | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
    if (!Ctor) {
      this.failed = true;
      return null;
    }
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      this.failed = true;
      return null;
    }
    return this.ctx;
  }

  private envelope(ctx: AudioContext, start: number, duration: number): GainNode {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(GAIN, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    gain.connect(ctx.destination);
    return gain;
  }

  private tone(ctx: AudioContext, type: OscillatorType, frequency: number, start: number, duration: number): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    const gain = this.envelope(ctx, start, duration);
    osc.connect(gain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  private swish(ctx: AudioContext, start: number, duration: number): void {
    if (!this.noise) {
      const length = Math.ceil(ctx.sampleRate * duration);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(900, start);
    filter.frequency.exponentialRampToValueAtTime(3800, start + duration);
    const gain = this.envelope(ctx, start, duration);
    src.connect(filter);
    filter.connect(gain);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(start);
    src.stop(start + duration);
  }
}
