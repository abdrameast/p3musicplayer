import * as THREE from 'three';
import { toonGlobals } from '../contracts';
import type { SharedUniform } from './toon';

/** Back-face hull, expanded in clip space so the ink stays the same CSS width. */
export function createOutlineMaterial(hover: SharedUniform<number> = { value: 0 }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'walkman-ink-outline',
    uniforms: {
      uColor: toonGlobals.uOutlineColor,
      uWidth: toonGlobals.uOutlineWidth,
      uResolution: toonGlobals.uResolution,
      uPixelRatio: toonGlobals.uPixelRatio,
      uHover: hover,
    },
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float uWidth;
      uniform vec2 uResolution;
      uniform float uPixelRatio;
      uniform float uHover;
      void main() {
        vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
        vec4 clipPos = projectionMatrix * viewPos;
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec2 projectedNormal = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
        float normalLength = length(projectedNormal);
        vec2 direction = projectedNormal / max(normalLength, 0.0001);
        clipPos.xy += direction * (uWidth + 0.4 * uHover) * uPixelRatio *
          2.0 / max(uResolution, vec2(1.0)) * clipPos.w;
        gl_Position = clipPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
