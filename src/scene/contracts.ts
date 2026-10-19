import * as THREE from 'three';
import { PALETTE } from '../config/config';
import type {
  AudioFeatures,
  PlaybackStatus,
  QualityProfile,
  RepeatMode,
  SourceKind,
  TrackChange,
} from '../core/types';

/**
 * Contracts between the hero walkman (Walkman.ts, WalkmanScreen.ts,
 * Lanyard.ts, shaders/toon.ts, shaders/outline.ts) and the scene host
 * (SceneManager.ts, CameraRig.ts, Environment.ts, Lighting.ts, visuals/*).
 */

/**
 * Global uniforms shared by every cel-shaded and outlined material.
 * The scene host updates them (light direction, per-mode rim/shadow tint,
 * drawing-buffer resolution, time); toon/outline materials reference these
 * exact uniform objects so a single write updates every material.
 */
export const toonGlobals = {
  /** World-space direction TOWARDS the key light (moonlight, upper left front). */
  uLightDir: { value: new THREE.Vector3(-0.45, 0.75, 0.5).normalize() },
  uRimColor: { value: new THREE.Color(PALETTE.cyan) },
  uRimStrength: { value: 0.6 },
  /** Subtle blue injected in shadow tones (per visual mode). */
  uShadowTint: { value: new THREE.Color(PALETTE.personaBlue) },
  uOutlineColor: { value: new THREE.Color(PALETTE.ink) },
  /** Outline width in CSS pixels (≈2.5 desktop). Hover may raise it slightly. */
  uOutlineWidth: { value: 2.5 },
  /** Drawing buffer size in device pixels. */
  uResolution: { value: new THREE.Vector2(1, 1) },
  uPixelRatio: { value: 1 },
  uTime: { value: 0 },
};

export type ToonGlobals = typeof toonGlobals;

/** Data rendered on the walkman LCD. Passed every frame; the screen decides when to redraw. */
export interface ScreenData {
  status: PlaybackStatus;
  /** Canonical id, rendered as 3 digits. */
  trackNumber: number;
  title: string;
  artist: string;
  /** Seconds (interpolated). */
  position: number;
  duration: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  /** Active provider, null when the track has no playable source. */
  signal: SourceKind | null;
  /** True when visuals follow real analysed audio. */
  syncReal: boolean;
}

export interface WalkmanFrame {
  /** Seconds since previous frame, clamped to ≤ 0.1. */
  dt: number;
  /** Seconds since start. */
  time: number;
  features: Readonly<AudioFeatures>;
  playing: boolean;
  reducedMotion: boolean;
  /** Ambient energy 0..1 (mode × track visual profile). */
  energy: number;
  screen: ScreenData;
}

export interface WalkmanOptions {
  quality: QualityProfile;
  reducedMotion: boolean;
  /** Resolves when LCD fonts (DotGothic16 / IBM Plex Mono) are loaded. */
  fontsReady: Promise<unknown>;
}

/**
 * The hero object. Its local frame: body axis along +X (attachment end at −X,
 * dome at +X), LCD facing +Z, buttons on +Y. The object owns its idle/playing
 * animation, pose springs, lanyard simulation and LCD; the scene host owns DOM
 * pointer events, raycasting and the camera.
 */
export interface IWalkman {
  /** Add this to the scene. Includes the lanyard. */
  readonly root: THREE.Object3D;
  /** World-space bounding sphere of the body (excluding lanyard) for framing. */
  getFocusBounds(target: THREE.Sphere): THREE.Sphere;
  /** Cheap hit test against the body (capsule), not the lanyard. */
  hitTest(raycaster: THREE.Raycaster): boolean;

  /** Manipulation — deltas in CSS px; viewport height normalises speed. */
  beginDrag(): void;
  drag(dxPx: number, dyPx: number, viewportHeightPx: number): void;
  /** Release velocity in CSS px / s, for inertia. */
  endDrag(velocityXPx: number, velocityYPx: number, viewportHeightPx: number): void;
  /** Spring back to the presentation pose (double-click / reset button). */
  resetPose(): void;
  setHover(hovered: boolean): void;
  /** Pointer position −1..1 over the viewport, for a very subtle parallax lean. */
  setPointerInfluence(nx: number, ny: number): void;

  /** LCD blank → flicker → new title (≈ CONFIG.transitions.lcdMs). Never awaits audio. */
  onTrackChange(change: TrackChange): void;
  /** Intro: descends slightly, settles with lanyard inertia, LCD powers on. */
  playIntro(reducedMotion: boolean): Promise<void>;

  setQuality(quality: QualityProfile): void;
  update(frame: WalkmanFrame): void;
  dispose(): void;
}
