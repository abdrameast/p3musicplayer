/**
 * Shaders of the Dark Hour environment (Environment.ts). Colours arrive as
 * linear uniforms and are converted with three's linearToOutputTexel, so the
 * palette hex values land exactly on screen (NoToneMapping).
 */

/** Hash / value noise / cellular helpers shared by the background passes. */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Distance to the nearest cell border (F2 - F1), animated feature points.
float cellEdge(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}
`;

/** Full-screen triangle in clip space: no camera dependency, drawn first. */
export const BACKGROUND_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Layer 1 (deep midnight gradient + dithered noise), layer 2 (moon disc,
 * halo, partial arcs, light shards) and layer 4 (water ceiling caustics,
 * fluid light lines, god rays). Defines: CAUSTICS, GOD_RAYS, CAUSTIC_OCTAVES.
 */
export const BACKGROUND_FRAGMENT = /* glsl */ `
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTime;
uniform float uFlow;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyBottom;
uniform vec3 uInk;
uniform vec3 uMoonColor;
uniform float uMoonIntensity;
uniform vec3 uMoon;
uniform vec3 uHaloColor;
uniform float uFrameAngle;
uniform vec3 uCausticColor;
uniform float uCausticIntensity;
uniform float uGodRays;
uniform float uFade;
uniform float uDim;

varying vec2 vUv;

${NOISE_GLSL}

const float PI = 3.14159265;

float arcMask(float angle, float centre, float halfWidth) {
  float d = abs(mod(angle - centre + PI, 2.0 * PI) - PI);
  return step(d, halfWidth);
}

float ringLine(float dist, float radius, float width) {
  return 1.0 - smoothstep(0.0, width, abs(dist - radius));
}

// Signed distance to a triangle (Inigo Quilez, MIT).
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 moonLayer(vec3 col, vec2 frag) {
  float radius = uMoon.z;
  vec2 mp = (frag - uMoon.xy) / radius;
  float md = length(mp);
  float px = uPixelRatio / radius;
  float disc = 1.0 - smoothstep(1.0 - px * 1.2, 1.0 + px * 1.2, md);

  float outside = max(md - 1.0, 0.0);
  float halo = exp(-outside * 3.6) * 0.42 + exp(-outside * 0.85) * 0.2;
  col += uHaloColor * halo * uMoonIntensity * (1.0 - disc);

  // Flat illustrated surface: two cel tones, a cold limb.
  float maria = smoothstep(0.6, 0.63, valueNoise(mp * 2.2 + 3.7)) * 0.08
              + smoothstep(0.62, 0.65, valueNoise(mp * 4.4 - 1.3)) * 0.05;
  float limb = smoothstep(0.78, 1.0, md);
  vec3 surface = mix(uMoonColor, uHaloColor, limb * 0.2 + maria);
  col = mix(col, surface * uMoonIntensity, disc);

  // Geometric fragments, oriented away from the walkman (uFrameAngle).
  vec2 fp = rotate2(mp, -uFrameAngle);
  float fa = atan(fp.y, fp.x);
  float lw = px * 1.1;
  float sway = sin(uFlow * 0.05) * 0.06;
  float arcs = ringLine(md, 1.16, lw) * arcMask(fa, 1.15 + sway, 0.75) * 0.7
             + ringLine(md, 1.33, lw) * (arcMask(fa, -1.25 - sway, 0.42) + arcMask(fa, 0.15 - sway, 0.12)) * 0.5;
  float tickStep = 0.1047;
  float tickDist = abs(fract(fa / tickStep + 0.5) - 0.5) * tickStep * md;
  float ticks = step(1.24, md) * step(md, 1.29) * arcMask(fa, 0.55 + sway, 0.5)
              * (1.0 - smoothstep(0.0, px * 1.1, tickDist));
  float shardA = 1.0 - smoothstep(0.0, px * 1.2, sdTriangle(fp, vec2(1.18, 0.62), vec2(1.32, 0.5), vec2(1.95, 1.02)));
  float shardB = 1.0 - smoothstep(0.0, px * 1.2, sdTriangle(fp, vec2(0.95, -1.05), vec2(1.07, -1.12), vec2(1.3, -1.72)));
  col += uHaloColor * uMoonIntensity * (1.0 - disc) * (arcs + ticks * 0.45 + shardA * 0.32 + shardB * 0.22);
  return col;
}

#if CAUSTICS
vec3 aquaticLayer(vec2 uv, float aspect) {
  // Perspective water ceiling: the plane above recedes towards a soft horizon.
  float horizon = 0.5;
  float h = (uv.y - horizon) / (1.0 - horizon);
  if (h <= 0.0) return vec3(0.0);
  float depth = 1.0 / (h + 0.2);
  vec2 p = vec2((uv.x - 0.5) * aspect * depth * 1.7, depth * 2.1 + uFlow * 0.04);
  vec2 warp = vec2(valueNoise(p * 0.7 + vec2(0.0, uFlow * 0.08)), valueNoise(p * 0.7 + vec2(7.3, -uFlow * 0.07)));
  vec2 q = p + (warp - 0.5) * 1.1;

  float e1 = cellEdge(q * 1.15, uFlow * 0.32);
  float net = 1.0 - smoothstep(0.03, 0.03 + max(fwidth(e1) * 1.5, 0.018), e1);
#if CAUSTIC_OCTAVES > 1
  float e2 = cellEdge(q * 2.7 + 3.1, uFlow * 0.45);
  net = max(net, 0.4 * (1.0 - smoothstep(0.025, 0.025 + max(fwidth(e2) * 1.5, 0.018), e2)));
#endif
  float plates = smoothstep(0.63, 0.67, valueNoise(q * 0.55 - uFlow * 0.03));
  float fade = smoothstep(0.0, 0.6, h) * (0.5 + 0.5 * h);
  float band = smoothstep(0.8, 1.0, uv.y) * 0.24;

  // Fluid light lines drifting under the surface.
  float lines = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float ly = 0.64 + 0.09 * fi + 0.014 * sin(uv.x * aspect * (2.1 + fi) + uFlow * (0.11 + 0.04 * fi) + fi * 2.3);
    float dpx = abs(uv.y - ly) * uResolution.y;
    lines += (1.0 - smoothstep(0.0, 1.1 * uPixelRatio, dpx)) * (0.5 + 0.5 * sin(uv.x * aspect * 3.0 - uFlow * 0.2 + fi));
  }

  return uCausticColor * uCausticIntensity * ((net * 0.62 + plates * 0.28) * fade + band + lines * 0.08);
}
#endif

#if GOD_RAYS
float godRays(vec2 uv, float aspect) {
  float x = uv.x * aspect + (1.0 - uv.y) * 0.45;
  float r = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(x * 6.0 + uFlow * 0.12))
          + 0.6 * smoothstep(0.65, 1.0, 0.5 + 0.5 * sin(x * 11.0 - uFlow * 0.09 + 1.7))
          + 0.4 * smoothstep(0.7, 1.0, 0.5 + 0.5 * sin(x * 17.0 + uFlow * 0.05 + 4.1));
  float v = smoothstep(0.22, 1.0, uv.y);
  return r * v * v;
}
#endif

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uResolution;
  float aspect = uResolution.x / uResolution.y;

  vec3 col = uv.y < 0.5
    ? mix(uSkyBottom, uSkyMid, smoothstep(0.0, 0.5, uv.y))
    : mix(uSkyMid, uSkyTop, smoothstep(0.5, 1.0, uv.y));
  float drift = valueNoise(vec2(uv.x * aspect * 1.6, uv.y * 2.0) + vec2(uFlow * 0.012, -uFlow * 0.008));
  col *= 0.965 + 0.07 * drift;

#if GOD_RAYS
  col += uCausticColor * godRays(uv, aspect) * uGodRays * 0.07;
#endif

  col = moonLayer(col, frag);

#if CAUSTICS
  col += aquaticLayer(uv, aspect);
#endif

  col = mix(uInk, col, uFade) * uDim;
  vec4 outColor = linearToOutputTexel(vec4(col, 1.0));
  // Dither in output space: kills banding of the long dark gradients.
  outColor.rgb += (hash12(frag + fract(uTime * 7.0) * 113.0) - 0.5) * (1.5 / 255.0);
  gl_FragColor = outColor;
}
`;

/** Skyline silhouettes (layer 3). Attribute aKind selects the element type. */
export const SKYLINE_VERTEX = /* glsl */ `
attribute float aKind;
attribute float aPhase;
varying float vKind;
varying float vPhase;
varying float vY;
void main() {
  vKind = aKind;
  vPhase = aPhase;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKYLINE_FRAGMENT = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uFog;
uniform float uHaze;
uniform vec3 uWindow;
uniform float uWindowLevel;
uniform vec3 uSign;
uniform vec3 uRim;
uniform vec3 uInk;
uniform float uTime;
uniform float uFade;
uniform float uDim;

varying float vKind;
varying float vPhase;
varying float vY;

void main() {
  // Ground haze rising from the bottom of the frame (layer-local y = 0).
  float haze = uHaze * (1.0 - smoothstep(-0.02, 0.2, vY));
  vec3 body = mix(uBody, uFog, haze);
  vec3 col = body;
  if (vKind > 0.5 && vKind < 1.5) {
    // Sparse lit windows; a few switch on/off over minutes.
    float toggles = step(0.82, fract(vPhase * 7.31));
    float on = mix(1.0, step(0.32, fract(vPhase + uTime / 85.0)), toggles);
    col = mix(body, uWindow, on * (0.5 + 0.5 * fract(vPhase * 13.7)) * uWindowLevel);
  } else if (vKind > 1.5 && vKind < 2.5) {
    col = uSign;
  } else if (vKind > 2.5 && vKind < 3.5) {
    col = mix(body, uSign, 0.1);
  } else if (vKind > 3.5) {
    col = mix(body, uRim, 0.45);
  }
  col = mix(uInk, col, uFade) * uDim;
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
}
`;

/** Large white/ice slanted forms and thin cyan guide lines (layers 2/5). */
export const SHARD_VERTEX = /* glsl */ `
attribute float aEdge;
attribute float aKind;
attribute float aAlpha;
varying float vEdge;
varying float vKind;
varying float vAlpha;
void main() {
  vEdge = aEdge;
  vKind = aKind;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHARD_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLine;
uniform float uOpacity;
uniform float uFade;

varying float vEdge;
varying float vKind;
varying float vAlpha;

void main() {
  vec3 col = uColor;
  float alpha;
  if (vKind < 0.5) {
    // Flat low-contrast fill, crisp brighter leading edge.
    float edge = 1.0 - smoothstep(0.0, fwidth(vEdge) * 1.5, 1.0 - vEdge);
    alpha = (0.55 + 0.45 * vEdge) + edge * 2.4;
  } else {
    col = uLine;
    alpha = 3.0;
  }
  gl_FragColor = linearToOutputTexel(vec4(col, clamp(alpha * vAlpha * uOpacity, 0.0, 1.0) * uFade));
}
`;
