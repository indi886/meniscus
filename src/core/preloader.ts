// 04:40, the depot: purging the line. Real byte progress drives the water reading from Sydney
// mains (62 ppm) down through carbon, reverse osmosis and mixed-bed resin to 000 ppm at the brush.
// The exit is a water sheet draining off the glass under gravity: the panel falls away with its
// wavy leading edge, and nothing important plays until it has completely cleared.
import gsap from 'gsap';
import { prefersReducedMotion } from './util';

const MAINS = 62;

export class Preloader {
  private ppm: HTMLElement;
  private fill: HTMLElement;
  private bytes: HTMLElement;
  private clock: HTMLElement;
  private stages: HTMLElement[];
  private sheet: HTMLElement;
  private shown = 0;
  private target = 0;
  private raf = 0;
  private loaded = 0;
  private total = 0;

  constructor(private root: HTMLElement) {
    this.ppm = root.querySelector('[data-pl-ppm]')!;
    this.fill = root.querySelector('[data-pl-fill]')!;
    this.bytes = root.querySelector('[data-pl-bytes]')!;
    this.clock = root.querySelector('[data-pl-clock]')!;
    this.stages = Array.from(root.querySelectorAll<HTMLElement>('[data-pl-stage]'));
    this.sheet = root.querySelector('.preloader__sheet')!;
    // The preloader runs before the shared ticker has anything to do, and must keep counting even if
    // a long shader compile blocks a frame, so it eases on its own short-lived rAF.
    const step = () => {
      this.shown += (this.target - this.shown) * 0.12;
      if (Math.abs(this.target - this.shown) < 0.0005) this.shown = this.target;
      this.paint();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** f in 0..1; loaded/total in bytes (real) */
  setProgress(f: number, loaded: number, total: number): void {
    this.target = Math.max(this.target, Math.min(1, f));
    this.loaded = loaded;
    this.total = total;
  }

  private paint(): void {
    const f = this.shown;
    const ppm = Math.max(0, Math.round(MAINS * (1 - f)));
    this.ppm.textContent = String(ppm).padStart(3, '0');
    this.fill.style.transform = `scaleY(${f.toFixed(4)})`;
    this.stages.forEach((s, i) => s.classList.toggle('is-on', f >= (i + 1) / this.stages.length - 0.001));
    const mb = (n: number) => (n / 1048576).toFixed(1);
    this.bytes.textContent = `${mb(this.loaded)} of ${mb(this.total)} MB`;
    const secs = Math.floor(f * 47);
    this.clock.textContent = `04:40:${String(secs).padStart(2, '0')}`;
  }

  /** Resolves once the sheet has fully drained off screen. */
  async finish(): Promise<void> {
    this.target = 1;
    await new Promise<void>((r) => {
      const wait = () => (this.shown >= 0.999 ? r() : requestAnimationFrame(wait));
      wait();
    });
    await new Promise((r) => setTimeout(r, 380));
    cancelAnimationFrame(this.raf);
    if (prefersReducedMotion()) {
      await gsap.to(this.root, { opacity: 0, duration: 0.4 });
    } else {
      // gravity: slow to start, then it goes
      await gsap.to(this.sheet, { yPercent: 112, duration: 1.15, ease: 'power3.in' });
    }
    this.root.classList.add('is-gone');
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
