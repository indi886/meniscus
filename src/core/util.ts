// Small numeric helpers shared by scenes and sections.

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => clamp((v - a) / (b - a));
export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
export const easeOut3 = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeIn3 = (t: number): number => t * t * t;
export const easeInOut3 = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Overshoot ease (craned parts settle past their seat and back). */
export const easeOutBack = (t: number, s = 1.9): number => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
/** Map v in [a,b] to [0,1] and apply smoothstep. */
export const band = (a: number, b: number, v: number): number => smooth(invLerp(a, b, v));
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Deterministic PRNG (mulberry32) so procedural geometry is identical on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson) through [x, y] keys: used for the 911 body
 * profiles so the curves never overshoot between keys.
 */
export function monotone(keys: [number, number][]): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

export const isTouch = (): boolean => matchMedia('(hover: none), (pointer: coarse)').matches;
export const prefersReducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Format a number with fixed decimals using tabular-friendly thin spacing for thousands. */
export function fmt(v: number, dp = 0): string {
  const s = v.toFixed(dp);
  const [i, f] = s.split('.');
  const withSep = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f !== undefined ? `${withSep}.${f}` : withSep;
}

export function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, '0');
}
