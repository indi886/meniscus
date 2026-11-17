// TAKE 3 · Overhead lane pass.
// Each service is a photograph under the grime that service removes: dust and hard-water rings on
// the glass services, black algae, tyre marks and oil on the hard surfaces. Scrolling drives a
// 25° fan jet across the frame in overlapping lanes, top to bottom and back and forth, the way a
// surface is pressure-cleaned so dirty water always runs onto ground not yet done. The pointer is a
// second nozzle: drag across the frame and it cuts its own lanes.
// The lanes are a closed-form function of scroll (scrubs both ways); the pointer's strokes are
// painted into a mask that is cleared at each cut between services.
// Wet concrete reads darker and glossier than dry: a lane is dark-wet behind the jet and dries
// light a short way back along the path.
import * as THREE from 'three';
import { GLStage } from '../gl/stage';
import type { Take } from '../core/scroll';
import { loadTexture } from '../core/assets';
import { clamp, smooth, lerp } from '../core/util';
import { pointer } from '../core/cursor';

export const SVC_COUNT = 7;
export const LANES = 5;
/** which services are glass (dust film) and which are hard surfaces (concrete grime) */
const GLASSY = [1, 1, 0.3, 0.15, 0, 1, 0.8];
const TINT = [
  [0.62, 0.6, 0.55],
  [0.58, 0.6, 0.6],
  [0.36, 0.33, 0.24],
  [0.3, 0.33, 0.26],
  [0.22, 0.21, 0.2],
  [0.6, 0.58, 0.54],
  [0.66, 0.62, 0.52],
];

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PAINT = /* glsl */ `
uniform vec4 uSeg; uniform float uHalfW; uniform float uAspect;
varying vec2 vUv;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  // the fan's footprint is a short line across the stroke: stretch the brush sideways
  float d = sdSeg(p, uSeg.xy, uSeg.zw);
  float m = 1.0 - smoothstep(uHalfW * 0.55, uHalfW, d);
  if (m <= 0.0) discard;
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tPhoto; uniform sampler2D tGrimeG; uniform sampler2D tGrimeC; uniform sampler2D tUser;
uniform vec2 uRes; uniform float uPhotoAspect; uniform float uTime;
uniform float uS;       // jet path position, 0..LANES
uniform float uGlassy; uniform vec3 uTint; uniform float uSeed;
uniform vec2 uHead;     // jet head in uv
uniform float uJet;     // jet visible 0..1
uniform vec2 uUserHead; uniform float uUserJet;
varying vec2 vUv;
#define LANES ${LANES}.0

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.1) * 0.3 + noise(p * 4.3 + 7.7) * 0.15; }

vec3 photo(vec2 uv) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > uPhotoAspect ? vec2(1.0, uPhotoAspect / sa) : vec2(sa / uPhotoAspect, 1.0);
  return texture2D(tPhoto, (uv - 0.5) * s + 0.5).rgb;
}

// one fan jet: a sheet from a nozzle above the frame to its footprint, and the spray at impact
vec3 jet(vec2 uv, vec2 head, float aspect, float on) {
  if (on <= 0.0) return vec3(0.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 h = vec2(head.x * aspect, head.y);
  vec2 nozzle = h + vec2(0.06, 0.55);
  vec2 axis = normalize(h - nozzle);
  vec2 rel = p - nozzle;
  float along = dot(rel, axis);
  float side = dot(rel, vec2(-axis.y, axis.x));
  float len = length(h - nozzle);
  // 25° fan: half-width grows with distance from the nozzle
  float hw = along * tan(radians(12.5));
  float inFan = step(0.0, along) * step(along, len) * (1.0 - smoothstep(hw * 0.7, hw, abs(side)));
  float streak = noise(vec2(side / max(hw, 1e-3) * 9.0, along * 30.0 - uTime * 22.0));
  vec3 c = vec3(0.86, 0.94, 1.0) * inFan * (0.05 + 0.18 * streak) * smoothstep(0.0, len * 0.35, along);
  // impact: mist and droplets thrown sideways along the footprint
  vec2 d = p - h;
  float mist = exp(-dot(d * vec2(1.0, 2.2), d * vec2(1.0, 2.2)) * 260.0);
  float sparks = smoothstep(0.82, 1.0, noise(d * 140.0 + uTime * vec2(9.0, -14.0))) * exp(-length(d) * 22.0);
  c += vec3(0.9, 0.96, 1.0) * (mist * 0.55 + sparks * 1.6);
  return c * on;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec3 img = photo(uv);

  // ---- clean mask: the lanes so far (closed form) or the pointer's strokes ----
  float laneF = (1.0 - uv.y) * LANES;
  float j = floor(laneF);
  float inLane = fract(laneF);
  float dir = mod(j, 2.0) < 0.5 ? 1.0 : -1.0;
  float xl = dir > 0.0 ? uv.x : 1.0 - uv.x;
  // ragged edges: the fan's footprint is uneven and lanes overlap a little
  float rag = (fbm(vec2(uv.y * 28.0 + j * 3.1, uSeed)) - 0.5) * 0.05;
  float pos = j + xl + rag;           // path position of this pixel
  float since = uS - pos;              // how far the jet has travelled since it cleaned this pixel
  // earlier lanes are done; in the current lane the footprint (full lane height) has passed xl < fract(s)
  float lane = smoothstep(-0.012, 0.012, since);
  // a faint tide line where neighbouring lanes overlap
  lane *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 0.04, min(inLane, 1.0 - inLane)));
  float user = texture2D(tUser, uv).r;
  float clean = clamp(max(lane, user), 0.0, 1.0);
  float wet = clamp(exp(-max(since, 0.0) * 2.4) * lane, 0.0, 1.0);
  wet = max(wet, user * 0.55);

  // ---- grime for this surface ----
  vec2 gp = vec2(uv.x * aspect, uv.y) * 0.9 + uSeed;
  float gg = texture2D(tGrimeG, gp).r;
  float gc = texture2D(tGrimeC, gp * 0.8).r;
  float n = fbm(uv * vec2(3.0, 2.0) + uSeed);
  float algae = smoothstep(0.35, 0.9, fbm(uv * vec2(1.2, 4.5) + uSeed * 1.7)) * (1.0 - uGlassy);
  float g = mix(1.0 - gc, gg * 1.3, uGlassy) * (0.6 + n * 0.8);
  // glass: milky dust that lifts the image; hard surfaces: dark grime that buries it
  float runs = smoothstep(0.62, 0.95, noise(vec2(uv.x * 38.0 + uSeed, uv.y * 1.6))) * smoothstep(0.05, 0.9, uv.y);
  float film = clamp(gg * 1.6 - 0.18 + (n - 0.5) * 0.7 + runs * 0.5, 0.0, 1.0);
  vec3 dustHaze = mix(img * 0.62, uTint * 1.02, clamp(0.12 + film * 0.78, 0.0, 0.9));
  dustHaze += vec3(0.9, 0.88, 0.82) * smoothstep(0.6, 0.95, gg) * 0.18;
  vec3 darkGrime = img * mix(vec3(0.55), uTint * 0.9, 0.5) * (1.0 - clamp(g, 0.0, 1.0) * 0.55) - algae * vec3(0.06, 0.03, 0.07);
  vec3 dirty = mix(darkGrime, dustHaze, uGlassy);
  float dl = dot(dirty, vec3(0.299, 0.587, 0.114));
  dirty = mix(vec3(dl), dirty, 0.4);

  // wet: darker, more saturated, with a soft sheen
  vec3 wetImg = img * 0.78;
  float wl = dot(wetImg, vec3(0.299, 0.587, 0.114));
  wetImg = mix(vec3(wl), wetImg, 1.25) + vec3(0.7, 0.8, 0.85) * pow(fbm(uv * 30.0 + uTime * 0.3), 4.0) * 0.25;
  vec3 cleanImg = mix(img, wetImg, wet);
  vec3 col = mix(dirty, cleanImg, clean);

  // the line where clean meets dirty carries a little foam
  float front = (1.0 - smoothstep(0.0, 0.035, abs(since))) * step(j, floor(uS)) * step(floor(uS) - 0.5, j) * uJet;
  col += vec3(0.85) * front * smoothstep(0.55, 0.9, noise(uv * 220.0)) * 0.6;

  col += jet(uv, uHead, aspect, uJet);
  col += jet(uv, uUserHead, aspect, uUserJet);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Jet head position on the path (uv), for a path position s in [0, LANES]. */
export function headAt(s: number): { x: number; y: number } {
  const j = Math.min(LANES - 1, Math.floor(s));
  const f = clamp(s - j);
  const x = j % 2 === 0 ? f : 1 - f;
  return { x, y: 1 - (j + 0.5) / LANES };
}

/** Within one service's share of the take: lanes run from 0.06 to 0.8, then it holds clean. */
export function laneS(q: number): number {
  return LANES * smooth(clamp((q - 0.06) / 0.74)) * 1.0001;
}

export class JetScene extends GLStage {
  private mat: THREE.ShaderMaterial;
  private userRT: THREE.WebGLRenderTarget;
  private paintMat: THREE.ShaderMaterial;
  private paintScene = new THREE.Scene();
  private photos: (THREE.Texture | null)[] = new Array(SVC_COUNT).fill(null);
  private current = -1;
  private last: { x: number; y: number } | null = null;
  private userJet = 0;
  private dip = 0;
  /** set by the section each frame: which service and how far through it */
  index = 0;
  q = 0;
  hovering = false;
  private urls: string[];

  constructor(canvas: HTMLCanvasElement, take: Take, names: string[]) {
    super(canvas, take, { samples: 0, maxDpr: 1.5, post: { bloom: 0.55, threshold: 1.0, flare: 0.25, vignette: 0.28, grain: 0.04, exposure: 1.04 } });
    const small = matchMedia('(max-width: 860px)').matches;
    this.urls = names.map((n) => `/media/img/${n}${small ? '-900' : ''}.webp`);
    this.userRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const quad = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPhoto: { value: null }, tGrimeG: { value: null }, tGrimeC: { value: null }, tUser: { value: this.userRT.texture },
        uRes: { value: new THREE.Vector2(1, 1) }, uPhotoAspect: { value: 16 / 9 }, uTime: { value: 0 },
        uS: { value: 0 }, uGlassy: { value: 1 }, uTint: { value: new THREE.Color() }, uSeed: { value: 0 },
        uHead: { value: new THREE.Vector2(-1, -1) }, uJet: { value: 0 },
        uUserHead: { value: new THREE.Vector2(-1, -1) }, uUserJet: { value: 0 },
      },
    });
    const m = new THREE.Mesh(quad, this.mat);
    m.frustumCulled = false;
    this.scene.add(m);
    this.paintMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: PAINT, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uSeg: { value: new THREE.Vector4() }, uHalfW: { value: 0.05 }, uAspect: { value: 1 } },
    });
    const pm = new THREE.Mesh(quad, this.paintMat);
    pm.frustumCulled = false;
    this.paintScene.add(pm);
    this.disposables.push(this.userRT, this.paintMat, quad);
  }

  override async load(): Promise<void> {
    const [g, c, first] = await Promise.all([
      loadTexture('/media/img/tex-grime.webp', { repeat: true }),
      loadTexture('/media/img/tex-concrete.webp', { repeat: true }),
      loadTexture(this.urls[0]!),
    ]);
    g.colorSpace = THREE.NoColorSpace;
    c.colorSpace = THREE.NoColorSpace;
    this.mat.uniforms.tGrimeG!.value = g;
    this.mat.uniforms.tGrimeC!.value = c;
    this.photos[0] = first;
    this.setService(0);
    // the rest arrive in the background, nearest first
    this.urls.slice(1).forEach((u, i) => loadTexture(u).then((t) => (this.photos[i + 1] = t)).catch(() => undefined));
  }

  protected override onResize(): void {
    if (!this.mat) return;
    const s = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(s);
    this.mat.uniforms.uRes!.value.copy(s);
    this.userRT.setSize(Math.max(2, s.x >> 1), Math.max(2, s.y >> 1));
    this.clearUser();
  }

  private clearUser(): void {
    const r = this.renderer;
    r.setRenderTarget(this.userRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.setRenderTarget(null);
  }

  private setService(i: number): void {
    const tex = this.photos[i] ?? this.photos[this.current] ?? this.photos[0];
    if (!tex) return;
    const u = this.mat.uniforms;
    u.tPhoto!.value = tex;
    const img = tex.image as { width: number; height: number } | undefined;
    if (img?.width) u.uPhotoAspect!.value = img.width / img.height;
    u.uGlassy!.value = GLASSY[i] ?? 1;
    (u.uTint!.value as THREE.Color).setRGB(...(TINT[i] as [number, number, number]));
    u.uSeed!.value = i * 1.37;
    if (this.photos[i]) this.current = i;
  }

  update(time: number, dt: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    // a cut between services: swap the plate under a short exposure dip, wipe the pointer's lanes
    if (this.index !== this.current && this.photos[this.index]) {
      if (this.current >= 0) {
        this.dip = 1;
        this.clearUser();
      }
      this.setService(this.index);
    }
    this.dip = Math.max(0, this.dip - dt * 3.5);
    this.post.opts.exposure = 1.04 * (1 - this.dip * 0.55);
    const s = laneS(this.q);
    u.uS!.value = s;
    const h = headAt(Math.min(s, LANES - 0.0001));
    (u.uHead!.value as THREE.Vector2).set(h.x, h.y);
    u.uJet!.value = s > 0.001 && s < LANES - 0.001 ? 1 : 0;

    // the pointer's nozzle
    const r = this.canvas.getBoundingClientRect();
    const inside = pointer.active && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
    this.hovering = inside;
    const fresh = performance.now() - pointer.moved < 120;
    if (inside) {
      const x = (pointer.x - r.left) / r.width;
      const y = 1 - (pointer.y - r.top) / r.height;
      (u.uUserHead!.value as THREE.Vector2).set(x, y);
      if (fresh && this.last) this.paint(this.last, { x, y });
      this.last = { x, y };
    } else this.last = null;
    this.userJet = lerp(this.userJet, inside && fresh ? 1 : 0, Math.min(1, dt * (inside && fresh ? 14 : 5)));
    u.uUserJet!.value = this.userJet;
  }

  private paint(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const r = this.renderer;
    const asp = this.aspect;
    const pu = this.paintMat.uniforms;
    pu.uAspect!.value = asp;
    pu.uHalfW!.value = 0.06;
    // accumulate the strokes: no auto-clear for this render
    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.userRT);
    (pu.uSeg!.value as THREE.Vector4).set(a.x * asp, a.y, b.x * asp + 1e-4, b.y);
    r.render(this.paintScene, this.camera);
    r.setRenderTarget(null);
    r.autoClear = auto;
  }

  override async compile(): Promise<void> {
    await this.renderer.compileAsync(this.paintScene, this.camera);
    await super.compile();
  }
}
