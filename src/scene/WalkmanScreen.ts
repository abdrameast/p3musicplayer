import * as THREE from 'three';
import { CONFIG, QUALITY } from '../config/config';
import type { QualityProfile, TrackChange } from '../core/types';
import type { ScreenData, WalkmanFrame } from './contracts';

const WIDTH = 1536;
const HEIGHT = 240;
const TITLE_WIDTH = 1240;
const INK = '#073947';

export function formatLCDTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

/** Rest at either end; a return cut happens only while the text is already still. */
export function lcdScrollOffset(textWidth: number, availableWidth: number, elapsed: number): number {
  const distance = Math.max(0, textWidth - availableWidth);
  if (!distance) return 0;
  const travel = distance / 58;
  const phase = Math.max(0, elapsed) % (3.5 + travel);
  return Math.min(distance, Math.max(0, phase - 2) * 58);
}

/** One persistent canvas/texture. State changes redraw immediately; motion is capped. */
export class WalkmanScreen {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private hz: number;
  private elapsed = 0;
  private titleAge = 0;
  private transition = 1;
  private power = 1;
  private dirty = true;
  private lastKey = '';
  private lastDraw = -Infinity;
  private disposed = false;
  private titleWidth = 0;
  private title = '';

  constructor(quality: QualityProfile, fontsReady: Promise<unknown>) {
    this.hz = QUALITY[quality].lcdHz;
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('LCD canvas context unavailable');
    this.ctx = context;
    this.background = document.createElement('canvas');
    this.background.width = WIDTH;
    this.background.height = HEIGHT;
    const base = this.background.getContext('2d');
    if (!base) throw new Error('LCD backing canvas context unavailable');
    base.fillStyle = '#93e6e9';
    base.fillRect(0, 0, WIDTH, HEIGHT);
    base.fillStyle = 'rgba(7,57,71,0.055)';
    for (let y = 3; y < HEIGHT; y += 5) {
      for (let x = 3; x < WIDTH; x += 5) base.fillRect(x, y, 1, 1);
    }
    base.strokeStyle = 'rgba(7,57,71,0.24)';
    base.lineWidth = 3;
    base.strokeRect(3, 3, WIDTH - 6, HEIGHT - 6);
    this.ctx.drawImage(this.background, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.MeshBasicMaterial({ name: 'lcd-backlight', map: this.texture, toneMapped: false });
    void fontsReady.then(() => {
      if (this.disposed) return;
      this.title = '';
      this.dirty = true;
    }).catch(() => { /* Browser fallback fonts keep the display usable. */ });
  }

  onTrackChange(_change: TrackChange): void {
    this.transition = 0;
    this.titleAge = 0;
    this.dirty = true;
  }

  powerOn(): void {
    this.power = 0;
    this.dirty = true;
  }

  setQuality(profile: QualityProfile): void {
    this.hz = QUALITY[profile].lcdHz;
  }

  update(frame: WalkmanFrame, hover: number): void {
    const { screen, dt, reducedMotion } = frame;
    this.elapsed += dt;
    this.titleAge += dt;
    this.transition = Math.min(1, this.transition + dt / (CONFIG.transitions.lcdMs / 1000));
    this.power = Math.min(1, this.power + dt * 2.5);
    if (this.title !== screen.title) {
      this.title = screen.title;
      this.titleAge = 0;
      this.ctx.font = '52px "DotGothic16", "Noto Sans JP", monospace';
      this.titleWidth = this.ctx.measureText(this.title).width;
      this.dirty = true;
    }
    const key = [screen.trackNumber, screen.status, Math.floor(screen.position), Math.floor(screen.duration),
      Math.round(screen.volume * 12), screen.muted, screen.repeat, screen.signal, screen.syncReal].join('|');
    const stateChanged = key !== this.lastKey;
    const animate = this.transition < 1 || this.power < 1 || (!reducedMotion && (frame.playing || this.titleWidth > TITLE_WIDTH));
    if (this.dirty || stateChanged || (animate && this.elapsed - this.lastDraw >= 1 / this.hz)) {
      this.lastKey = key;
      this.draw(frame);
      this.lastDraw = this.elapsed;
      this.dirty = false;
    }
    const pulse = reducedMotion ? 0 : (frame.playing ? frame.features.bass * 0.035 : 0);
    const intensity = 0.83 + hover * 0.06 + (frame.playing ? 0.07 : 0) + pulse;
    this.material.color.setScalar(intensity * (0.66 + this.power * 0.34));
  }

  dispose(): void {
    this.disposed = true;
    this.material.dispose();
    this.texture.dispose();
  }

  private draw(frame: WalkmanFrame): void {
    const { screen, reducedMotion } = frame;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(this.background, 0, 0);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.textBaseline = 'alphabetic';
    // One short segment-check pulse, not a repeated flash.
    if (!reducedMotion && this.transition < 0.39) {
      if (this.transition > 0.23) {
        ctx.globalAlpha = 0.2;
        ctx.font = '52px "DotGothic16", monospace';
        ctx.fillText('888  ▰▰▰▰▰▰▰▰▰▰▰▰', 30, 113);
        ctx.globalAlpha = 1;
      }
      this.texture.needsUpdate = true;
      return;
    }
    ctx.globalAlpha = reducedMotion ? 1 : Math.min(1, this.power * 2, (this.transition - 0.36) * 5);
    ctx.font = '23px "IBM Plex Mono", monospace';
    ctx.fillText(`TRACK ${screen.trackNumber.toString().padStart(3, '0')} / 067`, 30, 39);
    ctx.fillText(screen.syncReal ? 'LIVE AUDIO' : 'VISUAL SYNC', 430, 39);
    const signal = screen.signal === 'youtube' ? 'YT' : screen.signal === 'licensed' ? 'FILE' : 'NO SOURCE';
    ctx.textAlign = 'right';
    ctx.fillText(`${signal}   ${screen.repeat === 'off' ? 'STEREO' : screen.repeat === 'one' ? 'REPEAT 1' : 'REPEAT ALL'}`, WIDTH - 30, 39);
    ctx.textAlign = 'left';

    this.drawStatus(screen, 32, 91);
    ctx.save();
    ctx.beginPath();
    ctx.rect(91, 57, TITLE_WIDTH, 66);
    ctx.clip();
    ctx.font = '52px "DotGothic16", "Noto Sans JP", monospace';
    const offset = reducedMotion ? 0 : lcdScrollOffset(this.titleWidth, TITLE_WIDTH, this.titleAge);
    ctx.fillText(this.title, 91 - offset, 107);
    ctx.restore();

    ctx.font = '48px "DotGothic16", monospace';
    ctx.fillText(formatLCDTime(screen.position), 33, 184);
    ctx.font = '24px "IBM Plex Mono", monospace';
    ctx.fillText(`/ ${screen.duration > 0 ? formatLCDTime(screen.duration) : '--:--'}`, 224, 182);
    const status = screen.status === 'SOURCE_UNAVAILABLE' ? 'SOURCE UNAVAILABLE'
      : screen.status === 'AUTOPLAY_BLOCKED' ? 'PRESS PLAY'
      : screen.status === 'INITIALIZING' ? 'CONNECTING' : screen.status;
    ctx.fillText(status, 430, 177);
    ctx.font = '20px "IBM Plex Mono", monospace';
    ctx.fillText(screen.muted ? 'MUTE' : 'VOL', 925, 178);
    for (let i = 0; i < 12; i++) {
      ctx.globalAlpha *= (!screen.muted && screen.volume * 12 > i) ? 1 : 0.16;
      ctx.fillRect(986 + i * 15, 180 - 12 - i * 1.3, 10, 12 + i * 1.3);
      ctx.globalAlpha = reducedMotion ? 1 : Math.min(1, this.power * 2, (this.transition - 0.36) * 5);
    }
    for (let i = 0; i < 12; i++) {
      const sample = frame.features.spectrum[Math.min(frame.features.spectrum.length - 1, i * 4)] ?? 0;
      const height = frame.playing && !reducedMotion ? 5 + Math.round(sample * 42 / 5) * 5 : 5;
      ctx.fillRect(1270 + i * 17, 182 - height, 11, height);
    }
    ctx.globalAlpha = 0.22;
    ctx.fillRect(32, 210, WIDTH - 64, 5);
    ctx.globalAlpha = 1;
    const progress = screen.duration > 0 ? THREE.MathUtils.clamp(screen.position / screen.duration, 0, 1) : 0;
    ctx.fillRect(32, 210, (WIDTH - 64) * progress, 5);
    this.texture.needsUpdate = true;
  }

  private drawStatus(screen: ScreenData, x: number, y: number): void {
    const ctx = this.ctx;
    if (screen.status === 'PLAYING') {
      ctx.beginPath();
      ctx.moveTo(x, y - 20);
      ctx.lineTo(x + 27, y - 2);
      ctx.lineTo(x, y + 16);
      ctx.closePath();
      ctx.fill();
    } else if (screen.status === 'PAUSED') {
      ctx.fillRect(x, y - 18, 9, 33);
      ctx.fillRect(x + 17, y - 18, 9, 33);
    } else {
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y - 16, 25, 29);
    }
  }
}
