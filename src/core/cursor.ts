// Pointer: a squeegee blade. It fans with the direction of travel the way a blade is turned through
// an S-stroke and settles level when the hand stops. Over anything clickable the blade becomes two
// rails that lock onto the element (brass channel above, the meniscus below). Buttons with
// [data-magnetic] lean toward the pointer; headings with [data-magnetic-text] widen letter by letter
// toward it on the font's width axis (a channel pulled wider). Scenes switch tool modes ('nozzle').
// Touch devices keep the native pointer. Only transforms are animated, plus the width axis.
import { onTick } from './ticker';
import { damp, isTouch, prefersReducedMotion } from './util';

export const pointer = { x: -100, y: -100, vx: 0, vy: 0, nx: 0, ny: 0, down: false, active: false, moved: 0 };

type Mode = '' | 'nozzle' | 'blade';
let setModeImpl: (m: Mode, label?: string) => void = () => undefined;
export const setCursorMode = (m: Mode, label?: string): void => setModeImpl(m, label);

export function splitLetters(el: HTMLElement, cls: string): HTMLElement[] {
  if (el.dataset.split === '1') return Array.from(el.querySelectorAll<HTMLElement>(`.${cls}`));
  const text = el.textContent ?? '';
  el.setAttribute('aria-label', text);
  el.textContent = '';
  const out: HTMLElement[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (/^\s+$/.test(word)) {
      el.appendChild(document.createTextNode(' '));
      continue;
    }
    const w = document.createElement('span');
    w.style.whiteSpace = 'nowrap';
    w.setAttribute('aria-hidden', 'true');
    for (const ch of word) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = ch;
      w.appendChild(s);
      out.push(s);
    }
    el.appendChild(w);
  }
  el.dataset.split = '1';
  return out;
}

export function initCursor(root: HTMLElement): () => void {
  const listeners: [EventTarget, string, EventListener][] = [];
  const on = (t: EventTarget, e: string, f: EventListener, o?: AddEventListenerOptions) => {
    t.addEventListener(e, f, o);
    listeners.push([t, e, f]);
  };
  let lastX = 0, lastY = 0, lastT = performance.now();
  on(window, 'pointermove', ((e: PointerEvent) => {
    const now = performance.now();
    const dtm = Math.max(1, now - lastT);
    pointer.vx = ((e.clientX - lastX) / dtm) * 1000;
    pointer.vy = ((e.clientY - lastY) / dtm) * 1000;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ny = -(e.clientY / window.innerHeight) * 2 + 1;
    pointer.active = true;
    pointer.moved = now;
  }) as EventListener, { passive: true });
  on(window, 'pointerdown', () => (pointer.down = true));
  on(window, 'pointerup', () => (pointer.down = false));

  const touch = isTouch();
  const reduced = prefersReducedMotion();
  if (touch) {
    root.remove();
    return () => listeners.forEach(([t, e, f]) => t.removeEventListener(e, f));
  }
  document.documentElement.classList.add('has-cursor');
  const blade = root.querySelector<HTMLElement>('[data-cursor-blade]')!;
  const lockEl = root.querySelector<HTMLElement>('[data-cursor-lock]')!;
  const rails = Array.from(lockEl.querySelectorAll<HTMLElement>('b'));
  const dot = root.querySelector<HTMLElement>('[data-cursor-dot]')!;
  const label = root.querySelector<HTMLElement>('[data-cursor-label]')!;

  let target: HTMLElement | null = null;
  let mode: Mode = '';
  setModeImpl = (m, l) => {
    if (mode === m && label.textContent === (l ?? '')) return;
    mode = m;
    root.dataset.mode = m;
    label.textContent = l ?? '';
  };

  on(document, 'pointerover', ((e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('a, button, [data-lock], label, [data-member], [data-svc]');
    target = el && !el.matches('input, select, textarea') ? el : null;
  }) as EventListener);

  const magnets = Array.from(document.querySelectorAll<HTMLElement>('[data-magnetic]')).map((el) => ({ el, x: 0, y: 0 }));
  const words = Array.from(document.querySelectorAll<HTMLElement>('[data-magnetic-text]'));
  const letters: { el: HTMLElement; w: number; word: number }[] = [];
  words.forEach((w, wi) => splitLetters(w, 'mt').forEach((el) => letters.push({ el, w: 0, word: wi })));

  let bx = -100, by = -100, rot = 0;
  const rl = { x: 0, y0: 0, y1: 0, w: 40 };
  let lock = 0;
  const off = onTick((_t, dt) => {
    // the blade: position follows closely, angle fans with the direction of travel
    const k = reduced ? 80 : 30;
    bx = damp(bx, pointer.x, k, dt);
    by = damp(by, pointer.y, k, dt);
    const speed = Math.hypot(pointer.vx, pointer.vy);
    const fresh = performance.now() - pointer.moved < 90;
    let want = 0;
    if (fresh && speed > 120) {
      // a blade travels broadside-on: perpendicular to its path, folded into ±70°
      let a = (Math.atan2(pointer.vy, pointer.vx) * 180) / Math.PI + 90;
      while (a > 90) a -= 180;
      while (a < -90) a += 180;
      want = Math.max(-70, Math.min(70, a)) * Math.min(1, speed / 900);
    }
    rot = damp(rot, reduced ? 0 : want, fresh ? 10 : 6, dt);
    blade.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
    dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
    label.style.transform = `translate3d(${pointer.x + 24}px, ${pointer.y + 14}px, 0)`;

    // lock-on rails
    let locked = false;
    if (target && mode === '' && document.contains(target)) {
      const bb = target.getBoundingClientRect();
      if (bb.width > 0) {
        locked = true;
        const pad = 6;
        rl.x = damp(rl.x, bb.left - pad, 22, dt);
        rl.y0 = damp(rl.y0, bb.top - pad, 22, dt);
        rl.y1 = damp(rl.y1, bb.bottom + pad - 2, 22, dt);
        rl.w = damp(rl.w, bb.width + pad * 2, 22, dt);
      }
    } else {
      rl.x = damp(rl.x, pointer.x - 17, 26, dt);
      rl.y0 = damp(rl.y0, pointer.y - 4, 26, dt);
      rl.y1 = damp(rl.y1, pointer.y + 4, 26, dt);
      rl.w = damp(rl.w, 34, 26, dt);
    }
    lock = damp(lock, locked ? 1 : 0, 14, dt);
    const sx = (rl.w / 100).toFixed(4);
    if (rails[0]) rails[0].style.transform = `translate3d(${rl.x.toFixed(1)}px, ${rl.y0.toFixed(1)}px, 0) scaleX(${sx})`;
    if (rails[1]) rails[1].style.transform = `translate3d(${rl.x.toFixed(1)}px, ${rl.y1.toFixed(1)}px, 0) scaleX(${sx})`;
    root.classList.toggle('is-locked', locked);
    root.classList.toggle('is-down', pointer.down);

    if (reduced) return;
    for (const m of magnets) {
      const bb = m.el.getBoundingClientRect();
      if (bb.bottom < 0 || bb.top > window.innerHeight) continue;
      const cx = bb.left + bb.width / 2, cy = bb.top + bb.height / 2;
      const dx = pointer.x - cx, dy = pointer.y - cy;
      const d = Math.hypot(dx, dy);
      const reach = Math.max(bb.width, bb.height) * 0.85 + 36;
      const pull = d < reach ? (1 - d / reach) * 0.38 : 0;
      m.x = damp(m.x, dx * pull, 10, dt);
      m.y = damp(m.y, dy * pull, 10, dt);
      m.el.style.transform = `translate3d(${m.x.toFixed(2)}px,${m.y.toFixed(2)}px,0)`;
    }
    // magnetic type: read every rect first, then write, so width changes never force a reflow per letter
    if (!letters.length) return;
    const near = words.map((w) => {
      const bb = w.getBoundingClientRect();
      return bb.bottom > -40 && bb.top < window.innerHeight + 40 && pointer.x > bb.left - 260 && pointer.x < bb.right + 260 && pointer.y > bb.top - 200 && pointer.y < bb.bottom + 200;
    });
    const targets = letters.map((lt) => {
      if (!near[lt.word]) return 0;
      const bb = lt.el.getBoundingClientRect();
      const d = Math.hypot(pointer.x - (bb.left + bb.width / 2), (pointer.y - (bb.top + bb.height / 2)) * 1.6);
      return d < 240 ? Math.pow(1 - d / 240, 2) : 0;
    });
    letters.forEach((lt, i) => {
      const next = damp(lt.w, targets[i]!, 9, dt);
      if (Math.abs(next - lt.w) < 0.0005 && next < 0.001) return;
      lt.w = next;
      lt.el.style.setProperty('--mt', lt.w.toFixed(3));
    });
  }, 95);

  return () => {
    off();
    listeners.forEach(([t, e, f]) => t.removeEventListener(e, f));
    document.documentElement.classList.remove('has-cursor');
  };
}
