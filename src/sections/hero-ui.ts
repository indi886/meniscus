// The hero's DOM layer. The wordmark is set on the font's width axis: each letter waits behind the
// wet glass at a 75% (six-inch) channel width, and as the squeegee's last pass crosses it, it is
// pulled out to a 125% (eighteen-inch) channel. Scrolling then eases the copy up and away while
// the film pulls back. Reduced motion: everything is simply there.
import { onTick } from '../core/ticker';
import { clamp, damp, smooth, prefersReducedMotion } from '../core/util';
import type { Take } from '../core/scroll';
import type { HeroScene } from '../scenes/hero';

export class HeroUI {
  private letters: { el: HTMLElement; w: number; g: number; x: number }[] = [];
  private copy: HTMLElement;
  private readings: HTMLElement | null;
  private started = false;
  private off: () => void;
  scene: HeroScene | null = null;
  private fallbackT = -1;

  constructor(private root: HTMLElement, private take: Take) {
    const mark = root.querySelector<HTMLElement>('[data-wordmark]')!;
    const text = mark.textContent ?? '';
    mark.textContent = '';
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'wm';
      s.textContent = ch;
      s.setAttribute('aria-hidden', 'true');
      mark.appendChild(s);
      this.letters.push({ el: s, w: 75, g: 300, x: 0 });
    }
    root.querySelectorAll<HTMLElement>('[data-hero-in]').forEach((el, i) => el.style.setProperty('--i', String(i)));
    this.copy = root.querySelector('.hero__copy')!;
    this.readings = root.querySelector('.hero__readings');
    this.off = onTick((_t, dt) => this.tick(dt), 45);
  }

  /** Called the moment the preloader has completely cleared. */
  start(): void {
    this.started = true;
    this.root.classList.add('is-intro');
    if (prefersReducedMotion()) {
      this.letters.forEach((l) => {
        l.w = 125;
        l.g = 280;
        this.paint(l, 1);
      });
    }
    this.fallbackT = 0;
  }

  private paint(l: { el: HTMLElement; w: number; g: number }, o: number): void {
    l.el.style.setProperty('--w', l.w.toFixed(2));
    l.el.style.setProperty('--g', l.g.toFixed(1));
    l.el.style.opacity = o.toFixed(3);
  }

  private tick(dt: number): void {
    if (!this.started) return;
    const reduced = prefersReducedMotion();
    // which letters has the blade passed? (screen x of the blade on its last pass)
    const blade = this.scene?.bladePx ?? null;
    const sceneT = this.scene?.introT ?? -1;
    if (this.fallbackT >= 0) this.fallbackT += dt;
    // without a scene (no WebGL), sweep a virtual blade at the same pace
    const t = sceneT >= 0 ? sceneT : this.fallbackT;
    // the copy arrives on the blade's own clock, as its last pass leaves the frame
    if (t > 2.55 || reduced) this.root.classList.add('is-copy');
    const vw = window.innerWidth;
    let bx = -1e9;
    if (blade && blade.pass === 2) bx = blade.x;
    else if (t > 3.2 || reduced) bx = 1e9;
    else if (sceneT < 0 && t > 2.0) bx = ((t - 2.0) / 1.0) * vw * 1.1;
    for (const l of this.letters) {
      if (!reduced) {
        const r = l.el.getBoundingClientRect();
        l.x = r.left + r.width * 0.5;
        const passed = bx > l.x ? 1 : 0;
        l.w = damp(l.w, passed ? 125 : 75, passed ? 7 : 3, dt);
        l.g = damp(l.g, passed ? 280 : 520, 6, dt);
        const o = passed ? 1 : 0.16;
        const cur = Number(l.el.style.opacity || 0);
        this.paint(l, damp(cur, o, 5, dt));
      }
    }
    // scroll: copy rises and dims, readings slide out to the right
    const p = this.take.p;
    const k = smooth(clamp(p / 0.85));
    if (!reduced) {
      this.copy.style.transform = `translate3d(0, ${(-k * 14).toFixed(2)}vh, 0)`;
      this.copy.style.opacity = (1 - k * 0.9).toFixed(3);
      // leave the intro's own fade alone until the visitor actually scrolls
      if (this.readings) this.readings.style.opacity = k > 0.001 ? (1 - k).toFixed(3) : '';
    }
    if (this.scene) this.scene.scrollP = p;
  }

  dispose(): void {
    this.off();
  }
}
