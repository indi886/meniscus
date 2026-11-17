// Method statements page. Same runtime as the film (one GSAP ticker, Lenis, the squeegee cursor),
// a quieter motion language: the title is pulled from a 75% to a 125% channel on load, and each
// statement's photograph is squeegeed clean as it scrolls through the frame (scrubbed both ways:
// a blade crosses the plate and the grey film it pushes slides off with it).
import './styles/main.css';
import { startTicker, onTick, stopTicker } from './core/ticker';
import { initScroll, destroyScroll, scroll } from './core/scroll';
import { initCursor } from './core/cursor';
import { clamp, smooth, band, pad, prefersReducedMotion } from './core/util';

const reduced = prefersReducedMotion();
const cleanups: (() => void)[] = [];

function boot(): void {
  initScroll();
  startTicker();
  cleanups.push(initCursor(document.querySelector('[data-cursor]')!));

  // title: letters on the width axis, staggered from a six-inch to an eighteen-inch channel
  const title = document.querySelector<HTMLElement>('[data-ms-title]')!;
  const text = title.textContent ?? '';
  title.setAttribute('aria-label', text);
  title.textContent = '';
  const letters = Array.from(text).map((ch, i) => {
    if (ch === ' ') {
      title.appendChild(document.createTextNode(' '));
      return null;
    }
    const s = document.createElement('span');
    s.className = 'wm';
    s.textContent = ch;
    s.setAttribute('aria-hidden', 'true');
    s.style.setProperty('--w', reduced ? '125' : '75');
    s.style.setProperty('--g', reduced ? '300' : '560');
    title.appendChild(s);
    return { el: s, at: 0.25 + i * 0.045 };
  }).filter((l): l is { el: HTMLSpanElement; at: number } => l !== null);
  const t0 = performance.now();

  const plates = Array.from(document.querySelectorAll<HTMLElement>('[data-plate]')).map((el) => ({
    el,
    img: el.querySelector<HTMLElement>('img')!,
    cover: el.querySelector<HTMLElement>('.stmt__cover')!,
    blade: el.querySelector<HTMLElement>('.stmt__blade')!,
  }));
  const stmts = Array.from(document.querySelectorAll<HTMLElement>('[data-stmt]'));
  const tc = document.querySelector<HTMLElement>('[data-ms-tc]')!;
  const n = document.querySelector<HTMLElement>('[data-ms-n]')!;
  let lastN = '';

  cleanups.push(
    onTick(() => {
      const t = (performance.now() - t0) / 1000;
      if (!reduced) {
        for (const l of letters) {
          const k = smooth(clamp((t - l.at) / 0.7));
          l.el.style.setProperty('--w', (75 + 50 * k).toFixed(1));
          l.el.style.setProperty('--g', (560 - 260 * k).toFixed(0));
        }
      }
      for (const p of plates) {
        const r = p.el.getBoundingClientRect();
        if (r.bottom < -100 || r.top > scroll.vh + 100) continue;
        // 0 when the plate's top enters the bottom of the frame, 1 when it is 35% from the top
        const k = reduced ? 1 : band(0, 1, (scroll.vh - r.top) / (scroll.vh * 0.65));
        const x = -8 + k * 116;
        p.blade.style.transform = `translate3d(${x.toFixed(2)}%, 0, 0) rotate(${(8 - k * 16).toFixed(2)}deg)`;
        p.blade.style.opacity = k > 0.01 && k < 0.99 ? '1' : '0';
        p.cover.style.transform = `translate3d(${(k * 108).toFixed(2)}%, 0, 0)`;
        p.img.style.transform = `scale(${(1.08 - k * 0.08).toFixed(4)})`;
      }
      // HUD: the statement in frame and its hour
      let cur = 0;
      stmts.forEach((s, i) => {
        if (s.getBoundingClientRect().top < scroll.vh * 0.5) cur = i;
      });
      const secs = (performance.now() / 1000) % 60;
      const clock = stmts[cur]?.dataset.clock ?? '07:00';
      tc.textContent = `${clock}:${pad(secs)}:${pad(Math.floor((secs % 1) * 24))}`;
      const label = pad(cur + 1);
      if (label !== lastN) {
        lastN = label;
        n.textContent = label;
      }
    }, 40),
  );
}

function dispose(): void {
  cleanups.splice(0).forEach((f) => f());
  destroyScroll();
  stopTicker();
}
window.addEventListener('pagehide', dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);
boot();
