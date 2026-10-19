import * as THREE from 'three';
import { MODES } from '../config/config';
import { formatTrackNumber } from '../config/tracks';
import type { VisualMode } from '../core/types';
import { PRESENTATION_ANGLE } from '../scene/CameraRig';
import type { ScenePalette } from '../scene/Lighting';

export interface BackdropFrame {
  dt: number;
  palette: ScenePalette;
  parallax: THREE.Vector2;
  reducedMotion: boolean;
  fade: number;
}

const NUMBER_CANVAS = { width: 1024, height: 448 };
const WORD_CANVAS = { width: 1024, height: 192 };
const NUMBER_FONT = '"Rajdhani", "Michroma", "Noto Sans JP", sans-serif';
const WORD_FONT = '"Michroma", "Rajdhani", "Noto Sans JP", sans-serif';
const KANJI_FONT = '"Noto Sans JP", sans-serif';

const NUMBER_OPACITY = 0.065;
const WORD_OPACITY = 0.13;
const SLIDE_S = 0.75;
const SLIDE_FEATURED_S = 0.95;
const FADE_REDUCED_S = 0.3;

/** Word shown when no featured accent applies. */
export function modeWord(mode: VisualMode): string {
  return mode === 'darkhour' ? 'THE DARK HOUR' : MODES[mode].label;
}

interface TypePlane {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  text: string;
  sub: string;
  /** Animation: offset (in focus radii, along slideAxis) and opacity, from → to. */
  fromOffset: number;
  toOffset: number;
  fromAlpha: number;
  toAlpha: number;
  t: number;
  duration: number;
}

type Painter = (ctx: CanvasRenderingContext2D, text: string, sub: string) => void;

const paintNumber: Painter = (ctx, text) => {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  // Same forward lean as the HUD's skewed panels.
  ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.font = `700 ${Math.round(height * 0.9)}px ${NUMBER_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'miter';
  ctx.lineWidth = Math.max(2, height * 0.011);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, 0, height * 0.04);
  ctx.restore();
};

const paintWord: Painter = (ctx, text, sub) => {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  // Manual tracking: canvas letterSpacing is not available everywhere.
  const size = Math.round(height * 0.3);
  ctx.font = `400 ${size}px ${WORD_FONT}`;
  ctx.textBaseline = 'alphabetic';
  const chars = [...text];
  const tracking = size * 0.32;
  const total = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + tracking * (chars.length - 1);
  const scale = Math.min(1, (width * 0.92) / total);
  ctx.save();
  ctx.translate(width * 0.04, height * 0.5);
  ctx.scale(scale, 1);
  let x = 0;
  for (const ch of chars) {
    ctx.fillText(ch, x, 0);
    x += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();
  // Hairline rule + small Japanese annotation underneath.
  ctx.fillRect(width * 0.04, height * 0.62, width * 0.5, Math.max(1, height * 0.012));
  ctx.font = `500 ${Math.round(height * 0.17)}px ${KANJI_FONT}`;
  ctx.fillText(sub, width * 0.04, height * 0.88);
};

/**
 * Atmospheric typography inside the 3D scene, behind the walkman: a huge
 * outlined three-digit track number and a short word (featured accent, mode
 * label or THE DARK HOUR). Two planes per element let the old value slide out
 * while the new one slides in. Very low opacity — décor, never information.
 */
export class BackdropType {
  readonly group = new THREE.Group();
  private readonly numbers: [TypePlane, TypePlane];
  private readonly words: [TypePlane, TypePlane];
  private readonly numberBase: THREE.Vector3;
  private readonly wordBase: THREE.Vector3;
  private currentNumber = '';
  private currentWord = '';
  private currentSub = '';
  private disposed = false;

  constructor(
    private readonly focusRadius: number,
    fontsReady: Promise<unknown>,
  ) {
    const r = focusRadius;
    this.group.name = 'visuals:backdrop-type';
    const numberHeight = 2.0 * r;
    const numberWidth = numberHeight * (NUMBER_CANVAS.width / NUMBER_CANVAS.height);
    const wordWidth = 2.5 * r;
    const wordHeight = wordWidth * (WORD_CANVAS.height / WORD_CANVAS.width);
    this.numbers = [this.createPlane(NUMBER_CANVAS, numberWidth, numberHeight), this.createPlane(NUMBER_CANVAS, numberWidth, numberHeight)];
    this.words = [this.createPlane(WORD_CANVAS, wordWidth, wordHeight), this.createPlane(WORD_CANVAS, wordWidth, wordHeight)];

    // Number in the empty upper-left of the diagonal, word along the lower-right.
    this.numberBase = new THREE.Vector3(-0.6 * r, 0.62 * r, -2.6 * r);
    const c = Math.cos(PRESENTATION_ANGLE);
    const s = Math.sin(PRESENTATION_ANGLE);
    const along = 0.3 * r;
    const across = -1.38 * r;
    this.wordBase = new THREE.Vector3(along * c - across * s, along * s + across * c, -1.7 * r);
    for (const plane of this.words) plane.mesh.rotation.z = PRESENTATION_ANGLE;
    for (const plane of [...this.numbers, ...this.words]) this.group.add(plane.mesh);

    // Fonts may arrive after the first paint: repaint with the real faces.
    fontsReady
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        this.repaint(this.numbers, paintNumber);
        this.repaint(this.words, paintWord);
      });
  }

  /** Shows a track number; `animate` false = immediate (initial state, missed events). */
  setNumber(trackId: number, direction: -1 | 0 | 1, featured: boolean, animate: boolean, reducedMotion: boolean): void {
    const text = formatTrackNumber(trackId);
    if (text === this.currentNumber) return;
    this.currentNumber = text;
    this.swap(this.numbers, text, '', paintNumber, direction, featured, animate, reducedMotion);
  }

  setWord(word: string, sub: string, animate: boolean, reducedMotion: boolean): void {
    if (word === this.currentWord && sub === this.currentSub) return;
    this.currentWord = word;
    this.currentSub = sub;
    this.swap(this.words, word, sub, paintWord, 1, false, animate, reducedMotion);
  }

  update(frame: BackdropFrame): void {
    const r = this.focusRadius;
    const color = frame.palette.spectrumColor;
    const px = frame.parallax.x;
    const py = frame.parallax.y;
    this.animate(this.numbers, frame.dt, NUMBER_OPACITY * frame.fade, color, (plane, offset) => {
      plane.mesh.position.set(this.numberBase.x + offset * r - px * 0.05 * r, this.numberBase.y - py * 0.03 * r, this.numberBase.z);
    });
    const c = Math.cos(PRESENTATION_ANGLE);
    const s = Math.sin(PRESENTATION_ANGLE);
    this.animate(this.words, frame.dt, WORD_OPACITY * frame.fade, color, (plane, offset) => {
      plane.mesh.position.set(
        this.wordBase.x + offset * r * c - px * 0.035 * r,
        this.wordBase.y + offset * r * s - py * 0.02 * r,
        this.wordBase.z,
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const plane of [...this.numbers, ...this.words]) {
      plane.mesh.geometry.dispose();
      plane.mesh.material.dispose();
      plane.texture.dispose();
      // Release the canvas backing store promptly.
      plane.canvas.width = 0;
      plane.canvas.height = 0;
    }
    this.group.clear();
  }

  private createPlane(size: { width: number; height: number }, width: number, height: number): TypePlane {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for backdrop typography');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.renderOrder = 2;
    mesh.visible = false;
    return { mesh, canvas, ctx, texture, text: '', sub: '', fromOffset: 0, toOffset: 0, fromAlpha: 0, toAlpha: 0, t: 1, duration: 1 };
  }

  private swap(
    pair: [TypePlane, TypePlane],
    text: string,
    sub: string,
    paint: Painter,
    direction: -1 | 0 | 1,
    featured: boolean,
    animate: boolean,
    reducedMotion: boolean,
  ): void {
    const [current, next] = pair;
    next.text = text;
    next.sub = sub;
    paint(next.ctx, text, sub);
    next.texture.needsUpdate = true;

    const slide = animate && !reducedMotion;
    const duration = !animate ? 0 : reducedMotion ? FADE_REDUCED_S : featured ? SLIDE_FEATURED_S : SLIDE_S;
    const distance = slide ? (direction === 0 ? 0.35 : 0.6 * direction) * (featured ? 1.3 : 1) : 0;
    this.start(next, distance, 0, 0, 1, duration);
    this.start(current, this.offsetOf(current), -distance, this.alphaOf(current), 0, duration * 0.55);
    pair[0] = next;
    pair[1] = current;
  }

  private start(plane: TypePlane, fromOffset: number, toOffset: number, fromAlpha: number, toAlpha: number, duration: number): void {
    plane.fromOffset = fromOffset;
    plane.toOffset = toOffset;
    plane.fromAlpha = fromAlpha;
    plane.toAlpha = toAlpha;
    plane.duration = duration;
    plane.t = duration > 0 ? 0 : 1;
  }

  private progress(plane: TypePlane): number {
    // Expo-out: snaps into place, settles softly.
    return plane.t >= 1 ? 1 : 1 - 2 ** (-10 * plane.t);
  }

  private offsetOf(plane: TypePlane): number {
    return THREE.MathUtils.lerp(plane.fromOffset, plane.toOffset, this.progress(plane));
  }

  private alphaOf(plane: TypePlane): number {
    return THREE.MathUtils.lerp(plane.fromAlpha, plane.toAlpha, this.progress(plane));
  }

  private animate(
    pair: [TypePlane, TypePlane],
    dt: number,
    opacity: number,
    color: THREE.Color,
    place: (plane: TypePlane, offset: number) => void,
  ): void {
    for (const plane of pair) {
      if (plane.t < 1) plane.t = Math.min(1, plane.t + dt / plane.duration);
      const alpha = this.alphaOf(plane);
      const material = plane.mesh.material;
      material.opacity = alpha * opacity;
      material.color.copy(color);
      plane.mesh.visible = material.opacity > 0.002;
      place(plane, this.offsetOf(plane));
    }
  }

  private repaint(pair: [TypePlane, TypePlane], paint: Painter): void {
    for (const plane of pair) {
      if (!plane.text) continue;
      paint(plane.ctx, plane.text, plane.sub);
      plane.texture.needsUpdate = true;
    }
  }
}
