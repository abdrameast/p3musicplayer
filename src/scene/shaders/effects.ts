/**
 * Shaders of the audio-reactive visuals (src/visuals/*). All are additive
 * glows (blend SRC_ALPHA, ONE) so their order never matters and they only
 * ever brighten the blue world; none writes depth, all are depth-tested so the
 * opaque walkman always occludes what is behind it.
 */

/** Plain quad passing local XY (in focus-radius units after mesh scale) to the fragment. */
export const LOCAL_QUAD_VERTEX = /* glsl */ `
varying vec2 vLocal;
varying vec2 vUv;
void main() {
  vLocal = position.xy;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Effect A — Lunar Pulse: capsule-shaped glow aligned with the walkman diagonal. */
export const AURA_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uHalfLength;
uniform float uRadius;
varying vec2 vLocal;
varying vec2 vUv;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  float d = sdSegment(vLocal, vec2(-uHalfLength, 0.0), vec2(uHalfLength, 0.0));
  float wide = exp(-max(d - uRadius * 0.25, 0.0) / uRadius * 1.9);
  float tight = exp(-(d * d) / (uRadius * uRadius * 0.45));
  vec2 edge = abs(vUv * 2.0 - 1.0);
  float frame = 1.0 - smoothstep(0.72, 1.0, max(edge.x, edge.y));
  float alpha = (wide * 0.5 + tight * 0.3) * uStrength * frame;
  gl_FragColor = linearToOutputTexel(vec4(uColor, clamp(alpha, 0.0, 1.0)));
}
`;

/** Effect B — Water Ripples: up to MAX_RIPPLES thin perspective rings in one pass. */
export const RIPPLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRipples[MAX_RIPPLES];
uniform int uCount;
uniform float uSquash;
uniform float uPixelRatio;
uniform float uFade;
varying vec2 vLocal;
varying vec2 vUv;

void main() {
  vec2 p = vec2(vLocal.x, vLocal.y / uSquash);
  float d = length(p);
  float fw = max(fwidth(d), 1e-5);
  float line = fw * 1.1 * uPixelRatio;
  float alpha = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uCount) break;
    vec3 ripple = uRipples[i];
    float ring = 1.0 - smoothstep(line * 0.5, line * 0.5 + fw * 1.2, abs(d - ripple.x));
    float echo = 1.0 - smoothstep(line * 0.4, line * 0.4 + fw * 1.2, abs(d - ripple.x * 0.86));
    alpha += (ring + echo * 0.35) * ripple.y;
  }
  vec2 edge = abs(vUv * 2.0 - 1.0);
  alpha *= 1.0 - smoothstep(0.8, 1.0, max(edge.x, edge.y));
  gl_FragColor = linearToOutputTexel(vec4(uColor, clamp(alpha, 0.0, 1.0) * uFade));
}
`;

/** Effect C — Spectral Arc: instanced bars (base at y = 0, height via instance scale). */
export const SPECTRUM_VERTEX = /* glsl */ `
attribute float aValue;
attribute float aParam;
varying float vValue;
varying float vParam;
varying float vY;
void main() {
  vValue = aValue;
  vParam = aParam;
  vY = uv.y;
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

export const SPECTRUM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSweep;
uniform float uSweepStrength;
varying float vValue;
varying float vParam;
varying float vY;

void main() {
  float sweep = exp(-pow((vParam - uSweep) / 0.06, 2.0)) * uSweepStrength;
  // Bright root fading to the tip: reads as light, not as a solid bar chart.
  float body = mix(1.0, 0.3, vY);
  float alpha = uOpacity * body * (0.4 + 0.6 * vValue) + sweep * 0.55;
  gl_FragColor = linearToOutputTexel(vec4(uColor, clamp(alpha, 0.0, 1.0)));
}
`;

/** Effect E — Floating Memory: instanced soft discs and thin-rimmed bubbles. */
export const PARTICLE_VERTEX = /* glsl */ `
attribute float aAlpha;
attribute float aKind;
varying float vAlpha;
varying float vKind;
varying vec2 vUv;
void main() {
  vAlpha = aAlpha;
  vKind = aKind;
  vUv = uv;
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vKind;
varying vec2 vUv;

void main() {
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float disc = pow(1.0 - r, 1.6);
  float rim = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.86, 1.0, r));
  float bubble = rim * 0.85 + (1.0 - r) * 0.12;
  float shape = mix(disc, bubble, step(0.5, vKind));
  gl_FragColor = linearToOutputTexel(vec4(uColor, clamp(shape * vAlpha * uOpacity, 0.0, 1.0)));
}
`;
