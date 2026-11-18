// TAKE 4 · Shade-chase orbit. The signature 3D take.
// A real street on a clear afternoon: Preetham sky with the true Sydney sun for today, reflection
// probes made from that sky, aerial haze, the neighbouring blocks, plane trees (Blender, with real
// foliage cut from a photograph) moving in the wind, parked cars and signal-phased traffic, and a
// rope-access technician (image-to-3D, cleaned in Blender) whose squeegee arm is skinned here.
// One corner building (curtain-wall glass and a shopfront on the east face, sandstone render with
// punched windows elsewhere, box gutters behind the parapet, a solar array on the roof, a paved
// forecourt) is cleaned the way Meniscus cleans every building: top down, in the shade, signed off
// with readings. Eight steps map to the copy (survey, rig, purify, roof, façade, glass, ground,
// reading). The sun is the real Sydney sun for today's date, moving from 11:00 to 17:20 as you
// scroll, and the camera keeps the building between itself and the sun, so the face being worked
// is always the one in shade (and the sun rims the building's edges).
// Everything is a pure function of the take's progress, so it scrubs both ways: wash fronts,
// drops, lanes, leaves, the brush and the surface cleaner are closed-form, not simulated.
// Dirt is one patch on MeshStandardMaterial (onBeforeCompile) with four kinds (render, glass,
// pavers, solar) sharing one uniform block; each kind has its own program cache key.
import * as THREE from 'three';
import { GLStage, IS_MOBILE } from '../gl/stage';
import type { Take } from '../core/scroll';
import { loadTexture } from '../core/assets';
import { clamp, smooth, lerp, band, rng, invLerp } from '../core/util';
import { sunAt } from '../core/sun';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** The Blender model (Draco). Phones drop requests, so it retries twice. */
function loadModel(url: string, tries = 3): Promise<{ scene: THREE.Group }> {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  return loader.loadAsync(url).then(
    (g) => {
      draco.dispose();
      return g;
    },
    (err) => {
      draco.dispose();
      if (tries <= 1) throw err;
      return new Promise((r) => setTimeout(r, 800)).then(() => loadModel(url, tries - 1));
    },
  );
}

// ---------------------------------------------------------------------------------------------
// timeline: step windows in take progress, and the working-day clock at each boundary
export const STEPS = [0.04, 0.15, 0.26, 0.36, 0.49, 0.61, 0.74, 0.86, 1.0];
const CLOCK = [11.0, 11.0333, 11.6667, 12.0833, 12.5, 13.3333, 14.1667, 15.0833, 16.8333, 17.3333];
const KEYS_P = [0, ...STEPS];

/** working-day clock (fractional hours) at progress p, piecewise linear through the step times */
export function clockAt(p: number): number {
  for (let i = 0; i < KEYS_P.length - 1; i++) {
    if (p <= KEYS_P[i + 1]!) return lerp(CLOCK[i]!, CLOCK[i + 1]!, invLerp(KEYS_P[i]!, KEYS_P[i + 1]!, p));
  }
  return CLOCK[CLOCK.length - 1]!;
}
/** index of the step at p (−1 = establishing shot) */
export function stepAt(p: number): number {
  if (p < STEPS[0]!) return -1;
  for (let i = 0; i < 8; i++) if (p < STEPS[i + 1]!) return i;
  return 7;
}
/** local progress through step i */
export function stepLocal(p: number, i: number): number {
  return clamp((p - STEPS[i]!) / (STEPS[i + 1]! - STEPS[i]!));
}

// building dimensions (m): x east, y up, z south
const W = 14, D = 10, FLOOR = 3.2, FLOORS = 4, H = FLOOR * FLOORS, PARAPET = 0.9;
const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
const DROPS = 4; // east face, 2.5 m each
const FORE = { x0: X1 + 0.2, x1: X1 + 10.2, z0: -7, z1: 7 };
const PAVER_LANES = 10;
/** the modelled downpipe (see build_building.py) */
const DPX = X1 - 0.45, DPZ = Z1 + 0.12;
/** roof deck top in the model */
const DECK = H + 0.15;
/** radius of the sun-path dome drawn around the building (an architect's solar study) */
const R_ARC = 26;

// ---------------------------------------------------------------------------------------------
// the dirt patch
const NOISE = /* glsl */ `
float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y); }
float dfbm(vec2 p) { return dn(p) * 0.5 + dn(p * 2.03 + 1.7) * 0.3 + dn(p * 4.1 + 3.1) * 0.2; }
`;

interface Shared {
  [k: string]: { value: unknown };
}

function dirtMaterial(kind: 0 | 1 | 2 | 3, shared: Shared, params: THREE.MeshStandardMaterialParameters, shop = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.defines = { ...(shader.defines ?? {}), DIRT_KIND: kind, ...(shop ? { SHOP: '' } : {}) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vec4 wpD = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpD = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vWPos = wpD.xyz;
  vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWN;
uniform float uWallFront; uniform float uGlassS; uniform float uShopFront; uniform float uPaverS; uniform float uSolarS;
uniform float uInterior; uniform float uTime; uniform sampler2D tConcrete; uniform vec3 uCleanerPos;
float gDirt; float gWet; vec3 gEmit;
${NOISE}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  gDirt = 0.0; gWet = 0.0; gEmit = vec3(0.0);
  {
#if DIRT_KIND == 0
  // render: grey-green biological streaks from sills and the parapet, splashback at the base
  float hz = abs(vWN.x) > 0.5 ? vWPos.z : vWPos.x;
  float streak = smoothstep(0.42, 0.95, dn(vec2(hz * 2.6, vWPos.y * 0.12)));
  float blot = dfbm(vec2(hz, vWPos.y) * 0.45);
  float splash = smoothstep(2.2, 0.0, vWPos.y);
  float dirtW = clamp(0.48 + streak * 0.6 + splash * 0.4 + (blot - 0.5) * 0.6, 0.0, 1.0);
  float drop = floor((hz + 30.0) / 2.4);
  float front = uWallFront + dh(vec2(drop, 3.7)) * 1.6;
  float cleanW = smoothstep(front - 0.12, front + 0.12, vWPos.y);
  float washing = step(-1.5, uWallFront) * step(uWallFront, 16.0);
  gWet = cleanW * smoothstep(front + 3.6, front, vWPos.y) * washing;
  gDirt = dirtW * (1.0 - cleanW);
  #ifdef USE_AOMAP
    float aoS = texture2D(aoMap, vAoMapUv).r;
    gDirt = clamp(gDirt * mix(1.5, 0.85, aoS), 0.0, 1.0);
    diffuseColor.rgb *= mix(0.6, 1.0, aoS);
  #endif
  vec3 grimeC = diffuseColor.rgb * vec3(0.24, 0.25, 0.22) + vec3(0.012, 0.028, 0.016) * streak;
  diffuseColor.rgb = mix(diffuseColor.rgb, grimeC, gDirt);
  diffuseColor.rgb *= 1.0 - gWet * 0.45;
  // the soft-wash front itself: a thin line of foam where the rinse meets the dirt
  diffuseColor.rgb += vec3(0.42, 0.44, 0.42) * (1.0 - smoothstep(0.0, 0.1, abs(vWPos.y - front))) * washing * (0.6 + 0.4 * dn(vec2(hz * 9.0, uTime * 2.0)));
  roughnessFactor = mix(roughnessFactor, 0.35, gWet);
#elif DIRT_KIND == 1
  // glass: milky film and dried runs; cleaned drop by drop (curtain wall) or by the pole (shopfront)
  float haze = clamp(0.45 + dfbm(vWPos.zy * 0.6) * 0.5 + smoothstep(0.6, 0.95, dn(vec2(vWPos.z * 9.0, vWPos.y * 0.5))) * 0.4, 0.0, 1.0);
  float cleanG = 0.0;
  #ifdef SHOP
    cleanG = smoothstep(uShopFront + 0.15, uShopFront - 0.15, vWPos.z);
    gWet = cleanG * smoothstep(uShopFront - 2.5, uShopFront, vWPos.z) * step(-6.0, uShopFront) * step(uShopFront, 6.5);
  #else
    float k = floor((${Z1.toFixed(1)} - vWPos.z) / 2.5);
    float s = uGlassS;
    float yt = ${(H - 0.1).toFixed(2)} - fract(s) * ${(H - FLOOR).toFixed(2)};
    cleanG = k < floor(s) ? 1.0 : (k > floor(s) ? 0.0 : smoothstep(yt - 0.12, yt + 0.12, vWPos.y));
    if (s >= ${DROPS.toFixed(1)}) cleanG = 1.0;
    gWet = cleanG * (k == floor(s) ? smoothstep(yt + 2.6, yt, vWPos.y) : 0.0);
  #endif
  gDirt = haze * (1.0 - cleanG);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.22, 0.19), gDirt * 0.92);
  roughnessFactor = mix(roughnessFactor, 0.62, gDirt);
  metalnessFactor = mix(metalnessFactor, 0.12, gDirt);
  roughnessFactor = mix(roughnessFactor, 0.12, gWet * 0.6);
  // offices and the shop light up as the day goes
  vec2 pane = floor(vec2(vWPos.z / 1.25, vWPos.y / ${FLOOR.toFixed(1)}));
  float lit = step(0.58, dh(pane + 0.3));
  #ifdef SHOP
    lit = 1.0;
  #endif
  float within = smoothstep(0.0, 0.15, fract(vWPos.y / ${FLOOR.toFixed(1)})) * smoothstep(1.0, 0.7, fract(vWPos.y / ${FLOOR.toFixed(1)}));
  float fy = fract(vWPos.y / ${FLOOR.toFixed(1)});
  gEmit = vec3(1.0, 0.72, 0.44) * uInterior * lit * within * (1.0 - gDirt * 0.75) * mix(0.45, 0.9, smoothstep(0.85, 0.25, fy)) * 0.6;
  #ifdef SHOP
    gEmit *= 1.7;
    gEmit += vec3(1.0, 0.78, 0.5) * 0.12 * (1.0 - gDirt * 0.6);
  #endif
#elif DIRT_KIND == 2
  // pavers: running bond 600 × 300, grime, oil and tyre arcs; cleaned in lanes by the surface cleaner
  vec2 q = vWPos.xz;
  vec2 cell = vec2(0.6, 0.3);
  float row = floor(q.y / cell.y);
  vec2 g = vec2(q.x / cell.x + mod(row, 2.0) * 0.5, q.y / cell.y);
  vec2 f = fract(g);
  float joint = smoothstep(0.0, 0.035, min(min(f.x, 1.0 - f.x) * cell.x / cell.y, min(f.y, 1.0 - f.y)));
  float tone = dh(floor(g)) * 0.12;
  diffuseColor.rgb = diffuseColor.rgb * (0.92 + tone) * mix(0.55, 1.0, joint);
  float grime = 1.0 - texture2D(tConcrete, q * 0.18).r;
  float oil = smoothstep(0.62, 0.8, dfbm(q * 0.7 + 4.0));
  float dirtP = clamp(grime * 0.9 + oil * 0.6 + 0.25, 0.0, 1.0);
  float j = floor((q.x - ${FORE.x0.toFixed(2)}) / ${((FORE.x1 - FORE.x0) / PAVER_LANES).toFixed(3)});
  float along = (q.y - ${FORE.z0.toFixed(1)}) / ${(FORE.z1 - FORE.z0).toFixed(1)};
  along = mod(j, 2.0) < 0.5 ? along : 1.0 - along;
  float since = uPaverS - (j + along);
  float cleanP = smoothstep(-0.01, 0.01, since);
  cleanP = max(cleanP, 1.0 - smoothstep(0.48, 0.55, length(q - uCleanerPos.xz)));
  if (q.x < ${FORE.x0.toFixed(2)}) cleanP = 0.0;
  gWet = cleanP * exp(-max(since, 0.0) * 0.9) * step(0.001, uPaverS) * step(uPaverS, ${(PAVER_LANES - 0.001).toFixed(3)}) + cleanP * 0.25 * step(0.001, uPaverS);
  gDirt = dirtP * (1.0 - cleanP);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.31, 0.3), gDirt);
  diffuseColor.rgb *= 1.0 - gWet * 0.35;
  roughnessFactor = mix(roughnessFactor, 0.16, clamp(gWet * 1.6, 0.0, 1.0));
#elif DIRT_KIND == 3
  // solar: cells under glass, dusted; cleaned row by row by the brush
  vec2 c = vec2(vWPos.x / 0.17, vWPos.z / 0.165);
  vec2 cf = fract(c);
  float grid = smoothstep(0.0, 0.06, min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)));
  diffuseColor.rgb = mix(vec3(0.55, 0.58, 0.62), diffuseColor.rgb, grid);
  float dust = clamp(0.55 + dfbm(vWPos.xz * 1.4) * 0.5, 0.0, 1.0);
  float r = floor((vWPos.z + 3.6) / 2.2);
  float s = uSolarS;
  float bx = -4.6 + fract(s) * 9.2;
  float cleanS = r < floor(s) ? 1.0 : (r > floor(s) ? 0.0 : smoothstep(bx + 0.1, bx - 0.1, vWPos.x));
  if (s >= 3.0) cleanS = 1.0;
  gDirt = dust * (1.0 - cleanS);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.4, 0.36), gDirt * 0.52);
  roughnessFactor = mix(roughnessFactor, 0.75, gDirt);
  metalnessFactor = mix(metalnessFactor, 0.0, gDirt);
#endif
  }
`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gEmit;');
  };
  m.customProgramCacheKey = () => `dirt-${kind}${shop ? '-shop' : ''}`;
  return m;
}

// particles: spray, mist and sheeting water, every position a function of time
const SPRAY_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uOrigin; uniform vec3 uDir; uniform float uSpread; uniform float uSpeed;
uniform float uLife; uniform float uOn; uniform float uSize; uniform float uGravity;
varying float vA;
void main() {
  float t = fract(uTime / uLife + aSeed.w) * uLife;
  vec3 side = normalize(cross(uDir, vec3(0.0, 1.0, 0.001)));
  vec3 up = normalize(cross(side, uDir));
  vec3 v = normalize(uDir + side * (aSeed.x - 0.5) * uSpread + up * (aSeed.y - 0.5) * uSpread * 0.6) * uSpeed * (0.6 + aSeed.z * 0.7);
  vec3 p = uOrigin + v * t + vec3(0.0, -uGravity, 0.0) * t * t * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float life = t / uLife;
  vA = uOn * smoothstep(0.0, 0.08, life) * (1.0 - life);
  gl_PointSize = uSize * (0.5 + aSeed.z) * (300.0 / -mv.z) * uOn;
}`;
const SPRAY_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

// glowing flow along a tube (the pure-water hose, the downpipe flush)
const FLOW_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const FLOW_FRAG = /* glsl */ `
uniform float uTime; uniform float uFill; uniform vec3 uColor; uniform float uPulse;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float filled = smoothstep(uFill, uFill - 0.03, vUv.x);
  float dash = 0.55 + 0.45 * sin((vUv.x * 60.0 - uTime * 6.0));
  float pulse = uPulse > 0.0 ? exp(-pow((vUv.x - uPulse) * 14.0, 2.0)) * 3.0 : 0.0;
  vec3 c = uColor * (filled * dash * 1.4 + pulse);
  gl_FragColor = vec4(c, 1.0);
#include <fog_fragment>
}`;

// ---------------------------------------------------------------------------------------------
// the street around the site (scripts/blender/build_street.py lays it out in this same space)
const ROAD_Y = -0.15;

/** Ground layers from the street model get a little life: mowing stripes and dry patches on the
 *  lawns, slab joints and wear on the footpaths. World-space, so it never tiles visibly. */
function patchGround(m: THREE.MeshStandardMaterial, kind: 'lawn' | 'footpath' | 'gravel'): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const body =
      kind === 'lawn'
        ? `
  vec2 q = vGPos.xz;
  float stripe = step(0.5, fract(q.x / 3.2));
  float dry = smoothstep(0.55, 0.85, dfbm(q * 0.06 + 3.0));
  float clump = dfbm(q * 1.7);
  vec3 g = diffuseColor.rgb * mix(0.86, 1.12, stripe) * mix(0.82, 1.15, clump);
  g = mix(g, vec3(0.32, 0.31, 0.13), dry * 0.45);
  diffuseColor.rgb = g;`
        : kind === 'footpath'
          ? `
  vec2 q = vGPos.xz / 1.2;
  vec2 f = fract(q);
  float joint = smoothstep(0.0, 0.025, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float tone = dh(floor(q)) * 0.1 + dfbm(vGPos.xz * 0.9) * 0.16;
  float stain = smoothstep(0.62, 0.9, dfbm(vGPos.xz * 0.21 + 7.0));
  diffuseColor.rgb *= (0.9 + tone) * mix(0.72, 1.0, joint) * (1.0 - stain * 0.22);`
          : `
  float n = dfbm(vGPos.xz * 3.1) * 0.6 + dh(floor(vGPos.xz * 40.0)) * 0.4;
  diffuseColor.rgb *= 0.78 + n * 0.4;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGPos;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n  {${body}\n  }`);
  };
  m.customProgramCacheKey = () => `ground-${kind}`;
}

/** Physically based sky (three's Preetham model) with a gain for this pipeline (the post chain does
 *  the tone mapping) and a sun-disc scale so the reflection probe can keep the disc tame. */
function makeSky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(1500);
  sky.frustumCulled = false;
  const m = sky.material as THREE.ShaderMaterial;
  m.uniforms.uGain = { value: 0.42 };
  m.uniforms.uDisk = { value: 1 };
  m.uniforms.uSat = { value: 1.45 };
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uGain;\nuniform float uDisk;\nuniform float uSat;')
    .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * uDisk;')
    // a polariser's worth of saturation: the deep blue a camera sees away from the sun
    .replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      'retColor = max(mix(vec3(dot(retColor, vec3(0.2126, 0.7152, 0.0722))), retColor, uSat), 0.0);\ngl_FragColor = vec4( retColor * uGain, 1.0 );',
    );
  const u = m.uniforms;
  u.turbidity!.value = 2.0;
  u.rayleigh!.value = 1.8;
  u.mieCoefficient!.value = 0.003;
  u.mieDirectionalG!.value = 0.86;
  return sky;
}

// trees: [x, z, variant (0 big plane, 1 young plane), scale]
const TREES: [number, number, number, number][] = [
  // build-outs in the east street's parking lanes (both sides, north of the site)
  [20.45, -60, 1, 0.92], [20.45, -44, 1, 1.0], [20.45, -26, 1, 0.9],
  [28.55, -52, 1, 0.95], [28.55, -36, 1, 0.88], [28.55, -20, 1, 1.0],
  // along the parks' street edges
  [15.4, 27, 0, 0.92], [15.2, 41, 0, 1.0], [15.5, 56, 0, 0.95], [15.3, 71, 0, 0.9],
  [35.6, 27, 0, 0.95], [35.4, 43, 0, 0.88], [35.7, 59, 0, 1.0], [35.5, 75, 0, 0.93],
  [-46, 24.6, 0, 0.95], [-34, 24.4, 0, 1.0], [-22, 24.8, 0, 0.9], [-10.8, 24.5, 1, 1.05], [10.8, 24.6, 1, 1.1],
];
{
  // the park: scattered, clear of the façade shot's corridor, the paths and the survey camera
  const r = rng(41);
  let tries = 0;
  const parkN = IS_MOBILE ? 18 : 26;
  let n = 0;
  while (n < parkN && tries++ < 600) {
    const x = -58 + r() * 72, z = 31 + r() * 84;
    if (Math.abs(x + 1) < 11 && z < 52) continue;
    if (Math.abs(z - 39.5) < 2.6 || Math.abs(x - 5.5) < 2.8) continue;
    if (Math.hypot(x + 22, z - 55) < 9) continue;
    if (TREES.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 7.5)) continue;
    TREES.push([x, z, r() < 0.62 ? 0 : 1, 0.8 + r() * 0.32]);
    n++;
  }
  const eastN = IS_MOBILE ? 9 : 14;
  n = 0;
  tries = 0;
  while (n < eastN && tries++ < 600) {
    const x = 40 + r() * 75, z = 27 + r() * 88;
    if (Math.abs(z - 53.5) < 2.6) continue;
    if (Math.hypot(x - 46, z - 34.5) < 10) continue;
    if (TREES.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 7.5)) continue;
    TREES.push([x, z, r() < 0.55 ? 0 : 1, 0.8 + r() * 0.3]);
    n++;
  }
}

// parked vehicles: [x, z, heading (rad, 0 = +x), paint]
const PAINT = [
  [0.82, 0.82, 0.8], [0.55, 0.56, 0.58], [0.16, 0.17, 0.18], [0.04, 0.042, 0.046],
  [0.05, 0.085, 0.21], [0.3, 0.035, 0.035], [0.52, 0.46, 0.35], [0.07, 0.13, 0.1],
] as const;
const N_ = -Math.PI / 2, S_ = Math.PI / 2, E_ = 0, W_ = Math.PI;
const PARKED: [number, number, number, number][] = [
  [20.45, -18, N_, 0], [20.45, -35, N_, 2], [20.45, -52.5, N_, 4],
  [28.55, -12, S_, 1], [28.55, -28, S_, 5], [28.55, -44, S_, 0],
  [20.45, 31, N_, 3], [20.45, 47, N_, 6], [28.55, 35, S_, 1], [28.55, 60, S_, 7],
  [-18, 18.45, E_, 0], [-30, 18.45, E_, 4], [-44, 18.45, E_, 1], [-26, 10.55, W_, 2],
];
/** heading → rotation.y for a model whose nose is +x (sedan) */
const yawFor = (h: number) => -h;

// signal-phased traffic, closed-form in time: each car approaches from 230 m out, queues at its
// stop line during red, pulls away on green, and is 300 m down the road (in the haze) before the
// 60 s cycle wraps. The east street and the cross street get green alternately, so nothing ever
// meets in the intersection.
const CYCLE = 60, V_CRUISE = 11, T_DECEL = 2.6, T_ACCEL = 3.2;
interface Lane { ox: number; oz: number; dx: number; dz: number; phase: number }
const LANES: Lane[] = [
  { ox: 22.9, oz: 21.6, dx: 0, dz: -1, phase: 0 }, // east street, northbound (stops south of the junction)
  { ox: 26.1, oz: 1.7, dx: 0, dz: 1, phase: 0 }, // east street, southbound (stops before the zebra)
  { ox: 18.3, oz: 15.95, dx: 1, dz: 0, phase: 30 }, // cross street, eastbound
  { ox: 30.7, oz: 13.05, dx: -1, dz: 0, phase: 30 }, // cross street, westbound
];
const CARS_PER_LANE = 3;
function laneD(u: number, k: number): number {
  const q = -(3.2 + 6.6 * k);
  const ta = 21 + 2.4 * k, tr = 30.5 + 1.7 * k;
  if (u < ta) {
    const x = ta - u;
    return x >= T_DECEL ? q - (V_CRUISE * T_DECEL) / 2 - V_CRUISE * (x - T_DECEL) : q - (V_CRUISE * x * x) / (2 * T_DECEL);
  }
  if (u < tr) return q;
  const x = u - tr;
  return x < T_ACCEL ? q + (V_CRUISE * x * x) / (2 * T_ACCEL) : q + (V_CRUISE * T_ACCEL) / 2 + V_CRUISE * (x - T_ACCEL);
}

// The rope-access technician (fal image-to-3D, cleaned in Blender: scripts/blender/clean_gen.py).
// The model faces −x, origin under the boots. Its squeegee arm is skinned to a shoulder bone here,
// weights from position, so the arm can fan the classic S-stroke across the glass.
const SHOULDER = new THREE.Vector3(0.12, 1.066, -0.215);
const HAND = new THREE.Vector3(-0.249, 1.285, -0.22);
const ROPE_TOP = new THREE.Vector3(0.05, 1.76, -0.095);
const ROPE_TAIL = new THREE.Vector3(0.06, 0.08, -0.12);
/** squeegee blade height above the origin */
const BLADE_Y = 1.38;
/** where a technician hangs on drop k of the east curtain wall (blade over the drop's centre) */
const dropZ = (k: number) => Z1 - 1.25 - k * 2.5 + 0.22;

interface Worker {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  arm: THREE.Bone;
  phase: number;
}

function skinArm(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const axis = HAND.clone().sub(SHOULDER);
  const L = axis.length();
  axis.normalize();
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  const ss = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    d.copy(v).sub(SHOULDER);
    const along = d.dot(axis);
    const t = along / L;
    const r = d.clone().addScaledVector(axis, -along).length();
    // the arm is on the model's right side (−z); the head, rope and torso centre stay put
    const side = ss(-0.128, -0.17, v.z);
    const reach = ss(0.06, 0.34, t);
    const tube = Math.max(1 - ss(0.1, 0.15, r), ss(0.72, 0.95, t));
    const w = side * reach * tube;
    si[i * 4] = 0;
    si[i * 4 + 1] = 1;
    sw[i * 4] = 1 - w;
    sw[i * 4 + 1] = w;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

function makeWorker(geo: THREE.BufferGeometry, mat: THREE.Material, phase: number): Worker {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const rootBone = new THREE.Bone();
  const arm = new THREE.Bone();
  arm.position.copy(SHOULDER);
  rootBone.add(arm);
  mesh.add(rootBone);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([rootBone, arm]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, arm, phase };
}

interface CamKey {
  az: number;
  el: number;
  dist: number;
  target: [number, number, number];
  fov: number;
}

// camera per step (az clockwise from north; the building sits between camera and sun)
const CAMS: CamKey[] = [
  { az: 222, el: 3, dist: 72, target: [2, 18, 0], fov: 40 }, // establishing, 11:00: the block and skyline from over the park
  { az: 200, el: 3, dist: 58, target: [0, 15, 0], fov: 40 }, // survey: the sun-path study against the sky
  { az: 140, el: 30, dist: 30, target: [3, 11, 0], fov: 34 }, // rig
  { az: 58, el: 14, dist: 20, target: [12, 2.4, -3.5], fov: 34 }, // purify: from over the far parking lane
  { az: 168, el: 50, dist: 30, target: [0, 12.5, 0], fov: 34 }, // roof
  { az: 182, el: 10, dist: 36, target: [0, 7, 0], fov: 32 }, // façade (south, in shade), from the park
  { az: 104, el: 9, dist: 15, target: [7, 8, 0], fov: 34 }, // glass (east, in shade): follows the crew, over the street
  { az: 96, el: 55, dist: 26, target: [12, 0, 0], fov: 36 }, // ground
  { az: 128, el: 7, dist: 60, target: [2, 11, 0], fov: 32 }, // reading, late afternoon, from over the east park
];

/** the glass take follows the crew: the active drop (panning to the next as each finishes), then
 *  down to the shopfront for the pole. Pure in p. */
function glassFocus(p: number): [number, number, number] {
  const s = stepAt(p);
  const glL = s < 5 ? 0 : s === 5 ? stepLocal(p, 5) : 1;
  const gS = clamp(glL / 0.78) * DROPS;
  const k = Math.min(DROPS - 1, Math.floor(gS));
  const f = gS - k;
  const tr = k < DROPS - 1 ? smooth(clamp((f - 0.82) / 0.18)) : 0;
  const z = lerp(dropZ(k), dropZ(Math.min(DROPS - 1, k + 1)), tr);
  const yt = gS >= DROPS ? FLOOR : H - 0.1 - f * (H - FLOOR);
  const y = lerp(7.2, lerp(yt, H - 0.1, tr), 0.6);
  const shop = smooth(clamp((glL - 0.76) / 0.1));
  return [7, lerp(y, 2.6, shop), lerp(z, 0, shop)];
}

function camKeyAt(p: number): CamKey {
  CAMS[6]!.target = glassFocus(p);
  const s = stepAt(p);
  const i = s + 1; // key index
  const local = s < 0 ? clamp(p / STEPS[0]!) : stepLocal(p, s);
  const prev = CAMS[Math.max(0, i - 1)]!;
  const cur = CAMS[i]!;
  // ease from the previous framing over the first 40% of the step, then a slow drift
  const k = i === 0 ? 1 : smooth(clamp(local / 0.4));
  let daz = cur.az - prev.az;
  if (daz > 180) daz -= 360;
  if (daz < -180) daz += 360;
  const drift = (local - 0.5) * 9;
  return {
    az: prev.az + daz * k + drift,
    el: lerp(prev.el, cur.el, k),
    dist: lerp(prev.dist, cur.dist, k) * (1 - local * 0.04),
    target: [lerp(prev.target[0], cur.target[0], k), lerp(prev.target[1], cur.target[1], k), lerp(prev.target[2], cur.target[2], k)],
    fov: lerp(prev.fov, cur.fov, k),
  };
}

function sunVector(alt: number, az: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(alt), z = THREE.MathUtils.degToRad(az);
  return new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a));
}

/** world-space meshes out of a glTF scene (node transforms baked into cloned geometry) */
function meshesOf(root: THREE.Object3D): Map<string, THREE.Mesh> {
  root.updateMatrixWorld(true);
  const out = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const mesh = new THREE.Mesh(g, m.material);
    mesh.name = m.name || (m.material as THREE.Material).name;
    out.set(mesh.name, mesh);
  });
  return out;
}

/** soft round contact shadow under cars (the shadow map is too coarse for the tyre line) */
function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class ProcessScene extends GLStage {
  p = 0;
  private shared: Shared;
  private sun = new THREE.DirectionalLight(0xffffff, 3.4);
  private hemi = new THREE.HemisphereLight(0xbcd4ee, 0x3b4032, 0.2);
  private sky: Sky;
  private envs: THREE.Texture[] = [];
  private envClock = [11.6, 13.6, 16.4];
  private sprays: { pts: THREE.Points; mat: THREE.ShaderMaterial }[] = [];
  private hoseMat: THREE.ShaderMaterial;
  private pipeMat: THREE.ShaderMaterial;
  private workers: Worker[] = [];
  private ropes: THREE.Line[] = [];
  private buildingMats: Record<string, THREE.MeshStandardMaterial> = {};
  private leaves!: THREE.InstancedMesh;
  private leafBase: { pos: THREE.Vector3; d: number; r: number }[] = [];
  private nozzle = new THREE.Group();
  private brush = new THREE.Group();
  private cleaner = new THREE.Group();
  private pole = new THREE.Group();
  private barrier = new THREE.Group();
  private laser = new THREE.Group();
  private arc!: THREE.Line;
  private arcMat!: THREE.LineDashedMaterial;
  private beadMat!: THREE.MeshBasicMaterial;
  private anchors: THREE.Mesh[] = [];
  private anchorMat = new THREE.MeshBasicMaterial({ color: 0x8ec5b1 });
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);
  private tmpE = new THREE.Euler();
  // street life
  private cars: THREE.InstancedMesh | null = null;
  private carBlobs: THREE.InstancedMesh | null = null;
  private leafU = { uTime: { value: 0 }, uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) } };
  private lampMats: THREE.MeshStandardMaterial[] = [];
  /** reading for the HUD: water at the brush */
  tds = 62;
  private meterCanvas = document.createElement('canvas');
  private meterTex: THREE.CanvasTexture | null = null;
  private meterShown = -1;

  private drawMeter(ppm: number): void {
    const g = this.meterCanvas.getContext('2d');
    if (!g || !this.meterTex) return;
    g.fillStyle = '#071014';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = ppm > 0 ? '#c47a2c' : '#8ec5b1';
    g.font = '300 64px "Mona Sans", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(String(ppm).padStart(3, '0'), 14, 52);
    g.font = '500 22px "Mona Sans", sans-serif';
    g.fillText('ppm', 170, 62);
    this.meterTex.needsUpdate = true;
    this.meterShown = ppm;
  }

  constructor(canvas: HTMLCanvasElement, take: Take) {
    super(canvas, take, {
      samples: 2,
      shadows: true,
      fov: 32,
      near: 0.5,
      far: 900,
      maxDpr: IS_MOBILE ? 1.3 : 1.5,
      dof: !IS_MOBILE,
      post: { bloom: 0.55, threshold: 1.6, flare: 0.22, vignette: 0.36, grain: 0.035, exposure: 1.15, flareTint: new THREE.Color(1, 0.9, 0.74), fstop: 5.6, dof: 5, saturation: 1.04 },
    });
    this.shared = {
      uWallFront: { value: 20 },
      uGlassS: { value: 0 },
      uShopFront: { value: -8 },
      uPaverS: { value: 0 },
      uSolarS: { value: 0 },
      uInterior: { value: 0 },
      uTime: { value: 0 },
      tConcrete: { value: null },
      uCleanerPos: { value: new THREE.Vector3(100, 0, 100) },
    };
    // aerial perspective: the haze takes the colour of the horizon
    this.scene.fog = new THREE.FogExp2(0xa9bfd6, 0.003);
    this.sky = makeSky();
    this.scene.add(this.sky);
    // light: the sun casts; the sky itself lights everything else through the environment
    this.sun.castShadow = true;
    const sm = 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 20; sc.far = 320;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.hoseMat = new THREE.ShaderMaterial({ vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uFill: { value: 0 }, uColor: { value: new THREE.Color(0x8ec5b1) }, uPulse: { value: -1 } } });
    this.pipeMat = new THREE.ShaderMaterial({ vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uFill: { value: 0 }, uColor: { value: new THREE.Color(0x9fd8ff) }, uPulse: { value: -1 } } });
    this.build();
    // dev only: a handle for tuning from the console / capture scripts
    if (import.meta.env.DEV) (window as unknown as { __proc?: ProcessScene }).__proc = this;
  }

  override async load(): Promise<void> {
    const [t, gltf, ao, street, trees, sedan, van, worker] = await Promise.all([
      loadTexture('/media/img/tex-concrete.webp', { repeat: true }),
      loadModel('/media/model/building.glb'),
      loadTexture('/media/model/building-ao.webp'),
      loadModel('/media/model/street.glb'),
      loadModel('/media/model/trees.glb'),
      loadModel('/media/model/sedan.glb'),
      loadModel('/media/model/van.glb'),
      loadModel('/media/model/worker-rope.glb'),
    ]);
    t.colorSpace = THREE.NoColorSpace;
    this.shared.tConcrete!.value = t;
    // glTF UVs run top-down: the baked AO must not be flipped, and it is data, not colour
    ao.flipY = false;
    ao.colorSpace = THREE.NoColorSpace;
    ao.needsUpdate = true;
    this.makeEnvs();
    const seen = new Set<THREE.Material>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const mapped = this.buildingMats[src.name];
      const mat = mapped ?? src;
      if (!mapped) {
        mat.envMapIntensity = src.name === 'interior' ? 0 : 1;
        if (src.name !== 'interior') this.disposables.push(src);
      }
      if (!seen.has(mat)) {
        seen.add(mat);
        mat.aoMap = ao;
        mat.aoMapIntensity = 1;
        mat.needsUpdate = true;
      }
      m.material = mat;
      m.castShadow = src.name !== 'interior' && !src.name.startsWith('glass');
      m.receiveShadow = true;
    });
    this.disposables.push(ao);
    this.scene.add(gltf.scene);

    this.addStreet(street.scene);
    this.addTrees(trees.scene);
    this.addVehicles(sedan.scene, van.scene);
    this.addWorkers(worker.scene);
    this.makeCityProbe();
  }

  /** The building's glass reflects the street, not just the sky: one cube capture of the finished
   *  city from across the forecourt, prefiltered, used as the glass materials' envMap. */
  private makeCityProbe(): void {
    const rt = new THREE.WebGLCubeRenderTarget(IS_MOBILE ? 128 : 256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.5, 900, rt);
    cam.position.set(X1 + 7, 6.5, 0.5);
    const hidden = [this.arc, this.laser, this.barrier, ...this.sprays.map((s) => s.pts)];
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const s13 = sunAt(13);
    const sv = sunVector(s13.alt, s13.az);
    (this.sky.material as THREE.ShaderMaterial).uniforms.sunPosition!.value.copy(sv);
    this.sun.position.copy(sv).multiplyScalar(160).add(new THREE.Vector3(8, 0, 4));
    this.sun.target.position.set(8, 0, 4);
    this.sun.target.updateMatrixWorld();
    cam.update(this.renderer, this.scene);
    hidden.forEach((o, i) => (o.visible = was[i]!));
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromCubemap(rt.texture).texture;
    pm.dispose();
    rt.dispose();
    this.disposables.push(env);
    for (const n of ['glass_cw', 'glass_win', 'glass_shop', 'spandrel']) {
      const m = this.buildingMats[n];
      if (!m) continue;
      m.envMap = env;
      m.envMapIntensity = n === 'glass_shop' ? 0.9 : 1.0;
      m.needsUpdate = true;
    }
  }

  /** Reflection probes: the same sky at three times of the working day, prefiltered once at load
   *  (a PMREM per frame would stall the Iris-class GPUs this has to run on). */
  private makeEnvs(): void {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky = makeSky();
    const su = (sky.material as THREE.ShaderMaterial).uniforms;
    su.uDisk!.value = 0.08;
    su.uSat!.value = 1.15;
    envScene.add(sky);
    for (const clock of this.envClock) {
      const s = sunAt(clock);
      (su.sunPosition!.value as THREE.Vector3).copy(sunVector(s.alt, s.az));
      const rt = pm.fromScene(envScene, 0, 0.1, 3000);
      this.envs.push(rt.texture);
      this.disposables.push(rt);
    }
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    pm.dispose();
    this.scene.environment = this.envs[0]!;
    // shade is lit by the sky alone: about a quarter of the sunlit side, as on a clear day
    this.scene.environmentIntensity = 0.4;
  }

  private addStreet(root: THREE.Group): void {
    const byName = new Map<string, THREE.MeshStandardMaterial>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      byName.set(mat.name, mat);
      const flat = ['asphalt', 'footpath', 'lawn', 'gravel', 'paint'].includes(mat.name);
      m.castShadow = !flat;
      m.receiveShadow = true;
      mat.envMapIntensity = 0.85;
      if (mat.map) mat.map.anisotropy = 8;
      if (mat.name === 'facade-concrete') mat.color.setScalar(0.8);
      if (mat.name === 'facade-glass') {
        // the generated curtain-wall photo is very cyan: pull it toward neutral and let the sky
        // probe do the reflecting, as real tinted glass does
        mat.roughness = 0.22;
        mat.metalness = 0.55;
        mat.envMapIntensity = 1.0;
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), 0.6) * 0.72;`,
          );
        };
        mat.customProgramCacheKey = () => 'facade-glass';
      }
      if (mat.name === 'lampglass') this.lampMats.push(mat);
    });
    const lawn = byName.get('lawn');
    if (lawn) patchGround(lawn, 'lawn');
    const foot = byName.get('footpath');
    if (foot) {
      patchGround(foot, 'footpath');
      // the block around the site: one slab of footpath under everything, so no seam shows
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(28.2, 18.4), foot);
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(3.1, -0.004, 0.2);
      fill.receiveShadow = true;
      this.scene.add(fill);
    }
    const gravel = byName.get('gravel');
    if (gravel) patchGround(gravel, 'gravel');
    for (const name of ['signal_red', 'signal_green']) {
      const m = byName.get(name);
      if (m) m.emissiveIntensity = 1.6;
    }
    this.scene.add(root);
  }

  private addTrees(root: THREE.Group): void {
    const parts = meshesOf(root);
    const leafSrc = parts.get('tree_a_leaf')!.material as THREE.MeshStandardMaterial;
    const woodSrc = parts.get('tree_a_wood')!.material as THREE.MeshStandardMaterial;
    const leafMap = leafSrc.map!;
    leafMap.anisotropy = 4;
    const leafMat = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: 0.5, vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.9 });
    const wind = `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    #else
      vec3 ip = vec3(0.0);
    #endif
    float hgt = max(transformed.y - 2.4, 0.0);
    float ph = dot(ip, vec3(0.13, 0.0, 0.17));
    float sway = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7 + transformed.x * 0.4) * 0.3;
    transformed.x += sway * 0.011 * hgt;
    transformed.z += cos(uTime * 1.05 + ph) * 0.008 * hgt;
    transformed += normal * sin(uTime * 5.5 + dot(transformed, vec3(3.1, 1.7, 2.3))) * 0.025;
  }`;
    const U = this.leafU;
    leafMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', wind);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  // light through the leaves: strongest looking into the sun, a little everywhere
  float back = pow(max(dot(normalize(-vViewPosition), uSunView), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.07 + back * 0.9);`,
        );
    };
    leafMat.customProgramCacheKey = () => 'leaf';
    const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: 0.5 });
    leafDepth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', wind);
    };
    leafDepth.customProgramCacheKey = () => 'leaf-depth';
    const woodMat = new THREE.MeshStandardMaterial({ map: woodSrc.map, roughness: 0.92, metalness: 0, envMapIntensity: 0.8 });
    this.disposables.push(leafSrc, woodSrc, leafDepth);

    const r = rng(17);
    for (const [v, key] of [[0, 'a'], [1, 'b']] as const) {
      const list = TREES.filter((t) => t[2] === v);
      const wood = new THREE.InstancedMesh(parts.get(`tree_${key}_wood`)!.geometry, woodMat, list.length);
      const leaf = new THREE.InstancedMesh(parts.get(`tree_${key}_leaf`)!.geometry, leafMat, list.length);
      leaf.customDepthMaterial = leafDepth;
      list.forEach(([x, z, , s], i) => {
        this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
        this.tmpS.setScalar(s);
        this.tmpM.compose(new THREE.Vector3(x, 0, z), this.tmpQ, this.tmpS);
        wood.setMatrixAt(i, this.tmpM);
        leaf.setMatrixAt(i, this.tmpM);
        // late-spring planes: some crowns a touch yellower, some deeper
        const k = r();
        leaf.setColorAt(i, new THREE.Color(0.94 + k * 0.12, 0.96 + r() * 0.08, 0.86 + r() * 0.12));
      });
      for (const im of [wood, leaf]) {
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
      }
    }
    // tree pits for the build-outs: a kerb square and soil
    const pits = TREES.filter(([x]) => x > 19.6 && x < 29.4);
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.85 });
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 1 });
    const ring = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.15, 1.7), kerbMat, pits.length);
    const soil = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.36, 1.36).rotateX(-Math.PI / 2), soilMat, pits.length);
    pits.forEach(([x, z], i) => {
      this.tmpM.makeTranslation(x, ROAD_Y + 0.075, z);
      ring.setMatrixAt(i, this.tmpM);
      this.tmpM.makeTranslation(x, 0.003, z);
      soil.setMatrixAt(i, this.tmpM);
    });
    ring.receiveShadow = soil.receiveShadow = true;
    ring.castShadow = true;
    this.scene.add(ring, soil);
  }

  private moving = LANES.length * CARS_PER_LANE;

  private addVehicles(sedanRoot: THREE.Group, vanRoot: THREE.Group): void {
    const sedan = [...meshesOf(sedanRoot).values()][0]!;
    const van = [...meshesOf(vanRoot).values()][0]!;
    const sm = sedan.material as THREE.MeshStandardMaterial;
    // repaint: the source car is navy; per-instance colour replaces only the paint (saturated blue,
    // dark), keeping the baked shading, glass, chrome and tyres
    sm.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#ifdef USE_COLOR
  {
    vec3 t = diffuseColor.rgb;
    float lum = dot(t, vec3(0.2126, 0.7152, 0.0722));
    float sat = (t.b - max(t.r, t.g)) / max(t.b, 1e-4);
    float paint = smoothstep(0.32, 0.58, sat) * smoothstep(0.004, 0.012, t.b) * smoothstep(0.13, 0.07, lum);
    vec3 rep = clamp(vColor.rgb * (lum / 0.036), 0.0, 0.93);
    diffuseColor.rgb = mix(t, rep, paint);
  }
#endif`,
      );
    };
    sm.customProgramCacheKey = () => 'car-repaint';
    sm.envMapIntensity = 1.25;
    const nP = PARKED.length;
    const total = nP + this.moving;
    const cars = new THREE.InstancedMesh(sedan.geometry, sm, total);
    const blobTex = blobTexture();
    this.disposables.push(blobTex);
    const blobs = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      total + 2,
    );
    const r = rng(29);
    PARKED.forEach(([x, z, h, paint], i) => {
      this.placeCar(cars, blobs, i, x, ROAD_Y, z, yawFor(h), 4.8, 2.0);
      const c = PAINT[paint]!;
      cars.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
    });
    for (let i = nP; i < total; i++) {
      const c = PAINT[Math.floor(r() * PAINT.length)]!;
      cars.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
    }
    cars.castShadow = true;
    cars.receiveShadow = true;
    cars.frustumCulled = false;
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    // the crew van by the forecourt, nose north, and one more down the street
    const vans = new THREE.InstancedMesh(van.geometry, van.material as THREE.MeshStandardMaterial, 2);
    (van.material as THREE.MeshStandardMaterial).envMapIntensity = 1.2;
    // van nose is −x: heading h → rotation.y = π − h
    this.placeCar(vans, blobs, 0, 20.45, ROAD_Y, -6.2, Math.PI - N_, 4.75, 2.0, total);
    this.placeCar(vans, blobs, 1, 28.55, ROAD_Y, 47.5, Math.PI - S_, 4.75, 2.0, total + 1);
    vans.castShadow = vans.receiveShadow = true;
    vans.computeBoundingSphere();
    this.cars = cars;
    this.carBlobs = blobs;
    this.scene.add(cars, vans, blobs);
  }

  private placeCar(im: THREE.InstancedMesh, blobs: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, len: number, wid: number, blobIndex = i): void {
    this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this.tmpS.set(1, 1, 1);
    this.tmpM.compose(this.tmpV.set(x, y, z), this.tmpQ, this.tmpS);
    im.setMatrixAt(i, this.tmpM);
    im.instanceMatrix.needsUpdate = true;
    this.tmpS.set(len * 1.08, 1, wid * 1.05);
    this.tmpM.compose(this.tmpV.set(x, y + 0.012, z), this.tmpQ, this.tmpS);
    blobs.setMatrixAt(blobIndex, this.tmpM);
    blobs.instanceMatrix.needsUpdate = true;
  }

  private hide(im: THREE.InstancedMesh, i: number): void {
    this.tmpM.makeScale(0, 0, 0);
    im.setMatrixAt(i, this.tmpM);
  }

  private updateTraffic(time: number): void {
    const cars = this.cars, blobs = this.carBlobs;
    if (!cars || !blobs) return;
    const nP = PARKED.length;
    let i = nP;
    for (const lane of LANES) {
      const u = (((time + lane.phase) % CYCLE) + CYCLE) % CYCLE;
      for (let k = 0; k < CARS_PER_LANE; k++, i++) {
        const d = laneD(u, k);
        if (d < -235 || d > 300) {
          this.hide(cars, i);
          this.hide(blobs, i);
          continue;
        }
        const x = lane.ox + lane.dx * d, z = lane.oz + lane.dz * d;
        this.placeCar(cars, blobs, i, x, ROAD_Y, z, Math.atan2(-lane.dz, lane.dx), 4.8, 2.0);
      }
    }
    cars.instanceMatrix.needsUpdate = true;
    blobs.instanceMatrix.needsUpdate = true;
  }

  private addWorkers(root: THREE.Group): void {
    const src = [...meshesOf(root).values()][0]!;
    const geo = src.geometry;
    skinArm(geo);
    const mat = src.material as THREE.MeshStandardMaterial;
    mat.envMapIntensity = 0.9;
    for (let i = 0; i <= DROPS; i++) {
      const w = makeWorker(geo, mat, i * 1.7);
      w.root.visible = false;
      this.workers.push(w);
      this.scene.add(w.root);
    }
  }

  /** a worker on the wall: position, which way it faces, the stroke, and its ropes */
  private poseWorker(w: Worker, pos: THREE.Vector3, rotY: number, time: number, stroke: number): void {
    w.root.visible = true;
    w.root.position.copy(pos);
    // a rope-access tech swings a little on the line and leans into the stroke
    const t = time + w.phase;
    w.root.rotation.set(Math.sin(t * 0.7) * 0.025, rotY + Math.sin(t * 0.45) * 0.04, Math.sin(t * 0.9) * 0.02);
    w.root.position.y += Math.sin(t * 1.4) * 0.025;
    // the S-stroke: the arm fans across the glass while the blade dips and lifts
    const yaw = Math.sin(t * 1.55) * 0.34 * stroke;
    const pitch = (Math.sin(t * 3.1) * 0.08 - 0.04) * stroke;
    this.tmpE.set(0, yaw, pitch);
    w.arm.quaternion.setFromEuler(this.tmpE);
  }

  // -------------------------------------------------------------------------------------------
  private build(): void {
    const S = this.shared;
    const render = dirtMaterial(0, S, { color: 0xd8c09a, roughness: 0.86, metalness: 0 });
    const glass = dirtMaterial(1, S, { color: 0x8fa9b8, roughness: 0.035, metalness: 0.92, envMapIntensity: 1.2 });
    const shop = dirtMaterial(1, S, { color: 0x3c4a52, roughness: 0.04, metalness: 0.75, envMapIntensity: 1.1 }, true);
    const pavers = dirtMaterial(2, S, { color: 0xcfc5b4, roughness: 0.78, metalness: 0, envMapIntensity: 1.0 });
    const solar = dirtMaterial(3, S, { color: 0x0c1830, roughness: 0.12, metalness: 0.55, envMapIntensity: 1.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.7, metalness: 0.1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.55, metalness: 0 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb98a47, roughness: 0.3, metalness: 0.9 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true, recv = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = recv;
      this.scene.add(m);
      return m;
    };

    // the paved forecourt (the street model brings everything else at ground level)
    const fw = FORE.x1 - FORE.x0, fd = FORE.z1 - FORE.z0;
    const fore = add(new THREE.PlaneGeometry(fw + 0.2, fd), pavers, (FORE.x0 + FORE.x1) / 2 - 0.1, 0.005, (FORE.z0 + FORE.z1) / 2, false);
    fore.rotation.x = -Math.PI / 2;

    // the building itself is modelled in Blender (scripts/blender/build_building.py) and arrives in
    // load(); its material names map onto the dirt materials made here
    this.buildingMats = {
      stone: render,
      trim: dirtMaterial(0, S, { color: 0xe6d6b8, roughness: 0.75, metalness: 0 }),
      base: dirtMaterial(0, S, { color: 0xa69174, roughness: 0.9, metalness: 0 }),
      glass_cw: glass,
      glass_win: dirtMaterial(1, S, { color: 0x6f8794, roughness: 0.05, metalness: 0.88, envMapIntensity: 1.15 }),
      glass_shop: shop,
      spandrel: dirtMaterial(1, S, { color: 0x2b353b, roughness: 0.2, metalness: 0.65, envMapIntensity: 1.0 }),
      solar,
      roof: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.95, metalness: 0 }),
      alu: new THREE.MeshStandardMaterial({ color: 0x8a9196, roughness: 0.4, metalness: 0.9 }),
    };
    // anchors near the east parapet
    const anchorGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.5, 10);
    for (let k = 0; k < DROPS; k++) for (const dz of [-0.1, 0.18]) this.anchors.push(add(anchorGeo, this.anchorMat, X1 - 0.6, H + 0.4, dropZ(k) + dz, false, false));
    // the modelled downpipe (south face, by the east pier) gets a glowing sleeve for the flush
    const pipeCurve = new THREE.LineCurve3(new THREE.Vector3(DPX, H - 0.45, DPZ), new THREE.Vector3(DPX, 0.12, DPZ));
    const sleeve = new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 40, 0.09, 10, false), this.pipeMat);
    this.scene.add(sleeve);

    // purification trailer and the hose up to the parapet
    const trailer = new THREE.Group();
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xc9ced1, roughness: 0.28, metalness: 0.85 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.25, 1.7, 4, 0.12), white);
    body.position.set(-0.2, 1.2, 0);
    body.castShadow = true;
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.5), dark);
    chassis.position.y = 0.5;
    const drawbar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), dark);
    drawbar.position.set(-2.1, 0.5, 0);
    trailer.add(body, chassis, drawbar);
    // two pressure vessels (carbon and mixed-bed resin), stainless with domed ends
    for (const z of [-0.42, 0.42]) {
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 6, 20), steelMat);
      t.position.set(1.2, 1.55, z);
      t.castShadow = true;
      trailer.add(t);
    }
    // hose reel on the side
    const reel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 10, 32), new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.6 }));
    reel.position.set(-0.5, 1.25, 0.92);
    trailer.add(reel);
    // the meter: reads the water at the brush, live
    this.meterCanvas.width = 256;
    this.meterCanvas.height = 96;
    this.meterTex = new THREE.CanvasTexture(this.meterCanvas);
    this.meterTex.colorSpace = THREE.SRGBColorSpace;
    const meter = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: this.meterTex, toneMapped: false }));
    meter.position.set(0.3, 1.45, 0.86);
    trailer.add(meter);
    this.drawMeter(62);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 20);
    for (const z of [-0.88, 0.88]) {
      const wh = new THREE.Mesh(wheelGeo, dark);
      wh.rotation.x = Math.PI / 2;
      wh.position.set(0.2, 0.36, z);
      trailer.add(wh);
    }
    trailer.traverse((o) => (o.receiveShadow = true));
    this.disposables.push(this.meterTex);
    trailer.position.set(FORE.x1 - 2.2, 0, FORE.z0 + 2.0);
    this.scene.add(trailer);
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(FORE.x1 - 2.2, 1.9, FORE.z0 + 2.0),
      new THREE.Vector3(FORE.x1 - 4.5, 0.08, FORE.z0 + 3.5),
      new THREE.Vector3(X1 + 1.2, 0.08, Z0 + 1.5),
      new THREE.Vector3(X1 + 0.35, 0.3, Z0 + 1.3),
      new THREE.Vector3(X1 + 0.3, H * 0.6, Z0 + 1.4),
      new THREE.Vector3(X1 + 0.3, H + 1.25, Z0 + 1.6),
      new THREE.Vector3(X1 - 0.9, DECK + 0.12, -2.6),
    ]);
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 160, 0.05, 8, false), this.hoseMat));

    // ropes: working line and backup for the technician (the model carries its own rope below the
    // descender; these run from the anchors over the parapet)
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xe8d7b0 });
    for (let i = 0; i < (DROPS + 1) * 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(g, ropeMat);
      l.frustumCulled = false;
      l.visible = false;
      this.ropes.push(l);
      this.scene.add(l);
    }

    // leaves in the gutters
    const leafGeo = new THREE.PlaneGeometry(0.14, 0.09);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6d4b2a, roughness: 0.9, side: THREE.DoubleSide });
    const LEAVES = 160;
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
    const lr = rng(5);
    for (let i = 0; i < LEAVES; i++) {
      // along the east gutter (z −4.7 → 4.7) then the south gutter (x 6.5 → −6.5): path length param
      const t = lr();
      const east = D - 0.6;
      const len = east + (W - 0.8);
      const d = t * len;
      const pos = d < east ? new THREE.Vector3(X1 - 0.5 + (lr() - 0.5) * 0.25, DECK + 0.05, Z0 + 0.3 + d) : new THREE.Vector3(X1 - 0.4 - (d - east), DECK + 0.05, Z1 - 0.5 + (lr() - 0.5) * 0.25);
      this.leafBase.push({ pos, d: t, r: lr() });
    }
    this.scene.add(this.leaves);
    // gutter vacuum nozzle + hose to the ground
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 10), dark);
    noz.rotation.z = 0.5;
    this.nozzle.add(noz);
    this.scene.add(this.nozzle);
    // solar brush: a bar with bristles on a pole
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.7), brass);
    const bpole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 4.2, 6), dark);
    bpole.rotation.z = 1.1;
    bpole.position.set(1.8, 0.9, 0);
    this.brush.add(bar, bpole);
    this.scene.add(this.brush);
    // rotary surface cleaner
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.55, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0xb7bcbf, roughness: 0.22, metalness: 0.95 }));
    disc.position.y = 0.1;
    disc.castShadow = true;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), dark);
    handle.position.set(-0.5, 0.6, 0);
    handle.rotation.z = 0.9;
    this.cleaner.add(disc, handle);
    this.scene.add(this.cleaner);
    // water-fed pole on the shopfront
    const wpole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.0, 8), dark);
    wpole.position.set(1.2, 1.4, 0);
    wpole.rotation.z = 0.62;
    const wbrush = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.6), brass);
    wbrush.position.set(-0.02, 2.95, 0);
    this.pole.add(wpole, wbrush);
    this.scene.add(this.pole);
    // exclusion zone: posts and tape three metres out from the east face
    const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 1.0, 8);
    const tapeMat = new THREE.MeshBasicMaterial({ color: 0xb98a47 });
    const zx = X1 + 3.2;
    const pts = [new THREE.Vector3(X1 + 0.3, 0, Z0 - 1.5), new THREE.Vector3(zx, 0, Z0 - 1.5), new THREE.Vector3(zx, 0, Z1 + 1.5), new THREE.Vector3(X1 + 0.3, 0, Z1 + 1.5)];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const post = new THREE.Mesh(postGeo, white);
      post.position.set(a.x, 0.5, a.z);
      post.castShadow = true;
      this.barrier.add(post);
      if (i < pts.length - 1) {
        const b = pts[i + 1]!;
        const len = a.distanceTo(b);
        const tape = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.01), tapeMat);
        tape.position.set((a.x + b.x) / 2, 0.92, (a.z + b.z) / 2);
        tape.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        this.barrier.add(tape);
      }
    }
    this.scene.add(this.barrier);
    // survey: a tripod with laser lines to the corners
    const tri = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 5), dark);
      leg.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.25, 0.7, Math.sin((i * Math.PI * 2) / 3) * 0.25);
      leg.rotation.set(Math.sin((i * Math.PI * 2) / 3) * 0.3, 0, -Math.cos((i * Math.PI * 2) / 3) * 0.3);
      tri.add(leg);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.14), brass);
    head.position.y = 1.5;
    tri.add(head);
    const tripodAt = new THREE.Vector3(X1 + 6.5, 0, Z1 + 3.2);
    tri.position.copy(tripodAt);
    this.laser.add(tri);
    const laserMat = new THREE.LineDashedMaterial({ color: 0xff5a3c, dashSize: 0.3, gapSize: 0.18, transparent: true, opacity: 0.95 });
    const from = tripodAt.clone().setY(1.5);
    for (const to of [new THREE.Vector3(X1, 0.05, Z1), new THREE.Vector3(X1, H + PARAPET, Z1), new THREE.Vector3(X1, H + PARAPET, Z0), new THREE.Vector3(X0, H + PARAPET, Z1)]) {
      const g = new THREE.BufferGeometry().setFromPoints([from, to]);
      const l = new THREE.Line(g, laserMat);
      l.computeLineDistances();
      this.laser.add(l);
    }
    this.scene.add(this.laser);

    // the sun path for today, drawn over the block like an architect's solar study: a dashed arc
    // with hour beads (the real sun rides it, in the sky behind)
    const arcPts: THREE.Vector3[] = [];
    for (let h = 5; h <= 20.01; h += 0.1) {
      const s = sunAt(h);
      if (s.alt < -2) continue;
      arcPts.push(sunVector(s.alt, s.az).multiplyScalar(R_ARC));
    }
    this.arcMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.9, fog: false });
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), this.arcMat);
    this.arc.computeLineDistances();
    this.arc.frustumCulled = false;
    this.scene.add(this.arc);
    const tickGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.beadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2), fog: false, transparent: true });
    for (let h = 6; h <= 19; h++) {
      const s = sunAt(h);
      if (s.alt < 0) continue;
      const m = new THREE.Mesh(tickGeo, this.beadMat);
      m.position.copy(sunVector(s.alt, s.az).multiplyScalar(R_ARC));
      this.arc.add(m);
    }

    // water: four emitters sharing one program
    for (let i = 0; i < 4; i++) this.sprays.push(this.makeSpray(i === 2 ? 900 : 500));
  }

  private makeSpray(n: number): { pts: THREE.Points; mat: THREE.ShaderMaterial } {
    const g = new THREE.BufferGeometry();
    const seeds = new Float32Array(n * 4);
    const r = rng(n);
    for (let i = 0; i < seeds.length; i++) seeds[i] = r();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, -1, 0) }, uSpread: { value: 0.6 },
        uSpeed: { value: 3 }, uLife: { value: 0.7 }, uOn: { value: 0 }, uSize: { value: 0.12 }, uGravity: { value: 9.8 }, uColor: { value: new THREE.Color(1.1, 1.25, 1.4) },
      },
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return { pts, mat };
  }

  private spray(i: number, on: number, origin: THREE.Vector3, dir: THREE.Vector3, o: Partial<{ spread: number; speed: number; life: number; size: number; gravity: number }> = {}): void {
    const u = this.sprays[i]!.mat.uniforms;
    u.uOn!.value = on;
    (u.uOrigin!.value as THREE.Vector3).copy(origin);
    (u.uDir!.value as THREE.Vector3).copy(dir).normalize();
    u.uSpread!.value = o.spread ?? 0.6;
    u.uSpeed!.value = o.speed ?? 3;
    u.uLife!.value = o.life ?? 0.7;
    u.uSize!.value = o.size ?? 0.12;
    u.uGravity!.value = o.gravity ?? 9.8;
  }

  // -------------------------------------------------------------------------------------------
  update(time: number): void {
    const p = this.p;
    const S = this.shared;
    S.uTime!.value = time;
    this.hoseMat.uniforms.uTime!.value = time;
    this.pipeMat.uniforms.uTime!.value = time;
    for (const s of this.sprays) s.mat.uniforms.uTime!.value = time;
    this.leafU.uTime.value = time;
    const step = stepAt(p);
    const L = (i: number) => stepLocal(p, i);

    // sun for this clock time, today
    const clock = clockAt(p);
    const sun = sunAt(clock);
    const sv = sunVector(sun.alt, sun.az);
    const warm = clamp(1 - (sun.alt - 12) / 40);
    this.sun.color.setRGB(1, lerp(0.96, 0.8, warm), lerp(0.9, 0.62, warm));
    this.sun.intensity = lerp(3.6, 3.0, warm) * smooth(clamp(sun.alt / 8));
    this.hemi.intensity = 0.2;
    (this.sky.material as THREE.ShaderMaterial).uniforms.sunPosition!.value.copy(sv);
    // reflection probe nearest this time of day
    let ei = 0;
    for (let i = 1; i < this.envClock.length; i++) if (Math.abs(clock - this.envClock[i]!) < Math.abs(clock - this.envClock[ei]!)) ei = i;
    if (this.envs[ei] && this.scene.environment !== this.envs[ei]) this.scene.environment = this.envs[ei]!;
    // haze: pale blue at midday, warmer as the sun drops
    (this.scene.fog as THREE.FogExp2).color.setRGB(lerp(0.5, 0.7, warm), lerp(0.62, 0.66, warm), lerp(0.78, 0.66, warm));
    this.post.opts.flare = 0.16 + warm * 0.18;
    // leaves glow when the camera looks toward the sun through them
    this.leafU.uSunView.value.copy(sv).transformDirection(this.camera.matrixWorldInverse);
    this.leafU.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.32);
    this.updateTraffic(time);

    // survey: sun path and lasers
    const arcOn = step <= 0 ? 0.75 : step === 7 ? 0.4 : 0;
    this.arcMat.opacity = arcOn;
    this.beadMat.opacity = arcOn;
    this.arc.visible = arcOn > 0.01;
    this.laser.visible = step === 0;
    if (this.laser.visible) this.laser.children.forEach((c) => c instanceof THREE.Line && ((c.material as THREE.LineDashedMaterial).opacity = band(0, 0.25, L(0)) * (1 - band(0.85, 1, L(0)))));
    // rig: barrier and anchors, ropes over the edge
    this.barrier.visible = step >= 1 && step <= 6;
    const glint = step === 1 ? 0.5 + 0.5 * Math.sin(L(1) * 30) : 0;
    this.anchorMat.color.setRGB(0.55 + glint * 2.5, 0.77 + glint * 2.5, 0.69 + glint * 2.5);
    // purify: the hose fills and the reading falls to 000
    const fill = step < 2 ? 0 : step === 2 ? smooth(L(2)) : 1;
    this.hoseMat.uniforms.uFill!.value = fill;
    this.tds = step < 2 ? 62 : step === 2 ? Math.round(62 * (1 - smooth(clamp(L(2) / 0.8)))) : 0;
    if (this.tds !== this.meterShown) this.drawMeter(this.tds);

    // roof: gutter vac (first 55%), downpipe flush, then the solar brush
    const roofL = step < 3 ? 0 : step === 3 ? L(3) : 1;
    const vac = clamp(roofL / 0.45);
    const east = D - 0.6;
    const total = east + (W - 0.8);
    const vd = vac * total;
    const nozPos = vd < east ? new THREE.Vector3(X1 - 0.5, DECK + 0.45, Z0 + 0.3 + vd) : new THREE.Vector3(X1 - 0.4 - (vd - east), DECK + 0.45, Z1 - 0.5);
    this.nozzle.position.copy(nozPos);
    this.nozzle.visible = step === 3 && vac > 0 && vac < 1;
    const lp = new THREE.Vector3();
    for (let i = 0; i < this.leafBase.length; i++) {
      const leaf = this.leafBase[i]!;
      const since = (vac - leaf.d) * 6; // > 0 once the nozzle has passed
      let s = 1;
      lp.copy(leaf.pos);
      if (since > 0) {
        const k = clamp(since);
        lp.lerp(nozPos, smooth(k));
        lp.y += Math.sin(k * Math.PI) * 0.4;
        s = 1 - k;
      }
      this.tmpQ.setFromEuler(this.tmpE.set(-Math.PI / 2 + leaf.r * 0.6, leaf.r * 6.28 + time * (since > 0 ? 8 : 0), 0));
      this.tmpS.setScalar(Math.max(0.0001, s));
      this.tmpM.compose(lp, this.tmpQ, this.tmpS);
      this.leaves.setMatrixAt(i, this.tmpM);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    const flush = clamp((roofL - 0.45) / 0.12);
    this.pipeMat.uniforms.uPulse!.value = flush > 0 && flush < 1 ? 1 - flush : -1;
    this.pipeMat.uniforms.uFill!.value = 0;
    this.spray(3, flush > 0.75 && flush < 1 ? 1 : 0, new THREE.Vector3(DPX, 0.1, DPZ + 0.15), new THREE.Vector3(0.4, 0.6, 0.4), { spread: 1.6, speed: 1.6, life: 0.6, size: 0.1 });
    const solarS = clamp((roofL - 0.58) / 0.4) * 3;
    S.uSolarS!.value = solarS;
    const row = Math.min(2, Math.floor(solarS));
    const bx = -4.6 + (solarS - row) * 9.2;
    this.brush.position.set(bx, H + 0.9, -3.6 + row * 2.2 + 1.1);
    this.brush.visible = step === 3 && solarS > 0 && solarS < 3;
    if (this.brush.visible) this.spray(0, 1, this.brush.position.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(-0.3, 0.8, 0.2), { spread: 1.4, speed: 1.4, life: 0.5, size: 0.07 });

    // façade: soft wash fronts from the parapet down
    const facL = step < 4 ? 0 : step === 4 ? L(4) : 1;
    S.uWallFront!.value = lerp(15.5, -2.2, smooth(facL));
    const frontY = S.uWallFront!.value as number;

    // glass: four drops, the technician descending each, then the shopfront by pole
    const glL = step < 5 ? 0 : step === 5 ? L(5) : 1;
    const gS = clamp(glL / 0.78) * DROPS;
    S.uGlassS!.value = gS;
    const shopL = clamp((glL - 0.8) / 0.2);
    S.uShopFront!.value = step < 5 ? -8 : lerp(Z0 - 0.5, Z1 + 0.5, shopL);
    this.pole.visible = step === 5 && shopL > 0 && shopL < 1;
    this.pole.position.set(X1 + 0.9, 0, lerp(Z0, Z1, shopL));

    // the crew: four technicians on the east curtain wall, one per drop (waiting under the
    // parapet, descending with the squeegee as the clean line comes down, then detailing the low
    // panes), and a fifth soft-washing the south wall. Each hangs on a working line and a backup.
    for (const w of this.workers) w.root.visible = false;
    this.ropes.forEach((r) => (r.visible = false));
    const hand = new THREE.Vector3();
    let sprayOn = false;
    const wf = this.workers[DROPS];
    if (wf && step === 4 && facL > 0 && facL < 1) {
      // south wall, facing north; three bays left to right across the take
      const x = lerp(X1 - 2.0, X0 + 2.0, Math.floor(facL * 3) / 3 + 0.12);
      const y = Math.max(0.35, frontY + 0.5 - BLADE_Y);
      this.poseWorker(wf, this.tmpV.set(x, y, Z1 + 0.82), -Math.PI / 2, time, 0.55);
      this.ropeTo(DROPS * 2, wf, new THREE.Vector3(x + 0.1, H + PARAPET + 0.05, Z1 + 0.06), new THREE.Vector3(x + 0.1, H + 0.6, Z1 - 0.7));
      hand.copy(HAND).sub(SHOULDER);
      wf.arm.localToWorld(hand);
      this.spray(1, 1, hand, new THREE.Vector3(0, -0.12, -1), { spread: 0.5, speed: 4.5, life: 0.35, size: 0.09, gravity: 4 });
      sprayOn = true;
    }
    // from the rig onward the east crew hangs on its lines under the parapet, ready
    const rigged = step >= 1 && step <= 4 && band(0, 0.3, step === 1 ? L(1) : 1) > 0.5;
    if (step === 5 || rigged) {
      for (let k = 0; k < DROPS; k++) {
        const w = this.workers[k];
        if (!w) continue;
        const z = dropZ(k);
        let y: number, stroke: number;
        if (step !== 5 || gS < k) {
          y = H - 0.1 - BLADE_Y + 0.15;
          stroke = 0.12;
        } else if (gS < k + 1) {
          y = H - 0.1 - (gS - k) * (H - FLOOR) - BLADE_Y;
          stroke = 1;
        } else {
          y = FLOOR - 0.1 - BLADE_Y + Math.sin(time * 0.3 + k) * 0.25;
          stroke = 0.3;
        }
        this.poseWorker(w, this.tmpV.set(X1 + 0.8, y, z), 0, time, stroke);
        this.ropeTo(k * 2, w, new THREE.Vector3(X1 + 0.06, H + PARAPET + 0.05, z - 0.1), new THREE.Vector3(X1 - 0.6, H + 0.65, z - 0.1));
        if (stroke === 1) {
          hand.copy(HAND).sub(SHOULDER).add(new THREE.Vector3(-0.08, 0.05, 0));
          w.arm.localToWorld(hand);
          this.spray(1, 1, hand, new THREE.Vector3(-1, -1.2, 0), { spread: 0.4, speed: 1.4, life: 0.9, size: 0.05, gravity: 6 });
          sprayOn = true;
        }
      }
    }
    if (!sprayOn) this.spray(1, 0, this.tmpV, this.tmpV);

    // ground: rotary surface cleaner in lanes
    const grL = step < 6 ? 0 : step === 6 ? L(6) : 1;
    const ps = clamp(grL / 0.92) * PAVER_LANES;
    S.uPaverS!.value = ps;
    const lane = Math.min(PAVER_LANES - 1, Math.floor(ps));
    const along = ps - lane;
    const laneW = (FORE.x1 - FORE.x0) / PAVER_LANES;
    const cz = lane % 2 === 0 ? lerp(FORE.z0, FORE.z1, along) : lerp(FORE.z1, FORE.z0, along);
    const cx = FORE.x0 + (lane + 0.5) * laneW;
    this.cleaner.position.set(cx, 0, cz);
    this.cleaner.rotation.y = lane % 2 === 0 ? 0 : Math.PI;
    this.cleaner.children[0]!.rotation.y = time * 20;
    this.cleaner.visible = step === 6 && ps > 0 && ps < PAVER_LANES;
    (S.uCleanerPos!.value as THREE.Vector3).set(this.cleaner.visible ? cx : 999, 0, cz);
    this.spray(2, this.cleaner.visible ? 1 : 0, new THREE.Vector3(cx, 0.08, cz), new THREE.Vector3(0, 0.25, 1), { spread: 3.2, speed: 1.1, life: 0.55, size: 0.11, gravity: 3 });

    // reading: the lights come on, inside and along the street
    S.uInterior!.value = step < 6 ? 0.05 : step === 6 ? lerp(0.05, 0.3, L(6)) : lerp(0.3, 1.0, smooth(L(7)));
    const lamps = step < 7 ? 0 : smooth(clamp(L(7) / 0.6)) * 2.2;
    for (const m of this.lampMats) m.emissiveIntensity = lamps;

    // camera
    const ck = camKeyAt(p);
    const aspect = this.aspect;
    // narrow screens: a little further back, then a wider lens, so the building still fits
    const portrait = aspect < 1;
    const distMul = portrait ? 1.22 : aspect < 1.4 ? 1.08 : 1;
    let fov = ck.fov;
    if (aspect < 1.5) {
      const want = (Math.tan(THREE.MathUtils.degToRad(ck.fov) / 2) * 1.6 * (portrait ? 0.78 : 0.94)) / (aspect * distMul);
      fov = Math.min(68, Math.max(ck.fov, THREE.MathUtils.radToDeg(2 * Math.atan(want))));
    }
    const az = THREE.MathUtils.degToRad(ck.az), el = THREE.MathUtils.degToRad(ck.el);
    const dist = ck.dist * distMul;
    this.camera.position.set(ck.target[0] + Math.sin(az) * Math.cos(el) * dist, ck.target[1] + Math.sin(el) * dist, ck.target[2] - Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(ck.target[0], ck.target[1], ck.target[2]);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.fitShadow(sv, ck);
    // a real lens at working distance: only a gentle fall-off front and back
    this.post.opts.focus = dist;
    this.post.opts.focalMM = this.focalMM;
    this.post.opts.fstop = lerp(4, 6.3, clamp((dist - 20) / 40));
  }

  private shadowHalf = 0;
  /** The sun's shadow map covers what the shot sees: tight for close-ups (crisp edges), wide for
   *  the aerials. Its centre snaps to whole shadow texels in the light's frame, and the size to
   *  2 m steps, so edges hold still while the camera moves. */
  private fitShadow(sv: THREE.Vector3, ck: CamKey): void {
    const half = Math.round(clamp(ck.dist * 0.8, 24, 54) / 2) * 2;
    const sc = this.sun.shadow.camera;
    if (half !== this.shadowHalf) {
      this.shadowHalf = half;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * half) / this.sun.shadow.mapSize.x;
    const fwd = this.tmpV.copy(sv).negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // the target, pulled toward the building so the work always has its shadows
    const c = new THREE.Vector3(lerp(ck.target[0], 3, 0.35), 0, lerp(ck.target[2], 0, 0.35));
    const a = Math.round(c.dot(right) / texel) * texel;
    const b = Math.round(c.dot(up) / texel) * texel;
    const d = c.dot(fwd);
    c.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, d);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(sv, 160);
  }

  /** working line from the anchor, over the parapet edge, down to the technician's descender */
  private ropeTo(i: number, w: Worker, edge: THREE.Vector3, anchor: THREE.Vector3): void {
    w.root.updateMatrixWorld(true);
    const top = w.mesh.localToWorld(ROPE_TOP.clone());
    const tail = w.mesh.localToWorld(ROPE_TAIL.clone());
    this.setRope(i, [anchor, edge, top], true);
    // the backup line runs past the tech and hangs to the ground beside the working line's tail
    const e2 = edge.clone().add(new THREE.Vector3(0, 0, 0.28));
    const a2 = anchor.clone().add(new THREE.Vector3(0, 0, 0.28));
    this.setRope(i + 1, [a2, e2, new THREE.Vector3(tail.x + 0.05, 0.02, tail.z + 0.28)], true);
  }

  private setRope(i: number, pts: THREE.Vector3[], on: boolean): void {
    const r = this.ropes[i]!;
    r.visible = on;
    const pos = r.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let j = 0; j < 3; j++) {
      const q = pts[Math.min(j, pts.length - 1)]!;
      pos.setXYZ(j, q.x, q.y, q.z);
    }
    pos.needsUpdate = true;
  }
}
