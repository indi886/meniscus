// TAKE 5 · Rain-pane traverse and plunge.
// 17:48, a southerly buster: the glass beads up. Seen from inside an office at dusk, every drop on
// the pane is a lens, and each large drop holds one of the projects, small and upside down, the way a
// real droplet inverts the street behind it. For each project the camera trucks along the pane to
// its drop, the drop sticks, slips (stick-slip: gravity against contact-line pinning) and sticks
// again, swallowing the small beads in its path and leaving a trail; then the camera plunges into it.
// Past the focal point the image collapses to a blur and rights itself, filling the frame; the
// project holds, and the camera pulls back out through the focus again.
// One full-screen fragment shader with a virtual camera (centre, zoom, a little yaw); background
// is procedural night bokeh behind the glass, every bead refracts it, and the hero drops refract
// the project photographs with barrel distortion, a dark rim and a specular kick.
import * as THREE from 'three';
import { GLStage } from '../gl/stage';
import type { Take } from '../core/scroll';
import { loadTexture } from '../core/assets';
import { clamp, smooth, smoother, lerp, easeInOut3 } from '../core/util';
import { pointer } from '../core/cursor';

export const PROJ_COUNT = 6;
export const RAIN_P0 = 0.06;
const SPACING = 1.15;
const R = 0.135;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tA; uniform sampler2D tB;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uCam;      // centre xy (pane units), zoom (pane units per screen height)
uniform float uYaw;
uniform vec4 uDropA;    // centre xy, radius, flip (-1 inverted .. 1 upright)
uniform vec4 uDropB;
uniform vec3 uTrailA;   // x, y top of the trail, y now
uniform float uHoldZ;   // zoom at which a drop fills the frame
uniform vec2 uAspA; uniform vec2 uAspB; // image aspect of each texture (w/h, 0)
uniform vec2 uPointer;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }

// the city behind the glass, out of focus: warm sodium, cool white and teal discs, a storm sky
vec3 bokeh(vec2 q) {
  // storm light over the city: teal-grey, brighter toward the horizon band
  vec3 c = mix(vec3(0.03, 0.045, 0.05), vec3(0.11, 0.14, 0.15), smoothstep(-0.7, 0.5, q.y)) * (1.0 - smoothstep(0.5, 1.2, q.y) * 0.5);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float sc = 9.0 - fl * 2.6;
    vec2 g = q * sc + vec2(fl * 13.1, fl * 5.7);
    vec2 id = floor(g);
    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
      vec2 cid = id + vec2(float(dx), float(dy));
      vec2 h = hash2(cid);
      if (h.x > 0.36) continue;
      vec2 ctr = cid + 0.2 + h * 0.6;
      float r = 0.16 + h.y * 0.22;
      float d = length(g - ctr);
      float disc = smoothstep(r, r - 0.05, d) * (0.6 + 0.4 * smoothstep(r - 0.18, r, d));
      float k = hash(cid + 3.3);
      // sodium amber, warm white, the odd cool LED: never saturated
      vec3 col = k < 0.62 ? vec3(1.0, 0.66, 0.36) : (k < 0.9 ? vec3(0.95, 0.9, 0.82) : vec3(0.62, 0.8, 0.82));
      float lowBand = smoothstep(0.75, -0.55, q.y + h.y * 0.3);
      c += col * disc * (0.12 + 0.5 * h.x) * (0.35 + fl * 0.3) * lowBand;
    }
  }
  // rain beyond the glass, falling fast
  float streak = smoothstep(0.985, 1.0, noise(vec2(q.x * 90.0, q.y * 2.0 + uTime * 9.0)));
  c += vec3(0.5, 0.6, 0.65) * streak * 0.18;
  return c;
}

vec3 photo(sampler2D t, vec2 uv, vec2 asp, float bias) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > asp.x ? vec2(1.0, asp.x / sa) : vec2(sa / asp.x, 1.0);
  vec2 u = (uv - 0.5) * s + 0.5;
  float edge = step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0);
  return texture2D(t, clamp(u, 0.0, 1.0), bias).rgb * mix(0.25, 1.0, edge);
}

// a drop on vertical glass: a little wider and fuller at the bottom
float dropSdf(vec2 q, float r) {
  q.y *= mix(1.0, 0.9, step(q.y, 0.0));
  q.x *= 1.0 + 0.06 * smoothstep(0.0, -r, q.y);
  return length(q) - r;
}

vec3 heroDrop(vec2 pane, vec4 drop, sampler2D t, vec2 asp, vec3 under, inout float inside) {
  vec2 q = pane - drop.xy;
  float r = drop.z;
  float sd = dropSdf(q, r);
  if (sd > 0.01 * r + 0.004) return under;
  vec2 d = q / r;
  float rr = clamp(length(d), 0.0, 1.0);
  // barrel distortion, stronger toward the rim, and the flip through focus
  float barrel = 1.0 + 0.42 * rr * rr;
  float s = drop.w;
  vec2 rel = q * barrel * s / (uHoldZ * vec2(uRes.x / uRes.y, 1.0));
  float bias = (1.0 - abs(s)) * 7.0;
  vec3 img = photo(t, 0.5 + rel, asp, bias);
  // focal flash: as the image collapses through focus it glows
  img += vec3(1.0, 0.92, 0.8) * exp(-s * s * 18.0) * 0.55;
  // rim: total internal reflection darkens the edge; a specular kick top-left; a caustic bottom-right
  float rim = smoothstep(0.72, 1.0, rr);
  img *= 1.0 - rim * 0.75;
  vec2 sp = d - vec2(-0.38, 0.42);
  img += vec3(1.0) * pow(max(0.0, 1.0 - length(sp) * 3.2), 4.0) * 1.6;
  img += vec3(0.9, 0.8, 0.6) * smoothstep(0.08, 0.0, abs(length(d - vec2(0.12, -0.1)) - 0.86)) * smoothstep(0.0, -0.6, d.y) * 0.5;
  float a = smoothstep(0.004, -0.004, sd);
  inside = max(inside, a);
  return mix(under, img, a);
}

void main() {
  float asp = uRes.x / uRes.y;
  vec2 uv = vUv;
  // virtual camera: screen → pane, with a touch of yaw (keystone) while it trucks
  vec2 sc = (uv - 0.5) * vec2(asp, 1.0);
  sc.y *= 1.0 + uYaw * sc.x * 0.6;
  vec2 pane = uCam.xy + sc * uCam.z;

  // background parallax: the city is far away, it barely moves as the camera trucks along the pane
  vec2 bq = uCam.xy * 0.28 + sc * mix(1.0, 0.65, clamp(1.0 - uCam.z, 0.0, 1.0)) + uPointer * 0.02;
  vec3 col = bokeh(bq);

  // glass itself: a faint film and runs
  float film = noise(pane * vec2(60.0, 4.0) + vec2(0.0, uTime * 0.05));
  col += vec3(0.04, 0.05, 0.05) * smoothstep(0.7, 1.0, film);

  // small beads: two layers of hashed cells; each refracts the city upside down
  float trailW = uDropA.z * 0.45;
  float inTrail = step(abs(pane.x - uTrailA.x), trailW) * step(pane.y, uTrailA.y) * step(uTrailA.z, pane.y);
  for (int L = 0; L < 2; L++) {
    float cell = L == 0 ? 0.045 : 0.018;
    vec2 g = pane / cell;
    vec2 id = floor(g);
    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
      vec2 cid = id + vec2(float(dx), float(dy));
      vec2 h = hash2(cid + float(L) * 17.0);
      float keep = L == 0 ? 0.55 : 0.4;
      if (h.x > keep) continue;
      vec2 ctr = (cid + 0.15 + vec2(h.y, hash(cid + 9.1)) * 0.7) * cell;
      float r = cell * (L == 0 ? 0.14 + 0.3 * hash(cid + 1.7) : 0.12 + 0.22 * hash(cid + 2.3));
      // the running drop swallowed the beads in its path and left a few tiny ones
      float swallowed = step(abs(ctr.x - uTrailA.x), trailW) * step(ctr.y, uTrailA.y) * step(uTrailA.z, ctr.y);
      if (swallowed > 0.5) { if (L == 0 || h.y > 0.25) continue; r *= 0.6; }
      vec2 q = pane - ctr;
      float d = length(q * vec2(1.0, 1.08));
      if (d > r) continue;
      vec2 dn = q / r;
      vec3 inv = bokeh(bq - dn * 0.35 + vec2(0.0, 0.05)) * 1.15;
      float rr = length(dn);
      inv *= 1.0 - smoothstep(0.55, 1.0, rr) * 0.8;
      inv += vec3(1.0) * pow(max(0.0, 1.0 - length(dn - vec2(-0.35, 0.4)) * 3.0), 3.0) * 0.9;
      col = mix(col, inv, smoothstep(r, r * 0.86, d));
    }
  }
  // the wet trail left by the running drop
  col += vec3(0.05, 0.07, 0.075) * inTrail * (0.5 + 0.5 * noise(pane * vec2(30.0, 3.0)));

  float inside = 0.0;
  col = heroDrop(pane, uDropB, tB, uAspB, col, inside);
  col = heroDrop(pane, uDropA, tA, uAspA, col, inside);
  gl_FragColor = vec4(col, 1.0);
}`;

/** stick-slip: pinned, a sudden run under gravity, pinned again (offsets in pane units) */
function slipY(u: number): number {
  const s1 = smoother(clamp((u - 0.07) / 0.09));
  const s2 = smoother(clamp((u - 0.19) / 0.05));
  const s3 = smoother(clamp((u - 0.9) / 0.1));
  return -(s1 * 0.12 + s2 * 0.035 + s3 * 0.4);
}
function wiggle(u: number, i: number): number {
  return Math.sin(u * 9 + i * 2.1) * 0.006 * clamp(u / 0.2);
}

export interface RainState {
  index: number;
  /** 0..1 how much the current project's card should show */
  card: number;
}

export class RainScene extends GLStage {
  p = 0;
  state: RainState = { index: 0, card: 0 };
  private mat: THREE.ShaderMaterial;
  private photos: (THREE.Texture | null)[] = new Array(PROJ_COUNT).fill(null);
  private urls: string[];
  private yaw = 0;
  private lastCamX = 0;

  constructor(canvas: HTMLCanvasElement, take: Take, names: string[]) {
    super(canvas, take, { samples: 0, maxDpr: 1.4, post: { bloom: 0.75, threshold: 0.9, flare: 0.28, vignette: 0.5, grain: 0.05, exposure: 1.05, ca: 0, flareTint: new THREE.Color(1, 0.8, 0.55) } });
    const small = matchMedia('(max-width: 860px)').matches;
    this.urls = names.map((n) => `/media/img/${n}${small ? '-1024' : ''}.webp`);
    const geo = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tA: { value: null }, tB: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uCam: { value: new THREE.Vector3(0, 0, 1) }, uYaw: { value: 0 },
        uDropA: { value: new THREE.Vector4(0, 0, R, -1) }, uDropB: { value: new THREE.Vector4(SPACING, 0, R, -1) },
        uTrailA: { value: new THREE.Vector3(0, 0, 0) }, uHoldZ: { value: 0.2 },
        uAspA: { value: new THREE.Vector2(16 / 9, 0) }, uAspB: { value: new THREE.Vector2(16 / 9, 0) },
        uPointer: { value: new THREE.Vector2() },
      },
    });
    const m = new THREE.Mesh(geo, this.mat);
    m.frustumCulled = false;
    this.scene.add(m);
    this.disposables.push(geo);
  }

  override async load(): Promise<void> {
    const [a, b] = await Promise.all([loadTexture(this.urls[0]!), loadTexture(this.urls[1]!)]);
    this.photos[0] = a;
    this.photos[1] = b;
    this.mat.uniforms.tA!.value = a;
    this.mat.uniforms.tB!.value = b;
    this.urls.slice(2).forEach((u, i) => loadTexture(u).then((t) => (this.photos[i + 2] = t)).catch(() => undefined));
  }

  protected override onResize(): void {
    if (!this.mat) return;
    const s = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(s);
    this.mat.uniforms.uRes!.value.copy(s);
  }

  private tex(i: number): THREE.Texture | null {
    return this.photos[Math.max(0, Math.min(PROJ_COUNT - 1, i))] ?? null;
  }

  update(time: number, dt: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    const asp = this.aspect;
    // zoom at which a drop fills the frame (its radius reaches the frame's half diagonal)
    const holdZ = (2 * R) / Math.sqrt(1 + asp * asp) * 0.94;
    u.uHoldZ!.value = holdZ;
    const pv = u.uPointer!.value as THREE.Vector2;
    pv.x += (pointer.nx - pv.x) * Math.min(1, dt * 2);
    pv.y += (pointer.ny - pv.y) * Math.min(1, dt * 2);

    const p = this.p;
    let camX: number, camY: number, z: number, flip = -1;
    let i = 0, lu = 0;
    if (p < RAIN_P0) {
      const k = smooth(p / RAIN_P0);
      camX = lerp(-0.7, -0.35, k);
      camY = 0.02;
      z = lerp(1.3, 1.12, k);
    } else {
      const seg = clamp((p - RAIN_P0) / (1 - RAIN_P0)) * PROJ_COUNT;
      i = Math.min(PROJ_COUNT - 1, Math.floor(seg));
      lu = seg - i;
      const dx = i * SPACING + wiggle(lu, i);
      const dy = 0.06 + slipY(lu);
      const prevX = i === 0 ? -0.35 : (i - 1) * SPACING;
      if (lu < 0.22) {
        const k = easeInOut3(lu / 0.22);
        camX = lerp(prevX, dx, k);
        camY = lerp(0.02, dy * 0.6, k);
        z = lerp(1.12, 1.0, k) + Math.sin(k * Math.PI) * 0.12;
      } else if (lu < 0.52) {
        const k = (lu - 0.22) / 0.3;
        const kk = easeInOut3(k);
        camX = lerp(dx, dx, kk);
        camY = lerp(dy * 0.6, dy, smooth(k));
        z = Math.exp(lerp(Math.log(1.0), Math.log(holdZ), kk));
        flip = lerp(-1, 1, smoother(clamp((k - 0.42) / 0.5)));
      } else if (lu < 0.88) {
        const k = (lu - 0.52) / 0.36;
        camX = dx;
        camY = dy;
        z = holdZ * (1 - 0.05 * k);
        flip = 1;
      } else {
        const k = smooth((lu - 0.88) / 0.12);
        camX = dx;
        camY = lerp(dy, 0.02, k);
        z = Math.exp(lerp(Math.log(holdZ * 0.95), Math.log(1.12), k));
        flip = lerp(1, -1, smoother(clamp(k / 0.55)));
      }
      (u.uDropA!.value as THREE.Vector4).set(dx, dy, R, flip);
      (u.uDropB!.value as THREE.Vector4).set((i + 1) * SPACING, 0.06 + Math.sin(i * 1.7) * 0.05, R * 0.94, -1);
      if (i === PROJ_COUNT - 1) (u.uDropB!.value as THREE.Vector4).set(99, 99, R, -1);
      (u.uTrailA!.value as THREE.Vector3).set(dx, 0.06 + R * 0.3, dy + R * 0.2);
      // the cut of plates under the drops when the project changes
      if (this.state.index !== i || !u.tA!.value) {
        const a = this.tex(i), b = this.tex(i + 1);
        if (a) u.tA!.value = a;
        if (b) u.tB!.value = b;
      } else if (!this.photos[i + 1] || u.tB!.value !== this.tex(i + 1)) {
        const b = this.tex(i + 1);
        if (b) u.tB!.value = b;
      }
      const ia = (u.tA!.value as THREE.Texture | null)?.image as { width: number; height: number } | undefined;
      const ib = (u.tB!.value as THREE.Texture | null)?.image as { width: number; height: number } | undefined;
      if (ia?.width) (u.uAspA!.value as THREE.Vector2).set(ia.width / ia.height, 0);
      if (ib?.width) (u.uAspB!.value as THREE.Vector2).set(ib.width / ib.height, 0);
    }
    if (p < RAIN_P0) {
      (u.uDropA!.value as THREE.Vector4).set(0, 0.06, R, -1);
      (u.uDropB!.value as THREE.Vector4).set(SPACING, 0.06, R * 0.94, -1);
      (u.uTrailA!.value as THREE.Vector3).set(0, 0, 0);
      u.tA!.value = this.tex(0);
      u.tB!.value = this.tex(1);
    }
    // yaw follows the truck's velocity: the pane swings a little as the camera moves along it
    const vx = (camX - this.lastCamX) / Math.max(dt, 1 / 120);
    this.lastCamX = camX;
    this.yaw += (clamp(vx * 0.15, -0.25, 0.25) - this.yaw) * Math.min(1, dt * 4);
    u.uYaw!.value = this.yaw;
    (u.uCam!.value as THREE.Vector3).set(camX, camY, z);
    this.state.index = i;
    this.state.card = p < RAIN_P0 ? 0 : clamp(Math.min((lu - 0.46) / 0.08, (0.9 - lu) / 0.05));
    this.post.opts.vignette = lerp(0.55, 0.35, clamp((1 - z) / (1 - holdZ)));
  }
}
