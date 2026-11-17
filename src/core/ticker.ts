// The only animation clock on the page. Everything (Lenis, ScrollTrigger, every WebGL scene, the
// HUD, the cursor) subscribes here, so there is exactly one requestAnimationFrame: the GSAP ticker.
import gsap from 'gsap';

export type TickFn = (time: number, dt: number) => void;

interface Sub {
  fn: TickFn;
  order: number;
}

const subs: Sub[] = [];
let last = 0;
let started = false;

/** Frame time (ms), smoothed. Scenes read it for adaptive resolution. */
export const frameStats = { ms: 16.7, frames: 0 };

function loop(time: number): void {
  const raw = last ? time - last : 1 / 60;
  last = time;
  const dt = Math.min(raw, 0.1);
  frameStats.ms += (raw * 1000 - frameStats.ms) * 0.08;
  frameStats.frames++;
  for (let i = 0; i < subs.length; i++) subs[i]!.fn(time, dt);
}

export function startTicker(): void {
  if (started) return;
  started = true;
  gsap.ticker.lagSmoothing(500, 33);
  gsap.ticker.add(loop);
}

/**
 * Subscribe to the frame loop. Lower `order` runs first: scroll (0) → measurement (10) →
 * scenes (50) → HUD / overlays (90). Returns an unsubscribe function.
 */
export function onTick(fn: TickFn, order = 50): () => void {
  const sub = { fn, order };
  subs.push(sub);
  subs.sort((a, b) => a.order - b.order);
  return () => {
    const i = subs.indexOf(sub);
    if (i >= 0) subs.splice(i, 1);
  };
}

export function stopTicker(): void {
  gsap.ticker.remove(loop);
  subs.length = 0;
  started = false;
  last = 0;
}
