// TAKE 1 · Locked-off fan stroke.
// The commercial plays behind a pane of dusty glass with dried hard-water rings. When the preloader
// has completely drained away, a brass squeegee comes in at the top left and cleans the pane in one
// continuous fan stroke: three passes, pivoting on the blade's lower end at each edge, the way a
// window cleaner turns the blade without lifting it. A bead of water (the meniscus) rides ahead of
// the rubber and refracts the film; behind it the glass is wet for a moment, then dry and invisible.
// At each turn the blade leaves a little water that runs down as drips.
//
// Layers, back to front: the film (cover-fit video texture) · a faint diagonal sheen of reflected
// sky · grime and hard-water rings, lifting the blacks and diffusing the film · the wet film behind
// the blade · the bead · the rubber and the brass channel · drips. The wordmark in the DOM widens
// letter by letter as the blade passes over it (index of passes exported for the DOM).
import * as THREE from 'three';
import { GLStage } from '../gl/stage';
import type { Take } from '../core/scroll';
import { loadTexture } from '../core/assets';
import { clamp, smooth, lerp, isTouch, prefersReducedMotion } from '../core/util';

/** seconds per unit in the mask's wipe-time channel */
const STAMP = 1024;
import { pointer } from '../core/cursor';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Paints the blade's footprint into the wipe mask: R = cleaned, G = time it was last wiped (s / 1024,
// max-blended so the latest wipe wins; half float keeps that to about half a second).
const PAINT_FRAG = /* glsl */ `
uniform vec4 uSeg; // a.xy, b.xy in aspect-corrected units (x * aspect)
uniform float uHalfW; uniform float uAspect; uniform float uStamp;
varying vec2 vUv;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float d = sdSeg(p, uSeg.xy, uSeg.zw);
  float m = 1.0 - smoothstep(uHalfW * 0.6, uHalfW, d);
  if (m <= 0.0) discard;
  gl_FragColor = vec4(m, m * uStamp, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tFilm; uniform sampler2D tGrime; uniform sampler2D tMask;
uniform vec2 uRes; uniform float uTime; uniform float uIntroT; uniform float uFilmAspect; uniform float uFilmOn;
uniform vec4 uBlade; // centre xy (aspect units), angle (rad from vertical), half length
uniform float uBladeOn; uniform vec2 uDir; // travel direction (unit, aspect units)
uniform float uScroll; uniform vec2 uPointer; uniform float uDew;
uniform vec4 uDrips[3]; // x, y-start, t-start, size
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }

vec2 coverUv(vec2 uv) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > uFilmAspect ? vec2(1.0, uFilmAspect / sa) : vec2(sa / uFilmAspect, 1.0);
  // the camera eases back a touch as you scroll away
  float z = 1.0 + uScroll * 0.08;
  return (uv - 0.5) * s / z + 0.5 + uPointer * 0.006;
}
vec3 film(vec2 uv) { return texture2D(tFilm, clamp(coverUv(uv), 0.001, 0.999)).rgb * uFilmOn; }
// dust diffuses: a small blur that grows with the grime
vec3 filmSoft(vec2 uv, float r) {
  vec2 px = r / uRes;
  vec3 c = film(uv) * 0.28;
  c += film(uv + vec2(px.x, 0.0)) * 0.18 + film(uv - vec2(px.x, 0.0)) * 0.18;
  c += film(uv + vec2(0.0, px.y)) * 0.18 + film(uv - vec2(0.0, px.y)) * 0.18;
  return c;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec4 mask = texture2D(tMask, uv);
  float clean = mask.r;
  float age = uIntroT - mask.g * 1024.0;
  float wet = clean * exp(-max(age, 0.0) * 1.6) * step(0.0005, mask.g + clean * 0.0);

  // grime: dust film and dried rings from the texture, varied with a slow noise so it never tiles
  vec2 gp = vec2(uv.x * aspect, uv.y) * 0.78;
  float g = texture2D(tGrime, gp).r;
  float g2 = texture2D(tGrime, gp * 2.3 + 0.37).r;
  float n = noise(uv * vec2(5.0, 3.0));
  float grime = clamp((g * 1.35 + g2 * 0.35) * (0.55 + n * 0.7) - 0.06, 0.0, 1.0);
  // streaks: dried runs from the head of the frame
  float runs = smoothstep(0.75, 1.0, noise(vec2(uv.x * 46.0, uv.y * 1.4))) * smoothstep(0.0, 0.9, uv.y) * 0.5;
  float dirt = clamp(grime + runs, 0.0, 1.0) * (1.0 - clean);

  // wet glass right behind the blade: the water sheet wobbles the image as it runs down
  vec2 flow = vec2(noise(vec2(uv.x * 40.0, uv.y * 8.0 + uIntroT * 3.0)) - 0.5, noise(vec2(uv.x * 30.0 + 7.0, uv.y * 6.0 + uIntroT * 2.5)) - 0.5);
  vec2 fuv = uv + flow * wet * 0.006;

  vec3 col = mix(film(fuv), filmSoft(fuv, 3.5), smoothstep(0.05, 0.6, dirt));
  // dust scatters light: lifts the blacks, desaturates, and warms slightly
  vec3 dustCol = vec3(0.58, 0.55, 0.5);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), dirt * 0.45);
  col = col * (1.0 - dirt * 0.42) + dustCol * dirt * 0.36;
  // hard-water rings catch the light a little brighter than the film
  col += vec3(0.85, 0.82, 0.76) * smoothstep(0.55, 0.9, g) * (1.0 - clean) * 0.22;
  // dew: before sunrise the clean glass slowly mists over again (8 to 30 s after it was last wiped):
  // the image softens, lifts and cools, and micro-droplets catch the light. The pointer wipes it.
  float dew = uDew * clean * smoothstep(8.0, 30.0, age) * 0.62;
  if (dew > 0.002) {
    vec3 fog = filmSoft(uv, 8.0);
    float fl = dot(fog, vec3(0.299, 0.587, 0.114));
    fog = mix(fog, vec3(fl), 0.4) * 0.74 + vec3(0.36, 0.41, 0.45) * 0.32;
    float beads = smoothstep(0.86, 0.97, noise(uv * uRes / 3.2)) + smoothstep(0.9, 0.99, noise(uv * uRes / 9.0 + 3.7)) * 0.6;
    fog += vec3(0.86, 0.92, 0.96) * beads * 0.14;
    col = mix(col, fog, dew);
  }
  // wet sheen
  col += vec3(0.75, 0.86, 0.9) * wet * 0.05 * (0.5 + flow.x);

  // reflected sky: a broad diagonal sheen that clean glass still carries
  float sheen = smoothstep(0.32, 0.0, abs((uv.x + uv.y * 0.55) - 0.95 - uPointer.x * 0.04));
  col += vec3(0.6, 0.72, 0.8) * sheen * (0.035 + uScroll * 0.05);

  // ---- the squeegee ----
  if (uBladeOn > 0.0) {
    vec2 c = uBlade.xy;
    float a = uBlade.z;
    vec2 along = vec2(sin(a), cos(a));
    vec2 across = vec2(along.y, -along.x);
    // across points toward the direction of travel
    if (dot(across, uDir) < 0.0) across = -across;
    vec2 q = p - c;
    float u = dot(q, along) / uBlade.w;
    float v = dot(q, across) * uRes.y; // pixels ahead (+) / behind (-) the rubber edge
    float inside = 1.0 - smoothstep(0.985, 1.0, abs(u));
    float k = uRes.y / 1080.0;
    float bw = 11.0 * k, rw = 8.0 * k, cw = 26.0 * k;
    if (inside > 0.0) {
      // bead: a cylinder of water ahead of the rubber. Refracts (and flips) the film across it.
      if (v > 0.0 && v < bw) {
        float x = v / bw * 2.0 - 1.0;
        float h = sqrt(max(0.0, 1.0 - x * x));
        vec2 off = across * (-x * 26.0 / uRes.y) / vec2(aspect, 1.0);
        vec3 refr = film(uv + off) * 1.05;
        float spec = pow(max(0.0, 1.0 - abs(x + 0.45) * 3.2), 6.0);
        vec3 bead = refr * (0.75 + 0.35 * h) + vec3(1.0, 0.97, 0.9) * spec * 2.6;
        col = mix(col, bead, inside * smoothstep(0.0, 1.2, v) * smoothstep(bw, bw - 1.2, v));
      } else if (v <= 0.0 && v > -rw) {
        // rubber: black with a thin wet highlight on its edge
        float e = smoothstep(-1.4, 0.0, v);
        col = mix(col, vec3(0.012) + vec3(0.5, 0.55, 0.55) * e * 0.4, inside);
      } else if (v <= -rw && v > -rw - cw) {
        // brass channel: brushed metal with a raking key light down its length
        float y = (v + rw) / -cw;
        float ridge = pow(1.0 - abs(y - 0.3) * 2.0, 3.0);
        float brush = noise(vec2(u * 400.0, y * 3.0)) * 0.12;
        vec3 brass = vec3(0.72, 0.53, 0.26) * (0.35 + 0.65 * smoothstep(1.0, 0.0, y)) + vec3(1.0, 0.86, 0.6) * max(ridge, 0.0) * 1.8;
        brass *= 0.85 + brush + 0.25 * sin(u * 3.0 + 1.0);
        col = mix(col, brass, inside * smoothstep(-rw - cw, -rw - cw + 1.5, v));
      }
      // the handle: brass clamp, then a black grip, trailing behind the middle of the channel
      float hp = abs(u) * uBlade.w * uRes.y; // px from the channel's centre along the blade
      float back = -(v + rw + cw);           // px behind the channel
      float hw = 14.0 * k;
      if (back > 0.0 && back < 230.0 * k && hp < hw) {
        float x = hp / hw;
        float cyl = sqrt(max(0.0, 1.0 - x * x));
        vec3 hcol = back < 46.0 * k
          ? vec3(0.62, 0.45, 0.22) * (0.4 + 0.8 * cyl) + vec3(1.0, 0.85, 0.55) * pow(cyl, 12.0) * 1.4
          : vec3(0.02) + vec3(0.32, 0.34, 0.36) * pow(cyl, 7.0) * 0.6;
        float tip = smoothstep(230.0 * k, 222.0 * k, back);
        col = mix(col, hcol, smoothstep(hw, hw - 1.5, hp) * tip);
      }
      // soft shadow of the blade on the film just behind it
      col *= 1.0 - inside * 0.35 * smoothstep(-rw - cw - 26.0 * k, -rw - cw, v) * step(v, -rw - cw);
    }
  }

  // drips left at the turns: a bead with a thin trail, falling under gravity
  for (int i = 0; i < 3; i++) {
    vec4 d = uDrips[i];
    if (d.w <= 0.0) continue;
    float t = uIntroT - d.z;
    if (t < 0.0) continue;
    float y = d.y - min(t * t * 0.09 + t * 0.03, 1.4);
    vec2 dp = vec2(d.x * aspect, y);
    vec2 r = (p - dp) * uRes.y;
    float size = d.w * uRes.y / 1080.0;
    float drop = 1.0 - smoothstep(size * 0.8, size, length(r * vec2(1.0, 0.8)));
    float trail = (1.0 - smoothstep(size * 0.18, size * 0.32, abs(r.x))) * step(0.0, r.y) * step(r.y, (d.y - y) * uRes.y) * 0.5;
    float m = max(drop, trail);
    if (m > 0.0) {
      vec3 refr = film(uv - r / uRes * 0.6) * 1.1 + vec3(1.0) * pow(max(0.0, 1.0 - length(r - vec2(-size * 0.3, size * 0.35)) / (size * 0.35)), 3.0) * 1.8 * drop;
      col = mix(col, refr, m);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}`;

export interface BladePose {
  x: number; // uv x
  y: number; // uv y (0 = bottom)
  a: number; // radians from vertical
  len: number; // half length, uv-y units
  on: boolean;
}

/** The fan stroke timing (seconds of intro time). Three passes, two pivots. */
export const STROKE = {
  start: 0.25,
  pass: 0.78,
  pivot: 0.32,
  get end(): number {
    return this.start + this.pass * 3 + this.pivot * 2 + 0.3;
  },
};

const TILT = 0.2;
/** half length chosen so the three bands (each 2·L·cos(tilt) tall) tile the frame with margin */
const HALF = 0.18 / Math.cos(TILT);

/**
 * The fan stroke as a pure function of intro time. In a pass the blade travels broadside with its
 * top leaning into the direction of travel; at the frame edge it pivots about its lower end through
 * π − 2·tilt, which brings it down exactly one band, leaning the other way, and sets off back.
 */
export function bladeAt(t: number, aspect: number): BladePose {
  const L = HALF;
  const s = 2 * L * Math.cos(TILT);
  const y0 = 1.02 - L * Math.cos(TILT);
  const xl = -0.06, xr = 1.06;
  const { start, pass, pivot } = STROKE;
  let tt = t - start;
  if (tt < 0) return { x: xl - 0.3, y: y0, a: TILT, len: L, on: false };
  for (let i = 0; i < 3; i++) {
    const right = i % 2 === 0;
    const y = y0 - s * i;
    const a = right ? TILT : -TILT;
    if (tt <= pass) {
      const k = smooth(clamp(tt / pass));
      return { x: right ? lerp(xl, xr, k) : lerp(xr, xl, k), y, a, len: L, on: true };
    }
    tt -= pass;
    if (i === 2) return { x: xr + Math.min(0.4, tt * 1.4), y, a, len: L, on: tt < 0.3 };
    if (tt <= pivot) {
      const k = smooth(clamp(tt / pivot));
      const ex = right ? xr : xl;
      // lower end of the blade, the pivot
      const px = ex - (L * Math.sin(a)) / aspect;
      const py = y - L * Math.cos(a);
      const ang = a + (right ? 1 : -1) * (Math.PI - 2 * TILT) * k;
      return { x: px + (L * Math.sin(ang)) / aspect, y: py + L * Math.cos(ang), a: ang, len: L, on: true };
    }
    tt -= pivot;
  }
  return { x: xr + 1, y: y0 - s * 2, a: TILT, len: L, on: false };
}

export class HeroScene extends GLStage {
  private mat: THREE.ShaderMaterial;
  private maskRT: THREE.WebGLRenderTarget;
  private paintMat: THREE.ShaderMaterial;
  private paintScene = new THREE.Scene();
  private copyScene = new THREE.Scene();
  private copyMat: THREE.ShaderMaterial;
  private videoTex: THREE.VideoTexture;
  introT = -1;
  private last: BladePose | null = null;
  /** dew and the pointer's squeegee: pointer devices only, never with reduced motion */
  private dewOn = !isTouch() && !prefersReducedMotion();
  private lastPtr: { x: number; y: number } | null = null;
  /** blade position in screen pixels for the DOM (wordmark), or null */
  bladePx: { x: number; y: number; pass: number } | null = null;
  scrollP = 0;

  constructor(canvas: HTMLCanvasElement, take: Take, private video: HTMLVideoElement) {
    super(canvas, take, { samples: 0, maxDpr: 1.5, post: { bloom: 0.7, threshold: 1.15, flare: 0.55, flareTint: new THREE.Color(1, 0.86, 0.64), vignette: 0.42, grain: 0.05, exposure: 1.02 } });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.videoTex = new THREE.VideoTexture(video);
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
    this.videoTex.minFilter = THREE.LinearFilter;
    this.videoTex.magFilter = THREE.LinearFilter;
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
    const quad = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tFilm: { value: this.videoTex },
        tGrime: { value: null },
        tMask: { value: this.maskRT.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uIntroT: { value: 0 },
        uFilmAspect: { value: 16 / 9 },
        uFilmOn: { value: 0 },
        uBlade: { value: new THREE.Vector4(-1, 0.5, 0, 0.2) },
        uBladeOn: { value: 0 },
        uDir: { value: new THREE.Vector2(1, 0) },
        uScroll: { value: 0 },
        uPointer: { value: new THREE.Vector2() },
        uDrips: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uDew: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(quad, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.paintMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PAINT_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: { uSeg: { value: new THREE.Vector4() }, uHalfW: { value: 0.02 }, uAspect: { value: 1 }, uStamp: { value: 0 } },
    });
    const pm = new THREE.Mesh(quad, this.paintMat);
    pm.frustumCulled = false;
    this.paintScene.add(pm);
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = texture2D(tMap, vUv); }',
      depthTest: false,
      depthWrite: false,
      uniforms: { tMap: { value: null } },
    });
    const cm = new THREE.Mesh(quad, this.copyMat);
    cm.frustumCulled = false;
    this.copyScene.add(cm);
    this.disposables.push(this.videoTex, this.paintMat, this.copyMat, quad, { dispose: () => this.maskRT.dispose() });
  }

  override async load(): Promise<void> {
    const g = await loadTexture('/media/img/tex-grime.webp', { repeat: true });
    g.colorSpace = THREE.NoColorSpace;
    g.needsUpdate = true;
    this.mat.uniforms.tGrime!.value = g;
  }

  protected override onResize(): void {
    if (!this.mat) return;
    const s = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(s);
    this.mat.uniforms.uRes!.value.copy(s);
    // the mask lives at half the canvas's CSS size, so the adaptive resolution loop never touches
    // it; a real resize copies what has been wiped into the new target instead of clearing it
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width / 2)), h = Math.max(2, Math.round(r.height / 2));
    if (this.maskRT.width !== w || this.maskRT.height !== h) {
      const old = this.maskRT;
      const next = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
      const fresh = old.width <= 2;
      this.maskRT = next;
      this.mat.uniforms.tMask!.value = next.texture;
      if (fresh) this.clearMask(this.introT > STROKE.end ? 1 : 0);
      else {
        this.copyMat.uniforms.tMap!.value = old.texture;
        this.renderer.setRenderTarget(next);
        this.renderer.render(this.copyScene, this.camera);
        this.renderer.setRenderTarget(null);
      }
      old.dispose();
    }
  }

  private clearMask(v: number): void {
    const r = this.renderer;
    const prev = r.getClearColor(new THREE.Color());
    const prevA = r.getClearAlpha();
    r.setRenderTarget(this.maskRT);
    r.setClearColor(new THREE.Color(v, 0, 0), 1);
    r.clear(true, false, false);
    r.setRenderTarget(null);
    r.setClearColor(prev, prevA);
  }

  /** Start the fan stroke (call only once the preloader has completely cleared). */
  play(): void {
    this.introT = 0;
    this.clearMask(0);
    this.mat.uniforms.uFilmOn!.value = 1;
    this.video.currentTime = 0;
    this.video.play().catch(() => undefined);
  }

  /** Reduced motion or a late start: show the pane already clean. */
  skip(): void {
    this.introT = STROKE.end + 10;
    this.clearMask(1);
    this.mat.uniforms.uFilmOn!.value = 1;
    this.video.play().catch(() => undefined);
  }

  get aspectRatio(): number {
    return this.aspect;
  }

  private paint(a: BladePose, b: BladePose, t: number): void {
    const asp = this.aspect;
    const r = this.renderer;
    // accumulate: three clears the target before every render() unless autoClear is off
    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.maskRT);
    const steps = 14;
    const u = this.paintMat.uniforms;
    u.uAspect!.value = asp;
    u.uHalfW!.value = 0.018;
    u.uStamp!.value = clamp(t / STAMP);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k), ang = lerp(a.a, b.a, k);
      const L = b.len;
      const cx = x * asp, cy = y;
      (u.uSeg!.value as THREE.Vector4).set(cx - Math.sin(ang) * L, cy - Math.cos(ang) * L, cx + Math.sin(ang) * L, cy + Math.cos(ang) * L);
      r.render(this.paintScene, this.camera);
    }
    r.setRenderTarget(null);
    r.autoClear = auto;
  }

  update(time: number, dt: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    u.uScroll!.value = this.scrollP;
    const pv = u.uPointer!.value as THREE.Vector2;
    pv.x += (pointer.nx * 0.5 - pv.x) * Math.min(1, dt * 3);
    pv.y += (pointer.ny * 0.5 - pv.y) * Math.min(1, dt * 3);
    const v = this.video;
    if (v.videoWidth) u.uFilmAspect!.value = v.videoWidth / v.videoHeight;
    if (this.introT >= 0) {
      this.introT += dt;
      const t = this.introT;
      u.uIntroT!.value = t;
      const pose = bladeAt(t, this.aspect);
      if (pose.on && t <= STROKE.end) {
        if (this.last) this.paint(this.last, pose, t);
        this.last = pose;
        (u.uBlade!.value as THREE.Vector4).set(pose.x * this.aspect, pose.y, pose.a, pose.len);
        // the side of the rubber that leads: the direction the blade's centre is moving
        const ahead = bladeAt(t + 0.02, this.aspect);
        const dx = (ahead.x - pose.x) * this.aspect, dy = ahead.y - pose.y;
        if (Math.hypot(dx, dy) > 1e-5) (u.uDir!.value as THREE.Vector2).set(dx, dy).normalize();
        u.uBladeOn!.value = 1;
        const pass = t < STROKE.start + STROKE.pass ? 0 : t < STROKE.start + STROKE.pass * 2 + STROKE.pivot ? 1 : 2;
        const r = this.canvas.getBoundingClientRect();
        this.bladePx = { x: pose.x * r.width, y: (1 - pose.y) * r.height, pass };
      } else {
        u.uBladeOn!.value = 0;
        if (t > STROKE.end && this.last) {
          // make sure nothing was missed at the frame edges
          this.clearMaskSoft();
          this.last = null;
        }
        this.bladePx = pose.on ? this.bladePx : null;
      }
      // after the stroke: dew forms, and the pointer is a squeegee that wipes it away
      if (this.dewOn && t > STROKE.end + 0.4) {
        u.uDew!.value = 1;
        const r = this.canvas.getBoundingClientRect();
        const inside = pointer.active && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
        const fresh = performance.now() - pointer.moved < 100;
        if (inside && fresh) {
          const pt = { x: (pointer.x - r.left) / r.width, y: 1 - (pointer.y - r.top) / r.height };
          if (this.lastPtr) this.wipe(this.lastPtr, pt, t);
          this.lastPtr = pt;
        } else if (!inside) this.lastPtr = null;
      }
      // drips where the blade turned
      const drips = u.uDrips!.value as THREE.Vector4[];
      const t1 = STROKE.start + STROKE.pass;
      const t2 = t1 + STROKE.pivot + STROKE.pass;
      drips[0]!.set(0.965, 0.62, t1 + 0.2, 9);
      drips[1]!.set(0.035, 0.28, t2 + 0.2, 7);
      drips[2]!.set(0.71, 0.86, t1 - 0.25, 5);
    }
  }

  /** the pointer's blade: a short squeegee held broadside to its own motion */
  private wipe(a: { x: number; y: number }, b: { x: number; y: number }, t: number): void {
    const asp = this.aspect;
    const dx = (b.x - a.x) * asp, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return;
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.maskRT);
    const u = this.paintMat.uniforms;
    u.uAspect!.value = asp;
    u.uHalfW!.value = 0.012;
    u.uStamp!.value = clamp(t / STAMP);
    // blade direction: perpendicular to the stroke
    const nx = -dy / dist, ny = dx / dist;
    const L = 0.075;
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / 0.008)));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const cx = (a.x + (b.x - a.x) * k) * asp, cy = a.y + (b.y - a.y) * k;
      (u.uSeg!.value as THREE.Vector4).set(cx - nx * L, cy - ny * L, cx + nx * L, cy + ny * L);
      r.render(this.paintScene, this.camera);
    }
    r.setRenderTarget(null);
    r.autoClear = auto;
  }

  private clearMaskSoft(): void {
    // after the stroke the whole pane counts as clean, keeping each pixel's wipe time
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.maskRT);
    const u = this.paintMat.uniforms;
    u.uAspect!.value = this.aspect;
    u.uHalfW!.value = 4;
    u.uStamp!.value = 0;
    (u.uSeg!.value as THREE.Vector4).set(0.5 * this.aspect, 0.5, 0.5 * this.aspect + 0.001, 0.5);
    r.render(this.paintScene, this.camera);
    r.setRenderTarget(null);
    r.autoClear = auto;
  }

  override async compile(): Promise<void> {
    await this.renderer.compileAsync(this.paintScene, this.camera);
    await this.renderer.compileAsync(this.copyScene, this.camera);
    await super.compile();
  }
}
