import type { EnergyProfile, QualityProfile, VisualMode, VisualProfile } from '../core/types';

/** Brand palette — mirrors src/styles/tokens.css. */
export const PALETTE = {
  ink: '#050B1A',
  midnight: '#07152D',
  deepBlue: '#092B65',
  personaBlue: '#0869D8',
  electricBlue: '#219CFF',
  cyan: '#48DDF5',
  ice: '#A9F5FF',
  white: '#F8FCFF',
  silver: '#B8CEDF',
  mutedBlue: '#668EB8',
} as const;

export interface ModePalette {
  label: string;
  /** Japanese annotation shown in the visuals panel. */
  kanji: string;
  description: string;
  /** Background gradient, top → bottom. */
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** Distance fog / far skyline colour. */
  fog: string;
  skylineNear: string;
  skylineFar: string;
  windowLight: string;
  moonColor: string;
  /** 0..1 */
  moonIntensity: number;
  /** Normalised screen position of the moon (0,0 = bottom-left). */
  moonPosition: [number, number];
  haloColor: string;
  causticColor: string;
  causticIntensity: number;
  rimColor: string;
  rimStrength: number;
  /** Subtle tint injected into toon shadows. */
  shadowTint: string;
  rippleColor: string;
  particleColor: string;
  /** Multiplier on the quality profile particle count. */
  particleDensity: number;
  /** World units / s, positive = rising. */
  particleRise: number;
  auraColor: string;
  auraStrength: number;
  spectrumColor: string;
  /** Overall motion energy multiplier for ambient movement. */
  ambientMotion: number;
  /** Light rays from the water surface. */
  godRays: number;
  /** CSS accent for the HUD. */
  hudAccent: string;
}

export const MODES: Readonly<Record<VisualMode, ModePalette>> = {
  moonlight: {
    label: 'MOONLIGHT',
    kanji: '月光',
    description: 'Deep blue, lunar halo, slow water light. The default night.',
    skyTop: '#03122B',
    skyMid: '#0A3A86',
    skyBottom: '#0757C4',
    fog: '#0A3C8C',
    skylineNear: '#04102A',
    skylineFar: '#0A2D6A',
    windowLight: '#7BE9FF',
    moonColor: '#E9FBFF',
    moonIntensity: 0.9,
    moonPosition: [0.63, 1.01],
    haloColor: '#48DDF5',
    causticColor: '#A9F5FF',
    causticIntensity: 0.12,
    rimColor: '#48DDF5',
    rimStrength: 0.6,
    shadowTint: '#0869D8',
    rippleColor: '#A9F5FF',
    particleColor: '#CFF9FF',
    particleDensity: 1,
    particleRise: 0.05,
    auraColor: '#48DDF5',
    auraStrength: 0.75,
    spectrumColor: '#A9F5FF',
    ambientMotion: 1,
    godRays: 0.45,
    hudAccent: '#48DDF5',
  },
  darkhour: {
    label: 'DARK HOUR',
    kanji: '影時間',
    description: 'The hidden hour. Near-black blue, hard contrast, a colder moon.',
    skyTop: '#010510',
    skyMid: '#04112A',
    skyBottom: '#071E46',
    fog: '#061733',
    skylineNear: '#010409',
    skylineFar: '#051230',
    windowLight: '#3FB7D9',
    moonColor: '#DDF6FF',
    moonIntensity: 1,
    moonPosition: [0.64, 0.98],
    haloColor: '#2AA9D6',
    causticColor: '#5FC8E8',
    causticIntensity: 0.06,
    rimColor: '#7FE8FF',
    rimStrength: 0.85,
    shadowTint: '#04163A',
    rippleColor: '#7FE8FF',
    particleColor: '#9FDFF0',
    particleDensity: 0.45,
    particleRise: 0.02,
    auraColor: '#2AA9D6',
    auraStrength: 0.55,
    spectrumColor: '#7FE8FF',
    ambientMotion: 0.7,
    godRays: 0.15,
    hudAccent: '#7FE8FF',
  },
  bluememory: {
    label: 'BLUE MEMORY',
    kanji: '記憶',
    description: 'Submerged and introspective. Intense blue, moving light, rising memories.',
    skyTop: '#0A4FB4',
    skyMid: '#0869D8',
    skyBottom: '#0A2F7A',
    fog: '#0B62CC',
    skylineNear: '#06245E',
    skylineFar: '#1A6FD0',
    windowLight: '#E2FCFF',
    moonColor: '#FFFFFF',
    moonIntensity: 0.7,
    moonPosition: [0.6, 1.03],
    haloColor: '#A9F5FF',
    causticColor: '#E6FDFF',
    causticIntensity: 0.28,
    rimColor: '#A9F5FF',
    rimStrength: 0.7,
    shadowTint: '#0A52B8',
    rippleColor: '#F8FCFF',
    particleColor: '#F8FCFF',
    particleDensity: 1.35,
    particleRise: 0.12,
    auraColor: '#A9F5FF',
    auraStrength: 0.9,
    spectrumColor: '#F8FCFF',
    ambientMotion: 1.2,
    godRays: 0.85,
    hudAccent: '#A9F5FF',
  },
};

export interface QualitySpec {
  /** Device pixel ratio cap. */
  maxDpr: number;
  antialias: boolean;
  particles: number;
  /** Max concurrent ripple rings. */
  ripples: number;
  spectrumSegments: number;
  /** Background shader resolution scale (1 = full). */
  backgroundScale: number;
  caustics: boolean;
  godRays: boolean;
  skylineLayers: number;
  /** Lanyard simulation points. */
  lanyardSegments: number;
  lanyardIterations: number;
  /** Radial segments for the walkman lathe/cylinders. */
  walkmanRadialSegments: number;
  /** LCD texture redraw cap (Hz) while animating. */
  lcdHz: number;
}

export const QUALITY: Readonly<Record<QualityProfile, QualitySpec>> = {
  high: {
    maxDpr: 2,
    antialias: true,
    particles: 160,
    ripples: 6,
    spectrumSegments: 72,
    backgroundScale: 1,
    caustics: true,
    godRays: true,
    skylineLayers: 3,
    lanyardSegments: 28,
    lanyardIterations: 10,
    walkmanRadialSegments: 64,
    lcdHz: 30,
  },
  medium: {
    maxDpr: 1.5,
    antialias: true,
    particles: 80,
    ripples: 4,
    spectrumSegments: 56,
    backgroundScale: 0.75,
    caustics: true,
    godRays: false,
    skylineLayers: 2,
    lanyardSegments: 22,
    lanyardIterations: 8,
    walkmanRadialSegments: 48,
    lcdHz: 24,
  },
  low: {
    maxDpr: 1,
    antialias: false,
    particles: 30,
    ripples: 3,
    spectrumSegments: 48,
    backgroundScale: 0.5,
    caustics: false,
    godRays: false,
    skylineLayers: 1,
    lanyardSegments: 16,
    lanyardIterations: 6,
    walkmanRadialSegments: 32,
    lcdHz: 15,
  },
};

const FEATURED: Record<number, string> = {
  1: 'BURN MY DREAD',
  8: 'LAST BATTLE',
  23: 'BURN MY DREAD',
  36: 'LAST BATTLE',
  58: 'LAST BATTLE',
  60: 'BURN MY DREAD',
  5: 'MASS DESTRUCTION',
  11: 'MASS DESTRUCTION',
  26: 'MASS DESTRUCTION',
  51: 'MASS DESTRUCTION',
  62: 'MASS DESTRUCTION',
  9: 'キミの記憶',
  37: 'キミの記憶',
  59: 'キミの記憶',
  46: 'FULL MOON',
  52: "IT'S GOING DOWN",
  66: "IT'S GOING DOWN",
  53: 'COLOR YOUR NIGHT',
};

/**
 * Hand-assigned visual energy per canonical id. This is explicit artistic
 * configuration used to scale ambient motion and simulated sync intensity —
 * it is NOT derived from (or presented as) audio analysis.
 */
const CALM = [3, 7, 9, 12, 15, 21, 28, 29, 30, 34, 35, 37, 41, 43, 45, 48, 55, 56, 57, 59, 61, 64];
const HIGH = [5, 8, 11, 16, 19, 20, 25, 26, 31, 32, 36, 40, 42, 44, 46, 51, 52, 53, 58, 62, 63, 66, 67];

export function getVisualProfile(trackId: number): VisualProfile {
  const energy: EnergyProfile = CALM.includes(trackId) ? 'calm' : HIGH.includes(trackId) ? 'high' : 'mid';
  const accentLabel = FEATURED[trackId];
  return accentLabel ? { energy, featured: true, accentLabel } : { energy };
}

export const ENERGY_SCALE: Readonly<Record<EnergyProfile, number>> = {
  calm: 0.55,
  mid: 0.8,
  high: 1,
};

export const CONFIG = {
  app: {
    name: 'MIDNIGHT FREQUENCY',
    subtitle: 'P3 MUSIC ARCHIVE',
    tagline: 'The night is yours.',
    kanji: '真夜中の周波数',
    unofficialNotice:
      'Unofficial fan project. Not affiliated with or endorsed by ATLUS or SEGA. Music is streamed from YouTube via its official embedded player; all rights belong to their owners.',
  },
  youtube: {
    playlistId: 'PLWpIzCC1R3QbatqFaX4D9Op0lV9EEgybk',
    playlistUrl: 'https://www.youtube.com/watch?v=bNvjrEoVoH0&list=PLWpIzCC1R3QbatqFaX4D9Op0lV9EEgybk',
    apiSrc: 'https://www.youtube.com/iframe_api',
    /** Privacy-enhanced embed host supported by the IFrame API. */
    host: 'https://www.youtube-nocookie.com',
    apiLoadTimeoutMs: 15000,
    /** If play() was requested and no PLAYING/BUFFERING arrives in time → AUTOPLAY_BLOCKED. */
    autoplayCheckMs: 3500,
    /** YouTube Required Minimum Functionality: player viewport ≥ 200×200 CSS px. */
    minPlayerSizePx: 200,
    watchUrl: (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`,
  },
  sources: {
    /** Mappings below this confidence are reported UNMAPPED and never played. */
    minConfidence: 0.9,
    /** Optional runtime overrides supplied by the site owner. */
    overridesUrl: '/source-overrides.json',
  },
  playback: {
    defaultVolume: 0.7,
    volumeStep: 0.05,
    timeUpdateHz: 4,
    /** previous() restarts the current track when position > this (s). */
    previousRestartThreshold: 3,
    /** Auto-advance stops after this many consecutive failing tracks. */
    maxConsecutiveFailures: 5,
    /** Delay before auto-skipping a track that failed during auto-advance. */
    autoSkipDelayMs: 2200,
  },
  sync: {
    defaultBpm: 120,
    minBpm: 60,
    maxBpm: 200,
    fftSize: 2048,
    smoothingTimeConstant: 0.55,
    spectrumBins: 64,
    waveformSize: 256,
    /** Tap tempo: taps older than this reset the sequence (ms). */
    tapResetMs: 2000,
    labels: {
      simulated: 'VISUAL SYNC · SIMULATED',
      tab: 'VISUAL SYNC · LIVE TAB AUDIO',
      mic: 'VISUAL SYNC · MICROPHONE',
      direct: 'VISUAL SYNC · DIRECT ANALYSIS',
    },
  },
  transitions: {
    /** Now Playing typographic transition (ms). */
    standardMs: 780,
    featuredMs: 1150,
    /** LCD blank → flicker → new title (ms). */
    lcdMs: 560,
  },
  intro: {
    /** Hard cap; the intro never blocks longer than this. */
    maxMs: 2800,
  },
  storageKey: 'midnight-frequency:prefs:v1',
} as const;
