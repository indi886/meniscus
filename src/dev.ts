// Dev-only hooks for the headless capture scripts (never shipped: imported behind import.meta.env.DEV).
import type { scroll as ScrollT } from './core/scroll';
import { takes, scrollToY } from './core/scroll';
import { takeState } from './core/diag';

interface AppLike {
  ready: boolean;
  introDone: boolean;
  stages: { take: { id: string }; ready: boolean }[];
  hero: { introT: number } | null;
}

export function installDevHooks(app: AppLike, scroll: typeof ScrollT): void {
  const w = window as unknown as Record<string, unknown>;
  w.__mn = {
    get ready() {
      return app.ready;
    },
    get introDone() {
      return app.introDone;
    },
    get introT() {
      return app.hero?.introT ?? -1;
    },
    get stages() {
      return app.stages.map((s) => ({ id: s.take.id, ready: s.ready }));
    },
    get state() {
      return { ...takeState };
    },
    takeY(id: string, p: number) {
      const t = takes.find((k) => k.id === id);
      if (!t) return 0;
      return t.top + Math.max(0, t.height - scroll.vh) * p;
    },
    jump(y: number) {
      scrollToY(y, true);
    },
    sampleFrames(ms: number) {
      return new Promise((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        const end = last + ms;
        const f = (t: number) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(f);
          else {
            const s = times.slice(1).sort((a, b) => a - b);
            resolve({ avg: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: s[Math.floor(s.length * 0.95)] ?? 0 });
          }
        };
        requestAnimationFrame(f);
      });
    },
  };
}
