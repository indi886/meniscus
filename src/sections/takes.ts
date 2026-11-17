// DOM choreography for the pinned takes. Each reads only its take's progress (one number), so it
// scrubs both ways, and writes only transforms, opacity, filter and the font's width axis.
import { onTick } from '../core/ticker';
import { getTake, scrollToY, scroll } from '../core/scroll';
import { clamp, damp, smooth, band, lerp, prefersReducedMotion } from '../core/util';
import { hudState } from '../core/hud';
import { pointer, setCursorMode } from '../core/cursor';
import { STEPS, stepAt, clockAt, stepLocal } from '../scenes/process';
import { SVC_COUNT } from '../scenes/jet';
import { RAIN_P0, PROJ_COUNT } from '../scenes/rain';

const reduced = prefersReducedMotion();

// ---------------------------------------------------------------------------------------------
// ABOUT · Polarizer turn. A circular polarizer travels across a sunrise window. Inside its disc the
// filter is turned through 90° as you scroll: the sky reflected on the glass is polarised (at
// Brewster's angle almost completely), so Malus's law, I = I0·cos²θ, takes it out and the room
// behind appears. The disc follows the pointer a little and finally opens to fill the frame.
export function initAbout(): () => void {
  const take = getTake('about');
  const el = take.el;
  const disc = el.querySelector<HTMLElement>('[data-about-disc]')!;
  const view = el.querySelector<HTMLElement>('[data-about-disc-view]')!;
  const discSky = el.querySelector<HTMLElement>('[data-about-disc-sky]')!;
  const ring = el.querySelector<SVGSVGElement>('[data-about-ring]')!;
  const ticks = el.querySelector<SVGGElement>('[data-about-ticks]')!;
  const angleEl = el.querySelector<HTMLElement>('[data-about-angle]')!;
  const passEl = el.querySelector<HTMLElement>('[data-about-pass]')!;
  const win = el.querySelector<HTMLElement>('[data-about-window]')!;
  // ring graduations every 5°, long every 30°
  const NS = 'http://www.w3.org/2000/svg';
  for (let a = 0; a < 360; a += 5) {
    const l = document.createElementNS(NS, 'line');
    const r0 = a % 30 === 0 ? 86 : 91;
    const rad = ((a - 90) * Math.PI) / 180;
    l.setAttribute('x1', String(100 + Math.cos(rad) * r0));
    l.setAttribute('y1', String(100 + Math.sin(rad) * r0));
    l.setAttribute('x2', String(100 + Math.cos(rad) * 96));
    l.setAttribute('y2', String(100 + Math.sin(rad) * 96));
    ticks.appendChild(l);
  }
  let dx = 0, dy = 0;
  let last = '';
  const off = onTick((_t, dt) => {
    if (!take.visible) return;
    const p = take.p;
    const vw = scroll.vw, vh = scroll.vh;
    const disc0 = Math.min(vw, vh) * 0.58;
    // the filter turns 0 → 90° between 18% and 70% of the take
    const theta = band(0.16, 0.7, p) * 90;
    const pass = Math.cos((theta * Math.PI) / 180) ** 2;
    // where the disc sits: drifts across the window toward the pointer, then opens to fill the frame
    const ax = lerp(vw * 0.64, vw * 0.5, band(0.6, 0.9, p));
    const ay = lerp(vh * 0.56, vh * 0.5, band(0.6, 0.9, p));
    const tx = ax + (pointer.active && !reduced ? (pointer.x - vw * 0.5) * 0.18 : 0);
    const ty = ay + (pointer.active && !reduced ? (pointer.y - vh * 0.5) * 0.12 : 0);
    dx = reduced ? tx : damp(dx || tx, tx, 4, dt);
    dy = reduced ? ty : damp(dy || ty, ty, 4, dt);
    const fill = Math.hypot(vw, vh) / disc0 * 1.05;
    const sc = lerp(0.82, 1, band(0.0, 0.16, p)) * lerp(1, fill, smooth(band(0.72, 0.96, p)));
    disc.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
    // the view inside the disc stays fixed to the window: counter-translate and counter-scale
    view.style.transform = `scale(${(1 / sc).toFixed(5)}) translate3d(${(-dx + disc0 / 2).toFixed(1)}px, ${(-dy + disc0 / 2).toFixed(1)}px, 0)`;
    view.style.transformOrigin = '0 0';
    discSky.style.opacity = (0.92 * pass).toFixed(3);
    ring.style.transform = `rotate(${theta.toFixed(2)}deg)`;
    ring.style.opacity = (1 - band(0.82, 0.95, p)).toFixed(3);
    win.style.transform = `scale(${(1.04 - p * 0.04).toFixed(4)})`;
    const txt = `${Math.round(theta)}|${Math.round(pass * 100)}`;
    if (txt !== last) {
      last = txt;
      angleEl.textContent = String(Math.round(theta));
      passEl.textContent = String(Math.round(pass * 100));
    }
  }, 40);
  return off;
}

// ---------------------------------------------------------------------------------------------
// SERVICES · the index and the spec sheet follow the take; clicking a service scrolls to it.
export function initServices(onState: (index: number, q: number) => void): () => void {
  const take = getTake('services');
  const items = Array.from(take.el.querySelectorAll<HTMLElement>('[data-svc]'));
  const sheets = Array.from(take.el.querySelectorAll<HTMLElement>('[data-svc-sheet]'));
  const frame = take.el.querySelector<HTMLElement>('[data-svc-frame]')!;
  let cur = -1;
  items.forEach((li, i) => {
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    const go = () => {
      const span = Math.max(1, take.height - scroll.vh);
      scrollToY(take.top + span * ((i + 0.62) / SVC_COUNT));
    };
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go()));
  });
  let inFrame = false;
  frame.addEventListener('pointerenter', () => (inFrame = true));
  frame.addEventListener('pointerleave', () => {
    inFrame = false;
    setCursorMode('');
  });
  const off = onTick(() => {
    const seg = clamp(take.p, 0, 0.99999) * SVC_COUNT;
    const i = Math.floor(seg);
    const q = seg - i;
    if (i !== cur) {
      cur = i;
      items.forEach((li, k) => li.classList.toggle('is-on', k === i));
      sheets.forEach((s, k) => s.classList.toggle('is-on', k === i));
    }
    onState(i, q);
    if (inFrame && take.visible) setCursorMode('nozzle', '25° nozzle');
  }, 40);
  return off;
}

// ---------------------------------------------------------------------------------------------
// PROCESS · copy for each step (on the shaded side of the frame: left before solar noon, right
// after), the site report at the end, the progress rail, and the HUD's clock, lens and water.
export function initProcessUI(lens: () => number): () => void {
  const take = getTake('process');
  const steps = Array.from(take.el.querySelectorAll<HTMLElement>('[data-step]'));
  const head = take.el.querySelector<HTMLElement>('.process__head')!;
  const report = take.el.querySelector<HTMLElement>('[data-report]')!;
  const rail = take.el.querySelector<HTMLElement>('[data-rail]')!;
  // shaded side: steps after solar noon (12:40) sit on the right
  steps.forEach((s, i) => s.classList.toggle('is-right', i >= 3 && i !== 7));
  let tds = 62;
  const off = onTick(() => {
    const p = take.p;
    const active = take.visible && take.enter === 0;
    if (take.visible) {
      hudState.clockOverride = { id: 'process', clock: clockAt(p) };
      const st = stepAt(p);
      tds = st < 2 ? 62 : st === 2 ? Math.round(62 * (1 - smooth(clamp(stepLocal(p, 2) / 0.8)))) : 0;
      hudState.tds = tds;
      hudState.lens = lens();
    }
    if (!active && take.p <= 0) hudState.tds = 0;
    head.style.opacity = (1 - band(STEPS[0]! * 0.5, STEPS[0]! + 0.02, p)).toFixed(3);
    head.style.transform = `translate3d(0, ${(-band(0, STEPS[0]! + 0.02, p) * 30).toFixed(1)}px, 0)`;
    steps.forEach((s, i) => {
      const a = STEPS[i]!, b = STEPS[i + 1]!;
      const span = b - a;
      // in over the first 12% of the step, out over the last 10%
      let o = band(a + span * 0.06, a + span * 0.2, p) * (1 - band(b - span * 0.12, b - span * 0.01, p));
      if (i === 7) o = band(a + span * 0.04, a + span * 0.16, p) * (1 - band(a + span * 0.4, a + span * 0.5, p));
      s.style.opacity = o.toFixed(3);
      s.style.transform = `translate3d(0, ${((1 - o) * 18).toFixed(1)}px, 0)`;
      s.style.visibility = o > 0.002 ? 'visible' : 'hidden';
    });
    const r = band(0.905, 0.95, p);
    report.style.opacity = r.toFixed(3);
    report.style.transform = `translate3d(0, calc(-50% + ${((1 - r) * 20).toFixed(1)}px), 0)`;
    rail.style.transform = `scaleY(${p.toFixed(4)})`;
  }, 40);
  return () => {
    off();
    hudState.clockOverride = null;
  };
}

// ---------------------------------------------------------------------------------------------
// WORK · the project card for the drop the camera is inside.
export function initWorkUI(state: () => { index: number; card: number }): () => void {
  const take = getTake('work');
  const cards = Array.from(take.el.querySelectorAll<HTMLElement>('[data-proj]'));
  const head = take.el.querySelector<HTMLElement>('.work__head')!;
  const n = take.el.querySelector<HTMLElement>('[data-work-n]')!;
  let lastN = -1;
  const off = onTick(() => {
    if (!take.visible) return;
    const p = take.p;
    const s = state();
    const headO = 1 - band(RAIN_P0 * 0.6, RAIN_P0 + 0.035, p);
    head.style.opacity = headO.toFixed(3);
    head.style.transform = `translate3d(0, ${((1 - headO) * -24).toFixed(1)}px, 0)`;
    cards.forEach((c, i) => {
      const o = i === s.index ? s.card : 0;
      c.style.opacity = o.toFixed(3);
      c.style.transform = `translate3d(0, ${((1 - o) * 16).toFixed(1)}px, 0)`;
      c.style.visibility = o > 0.002 ? 'visible' : 'hidden';
    });
    const idx = p < RAIN_P0 ? 0 : Math.min(PROJ_COUNT - 1, s.index);
    if (idx !== lastN) {
      lastN = idx;
      n.textContent = String(idx + 1);
    }
  }, 40);
  return off;
}

/** A fallback state for the work take when its scene can't run: same timing, no drops. */
export function workStateFromP(p: number): { index: number; card: number } {
  if (p < RAIN_P0) return { index: 0, card: 0 };
  const seg = clamp((p - RAIN_P0) / (1 - RAIN_P0)) * PROJ_COUNT;
  const index = Math.min(PROJ_COUNT - 1, Math.floor(seg));
  const lu = seg - index;
  return { index, card: clamp(Math.min((lu - 0.46) / 0.08, (0.9 - lu) / 0.05)) };
}

// ---------------------------------------------------------------------------------------------
// VOICES · Fan-down tilt. One quote at a time; a blade (brass channel, rubber, a lit meniscus)
// fans down it. Lines above the blade are dry and pulled to a 125% channel; below it they are
// still wet: condensed to 75%, heavier, blurred and dim.
export function initVoices(): () => void {
  const take = getTake('voices');
  const quotes = Array.from(take.el.querySelectorAll<HTMLElement>('[data-quote]'));
  const blade = take.el.querySelector<HTMLElement>('[data-blade]')!;
  const fog = take.el.querySelector<HTMLElement>('[data-fog]')!;
  // split each quote into lines by measuring word positions at the final (dry) width
  const lines: HTMLElement[][] = quotes.map((q) => {
    const p = q.querySelector('p')!;
    const words = (p.textContent ?? '').split(/\s+/).filter(Boolean);
    p.textContent = '';
    p.style.setProperty('--w', '125');
    const spans = words.map((w) => {
      const s = document.createElement('span');
      s.textContent = w + ' ';
      s.style.fontVariationSettings = "'wdth' 125, 'wght' 400";
      p.appendChild(s);
      return s;
    });
    q.style.opacity = '1';
    const tops: number[] = [];
    const groups: string[][] = [];
    spans.forEach((s) => {
      const t = Math.round(s.offsetTop);
      let gi = tops.indexOf(t);
      if (gi < 0) {
        tops.push(t);
        groups.push([]);
        gi = tops.length - 1;
      }
      groups[gi]!.push(s.textContent!.trim());
    });
    q.style.opacity = '';
    p.textContent = '';
    return groups.map((g) => {
      const l = document.createElement('span');
      l.className = 'ql';
      l.textContent = g.join(' ');
      p.appendChild(l);
      return l;
    });
  });
  let cur = -1;
  const off = onTick(() => {
    if (!take.visible) return;
    const p = take.p;
    const n = quotes.length;
    const seg = clamp(p, 0, 0.99999) * n;
    const i = Math.floor(seg);
    const u = seg - i;
    if (i !== cur) {
      quotes.forEach((q, k) => (q.style.opacity = k === i ? '1' : '0'));
      cur = i;
    }
    const ls = lines[i]!;
    const first = ls[0]?.getBoundingClientRect();
    const lastL = ls[ls.length - 1]?.getBoundingClientRect();
    if (!first || !lastL) return;
    // the blade travels from above the first line to below the last over 12% → 72% of the quote
    const top = first.top - 30;
    const bottom = lastL.bottom + 24;
    const k = reduced ? (u > 0.05 ? 1 : 0) : smooth(band(0.1, 0.72, u));
    const by = lerp(top, bottom, k);
    const exit = band(0.86, 0.99, u);
    blade.style.transform = `translate3d(0, ${by.toFixed(1)}px, 0)`;
    // the condensation sits below the blade; between quotes the glass fogs up again from the top
    const fogTop = u < 0.1 ? lerp(-scroll.vh * 0.2, top, smooth(u / 0.1)) : exit > 0 ? lerp(by, -scroll.vh * 0.2, smooth(exit)) : by;
    fog.style.transform = `translate3d(0, ${(fogTop + 10).toFixed(1)}px, 0)`;
    blade.style.opacity = (band(0.02, 0.1, u) * (1 - band(0.74, 0.84, u))).toFixed(3);
    ls.forEach((l) => {
      const r = l.getBoundingClientRect();
      const mid = r.top + r.height * 0.5;
      // how far the blade is past this line: 0 still wet, 1 dry
      const d = clamp((by - mid) / 40);
      const w = lerp(75, 125, smooth(d));
      l.style.setProperty('--w', w.toFixed(1));
      l.style.setProperty('--g', lerp(560, 380, d).toFixed(0));
      l.style.setProperty('--o', (lerp(0.28, 1, d) * (1 - exit)).toFixed(3));
      l.style.setProperty('--b', `${(lerp(2.5, 0, d) + exit * 6).toFixed(2)}px`);
      l.style.setProperty('--y', `${(exit * -14).toFixed(1)}px`);
    });
    const cap = quotes[i]!.querySelector<HTMLElement>('figcaption')!;
    cap.style.opacity = (band(0.6, 0.75, u) * (1 - exit)).toFixed(3);
  }, 40);
  return off;
}
