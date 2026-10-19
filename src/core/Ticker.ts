export type TickHandler = (dt: number, time: number, now: number) => void;

/**
 * requestAnimationFrame loop with clamped delta time. Paused while the
 * document is hidden so no GPU/CPU work happens in background tabs.
 */
export class Ticker {
  private frame = 0;
  private running = false;
  private last = 0;
  private elapsed = 0;

  constructor(
    private readonly handler: TickHandler,
    private readonly maxDt = 0.1,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(this.maxDt, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.elapsed += dt;
    try {
      this.handler(dt, this.elapsed, now);
    } catch (error) {
      console.error('[Ticker] frame failed', error);
    }
    this.frame = requestAnimationFrame(this.loop);
  };
}
