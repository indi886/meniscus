// Lightweight cinematic post for every scene: HDR scene target (MSAA on desktop) → bright pass →
// two-level separable bloom → horizontal anamorphic streak → composite (exposure, ACES filmic,
// vignette, live film grain, sRGB). Three programs in total; UnrealBloomPass compiles about eight
// and dominates boot on this machine's Iris Xe (see README, "Performance").
// Optional (one scene): a thin-lens depth of field. The scene's depth gives each pixel a signed
// circle of confusion from the real lens (focal length, f-stop, focus distance, 24 mm gate); a
// half-res pass gathers along a golden-angle spiral so out-of-focus highlights open into round
// bokeh, and the composite blends it back by CoC, with a little lateral chromatic aberration and
// an optional heat-shimmer warp.
import * as THREE from 'three';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
uniform sampler2D tMap; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(24.0)), 1.0);
}`;

// 9-tap gaussian folded into 5 bilinear fetches
const BLUR = /* glsl */ `
uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846; vec2 o2 = uDir * 3.2307692308;
  c += texture2D(tMap, vUv + o1).rgb * 0.3162162162;
  c += texture2D(tMap, vUv - o1).rgb * 0.3162162162;
  c += texture2D(tMap, vUv + o2).rgb * 0.0702702703;
  c += texture2D(tMap, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COC = /* glsl */ `
uniform sampler2D tMap; uniform sampler2D tDepth; uniform vec2 uTexel;
uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uK; uniform float uMax;
varying vec2 vUv;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  vec3 c = texture2D(tMap, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tMap, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tMap, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tMap, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float z = linZ(texture2D(tDepth, vUv).r);
  float coc = clamp(uK * (z - uFocus) / z, -uMax, uMax);
  gl_FragColor = vec4(min(c, vec3(40.0)), coc);
}`;

const BOKEH = /* glsl */ `
uniform sampler2D tMap; uniform vec2 uPx; uniform float uMax;
varying vec2 vUv;
void main() {
  vec4 cc = texture2D(tMap, vUv);
  float cs = abs(cc.a);
  vec3 acc = cc.rgb; float tot = 1.0; float cAcc = cs;
  float r = 0.5; float ang = 0.0;
  for (int i = 0; i < 64; i++) {
    if (r >= uMax) break;
    vec4 s = texture2D(tMap, vUv + vec2(cos(ang), sin(ang)) * uPx * r);
    float ss = abs(s.a);
    if (s.a > cc.a) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(r - 0.5, r + 0.5, ss);
    acc += mix(acc / tot, s.rgb, m);
    cAcc += mix(cAcc / tot, ss, m);
    tot += 1.0;
    r += 1.15 / r;
    ang += 2.39996323;
  }
  gl_FragColor = vec4(acc / tot, cAcc / tot);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB; uniform sampler2D tStreak;
uniform float uBloom; uniform float uFlare; uniform vec3 uFlareTint; uniform float uExposure;
uniform float uVignette; uniform float uGrain; uniform float uTime; uniform vec2 uRes; uniform float uFade;
uniform vec3 uLift; uniform float uSat;
uniform float uCA; uniform float uWarp; uniform vec2 uWarpC; uniform float uWarpR;
#ifdef USE_DOF
uniform sampler2D tDepth; uniform sampler2D tDof; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uK;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
#endif
varying vec2 vUv;
vec3 aces(vec3 x) {
  // Narkowicz ACES fit with a gentle toe so blacks stay inky
  x *= 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  if (uWarp > 0.0) {
    // rising heat shimmer inside a soft ellipse
    vec2 d = (uv - uWarpC) * vec2(uRes.x / uRes.y, 1.0);
    float w = uWarp * smoothstep(uWarpR, 0.0, length(d * vec2(1.0, 0.6)));
    uv += vec2(sin(uv.y * 90.0 - uTime * 9.0 + sin(uv.x * 40.0) * 2.0), cos(uv.x * 70.0 - uTime * 7.0)) * w * 0.004;
  }
  // lateral CA grows with the square of the radius: clean centre, faint fringes in the corners
  vec2 ca = (uv - 0.5) * dot(uv - 0.5, uv - 0.5) * uCA * 4.0;
  vec3 c = vec3(texture2D(tScene, uv + ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv - ca).b);
#ifdef USE_DOF
  float z = linZ(texture2D(tDepth, uv).r);
  float coc = abs(uK * (z - uFocus) / z);
  vec4 dof = texture2D(tDof, uv);
  c = mix(c, dof.rgb, smoothstep(0.55, 1.6, max(coc * 0.5, dof.a)));
#endif
  vec3 bloom = texture2D(tBloomA, uv).rgb * 0.55 + texture2D(tBloomB, uv).rgb * 0.75;
  vec3 streak = texture2D(tStreak, uv).rgb;
  c += bloom * uBloom + streak * uFlare * uFlareTint;
  c *= uExposure;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c += uLift * (1.0 - l);
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y * 0.82;
  c *= mix(1.0, smoothstep(0.95, 0.18, length(q)), uVignette);
  c = toSRGB(clamp(c, 0.0, 1.0));
  float g = hash(vUv * uRes + fract(uTime * 7.31) * 113.0) - 0.5;
  c += g * uGrain * (0.55 + 0.45 * (1.0 - l));
  gl_FragColor = vec4(c * uFade, 1.0);
}`;

export interface PostOptions {
  bloom: number;
  threshold: number;
  flare: number;
  flareTint: THREE.Color;
  exposure: number;
  vignette: number;
  grain: number;
  fade: number;
  lift: THREE.Color;
  saturation: number;
  /** depth of field (only when the Post was built with dof): focus distance m, f-stop, lens mm, amount */
  focus: number;
  fstop: number;
  focalMM: number;
  dof: number;
  /** lateral chromatic aberration at the frame edge */
  ca: number;
  /** heat shimmer: amount, centre (uv) and radius (fraction of height) */
  warp: number;
  warpC: THREE.Vector2;
  warpR: number;
}

export class Post {
  readonly opts: PostOptions;
  private scene: THREE.WebGLRenderTarget;
  private half: THREE.WebGLRenderTarget[];
  private eighth: THREE.WebGLRenderTarget[];
  private streak: THREE.WebGLRenderTarget[];
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mBright: THREE.ShaderMaterial;
  private mBlur: THREE.ShaderMaterial;
  private mComp: THREE.ShaderMaterial;
  private w = 1;
  private h = 1;
  private useDof: boolean;
  private dofRT: THREE.WebGLRenderTarget[] = [];
  private mCoc: THREE.ShaderMaterial | null = null;
  private mBokeh: THREE.ShaderMaterial | null = null;
  private readonly maxCoc = 12;

  constructor(samples: number, opts: Partial<PostOptions> = {}, features: { dof?: boolean } = {}) {
    this.useDof = !!features.dof;
    this.opts = {
      bloom: 0.9,
      threshold: 1.0,
      flare: 0.35,
      flareTint: new THREE.Color(1.0, 0.72, 0.42),
      exposure: 1.0,
      vignette: 0.55,
      grain: 0.045,
      fade: 1,
      lift: new THREE.Color(0, 0, 0),
      saturation: 1,
      focus: 3,
      fstop: 2.8,
      focalMM: 35,
      dof: 0,
      ca: 0,
      warp: 0,
      warpC: new THREE.Vector2(0.5, 0.5),
      warpR: 0.2,
      ...opts,
    };
    const rt = (s = 0) =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: s, depthBuffer: s > 0 || false, colorSpace: THREE.LinearSRGBColorSpace });
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    if (this.useDof) {
      this.scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      this.dofRT = [rt(), rt()];
      this.mCoc = new THREE.ShaderMaterial({
        vertexShader: FS_VERT, fragmentShader: COC, depthTest: false, depthWrite: false,
        uniforms: { tMap: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 3 }, uK: { value: 0 }, uMax: { value: this.maxCoc } },
      });
      this.mBokeh = new THREE.ShaderMaterial({
        vertexShader: FS_VERT, fragmentShader: BOKEH, depthTest: false, depthWrite: false,
        uniforms: { tMap: { value: null }, uPx: { value: new THREE.Vector2() }, uMax: { value: this.maxCoc } },
      });
    }
    this.half = [rt(), rt()];
    this.eighth = [rt(), rt()];
    this.streak = [rt(), rt()];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mBright = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BRIGHT, uniforms: { tMap: { value: null }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } }, depthTest: false, depthWrite: false });
    this.mBlur = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BLUR, uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.mComp = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE,
      uniforms: {
        tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, tStreak: { value: null },
        uBloom: { value: 1 }, uFlare: { value: 0 }, uFlareTint: { value: new THREE.Color() }, uExposure: { value: 1 },
        uVignette: { value: 0.5 }, uGrain: { value: 0.04 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
        uFade: { value: 1 }, uLift: { value: new THREE.Color() }, uSat: { value: 1 },
        uCA: { value: 0 }, uWarp: { value: 0 }, uWarpC: { value: new THREE.Vector2(0.5, 0.5) }, uWarpR: { value: 0.2 },
        tDepth: { value: null }, tDof: { value: null }, uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 3 }, uK: { value: 0 },
      },
      defines: this.useDof ? { USE_DOF: '' } : {},
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(geo, this.mBright);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number): void {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.scene.setSize(this.w, this.h);
    const hw = Math.max(1, this.w >> 2), hh = Math.max(1, this.h >> 2);
    this.half.forEach((r) => r.setSize(hw, hh));
    const ew = Math.max(1, this.w >> 3), eh = Math.max(1, this.h >> 3);
    this.eighth.forEach((r) => r.setSize(ew, eh));
    const sw = Math.max(1, this.w >> 3), sh = Math.max(1, this.h >> 4);
    this.streak.forEach((r) => r.setSize(sw, sh));
    const dw = Math.max(1, this.w >> 1), dh = Math.max(1, this.h >> 1);
    this.dofRT.forEach((r) => r.setSize(dw, dh));
  }

  /** CoC scale in full-res pixels: c = K·(z − S)/z for a thin lens on a 24 mm gate */
  private cocK(): number {
    const o = this.opts;
    const f = o.focalMM / 1000;
    const S = Math.max(o.focus, f * 1.5);
    return ((f * f) / (o.fstop * (S - f)) / 0.024) * this.h * o.dof;
  }

  private pass(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.quad, this.cam);
  }

  private blur(r: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, pair: THREE.WebGLRenderTarget[], stepX: number, stepY: number): void {
    const w = pair[0]!.width, h = pair[0]!.height;
    this.mBlur.uniforms.tMap!.value = src.texture;
    this.mBlur.uniforms.uDir!.value.set(stepX / w, 0);
    this.pass(r, this.mBlur, pair[0]!);
    this.mBlur.uniforms.tMap!.value = pair[0]!.texture;
    this.mBlur.uniforms.uDir!.value.set(0, stepY / h);
    this.pass(r, this.mBlur, pair[1]!);
  }

  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const o = this.opts;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    // bright pass straight into quarter res
    this.mBright.uniforms.tMap!.value = this.scene.texture;
    this.mBright.uniforms.uThreshold!.value = o.threshold;
    this.pass(r, this.mBright, this.half[1]!);
    this.blur(r, this.half[1]!, this.half, 1, 1);
    this.blur(r, this.half[1]!, this.eighth, 1.5, 1.5);
    this.blur(r, this.eighth[1]!, this.eighth, 2.5, 2.5);
    if (o.flare > 0) {
      // anamorphic streak: wide horizontal-only blur of the bright pass
      this.mBlur.uniforms.tMap!.value = this.half[1]!.texture;
      this.mBlur.uniforms.uDir!.value.set(3 / this.streak[0]!.width, 0);
      this.pass(r, this.mBlur, this.streak[0]!);
      this.mBlur.uniforms.tMap!.value = this.streak[0]!.texture;
      this.mBlur.uniforms.uDir!.value.set(9 / this.streak[0]!.width, 0);
      this.pass(r, this.mBlur, this.streak[1]!);
      this.mBlur.uniforms.tMap!.value = this.streak[1]!.texture;
      this.mBlur.uniforms.uDir!.value.set(22 / this.streak[0]!.width, 0);
      this.pass(r, this.mBlur, this.streak[0]!);
    }
    const u = this.mComp.uniforms;
    if (this.useDof && this.mCoc && this.mBokeh) {
      const cam = camera as THREE.PerspectiveCamera;
      const K = this.cocK();
      const cu = this.mCoc.uniforms;
      cu.tMap!.value = this.scene.texture;
      cu.tDepth!.value = this.scene.depthTexture;
      (cu.uTexel!.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      cu.uNear!.value = cam.near;
      cu.uFar!.value = cam.far;
      cu.uFocus!.value = o.focus;
      cu.uK!.value = K * 0.5;
      this.pass(r, this.mCoc, this.dofRT[0]!);
      const bu = this.mBokeh.uniforms;
      bu.tMap!.value = this.dofRT[0]!.texture;
      (bu.uPx!.value as THREE.Vector2).set(1 / this.dofRT[0]!.width, 1 / this.dofRT[0]!.height);
      this.pass(r, this.mBokeh, this.dofRT[1]!);
      u.tDepth!.value = this.scene.depthTexture;
      u.tDof!.value = this.dofRT[1]!.texture;
      u.uNear!.value = cam.near;
      u.uFar!.value = cam.far;
      u.uFocus!.value = o.focus;
      u.uK!.value = K;
    }
    u.uCA!.value = o.ca;
    u.uWarp!.value = o.warp;
    (u.uWarpC!.value as THREE.Vector2).copy(o.warpC);
    u.uWarpR!.value = o.warpR;
    u.tScene!.value = this.scene.texture;
    u.tBloomA!.value = this.half[1]!.texture;
    u.tBloomB!.value = this.eighth[1]!.texture;
    u.tStreak!.value = this.streak[0]!.texture;
    u.uBloom!.value = o.bloom;
    u.uFlare!.value = o.flare;
    (u.uFlareTint!.value as THREE.Color).copy(o.flareTint);
    u.uExposure!.value = o.exposure;
    u.uVignette!.value = o.vignette;
    u.uGrain!.value = o.grain;
    u.uTime!.value = time;
    (u.uRes!.value as THREE.Vector2).set(this.w, this.h);
    u.uFade!.value = o.fade;
    (u.uLift!.value as THREE.Color).copy(o.lift);
    u.uSat!.value = o.saturation;
    this.pass(r, this.mComp, null);
  }

  /** Compile the post programs ahead of the first frame. */
  async warm(r: THREE.WebGLRenderer): Promise<void> {
    const s = new THREE.Scene();
    for (const m of [this.mBright, this.mBlur, this.mComp, this.mCoc, this.mBokeh]) {
      if (!m) continue;
      const q = new THREE.Mesh(this.quad.geometry, m);
      q.frustumCulled = false;
      s.add(q);
    }
    await r.compileAsync(s, this.cam);
  }

  dispose(): void {
    [this.scene, ...this.half, ...this.eighth, ...this.streak, ...this.dofRT].forEach((t) => t.dispose());
    this.scene.depthTexture?.dispose();
    this.quad.geometry.dispose();
    [this.mBright, this.mBlur, this.mComp, this.mCoc, this.mBokeh].forEach((m) => m?.dispose());
  }
}
