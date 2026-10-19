import * as THREE from 'three';
import { QUALITY } from '../config/config';
import type { QualityProfile } from '../core/types';
import { createToonMaterial, setToonPrint } from './shaders/toon';
import type { ToonMaterial } from './shaders/toon';

const WIDTH = 0.34;
const THICKNESS = 0.014;

/** A loop of woven ribbon. Both ends are pinned to the actual attachment clasp. */
export class Lanyard {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, ToonMaterial>;
  private readonly curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.10, 0.13, 0),
    new THREE.Vector3(-4.34, 0.85, -0.10),
    new THREE.Vector3(-4.02, 2.02, -0.27),
    new THREE.Vector3(-3.30, 3.35, -0.39),
    new THREE.Vector3(-2.55, 4.10, -0.32),
    new THREE.Vector3(-2.16, 4.03, -0.08),
    new THREE.Vector3(-2.32, 3.42, 0.07),
    new THREE.Vector3(-3.06, 2.03, 0.14),
    new THREE.Vector3(-3.73, 0.88, 0.10),
    new THREE.Vector3(-4.13, 0.30, 0.04),
    new THREE.Vector3(-4.10, -0.04, 0),
  ], false, 'centripetal');
  private points: THREE.Vector3[] = [];
  private previous: THREE.Vector3[] = [];
  private rest: THREE.Vector3[] = [];
  private targets: THREE.Vector3[] = [];
  private lengths: number[] = [];
  private readonly delta = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly pose = new THREE.Matrix4();
  private readonly orientation = new THREE.Quaternion();
  private readonly print: THREE.CanvasTexture;
  private iterations: number;
  private initialized = false;
  private disposed = false;

  constructor(profile: QualityProfile, fontsReady: Promise<unknown>) {
    this.iterations = QUALITY[profile].lanyardIterations;
    this.print = this.createPrint();
    const material = createToonMaterial({
      name: 'midnight-woven-lanyard', kind: 'textile', side: THREE.DoubleSide,
      palette: { highlight: '#263f63', base: '#13243d', shade: '#081222', deep: '#020714' },
      shadowTint: 0.08, rimWidth: 0.9,
      textile: { print: this.print, printColor: '#e1eff5', stitchColor: '#6888a5', printRepeat: 15 },
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'physically-attached-textile-loop';
    this.mesh.frustumCulled = false;
    this.setQuality(profile);
    void fontsReady.then(() => {
      if (this.disposed) return;
      this.drawPrint(this.print.image as HTMLCanvasElement);
      this.print.needsUpdate = true;
      setToonPrint(material, this.print);
    }).catch(() => { /* Fallback typography is sufficient for the small print. */ });
  }

  setQuality(profile: QualityProfile): void {
    const count = QUALITY[profile].lanyardSegments;
    this.iterations = QUALITY[profile].lanyardIterations;
    if (count + 1 === this.points.length) return;
    this.rest = this.curve.getSpacedPoints(count);
    this.points = this.rest.map((point) => point.clone());
    this.previous = this.rest.map((point) => point.clone());
    this.targets = this.rest.map((point) => point.clone());
    this.lengths = this.rest.slice(1).map((point, i) => point.distanceTo(this.rest[i]));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((count + 1) * 12), 3).setUsage(THREE.DynamicDrawUsage));
    const uvs = new Float32Array((count + 1) * 8);
    const indices: number[] = [];
    let length = 0;
    for (let i = 0; i <= count; i++) {
      if (i > 0) length += this.lengths[i - 1];
      for (let j = 0; j < 4; j++) {
        uvs[i * 8 + j * 2] = length / WIDTH;
        uvs[i * 8 + j * 2 + 1] = j % 2;
      }
      if (i === count) continue;
      const a = i * 4;
      // Front, back and the two narrow fabric edges give the ribbon real thickness.
      indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
      indices.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
      indices.push(a, a + 2, a + 4, a + 2, a + 6, a + 4);
      indices.push(a + 1, a + 5, a + 3, a + 3, a + 5, a + 7);
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.initialized = false;
    this.rebuildRibbon();
  }

  /** Pose is relative to the walkman's root; the ribbon is a sibling of the body. */
  update(dt: number, time: number, pose: THREE.Matrix4, energy: number, reducedMotion: boolean): void {
    this.pose.copy(pose);
    this.inverse.copy(pose).invert();
    this.orientation.setFromRotationMatrix(pose);
    for (let i = 0; i < this.rest.length; i++) this.targets[i].copy(this.rest[i]).applyMatrix4(pose);
    if (!this.initialized || reducedMotion) {
      for (let i = 0; i < this.points.length; i++) {
        this.points[i].copy(this.targets[i]);
        this.previous[i].copy(this.targets[i]);
      }
      this.initialized = true;
    } else if (dt > 0) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let step = 0; step < steps; step++) this.simulate(h, time, energy);
    }
    this.rebuildRibbon();
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.print.dispose();
  }

  private simulate(dt: number, time: number, energy: number): void {
    const last = this.points.length - 1;
    const damping = Math.exp(-5.2 * dt);
    for (let i = 1; i < last; i++) {
      const point = this.points[i];
      const prev = this.previous[i];
      this.velocity.subVectors(point, prev).multiplyScalar(damping);
      prev.copy(point);
      point.add(this.velocity);
      point.addScaledVector(this.delta.subVectors(this.targets[i], point), 13 * dt * dt);
      const wave = Math.sin(time * 1.15 + i * 0.34) * Math.sin(i / last * Math.PI);
      point.y -= 0.25 * dt * dt;
      point.z += wave * (0.16 + energy * 0.15) * dt * dt;
    }
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      this.points[0].copy(this.targets[0]);
      this.points[last].copy(this.targets[last]);
      for (let i = 0; i < last; i++) {
        this.delta.subVectors(this.points[i + 1], this.points[i]);
        const length = this.delta.length();
        if (length < 1e-6) continue;
        this.delta.multiplyScalar((length - this.lengths[i]) / length);
        if (i === 0) this.points[i + 1].sub(this.delta);
        else if (i + 1 === last) this.points[i].add(this.delta);
        else {
          this.points[i].addScaledVector(this.delta, 0.5);
          this.points[i + 1].addScaledVector(this.delta, -0.5);
        }
      }
      // A capsule keeps the cloth off the shell while allowing the long loop to
      // rise above it. The clearance includes half the ribbon's width.
      for (let i = 1; i < last; i++) {
        this.local.copy(this.points[i]).applyMatrix4(this.inverse);
        const spineX = THREE.MathUtils.clamp(this.local.x, -3.25, 3.25);
        this.delta.set(this.local.x - spineX, this.local.y, this.local.z);
        const distance = this.delta.length();
        if (distance < 0.80) {
          if (distance < 1e-6) this.delta.set(0, 1, 0);
          else this.delta.multiplyScalar(1 / distance);
          this.local.set(spineX, 0, 0).addScaledVector(this.delta, 0.80);
          this.points[i].copy(this.local).applyMatrix4(this.pose);
        }
      }
    }
    this.points[0].copy(this.targets[0]);
    this.points[last].copy(this.targets[last]);
    this.previous[0].copy(this.targets[0]);
    this.previous[last].copy(this.targets[last]);
  }

  private rebuildRibbon(): void {
    const positions = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const last = this.points.length - 1;
    for (let i = 0; i <= last; i++) {
      this.tangent.subVectors(this.points[Math.min(last, i + 1)], this.points[Math.max(0, i - 1)]).normalize();
      const s = i / last;
      const twist = Math.sin(s * Math.PI * 2) * 0.48;
      this.normal.set(0, Math.sin(twist), Math.cos(twist)).applyQuaternion(this.orientation);
      this.across.crossVectors(this.tangent, this.normal).normalize();
      this.normal.crossVectors(this.across, this.tangent).normalize();
      const taper = THREE.MathUtils.smoothstep(Math.min(s, 1 - s), 0, 0.1);
      const halfWidth = (0.13 + (WIDTH - 0.13) * taper) / 2;
      for (let j = 0; j < 4; j++) {
        this.local.copy(this.points[i]);
        this.local.addScaledVector(this.across, j % 2 === 0 ? -halfWidth : halfWidth);
        this.local.addScaledVector(this.normal, j < 2 ? THICKNESS : -THICKNESS);
        positions.setXYZ(i * 4 + j, this.local.x, this.local.y, this.local.z);
      }
    }
    positions.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  private createPrint(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 128;
    this.drawPrint(canvas);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    return texture;
  }

  private drawPrint(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 65px "Rajdhani", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('MIDNIGHT FREQUENCY', 70, 65);
    ctx.font = '700 62px "Rajdhani", sans-serif';
    ctx.fillText('P3 / 00:00', 980, 65);
    ctx.fillRect(900, 28, 4, 72);
  }
}
