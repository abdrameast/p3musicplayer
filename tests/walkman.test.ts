import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Lanyard } from '../src/scene/Lanyard';
import { Walkman } from '../src/scene/Walkman';
import { WalkmanScreen, formatLCDTime, lcdScrollOffset } from '../src/scene/WalkmanScreen';
import type { WalkmanFrame } from '../src/scene/contracts';

const print = vi.fn();
const context = {
  clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {},
  beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
  save() {}, restore() {}, rect() {}, clip() {},
  fillText: print,
  measureText: (text: string) => ({ width: text.length * 28 }),
} as unknown as CanvasRenderingContext2D;

function frame(overrides: Partial<WalkmanFrame> = {}): WalkmanFrame {
  return {
    dt: 1 / 60, time: 1, playing: false, reducedMotion: false, energy: 0.8,
    features: { level: 0, bass: 0, lowMid: 0, mid: 0, high: 0, beat: false, kick: 0, bpm: 120, spectrum: new Float32Array(64), waveform: new Float32Array(256) },
    screen: { status: 'PAUSED', trackNumber: 1, title: 'Burn My Dread', artist: 'Yumi Kawamura', position: 0, duration: 0, volume: 0.7, muted: false, repeat: 'off', signal: null, syncReal: false },
    ...overrides,
  };
}

beforeEach(() => {
  print.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});
afterEach(() => vi.restoreAllMocks());

describe('walkman LCD', () => {
  it('updates a newly selected Japanese title even while paused and below the redraw interval', () => {
    const screen = new WalkmanScreen('low', Promise.resolve());
    const state = frame();
    screen.update(state, 0);
    const version = screen.texture.version;
    state.screen = { ...state.screen, title: 'キミの記憶', trackNumber: 9 };
    state.dt = 0.001;
    screen.update(state, 0);
    expect(screen.texture.version).toBeGreaterThan(version);
    expect(print.mock.calls.some(([text]) => text === 'キミの記憶')).toBe(true);
    screen.dispose();
  });

  it('does not upload an unchanged paused display every animation frame', () => {
    const screen = new WalkmanScreen('high', new Promise(() => {}));
    screen.update(frame(), 0);
    const version = screen.texture.version;
    for (let i = 0; i < 30; i++) screen.update(frame(), 0);
    expect(screen.texture.version).toBe(version);
    screen.dispose();
  });

  it('holds long titles at both ends, and handles unknown/invalid time', () => {
    expect(lcdScrollOffset(900, 500, 1.9)).toBe(0);
    expect(lcdScrollOffset(900, 500, 4)).toBeCloseTo(116);
    expect(lcdScrollOffset(900, 500, 9)).toBe(400);
    expect(lcdScrollOffset(200, 500, 30)).toBe(0);
    expect(formatLCDTime(Number.NaN)).toBe('00:00');
    expect(formatLCDTime(-10)).toBe('00:00');
    expect(formatLCDTime(275.9)).toBe('04:35');
  });
});

describe('volumetric walkman', () => {
  it('keeps both cloth ends attached through rotation, quality changes and reduced motion', () => {
    const strap = new Lanyard('high', Promise.resolve());
    const pose = new THREE.Matrix4().compose(new THREE.Vector3(0.3, 0.8, -0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 1.2, 0.5)), new THREE.Vector3(1, 1, 1));
    const checkEndpoints = (): void => {
      const positions = strap.mesh.geometry.getAttribute('position');
      const expected = [new THREE.Vector3(-4.10, 0.13, 0), new THREE.Vector3(-4.10, -0.04, 0)];
      for (const [index, point] of expected.entries()) {
        const first = index === 0 ? 0 : positions.count - 4;
        const average = new THREE.Vector3();
        for (let i = first; i < first + 4; i++) average.add(new THREE.Vector3().fromBufferAttribute(positions, i));
        average.multiplyScalar(0.25);
        expect(average.distanceTo(point.applyMatrix4(pose))).toBeLessThan(1e-5);
      }
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    };
    for (let i = 0; i < 100; i++) strap.update(1 / 60, i / 60, pose, 1, false);
    checkEndpoints();
    strap.setQuality('low');
    strap.update(1 / 60, 2, pose, 1, true);
    checkEndpoints();
    strap.dispose();
  });

  it('frames and hit-tests the body independently of its long lanyard', () => {
    const walkman = new Walkman({ quality: 'low', reducedMotion: false, fontsReady: Promise.resolve() });
    const body = walkman.root.getObjectByName('assembled-walkman-body')!;
    walkman.root.updateMatrixWorld(true);
    const origin = new THREE.Vector3(0, 0, 10).applyMatrix4(body.matrixWorld);
    const center = new THREE.Vector3().applyMatrix4(body.matrixWorld);
    const ray = new THREE.Raycaster(origin, center.clone().sub(origin).normalize());
    expect(walkman.hitTest(ray)).toBe(true);
    ray.ray.origin.copy(new THREE.Vector3(0, 5, 10).applyMatrix4(body.matrixWorld));
    expect(walkman.hitTest(ray)).toBe(false);
    expect(walkman.getFocusBounds(new THREE.Sphere()).radius).toBeLessThan(4.5);
    walkman.dispose();
    expect(walkman.hitTest(ray)).toBe(false);
  });
});
