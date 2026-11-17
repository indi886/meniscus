// Base for every WebGL take: owns a canvas, renderer, post chain and camera; renders only while
// its take is on screen; adapts its resolution to frame time; compiles ahead of time; and disposes
// everything on pagehide / hot reload.
import * as THREE from 'three';
import { Post, type PostOptions } from './post';
import { frameStats } from '../core/ticker';
import { scroll, type Take } from '../core/scroll';
import { clamp } from '../core/util';

export interface StageOptions {
  maxDpr?: number;
  samples?: number;
  shadows?: boolean;
  post?: Partial<PostOptions>;
  /** thin-lens depth of field in the post chain (adds two programs) */
  dof?: boolean;
  fov?: number;
  near?: number;
  far?: number;
}

export const IS_MOBILE = matchMedia('(max-width: 760px), (pointer: coarse)').matches;

// ANGLE's HLSL compiler reports precision notes ("warning X4122 …") in the program info log of
// shaders that compiled and linked fine; three forwards them as console warnings. Drop only those;
// link failures still go to console.error and the stage's own first-frame check.
THREE.setConsoleFunction((type, message, ...params) => {
  if (type === 'warn' && message.includes('Program Info Log') && params.every((p) => /warning X\d{4}/.test(String(p)) && !/error/i.test(String(p)))) return;
  (console[type as 'log' | 'warn' | 'error'] ?? console.log)(message, ...params);
});

export abstract class GLStage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly post: Post;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly take: Take;
  ready = false;
  /** told when the GPU takes this canvas's context away (false) and gives it back (true) */
  onHealth: ((ok: boolean) => void) | null = null;
  private lost = false;
  private onLost = () => {
    this.lost = true;
    this.onHealth?.(false);
  };
  private onRestored = () => {
    this.lost = false;
    this.onHealth?.(true);
  };
  /** quality scale applied on top of the device pixel ratio (adaptive) */
  protected quality = 1;
  private baseDpr: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private w = 0;
  private h = 0;
  private ro: ResizeObserver;
  protected disposables: { dispose(): void }[] = [];

  constructor(canvas: HTMLCanvasElement, take: Take, opts: StageOptions = {}) {
    this.canvas = canvas;
    this.take = take;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    if (opts.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.baseDpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? (IS_MOBILE ? 1.5 : 1.6));
    this.post = new Post(IS_MOBILE ? 0 : opts.samples ?? 2, opts.post, { dof: opts.dof });
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 35, 1, opts.near ?? 0.05, opts.far ?? 200);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  get aspect(): number {
    return this.w / Math.max(1, this.h);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    const dpr = this.baseDpr * this.quality;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.post.setSize(this.w * dpr, this.h * dpr);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.onResize();
  }

  protected onResize(): void {}

  /** focal length (mm, 35 mm full-frame) for the HUD */
  get focalMM(): number {
    return 12 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
  }

  /** Set the vertical fov from a focal length (mm, full frame). */
  setFocal(mm: number): void {
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));
    this.camera.updateProjectionMatrix();
  }

  /** a scene can stop rendering while something covers it completely */
  protected covered = false;

  get shouldRender(): boolean {
    return this.ready && this.take.visible && !document.hidden && !this.covered && !this.lost;
  }

  private adapt(): void {
    const ms = frameStats.ms;
    if (ms > 19) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (ms < 15.5) this.fastFrames++;
    else this.fastFrames = 0;
    if (this.slowFrames > 40 && this.quality > 0.55) {
      this.quality = clamp(this.quality - 0.12, 0.55, 1);
      this.slowFrames = 0;
      this.resize();
    } else if (this.fastFrames > 240 && this.quality < 1) {
      this.quality = clamp(this.quality + 0.08, 0.55, 1);
      this.fastFrames = 0;
      this.resize();
    }
  }

  frame(time: number, dt: number): void {
    // a frame after a long task can arrive with a timestamp from before it; never step backwards
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.beforeFrame(time, dt);
    if (!this.shouldRender) return;
    this.adapt();
    this.update(time, dt);
    this.post.render(this.renderer, this.scene, this.camera, time);
  }

  abstract update(time: number, dt: number): void;

  /** runs every tick even when the scene is not rendering (cheap state checks only) */
  protected beforeFrame(_time: number, _dt: number): void {}

  /** fetch whatever the scene needs before it compiles */
  async load(): Promise<void> {}

  /** compileAsync every program this scene will use, plus the post chain. */
  async compile(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.post.warm(this.renderer);
    // one real frame so textures upload and shadow maps allocate before the take is reached
    this.update(0, 1 / 60);
    this.post.render(this.renderer, this.scene, this.camera, 0);
    this.verify();
  }

  /** A phone's GPU can fail to build a scene without anything throwing (it just draws black), so
   *  check the first frame and throw instead: the take then stays on its stills. */
  private verify(): void {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('WebGL context lost while compiling');
    // three records diagnostics on a program's first use; runnable is false when it didn't link
    const programs = (this.renderer.info.programs ?? []) as unknown as { diagnostics?: { runnable: boolean } }[];
    const broken = programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
    if (broken) throw new Error(`${broken} shader program(s) failed to build on this GPU`);
    const err = gl.getError();
    if (err === gl.OUT_OF_MEMORY || err === gl.INVALID_FRAMEBUFFER_OPERATION) throw new Error(`WebGL error 0x${err.toString(16)} on the first frame`);
  }

  protected viewportH(): number {
    return scroll.vh;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.disposables.forEach((d) => d.dispose());
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
