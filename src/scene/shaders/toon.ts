import * as THREE from 'three';
import { toonGlobals } from '../contracts';

/**
 * Illustrative cel shading for the hero walkman (reference: the Persona 3
 * illustration — flat white fills, hard shadow shapes, simplified chrome).
 *
 * Lighting is quantised into four tones (highlight / base / shade / deep)
 * with fwidth-antialiased thresholds, so steps stay crisp at any resolution
 * without stair-stepping. Each kind adds one stylised cue instead of PBR:
 *   paint   — clean painted shell, nothing extra;
 *   metal   — hard horizontal reflection bands from the view-space normal;
 *   satin   — a single small hard specular spot;
 *   textile — woven stripes, edge stitching and a repeating print (strap).
 * Every material references the shared `toonGlobals` uniform objects, so the
 * scene host updates light / rim / shadow tint once for all of them.
 */

export type ToonKind = 'paint' | 'metal' | 'satin' | 'textile';

export interface ToonPalette {
  highlight: THREE.ColorRepresentation;
  base: THREE.ColorRepresentation;
  shade: THREE.ColorRepresentation;
  deep: THREE.ColorRepresentation;
}

export interface SharedUniform<T> {
  value: T;
}

export interface TextileSpec {
  /** Alpha mask of the repeating print (canvas texture), null until drawn. */
  print: THREE.Texture | null;
  printColor: THREE.ColorRepresentation;
  stitchColor: THREE.ColorRepresentation;
  /** Length of one print repeat, in strap-width units (the uv.x scale). */
  printRepeat: number;
}

export interface ToonSpec {
  kind: ToonKind;
  palette: ToonPalette;
  /** Light thresholds on N·L: [highlight, base→shade, shade→deep]. */
  thresholds?: readonly [number, number, number];
  /** Share of toonGlobals.uShadowTint mixed into the shadow tones. */
  shadowTint?: number;
  /** Fresnel threshold of the dark-side rim; higher = thinner. */
  rimWidth?: number;
  /** Metal reflection band strength (metal only). */
  bandStrength?: number;
  /** cos of the specular spot radius (satin only); closer to 1 = smaller. */
  specSize?: number;
  /** Rendered sides; double-sided materials flip the normal on back faces. */
  side?: THREE.Side;
  /** Shared hover amount 0..1 (brightens the rim slightly). */
  hover?: SharedUniform<number>;
  textile?: TextileSpec;
  name?: string;
}

export interface ToonUniforms {
  [uniform: string]: THREE.IUniform;
  uLightDir: SharedUniform<THREE.Vector3>;
  uRimColor: SharedUniform<THREE.Color>;
  uRimStrength: SharedUniform<number>;
  uShadowTint: SharedUniform<THREE.Color>;
  uHighlight: SharedUniform<THREE.Color>;
  uBase: SharedUniform<THREE.Color>;
  uShade: SharedUniform<THREE.Color>;
  uDeep: SharedUniform<THREE.Color>;
  uThresholds: SharedUniform<THREE.Vector3>;
  uShadowTintAmount: SharedUniform<number>;
  uRimWidth: SharedUniform<number>;
  uBandStrength: SharedUniform<number>;
  uSpecSize: SharedUniform<number>;
  uBrightness: SharedUniform<number>;
  uEmissive: SharedUniform<THREE.Color>;
  uHover: SharedUniform<number>;
  uPrint: SharedUniform<THREE.Texture | null>;
  uPrintColor: SharedUniform<THREE.Color>;
  uStitchColor: SharedUniform<THREE.Color>;
  uPrintRepeat: SharedUniform<number>;
  uPrintOpacity: SharedUniform<number>;
}

export type ToonMaterial = THREE.ShaderMaterial & { uniforms: ToonUniforms };

const DEFAULT_THRESHOLDS: readonly [number, number, number] = [0.72, 0.32, -0.12];

/** Shared GLSL helper: a step whose edge is antialiased over one screen pixel. */
export const AA_STEP_GLSL = /* glsl */ `
float aaStep(float edge, float x) {
  float w = max(fwidth(x), 1e-4) * 0.75;
  return smoothstep(edge - w, edge + w, x);
}
`;

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
#ifdef TOON_TEXTILE
varying vec2 vUv;
#endif

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  // The walkman only ever scales uniformly, so mat3(modelMatrix) is a valid normal matrix.
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewNormal = normalize(normalMatrix * normal);
#ifdef TOON_TEXTILE
  vUv = uv;
#endif
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec3 uShadowTint;
uniform vec3 uHighlight;
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uDeep;
uniform vec3 uThresholds;
uniform float uShadowTintAmount;
uniform float uRimWidth;
uniform float uBandStrength;
uniform float uSpecSize;
uniform float uBrightness;
uniform vec3 uEmissive;
uniform float uHover;
#ifdef TOON_TEXTILE
uniform sampler2D uPrint;
uniform vec3 uPrintColor;
uniform vec3 uStitchColor;
uniform float uPrintRepeat;
uniform float uPrintOpacity;
varying vec2 vUv;
#endif

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;

${AA_STEP_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 nView = normalize(vViewNormal);
#ifdef TOON_DOUBLE_SIDED
  if (!gl_FrontFacing) { N = -N; nView = -nView; }
#endif
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, L);

  float toHighlight = aaStep(uThresholds.x, ndl);
  float toBase = aaStep(uThresholds.y, ndl);
  float toShade = aaStep(uThresholds.z, ndl);

  vec3 shadeTone = mix(uShade, uShadowTint, uShadowTintAmount * 0.6);
  vec3 deepTone = mix(uDeep, uShadowTint, uShadowTintAmount);
  vec3 color = mix(deepTone, shadeTone, toShade);
  color = mix(color, uBase, toBase);
  color = mix(color, uHighlight, toHighlight);

#ifdef TOON_METAL
  // Anime chrome: bands locked to the view, so they slide over the part as it turns.
  float band = nView.y * 0.92 + nView.x * 0.28;
  float bright = aaStep(0.38, band) * (1.0 - aaStep(0.58, band));
  float dark = aaStep(-0.34, band) * (1.0 - aaStep(-0.14, band));
  color = mix(color, uHighlight, bright * uBandStrength);
  color = mix(color, deepTone, dark * uBandStrength * 0.85);
#endif

#ifdef TOON_SATIN
  vec3 H = normalize(L + V);
  float spec = aaStep(uSpecSize, dot(N, H));
  color = mix(color, uHighlight, spec * 0.9);
#endif

#ifdef TOON_TEXTILE
  float lightFactor = mix(0.42, 1.0, toBase) * mix(0.75, 1.0, toShade);
  float across = vUv.y;
  // Fine woven stripes along the strap; faded out before they could alias.
  float stripeCoord = across * 18.0;
  float stripeFade = 1.0 - smoothstep(0.22, 0.5, fwidth(stripeCoord));
  float stripe = smoothstep(0.62, 0.9, 1.0 - abs(fract(stripeCoord) - 0.5) * 2.0);
  color *= 1.0 - 0.2 * stripe * stripeFade;
  // Lighter dashed stitching close to both edges.
  float edge = min(across, 1.0 - across);
  float stitchBand = aaStep(0.05, edge) * (1.0 - aaStep(0.078, edge));
  float dash = aaStep(0.38, fract(vUv.x * 7.0));
  color = mix(color, uStitchColor * lightFactor, stitchBand * dash * 0.9);
  // Repeating print (alpha mask).
  float printMask = texture2D(uPrint, vec2(vUv.x / uPrintRepeat, across)).a;
  color = mix(color, uPrintColor * lightFactor, printMask * uPrintOpacity);
#endif

  // Thin crisp Fresnel rim, only on the shadow side (Persona 3 Reload cyan edge).
  float fresnel = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  float rim = aaStep(uRimWidth, fresnel) * (1.0 - toBase);
  color += uRimColor * uRimStrength * (1.0 + 0.35 * uHover) * rim;

  color = color * uBrightness + uEmissive;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

function kindDefine(kind: ToonKind): string {
  switch (kind) {
    case 'metal':
      return 'TOON_METAL';
    case 'satin':
      return 'TOON_SATIN';
    case 'textile':
      return 'TOON_TEXTILE';
    case 'paint':
      return 'TOON_PAINT';
  }
}

export function createToonMaterial(spec: ToonSpec): ToonMaterial {
  const [t1, t2, t3] = spec.thresholds ?? DEFAULT_THRESHOLDS;
  const side = spec.side ?? THREE.FrontSide;
  const defines: Record<string, string> = { [kindDefine(spec.kind)]: '' };
  if (side === THREE.DoubleSide) defines.TOON_DOUBLE_SIDED = '';
  const textile = spec.textile;

  const uniforms: ToonUniforms = {
    // Shared objects: one write by the scene host updates every material.
    uLightDir: toonGlobals.uLightDir,
    uRimColor: toonGlobals.uRimColor,
    uRimStrength: toonGlobals.uRimStrength,
    uShadowTint: toonGlobals.uShadowTint,
    uHighlight: { value: new THREE.Color(spec.palette.highlight) },
    uBase: { value: new THREE.Color(spec.palette.base) },
    uShade: { value: new THREE.Color(spec.palette.shade) },
    uDeep: { value: new THREE.Color(spec.palette.deep) },
    uThresholds: { value: new THREE.Vector3(t1, t2, t3) },
    uShadowTintAmount: { value: spec.shadowTint ?? 0.22 },
    uRimWidth: { value: spec.rimWidth ?? 0.74 },
    uBandStrength: { value: spec.bandStrength ?? 0.85 },
    uSpecSize: { value: spec.specSize ?? 0.965 },
    uBrightness: { value: 1 },
    uEmissive: { value: new THREE.Color(0x000000) },
    uHover: spec.hover ?? { value: 0 },
    uPrint: { value: textile?.print ?? null },
    uPrintColor: { value: new THREE.Color(textile?.printColor ?? 0xffffff) },
    uStitchColor: { value: new THREE.Color(textile?.stitchColor ?? 0xffffff) },
    uPrintRepeat: { value: textile?.printRepeat ?? 1 },
    uPrintOpacity: { value: textile?.print ? 1 : 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: spec.name ?? `toon-${spec.kind}`,
    uniforms,
    defines,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side,
  });
  return material as ToonMaterial;
}

/** Installs (or replaces) the print texture of a textile toon material. */
export function setToonPrint(material: ToonMaterial, print: THREE.Texture | null): void {
  material.uniforms.uPrint.value = print;
  material.uniforms.uPrintOpacity.value = print ? 1 : 0;
}

const DECAL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DECAL_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform float uShadowLevel;
varying vec2 vUv;
varying vec3 vWorldNormal;

${AA_STEP_GLSL}

void main() {
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < 0.5) discard;
  float lit = aaStep(0.32, dot(normalize(vWorldNormal), normalize(uLightDir)));
  vec3 color = mix(texel.rgb * uShadowLevel + uShadowTint * 0.04, texel.rgb, lit);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Printed marking on a painted surface (pad-print / silk-screen look):
 * alpha-tested colour texture with the same hard light step as the paint, so
 * the ink sits *in* the illustration instead of glowing on top of it.
 */
export function createDecalMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'toon-decal',
    uniforms: {
      uMap: { value: map },
      uLightDir: toonGlobals.uLightDir,
      uShadowTint: toonGlobals.uShadowTint,
      uShadowLevel: { value: 0.62 },
    },
    vertexShader: DECAL_VERTEX,
    fragmentShader: DECAL_FRAGMENT,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
