import * as THREE from 'three';
import { QUALITY } from '../config/config';
import type { QualityProfile, TrackChange } from '../core/types';
import type { IWalkman, WalkmanFrame, WalkmanOptions } from './contracts';
import { Lanyard } from './Lanyard';
import { WalkmanScreen } from './WalkmanScreen';
import { createToonMaterial, createDecalMaterial } from './shaders/toon';
import { createOutlineMaterial } from './shaders/outline';

const PRESENTATION_ANGLE = Math.PI / 6;
const FOCUS_RADIUS = 3.96;
const CAPSULE_START = new THREE.Vector3(-3.25, 0, 0);
const CAPSULE_END = new THREE.Vector3(3.25, 0, 0);

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

/** A truly volumetric, assembled model; all markings are original canvas artwork. */
export class Walkman implements IWalkman {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hoverUniform = { value: 0 };
  private readonly outline = createOutlineMaterial(this.hoverUniform);
  private readonly screen: WalkmanScreen;
  private readonly lanyard: Lanyard;
  private readonly textures: THREE.Texture[] = [];
  private readonly fontsReady: Promise<unknown>;
  private readonly inverse = new THREE.Matrix4();
  private readonly localRay = new THREE.Ray();
  private hoverTarget = 0;
  private pointerX = 0;
  private pointerY = 0;
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private dragging = false;
  private releaseAge = 10;
  private introAge = Infinity;
  private introDuration = 1.3;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveIntro: (() => void) | null = null;
  private disposed = false;
  private quality: QualityProfile;

  constructor(options: WalkmanOptions) {
    this.quality = options.quality;
    this.fontsReady = options.fontsReady;
    this.root.name = 'hero-walkman';
    this.body.name = 'assembled-walkman-body';
    this.root.add(this.body);
    this.screen = new WalkmanScreen(options.quality, options.fontsReady);
    this.buildBody();
    this.body.rotation.set(0.15, -0.20, PRESENTATION_ANGLE, 'YXZ');
    this.body.updateMatrix();
    this.lanyard = new Lanyard(options.quality, options.fontsReady);
    this.root.add(this.lanyard.mesh);
    this.lanyard.update(0, 0, this.body.matrix, 0, options.reducedMotion);
  }

  getFocusBounds(target: THREE.Sphere): THREE.Sphere {
    this.root.updateWorldMatrix(true, false);
    target.center.set(0, 0, 0).applyMatrix4(this.root.matrixWorld);
    target.radius = FOCUS_RADIUS * this.root.matrixWorld.getMaxScaleOnAxis();
    return target;
  }

  hitTest(raycaster: THREE.Raycaster): boolean {
    if (this.disposed) return false;
    this.body.updateWorldMatrix(true, false);
    this.inverse.copy(this.body.matrixWorld).invert();
    this.localRay.copy(raycaster.ray).applyMatrix4(this.inverse);
    return this.localRay.distanceSqToSegment(CAPSULE_START, CAPSULE_END) <= 0.68 ** 2;
  }

  beginDrag(): void {
    this.dragging = true;
    this.yawTarget = this.yaw;
    this.pitchTarget = this.pitch;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
  }

  drag(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    const scale = 5 / Math.max(200, viewportHeightPx);
    this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + dxPx * scale, -Math.PI, Math.PI);
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + dyPx * scale, -1.15, 1.15);
  }

  endDrag(velocityXPx: number, velocityYPx: number, viewportHeightPx: number): void {
    this.dragging = false;
    this.releaseAge = 0;
    const scale = 2.8 / Math.max(200, viewportHeightPx);
    this.yawVelocity = THREE.MathUtils.clamp(velocityXPx * scale, -2.2, 2.2);
    this.pitchVelocity = THREE.MathUtils.clamp(velocityYPx * scale, -1.3, 1.3);
  }

  resetPose(): void {
    this.dragging = false;
    this.yawTarget = 0;
    this.pitchTarget = 0;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.releaseAge = 10;
  }

  setHover(hovered: boolean): void { this.hoverTarget = hovered ? 1 : 0; }

  setPointerInfluence(nx: number, ny: number): void {
    this.pointerX = THREE.MathUtils.clamp(nx, -1, 1);
    this.pointerY = THREE.MathUtils.clamp(ny, -1, 1);
  }

  onTrackChange(change: TrackChange): void { this.screen.onTrackChange(change); }

  playIntro(reducedMotion: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishIntro();
    this.introAge = 0;
    this.introDuration = reducedMotion ? 0.25 : 1.35;
    this.screen.powerOn();
    return new Promise<void>((resolve) => {
      this.resolveIntro = resolve;
      // Resolves even if the tab is hidden and the host suspends animation frames.
      this.introTimer = setTimeout(() => this.finishIntro(), (this.introDuration + 0.1) * 1000);
    });
  }

  setQuality(quality: QualityProfile): void {
    this.quality = quality;
    this.screen.setQuality(quality);
    this.lanyard.setQuality(quality);
    // The static hero mesh stays smooth; adaptive quality reduces animated work.
  }

  update(frame: WalkmanFrame): void {
    if (this.disposed) return;
    const { dt, time, reducedMotion } = frame;
    this.releaseAge += dt;
    this.introAge += dt;
    if (this.resolveIntro && this.introAge >= this.introDuration) this.finishIntro();
    this.hoverUniform.value += (this.hoverTarget - this.hoverUniform.value) * (1 - Math.exp(-9 * dt));
    if (!this.dragging) {
      if (this.releaseAge > 2.2 || reducedMotion) {
        const returnRate = 1 - Math.exp(-1.2 * dt);
        this.yawTarget *= 1 - returnRate;
        this.pitchTarget *= 1 - returnRate;
      } else {
        this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + this.yawVelocity * dt, -Math.PI, Math.PI);
        this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + this.pitchVelocity * dt, -1.15, 1.15);
      }
      const damping = Math.exp(-4.5 * dt);
      this.yawVelocity *= damping;
      this.pitchVelocity *= damping;
    }
    const response = 1 - Math.exp(-(this.dragging ? 18 : 8) * dt);
    this.yaw += (this.yawTarget - this.yaw) * response;
    this.pitch += (this.pitchTarget - this.pitch) * response;
    const motion = reducedMotion ? 0 : 1;
    const playingEnergy = frame.playing ? frame.features.bass * frame.energy : 0;
    const float = motion * (Math.sin(time * 0.72) * 0.065 + Math.sin(time * 1.17) * 0.016);
    const introT = Math.min(1, this.introAge / this.introDuration);
    const intro = reducedMotion ? 0 : 0.55 * Math.exp(-introT * 6) * Math.cos(introT * 7) * (1 - introT);
    this.body.position.y = float + intro;
    this.body.rotation.set(
      0.15 + this.pitch + motion * (Math.sin(time * 0.5) * 0.025 - this.pointerY * 0.025),
      -0.20 + this.yaw + motion * (Math.sin(time * 0.41) * 0.03 + this.pointerX * 0.035),
      PRESENTATION_ANGLE + motion * (Math.sin(time * 0.37) * 0.018 + playingEnergy * 0.012),
      'YXZ',
    );
    this.body.updateMatrix();
    this.lanyard.update(dt, time, this.body.matrix, frame.energy * (frame.playing ? 1 : 0.3), reducedMotion);
    this.screen.update(frame, this.hoverUniform.value);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finishIntro();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of entries) if (material !== this.screen.material) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.screen.dispose();
    this.lanyard.dispose();
    this.root.clear();
  }

  private finishIntro(): void {
    if (this.introTimer !== null) clearTimeout(this.introTimer);
    this.introTimer = null;
    this.resolveIntro?.();
    this.resolveIntro = null;
  }

  private buildBody(): void {
    const segments = QUALITY[this.quality].walkmanRadialSegments;
    const white = createToonMaterial({
      name: 'ceramic-silver-shell', kind: 'paint', hover: this.hoverUniform,
      palette: { highlight: '#ffffff', base: '#f0f6fa', shade: '#a9bfce', deep: '#233b55' },
      shadowTint: 0.1, thresholds: [0.74, 0.12, -0.4],
    });
    const metal = createToonMaterial({
      name: 'illustrated-chrome', kind: 'metal', hover: this.hoverUniform,
      palette: { highlight: '#ffffff', base: '#d5e1e9', shade: '#8195ac', deep: '#102137' },
      bandStrength: 0.8, shadowTint: 0.08,
    });
    const graphite = createToonMaterial({
      name: 'graphite-end-and-controls', kind: 'satin', hover: this.hoverUniform,
      palette: { highlight: '#8d9fae', base: '#354453', shade: '#172332', deep: '#050b13' },
      shadowTint: 0.1,
    });
    const ink = new THREE.MeshBasicMaterial({ color: '#050b1a', name: 'engraved-ink' });
    const labelWhite = new THREE.MeshBasicMaterial({ color: '#effaff', name: 'control-glyph' });

    const lathe = (profile: readonly (readonly [number, number])[]): THREE.LatheGeometry => {
      const geometry = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(r, x)), segments);
      geometry.rotateZ(-Math.PI / 2);
      return geometry;
    };
    this.part(lathe([[-2.81, 0.49], [-2.76, 0.545], [-2.65, 0.56], [2.65, 0.56], [2.77, 0.545], [2.82, 0.49]]), white, 'white-cylindrical-shell');
    this.part(lathe([[-3.80, 0], [-3.78, 0.22], [-3.72, 0.39], [-3.61, 0.50], [-3.48, 0.55], [-2.88, 0.55], [-2.82, 0.51]]), graphite, 'attachment-end-cap');
    this.part(lathe([[2.81, 0.51], [2.87, 0.555], [3.27, 0.555], [3.49, 0.525], [3.65, 0.41], [3.76, 0.23], [3.80, 0]]), metal, 'rounded-chrome-dome');

    // Narrow raised assembly collars and black seams wrap the whole cylinder.
    for (const x of [-2.80, 2.81]) {
      this.part(lathe([[x - 0.075, 0.535], [x - 0.055, 0.575], [x + 0.055, 0.575], [x + 0.075, 0.535]]), metal, 'polished-assembly-collar');
      const seam = new THREE.TorusGeometry(0.557, 0.014, 6, segments);
      seam.rotateY(Math.PI / 2);
      const mesh = this.part(seam, ink, 'assembly-seam', false);
      mesh.position.x = x + 0.09;
    }

    const bezelGeometry = new THREE.ExtrudeGeometry(roundedShape(5.24, 0.82, 0.12), {
      depth: 0.075, bevelEnabled: true, bevelSize: 0.024, bevelThickness: 0.02, bevelSegments: 2, steps: 1, curveSegments: 8,
    });
    const bezel = this.part(bezelGeometry, metal, 'machined-lcd-bezel', false);
    bezel.position.z = 0.47;
    const gasket = this.part(new THREE.ShapeGeometry(roundedShape(5.06, 0.70, 0.07), 8), ink, 'recessed-lcd-gasket', false);
    gasket.position.z = 0.574;
    const lcd = this.part(new THREE.PlaneGeometry(4.94, 0.635), this.screen.material, 'dynamic-lcd-display', false);
    lcd.position.z = 0.58;
    const glassMaterial = new THREE.MeshBasicMaterial({ color: '#d8ffff', transparent: true, opacity: 0.035, depthWrite: false, toneMapped: false });
    const glass = this.part(new THREE.ShapeGeometry(roundedShape(4.97, 0.66, 0.04), 6), glassMaterial, 'protective-lcd-glass', false);
    glass.position.z = 0.587;
    const sheenShape = new THREE.Shape();
    sheenShape.moveTo(-2.43, 0.29);
    sheenShape.lineTo(-1.60, 0.29);
    sheenShape.lineTo(-1.88, -0.29);
    sheenShape.lineTo(-2.43, -0.29);
    sheenShape.closePath();
    const sheen = this.part(new THREE.ShapeGeometry(sheenShape), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, depthWrite: false }), 'subtle-glass-reflection', false);
    sheen.position.z = 0.591;

    // Recessed top controls, with actual raised button caps and printed glyphs.
    for (const [i, x] of [-1.65, -0.6, 0.6, 1.65].entries()) {
      const surround = this.part(new THREE.BoxGeometry(0.67, 0.045, 0.29), ink, 'control-recess', false);
      surround.position.set(x, 0.544, 0.01);
      const key = this.part(new THREE.BoxGeometry(i === 2 ? 0.56 : 0.46, 0.085, 0.23), graphite, `physical-button-${i}`, false);
      key.position.set(x, 0.591, 0.01);
      const label = this.makeLabel(i === 0 ? '−' : i === 1 ? '+' : i === 2 ? '▶ II' : '≫', 256, 96, '#f1fbff', '54px "IBM Plex Mono", monospace');
      const glyph = this.part(new THREE.PlaneGeometry(0.31, 0.14), createDecalMaterial(label), 'button-symbol', false);
      glyph.rotation.x = -Math.PI / 2;
      glyph.position.set(x, 0.637, 0.01);
    }
    // Side jog control / clip bracket, the asymmetric fin visible in reference photos.
    const jog = this.part(new THREE.BoxGeometry(0.73, 0.17, 0.44), graphite, 'side-jog-control');
    jog.position.set(-3.20, -0.56, -0.045);
    const jogInset = this.part(new THREE.BoxGeometry(0.48, 0.045, 0.25), metal, 'jog-metal-contact', false);
    jogInset.position.set(-3.20, -0.665, -0.045);

    // A rear clip rewards rotating the object and makes the depth unambiguous.
    const clip = this.part(new THREE.BoxGeometry(3.62, 0.23, 0.09), graphite, 'rear-pocket-clip');
    clip.position.set(-0.29, 0, -0.59);
    for (const x of [-2.30, 2.30]) {
      const screw = this.part(new THREE.CylinderGeometry(0.06, 0.06, 0.022, 12), metal, 'rear-screw', false);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, 0, -0.569);
      const slot = this.part(new THREE.BoxGeometry(0.075, 0.012, 0.006), ink, 'screw-slot', false);
      slot.position.set(x, 0, -0.584);
    }
    const rearLabel = this.makeLabel('MIDNIGHT FREQUENCY   /   P3 MUSIC ARCHIVE', 1536, 96, '#07152d', '500 50px "Rajdhani", sans-serif');
    const rearPrint = this.part(new THREE.PlaneGeometry(4.05, 0.25), createDecalMaterial(rearLabel), 'rear-model-marking', false);
    rearPrint.rotation.set(0, Math.PI, 0);
    rearPrint.position.set(0, -0.29, -0.49);
    const smallLabel = this.makeLabel('MIDNIGHT     /     FREQUENCY', 1024, 96, '#182b42', '500 48px "Rajdhani", sans-serif');
    const frontPrint = this.part(new THREE.PlaneGeometry(3.3, 0.17), createDecalMaterial(smallLabel), 'front-model-marking', false);
    frontPrint.rotation.x = 0.85;
    frontPrint.position.set(0, -0.446, 0.36);
    const capLabel = this.makeLabel('P3', 256, 160, '#f8fcff', '600 108px "Rajdhani", sans-serif');
    const capPrint = this.part(new THREE.PlaneGeometry(0.43, 0.28), createDecalMaterial(capLabel), 'cap-p3-marking', false);
    capPrint.position.set(-3.25, 0, 0.559);

    // Ring and clasp share the same endpoint coordinates as the textile simulation.
    const eyelet = this.part(new THREE.TorusGeometry(0.16, 0.045, 8, 28), metal, 'attachment-eyelet');
    eyelet.position.set(-3.82, 0.025, 0);
    const splitRing = this.part(new THREE.TorusGeometry(0.20, 0.025, 7, 32), metal, 'lanyard-split-ring');
    splitRing.position.set(-4.02, 0.025, 0);
    splitRing.rotation.y = 0.38;
    const clasp = this.part(new THREE.BoxGeometry(0.13, 0.24, 0.09), metal, 'textile-metal-clasp');
    clasp.position.set(-4.17, 0.065, 0);
    // Tiny corner notches add the two-tone mechanical character of the original.
    for (const x of [2.99, 3.13]) {
      const notch = this.part(new THREE.BoxGeometry(0.032, 0.28, 0.008), ink, 'cap-engraving', false);
      notch.position.set(x, -0.04, 0.553);
    }
    const light = this.part(new THREE.CircleGeometry(0.045, 12), labelWhite, 'status-diode', false);
    light.position.set(2.99, 0.2, 0.523);
  }

  private part(geometry: THREE.BufferGeometry, material: THREE.Material, name: string, outlined = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    this.body.add(mesh);
    if (outlined) {
      const hull = new THREE.Mesh(geometry, this.outline);
      hull.name = `${name}-ink-outline`;
      mesh.add(hull);
    }
    return mesh;
  }

  private makeLabel(text: string, width: number, height: number, color: string, font: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const draw = (): void => {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font;
      ctx.fillText(text, width / 2, height / 2, width - 12);
    };
    draw();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    void this.fontsReady.then(() => {
      if (this.disposed) return;
      draw();
      texture.needsUpdate = true;
    }).catch(() => { /* The markings retain their browser fallback font. */ });
    return texture;
  }
}
