// TAKE 4 · Shade-chase orbit. The signature 3D take.
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

// sky dome: the afternoon, warming toward gold as the sun drops
const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform float uWarm; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.3, 1.0);
  // a dark studio cyclorama: blue-black overhead, a low band of light at the horizon
  vec3 zen = vec3(0.012, 0.022, 0.036);
  vec3 hor = mix(vec3(0.07, 0.11, 0.14), vec3(0.2, 0.11, 0.07), uWarm);
  vec3 c = mix(hor, zen, pow(smoothstep(-0.05, 0.75, h), 0.7));
  // the sun's side of the sky glows, warmer and wider as it drops
  vec2 dh = normalize(d.xz + 1e-4), sh = normalize(uSunDir.xz + 1e-4);
  float side = pow(max(dot(dh, sh), 0.0), 3.0);
  c += mix(vec3(0.16, 0.22, 0.26), vec3(0.75, 0.38, 0.16), uWarm) * side * smoothstep(0.6, -0.02, h) * smoothstep(-0.25, 0.02, h);
  float sd = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.86, 0.62) * (pow(sd, 1200.0) * 40.0 + pow(sd, 24.0) * (0.12 + uWarm * 0.4));
  c = mix(c, vec3(0.008, 0.012, 0.016), smoothstep(-0.02, -0.25, h));
  gl_FragColor = vec4(c, 1.0);
}`;
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;

interface CamKey {
  az: number;
  el: number;
  dist: number;
  target: [number, number, number];
  fov: number;
}

// camera per step (az clockwise from north; the building sits between camera and sun)
const CAMS: CamKey[] = [
  { az: 222, el: 22, dist: 66, target: [0, 9, 0], fov: 34 }, // establishing, 11:00: the solar study
  { az: 202, el: 9, dist: 60, target: [0, 12, 0], fov: 40 }, // survey: the sun-path dome over the block
  { az: 140, el: 30, dist: 30, target: [3, 11, 0], fov: 34 }, // rig
  { az: 70, el: 12, dist: 21, target: [12, 2.4, -3.5], fov: 34 }, // purify
  { az: 168, el: 50, dist: 30, target: [0, 12.5, 0], fov: 34 }, // roof
  { az: 182, el: 10, dist: 36, target: [0, 7, 0], fov: 32 }, // façade (south, in shade)
  { az: 112, el: 12, dist: 31, target: [5, 7.5, 0], fov: 32 }, // glass (east, in shade)
  { az: 96, el: 55, dist: 26, target: [12, 0, 0], fov: 36 }, // ground
  { az: 128, el: 15, dist: 58, target: [2, 8, 0], fov: 32 }, // reading, golden hour
];

function camKeyAt(p: number): CamKey {
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

export class ProcessScene extends GLStage {
  p = 0;
  private shared: Shared;
  private sun = new THREE.DirectionalLight(0xffffff, 3.2);
  private hemi = new THREE.HemisphereLight(0xbfd6e6, 0x2a2622, 0.55);
  private fill = new THREE.DirectionalLight(0xcfe0ea, 0.9);
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private sprays: { pts: THREE.Points; mat: THREE.ShaderMaterial }[] = [];
  private hoseMat: THREE.ShaderMaterial;
  private pipeMat: THREE.ShaderMaterial;
  private tech = new THREE.Group();
  private ropes: THREE.Line[] = [];
  private ropeAnchors = [new THREE.Vector3(X1 - 0.6, H + 0.65, 1.2), new THREE.Vector3(X1 - 0.6, H + 0.65, 1.8)];
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
  private sunBall!: THREE.Mesh;
  private anchors: THREE.Mesh[] = [];
  private anchorMat = new THREE.MeshBasicMaterial({ color: 0x8ec5b1 });
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);
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
      far: 400,
      maxDpr: IS_MOBILE ? 1.3 : 1.5,
      dof: !IS_MOBILE,
      post: { bloom: 0.7, threshold: 1.3, flare: 0.35, vignette: 0.48, grain: 0.04, exposure: 1.18, flareTint: new THREE.Color(1, 0.84, 0.6), fstop: 2.2, dof: 34, saturation: 1.06 },
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
    this.scene.fog = new THREE.Fog(0x0b1216, 70, 260);
    // sky
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uWarm: { value: 0 } } });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    // light
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 10; sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.fill, this.fill.target);
    this.hoseMat = new THREE.ShaderMaterial({ vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uFill: { value: 0 }, uColor: { value: new THREE.Color(0x8ec5b1) }, uPulse: { value: -1 } } });
    this.pipeMat = new THREE.ShaderMaterial({ vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uFill: { value: 0 }, uColor: { value: new THREE.Color(0x9fd8ff) }, uPulse: { value: -1 } } });
    this.build();
  }

  override async load(): Promise<void> {
    const [t, gltf, ao] = await Promise.all([
      loadTexture('/media/img/tex-concrete.webp', { repeat: true }),
      loadModel('/media/model/building.glb'),
      loadTexture('/media/model/building-ao.webp'),
    ]);
    t.colorSpace = THREE.NoColorSpace;
    this.shared.tConcrete!.value = t;
    // glTF UVs run top-down: the baked AO must not be flipped, and it is data, not colour
    ao.flipY = false;
    ao.colorSpace = THREE.NoColorSpace;
    ao.needsUpdate = true;
    this.scene.environment = this.makeEnv();
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
  }

  /** A gradient sky with a low city skyline painted into an equirect, prefiltered for reflections. */
  private makeEnv(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#05080b');
    grad.addColorStop(0.42, '#18232b');
    grad.addColorStop(0.5, '#5d6a70');
    grad.addColorStop(0.54, '#20272b');
    grad.addColorStop(1, '#0b0f12');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    // two long softbox strips and a top light: crisp highlights running down the glass
    const strip = (x: number, y: number, w: number, h: number, a: number) => {
      const sgr = g.createLinearGradient(x, 0, x + w, 0);
      sgr.addColorStop(0, 'rgba(255,255,255,0)');
      sgr.addColorStop(0.5, `rgba(255,250,240,${a})`);
      sgr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sgr;
      g.fillRect(x, y, w, h);
    };
    strip(150, 120, 60, 200, 1);
    strip(640, 90, 80, 230, 0.9);
    strip(380, 10, 260, 40, 0.7);
    const r = rng(7);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,${200 + r() * 40},${150 + r() * 60},${0.25 + r() * 0.4})`;
      g.fillRect(r() * 1024, 250 + r() * 14, 2 + r() * 3, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromEquirectangular(tex).texture;
    tex.dispose();
    pm.dispose();
    this.disposables.push(env);
    return env;
  }

  // -------------------------------------------------------------------------------------------
  private build(): void {
    const S = this.shared;
    const render = dirtMaterial(0, S, { color: 0xd8c09a, roughness: 0.86, metalness: 0 });
    const glass = dirtMaterial(1, S, { color: 0x8fa9b8, roughness: 0.035, metalness: 0.92, envMapIntensity: 1.35 });
    const shop = dirtMaterial(1, S, { color: 0x3c4a52, roughness: 0.04, metalness: 0.75, envMapIntensity: 1.2 }, true);
    const pavers = dirtMaterial(2, S, { color: 0xcfc5b4, roughness: 0.78, metalness: 0, envMapIntensity: 1.2 });
    const solar = dirtMaterial(3, S, { color: 0x0c1830, roughness: 0.12, metalness: 0.55, envMapIntensity: 1.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.7, metalness: 0.1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.4, metalness: 0 });
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x141a1e, roughness: 0.95, metalness: 0 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb98a47, roughness: 0.3, metalness: 0.9 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true, recv = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = recv;
      this.scene.add(m);
      return m;
    };

    // ground and forecourt
    const ground = add(new THREE.PlaneGeometry(500, 500), asphalt, 0, -1.25, 0, false);
    ground.rotation.x = -Math.PI / 2;
    const fw = FORE.x1 - FORE.x0, fd = FORE.z1 - FORE.z0;
    const fore = add(new THREE.PlaneGeometry(fw, fd), pavers, (FORE.x0 + FORE.x1) / 2, 0.005, (FORE.z0 + FORE.z1) / 2, false);
    fore.rotation.x = -Math.PI / 2;
    const kerb = new THREE.BoxGeometry(0.2, 0.15, fd);
    add(kerb, white, FORE.x1 + 0.1, 0.075, 0);

    // the building itself is modelled in Blender (scripts/blender/build_building.py) and arrives in
    // load(); its material names map onto the dirt materials made here
    this.buildingMats = {
      stone: render,
      trim: dirtMaterial(0, S, { color: 0xe6d6b8, roughness: 0.75, metalness: 0 }),
      base: dirtMaterial(0, S, { color: 0xa69174, roughness: 0.9, metalness: 0 }),
      glass_cw: glass,
      glass_win: dirtMaterial(1, S, { color: 0x6f8794, roughness: 0.05, metalness: 0.88, envMapIntensity: 1.25 }),
      glass_shop: shop,
      spandrel: dirtMaterial(1, S, { color: 0x2b353b, roughness: 0.2, metalness: 0.65, envMapIntensity: 1.1 }),
      solar,
      roof: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.95, metalness: 0 }),
      alu: new THREE.MeshStandardMaterial({ color: 0x737a7f, roughness: 0.42, metalness: 0.9 }),
    };
    // anchors near the east parapet
    const anchorGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.5, 10);
    for (const a of this.ropeAnchors) {
      const m = add(anchorGeo, this.anchorMat, a.x, H + 0.4, a.z, false, false);
      this.anchors.push(m);
    }
    for (const z of [-3.2, -1.0, 3.4]) this.anchors.push(add(anchorGeo, this.anchorMat, X1 - 0.6, H + 0.4, z, false, false));
    // the modelled downpipe (south face, by the east pier) gets a glowing sleeve for the flush
    const pipeCurve = new THREE.LineCurve3(new THREE.Vector3(DPX, H - 0.45, DPZ), new THREE.Vector3(DPX, 0.12, DPZ));
    const sleeve = new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 40, 0.09, 10, false), this.pipeMat);
    this.scene.add(sleeve);

    // the site as a presentation model: a round plinth with a chamfered edge, the street beyond it
    // falling away into the sky (fog matched to the horizon)
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.8 });
    const plinth = add(new THREE.CylinderGeometry(R_ARC + 1.5, R_ARC + 2.4, 1.2, 96, 1), plinthMat, 2, -0.61, 0, false, true);
    plinth.receiveShadow = true;
    const edge = add(new THREE.TorusGeometry(R_ARC + 1.5, 0.05, 6, 160), new THREE.MeshBasicMaterial({ color: 0xb98a47 }), 2, 0.0, 0, false, false);
    edge.rotation.x = Math.PI / 2;
    // a kerb and a strip of road along the forecourt, so the shopfront faces a street
    add(new THREE.BoxGeometry(5.5, 0.02, 2 * R_ARC), new THREE.MeshStandardMaterial({ color: 0x4d5254, roughness: 0.9 }), FORE.x1 + 3.2, 0.0, 0, false);
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

    // the technician on two ropes
    const suit = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.75 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), suit);
    torso.position.y = 0.1;
    torso.rotation.z = 0.12;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), white);
    helmet.position.set(0.05, 0.62, 0);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), suit);
    legs.position.set(-0.08, -0.45, 0.12);
    legs.rotation.z = 1.2;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.3), brass);
    seat.position.y = -0.25;
    const squeegee = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), brass);
    squeegee.position.set(0.32, 0.45, 0.1);
    this.tech.add(torso, helmet, legs, seat, squeegee);
    this.tech.traverse((o) => (o.castShadow = true));
    this.tech.scale.setScalar(1.35);
    this.scene.add(this.tech);
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xd9bc8c });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(g, ropeMat);
      l.frustumCulled = false;
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
    const tripodAt = new THREE.Vector3(X1 + 6.5, 0, Z1 + 4.5);
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

    // the sun path for today, drawn as a solar-study dome over the building: a dashed arc with
    // hour beads, a compass ring on the ground, and the sun riding the arc
    const arcPts: THREE.Vector3[] = [];
    for (let h = 5; h <= 20.01; h += 0.1) {
      const s = sunAt(h);
      if (s.alt < -2) continue;
      arcPts.push(sunVector(s.alt, s.az).multiplyScalar(R_ARC));
    }
    this.arcMat = new THREE.LineDashedMaterial({ color: 0x8ec5b1, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.9, fog: false });
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), this.arcMat);
    this.arc.computeLineDistances();
    this.arc.frustumCulled = false;
    this.scene.add(this.arc);
    this.sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.2, 4.6), fog: false }));
    this.scene.add(this.sunBall);
    // compass ring with ticks every 15°, long at the cardinal points
    const ringPts: THREE.Vector3[] = [];
    for (let a = 0; a <= 360; a += 3) ringPts.push(new THREE.Vector3(Math.sin((a * Math.PI) / 180) * R_ARC, 0.06, -Math.cos((a * Math.PI) / 180) * R_ARC));
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), this.arcMat);
    ring.computeLineDistances();
    this.arc.add(ring);
    const tickPts: THREE.Vector3[] = [];
    for (let a = 0; a < 360; a += 15) {
      const len = a % 90 === 0 ? 3.2 : 1.1;
      const sx = Math.sin((a * Math.PI) / 180), sz = -Math.cos((a * Math.PI) / 180);
      tickPts.push(new THREE.Vector3(sx * R_ARC, 0.06, sz * R_ARC), new THREE.Vector3(sx * (R_ARC - len), 0.06, sz * (R_ARC - len)));
    }
    this.arc.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), new THREE.LineBasicMaterial({ color: 0x8ec5b1, transparent: true, opacity: 0.8 })));
    // hour ticks on the arc
    const tickGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const tickMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.2, 1.9), fog: false });
    for (let h = 6; h <= 19; h++) {
      const s = sunAt(h);
      if (s.alt < 0) continue;
      const m = new THREE.Mesh(tickGeo, tickMat);
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
        uSpeed: { value: 3 }, uLife: { value: 0.7 }, uOn: { value: 0 }, uSize: { value: 0.12 }, uGravity: { value: 9.8 }, uColor: { value: new THREE.Color(1.4, 1.6, 1.8) },
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
    const step = stepAt(p);
    const L = (i: number) => stepLocal(p, i);

    // sun for this clock time, today
    const clock = clockAt(p);
    const sun = sunAt(clock);
    const sv = sunVector(sun.alt, sun.az);
    this.sun.position.copy(sv).multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    const warm = clamp(1 - (sun.alt - 12) / 40);
    this.sun.color.setRGB(1, lerp(0.97, 0.74, warm), lerp(0.92, 0.5, warm));
    this.sun.intensity = lerp(4.2, 3.4, warm) * smooth(clamp(sun.alt / 8));
    this.hemi.intensity = lerp(0.5, 0.36, warm);
    this.hemi.color.setRGB(lerp(0.6, 0.85, warm), lerp(0.74, 0.62, warm), lerp(0.92, 0.55, warm));
    this.hemi.groundColor.setRGB(0.22, 0.18, 0.14);
    (this.skyMat.uniforms.uSunDir!.value as THREE.Vector3).copy(sv);
    this.skyMat.uniforms.uWarm!.value = warm;
    (this.scene.fog as THREE.Fog).color.setRGB(lerp(0.045, 0.1, warm), lerp(0.07, 0.06, warm), lerp(0.09, 0.045, warm));
    this.sunBall.position.copy(sv).multiplyScalar(R_ARC);
    this.post.opts.flare = 0.25 + warm * 0.35;

    // survey: sun path and lasers
    const arcOn = step <= 0 ? 0.95 : step === 7 ? 0.6 : 0.3;
    this.arcMat.opacity = arcOn;
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
    for (let i = 0; i < this.leafBase.length; i++) {
      const leaf = this.leafBase[i]!;
      const b = leaf.pos;
      const ud = leaf;
      const passAt = ud.d;
      const since = (vac - passAt) * 6; // > 0 once the nozzle has passed
      let s = 1;
      this.tmpV.copy(b);
      if (since > 0) {
        const k = clamp(since);
        this.tmpV.lerp(nozPos, smooth(k));
        this.tmpV.y += Math.sin(k * Math.PI) * 0.4;
        s = 1 - k;
      }
      this.tmpQ.setFromEuler(new THREE.Euler(-Math.PI / 2 + ud.r * 0.6, ud.r * 6.28 + time * (since > 0 ? 8 : 0), 0));
      this.tmpS.setScalar(Math.max(0.0001, s));
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
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
    const techFace = step === 4;
    const techGlass = step === 5;

    // glass: four drops, technician descending each, then the shopfront by pole
    const glL = step < 5 ? 0 : step === 5 ? L(5) : 1;
    const gS = clamp(glL / 0.78) * DROPS;
    S.uGlassS!.value = gS;
    const shopL = clamp((glL - 0.8) / 0.2);
    S.uShopFront!.value = step < 5 ? -8 : lerp(Z0 - 0.5, Z1 + 0.5, shopL);
    this.pole.visible = step === 5 && shopL > 0 && shopL < 1;
    this.pole.position.set(X1 + 0.9, 0, lerp(Z0, Z1, shopL));
    // technician
    let tp: THREE.Vector3 | null = null;
    if (techFace && facL > 0 && facL < 1) {
      tp = new THREE.Vector3(lerp(X1 - 2.0, X0 + 2.0, Math.floor(facL * 3) / 3 + 0.12), Math.max(1.6, frontY + 0.6), Z1 + 0.45);
      this.spray(1, 1, tp.clone().add(new THREE.Vector3(0.2, 0.3, -0.2)), new THREE.Vector3(0, -0.15, -1), { spread: 0.5, speed: 4.5, life: 0.35, size: 0.1, gravity: 4 });
    } else if (techGlass && gS < DROPS) {
      const k = Math.min(DROPS - 1, Math.floor(gS));
      const yt = H - 0.1 - (gS - k) * (H - FLOOR);
      tp = new THREE.Vector3(X1 + 0.45, yt + 0.2, Z1 - 1.25 - k * 2.5);
      this.spray(1, 1, tp.clone().add(new THREE.Vector3(-0.2, 0.55, 0)), new THREE.Vector3(-1, -1.2, 0), { spread: 0.4, speed: 1.4, life: 0.9, size: 0.06, gravity: 6 });
    } else this.spray(1, 0, this.tmpV, this.tmpV);
    this.tech.visible = !!tp;
    if (tp) {
      this.tech.position.copy(tp);
      this.tech.rotation.y = techFace ? Math.PI : -Math.PI / 2;
      // ropes from the anchors (east face) or over the south parapet
      const a0 = techFace ? new THREE.Vector3(tp.x - 0.15, H + PARAPET, Z1 - 0.2) : this.ropeAnchors[0]!;
      const a1 = techFace ? new THREE.Vector3(tp.x + 0.15, H + PARAPET, Z1 - 0.2) : this.ropeAnchors[1]!;
      this.setRope(0, a0, tp.clone().add(new THREE.Vector3(0, 0.3, 0)));
      this.setRope(1, a1, tp.clone().add(new THREE.Vector3(0, 0.25, 0.05)));
    } else if (step >= 1 && step <= 3) {
      // rigged: ropes hang down the east face to the ground
      this.setRope(0, this.ropeAnchors[0]!, new THREE.Vector3(X1 + 0.35, 0.1, this.ropeAnchors[0]!.z));
      this.setRope(1, this.ropeAnchors[1]!, new THREE.Vector3(X1 + 0.35, 0.1, this.ropeAnchors[1]!.z));
    } else this.ropes.forEach((r) => (r.visible = false));
    if (step >= 1 && step <= 3) this.ropes.forEach((r) => (r.visible = band(0, 0.3, step === 1 ? L(1) : 1) > 0.5));

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

    // reading: the lights come on
    S.uInterior!.value = step < 6 ? 0.05 : step === 6 ? lerp(0.05, 0.3, L(6)) : lerp(0.3, 1.0, smooth(L(7)));

    // camera
    const ck = camKeyAt(p);
    const aspect = this.aspect;
    // portrait screens: pull back so the building still fits the width
    const wide = ck.dist > 50 ? 0.62 : 1;
    const fit = aspect < 1 ? Math.min(2.1, 1.05 / aspect) * (aspect < 1 ? wide + (1 - wide) * 0.4 : 1) : aspect < 1.4 ? 1.12 : 1;
    const az = THREE.MathUtils.degToRad(ck.az), el = THREE.MathUtils.degToRad(ck.el);
    const dist = ck.dist * fit;
    this.camera.position.set(ck.target[0] + Math.sin(az) * Math.cos(el) * dist, ck.target[1] + Math.sin(el) * dist, ck.target[2] - Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(ck.target[0], ck.target[1], ck.target[2]);
    if (Math.abs(this.camera.fov - ck.fov) > 0.01) {
      this.camera.fov = ck.fov;
      this.camera.updateProjectionMatrix();
    }
    // fill from just above the camera, toward the target (no shadows)
    this.fill.position.copy(this.camera.position).add(new THREE.Vector3(0, 6, 0));
    this.fill.target.position.set(ck.target[0], ck.target[1], ck.target[2]);
    this.fill.intensity = lerp(1.0, 0.55, warm);
    // tilt-shift: focus on the work, the rest falls off like a photographed model
    this.post.opts.focus = dist;
    this.post.opts.focalMM = this.focalMM;
    this.post.opts.fstop = lerp(2.4, 3.6, clamp((dist - 20) / 40));
  }

  private setRope(i: number, a: THREE.Vector3, b: THREE.Vector3): void {
    const r = this.ropes[i]!;
    r.visible = true;
    const pos = r.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
  }
}
