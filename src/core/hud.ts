// The viewfinder HUD and the global camera treatment.
//  - take number, named move and lens come from the active take's data attributes (a scene may
//    override the lens while it animates its focal length);
//  - the timecode IS the clock of the working day: hours and minutes come from where you are in the
//    take (data-clock="05:12-05:34"), seconds and frames run in real time like a camera's TC;
//  - sun altitude and the faces in shade are computed for that clock time on today's date;
//  - letterbox bars close on the 3D takes while they are pinned;
//  - a cut pulse (two-frame flash and a HUD flicker) marks every change of take;
//  - the light of the day: one fixed sky layer per theme, cross-faded by opacity only.
import { onTick } from './ticker';
import { scroll, takes, type Take } from './scroll';
import { sunAt, shadedFaces, parseClock } from './sun';
import { clamp, damp, pad, prefersReducedMotion, smooth } from './util';

export const hudState = {
  /** water reading at the brush, ppm; scenes may set it (the process take purges the line) */
  tds: 0,
  /** focal length override (mm) while a scene animates its lens; 0 = use data-lens */
  lens: 0,
  /** current clock as fractional hours, for scenes that light themselves by it */
  clock: 5.2,
  activeId: 'hero',
  /** a take can drive the clock itself (the process take runs piecewise through its step times) */
  clockOverride: null as { id: string; clock: number } | null,
};

interface TakeMeta {
  take: Take;
  index: number;
  from: number;
  to: number;
  move: string;
  lens: string;
  theme: string;
  letterbox: boolean;
}

export function initHud(root: HTMLElement): () => void {
  const reduced = prefersReducedMotion();
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const elTake = $('[data-hud-take]');
  const elMove = $('[data-hud-move]');
  const elLens = $('[data-hud-lens]');
  const elTc = $('[data-hud-tc]');
  const elSun = $('[data-hud-sun]');
  const elFace = $('[data-hud-face]');
  const elTds = $('[data-hud-tds]');
  const elFrame = $('[data-hud-frame]');
  const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-letterbox] i'));
  const cut = document.querySelector<HTMLElement>('[data-cut]')!;
  const layers = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-sky-layer]').forEach((el) => layers.set(el.dataset.skyLayer!, el));
  const layerOrder = Array.from(layers.keys());

  const metas: TakeMeta[] = takes.map((take, index) => {
    const [a, b] = (take.el.dataset.clock ?? '05:00-05:30').split('-');
    return {
      take,
      index,
      from: parseClock(a!),
      to: parseClock(b!),
      move: take.el.dataset.move ?? '',
      lens: take.el.dataset.lens ?? '35',
      theme: take.el.dataset.theme ?? 'predawn',
      letterbox: take.el.dataset.letterbox === '1',
    };
  });

  let active: TakeMeta | null = null;
  let bar = 0;
  let flash = 0;
  let lastText = { take: '', move: '', lens: '', tc: '', sun: '', face: '', tds: '' };
  const set = (el: HTMLElement, key: keyof typeof lastText, v: string) => {
    if (lastText[key] !== v) {
      lastText[key] = v;
      el.textContent = v;
    }
  };
  const t0 = performance.now();
  let lastSunCalc = -1;
  let sunCache = { alt: 0, az: 0 };
  const weights = new Map<string, number>();

  const off = onTick((_time, dt) => {
    const centre = scroll.y + scroll.vh * 0.5;
    // which take holds the centre of the frame
    let cur = metas[0]!;
    for (const m of metas) if (centre >= m.take.top) cur = m;
    if (cur !== active) {
      const first = active === null;
      active = cur;
      hudState.activeId = cur.take.id;
      set(elTake, 'take', pad(cur.index + 1));
      set(elMove, 'move', cur.move);
      if (!first && !reduced) {
        flash = 1;
        root.classList.remove('is-cut');
        void root.offsetWidth;
        root.classList.add('is-cut');
      }
    }
    // progress through the take: sticky stages use their pinned progress, flowing sections the centre
    const t = cur.take;
    const sticky = t.height > scroll.vh * 1.2 && t.el.querySelector('.stage');
    const p = sticky ? t.p : clamp((centre - t.top) / Math.max(1, t.height));
    // over flowing text the bottom readouts step back so they never fight the copy
    root.classList.toggle('is-quiet', !sticky);
    const ov = hudState.clockOverride;
    const clock = ov && ov.id === t.id ? ov.clock : cur.from + (cur.to - cur.from) * p;
    hudState.clock = clock;
    const secs = ((performance.now() - t0) / 1000) % 60;
    const frames = Math.floor((secs % 1) * 24);
    const h = Math.floor(clock);
    const m = Math.floor((clock - h) * 60);
    set(elTc, 'tc', `${pad(h)}:${pad(m)}:${pad(secs)}:${pad(frames)}`);
    set(elLens, 'lens', hudState.lens > 0 ? String(Math.round(hudState.lens)) : cur.lens);
    // the sun only moves a little per frame: recompute when the clock moves a minute
    const minute = Math.round(clock * 60);
    if (minute !== lastSunCalc) {
      lastSunCalc = minute;
      sunCache = sunAt(clock);
      set(elSun, 'sun', `${sunCache.alt < 0 ? '−' : ''}${Math.abs(sunCache.alt).toFixed(1)}°`);
      set(elFace, 'face', shadedFaces(sunCache).join(', '));
    }
    set(elTds, 'tds', String(Math.round(hudState.tds)).padStart(3, '0'));
    elFrame.style.opacity = frames < 12 ? '0.9' : '0.25';

    // letterbox on pinned 3D takes
    const wantBar = cur.letterbox && t.enter === 0 && t.p > 0.002 && t.p < 0.998 ? 1 : 0;
    bar = reduced ? wantBar : damp(bar, wantBar, 7, dt);
    const sy = bar.toFixed(4);
    if (bars[0]) bars[0].style.transform = `scaleY(${sy})`;
    if (bars[1]) bars[1].style.transform = `scaleY(${sy})`;

    // cut pulse: two frames of light, then gone
    if (flash > 0) {
      cut.style.opacity = (flash > 0.75 ? 0.22 : flash * 0.12).toFixed(3);
      flash = Math.max(0, flash - dt * 5);
      if (flash === 0) cut.style.opacity = '0';
    }

    // light of the day: every take's presence in a band around the centre of the frame
    weights.clear();
    const band = scroll.vh * 0.32;
    let sum = 0;
    for (const mm of metas) {
      const a = Math.max(centre - band, mm.take.top);
      const b = Math.min(centre + band, mm.take.top + mm.take.height);
      const w = Math.max(0, b - a) / (band * 2);
      if (w > 0) {
        weights.set(mm.theme, (weights.get(mm.theme) ?? 0) + smooth(clamp(w)));
        sum += smooth(clamp(w));
      }
    }
    // stacked opaque layers: alpha_k = w_k / (sum of weights up to k)
    let acc = 0;
    for (const name of layerOrder) {
      const w = (weights.get(name) ?? 0) / Math.max(sum, 1e-4);
      acc += w;
      const alpha = acc > 1e-4 ? w / acc : 0;
      const el = layers.get(name)!;
      const v = name === layerOrder[0] ? '1' : alpha.toFixed(3);
      if (el.style.opacity !== v) el.style.opacity = v;
    }
  }, 90);

  return () => off();
}
