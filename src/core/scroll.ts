// Lenis smooth scroll bridged to ScrollTrigger and driven by the shared GSAP ticker.
// Also owns the scroll kinematics the HUD's load map reads (velocity and acceleration), and the
// section registry: every take's top/height is cached on resize so per-frame progress is pure
// arithmetic on the scroll position (no layout reads inside the frame loop).
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { onTick } from './ticker';
import { clamp, prefersReducedMotion } from './util';

gsap.registerPlugin(ScrollTrigger);

export const scroll = {
  y: 0,
  /** px/s, smoothed */
  v: 0,
  /** px/s², smoothed: drives the longitudinal load transfer in the HUD */
  a: 0,
  vh: window.innerHeight,
  vw: window.innerWidth,
  max: 1,
};

let lenis: Lenis | null = null;
let prevV = 0;

export interface Take {
  el: HTMLElement;
  id: string;
  top: number;
  height: number;
  /** progress through a sticky stage: 0 when its top meets the viewport top, 1 when its bottom meets the viewport bottom */
  p: number;
  /** -1 → 1 visibility span: 0 while the stage is pinned, negative before, positive after */
  enter: number;
  visible: boolean;
}

export const takes: Take[] = [];

export function registerTakes(): void {
  takes.length = 0;
  document.querySelectorAll<HTMLElement>('[data-take]').forEach((el) => {
    takes.push({ el, id: el.dataset.take!, top: 0, height: 0, p: 0, enter: 0, visible: false });
  });
  measure();
}

export function measure(): void {
  scroll.vh = window.innerHeight;
  scroll.vw = window.innerWidth;
  const sy = window.scrollY;
  for (const t of takes) {
    const r = t.el.getBoundingClientRect();
    t.top = r.top + sy;
    t.height = r.height;
  }
  scroll.max = Math.max(1, document.documentElement.scrollHeight - scroll.vh);
}

function updateTakes(): void {
  const y = scroll.y;
  const vh = scroll.vh;
  for (const t of takes) {
    const span = Math.max(1, t.height - vh);
    t.p = clamp((y - t.top) / span);
    // enter: -1 when the take is a full viewport below, 0 while pinned, +1 once a viewport past
    if (y < t.top) t.enter = clamp((y - t.top) / vh, -1, 0);
    else if (y > t.top + span) t.enter = clamp((y - t.top - span) / vh, 0, 1);
    else t.enter = 0;
    t.visible = y + vh > t.top - 2 && y < t.top + t.height + 2;
  }
}

export function getTake(id: string): Take {
  const t = takes.find((k) => k.id === id);
  if (!t) throw new Error(`take ${id} not registered`);
  return t;
}

export function initScroll(): void {
  const reduced = prefersReducedMotion();
  if (!reduced) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4, syncTouch: false });
    lenis.on('scroll', ScrollTrigger.update);
  }
  scroll.y = window.scrollY;
  onTick((time, dt) => {
    if (lenis) lenis.raf(time * 1000);
    const y = lenis ? lenis.scroll : window.scrollY;
    const rawV = (y - scroll.y) / Math.max(dt, 1 / 240);
    scroll.y = y;
    scroll.v += (rawV - scroll.v) * Math.min(1, dt * 10);
    const rawA = (scroll.v - prevV) / Math.max(dt, 1 / 240);
    prevV = scroll.v;
    scroll.a += (rawA - scroll.a) * Math.min(1, dt * 6);
    updateTakes();
  }, 0);
  const ro = new ResizeObserver(() => {
    measure();
    ScrollTrigger.refresh();
  });
  ro.observe(document.body);
  window.addEventListener('resize', measure);
}

export function lockScroll(lock: boolean): void {
  if (lenis) (lock ? lenis.stop() : lenis.start());
  document.documentElement.classList.toggle('is-locked', lock);
}

export function scrollToY(y: number, immediate = false): void {
  if (lenis) lenis.scrollTo(y, { immediate, duration: immediate ? 0 : 1.6 });
  else window.scrollTo({ top: y, behavior: immediate ? 'auto' : 'smooth' });
}

export function scrollToTake(id: string, at = 0): void {
  const t = getTake(id);
  scrollToY(t.top + Math.max(0, t.height - scroll.vh) * at);
}

export function destroyScroll(): void {
  lenis?.destroy();
  lenis = null;
  ScrollTrigger.getAll().forEach((s) => s.kill());
}
