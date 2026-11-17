// Mounts the WebGL takes after the intro has started: nearest to the visitor first, each in its own
// try/catch with a stall timeout, so one refused context, dropped texture or failed shader leaves
// only that take on its stills. Every take has a poster under its canvas that shows until the scene
// is ready and comes back if the GPU takes the context away.
import { getTake, scroll, type Take } from '../core/scroll';
import { takeState } from '../core/diag';
import { Poster } from './poster';
import { JetScene } from '../scenes/jet';
import { ProcessScene, stepAt } from '../scenes/process';
import { RainScene, RAIN_P0, PROJ_COUNT } from '../scenes/rain';
import type { GLStage } from '../gl/stage';
import { onTick } from '../core/ticker';

const SVC = ['svc-office', 'svc-highrise', 'svc-gutter', 'svc-facade', 'svc-pressure', 'svc-skylight', 'svc-solar'];
const PROJ = ['proj-tower', 'proj-arcade', 'proj-carpark', 'proj-solar', 'proj-bond', 'proj-strip'];
const small = matchMedia('(max-width: 860px)').matches;

interface Spec {
  id: string;
  make: (canvas: HTMLCanvasElement, take: Take) => GLStage;
  poster: (take: Take, canvas: HTMLCanvasElement) => Poster;
  /** pass the take's progress (and anything else) into the scene each frame */
  drive?: (s: GLStage, take: Take) => void;
}

const SPECS: Spec[] = [
  {
    id: 'services',
    make: (c, t) => new JetScene(c, t, SVC),
    poster: (take, canvas) =>
      new Poster({
        take,
        canvas,
        urls: SVC.map((n) => `/media/img/${n}${small ? '-900' : ''}.webp`),
        frame: (p) => Math.min(SVC.length - 1, Math.floor(p * SVC.length)),
        copy: () => undefined,
      }),
  },
  {
    id: 'process',
    make: (c, t) => new ProcessScene(c, t),
    poster: (take, canvas) =>
      new Poster({
        take,
        canvas,
        urls: Array.from({ length: 9 }, (_, i) => `/media/img/proc-${i}${small ? '-m' : ''}.webp`),
        frame: (p) => stepAt(p) + 1,
        copy: () => undefined,
      }),
    drive: (s, take) => ((s as ProcessScene).p = take.p),
  },
  {
    id: 'work',
    make: (c, t) => new RainScene(c, t, PROJ),
    poster: (take, canvas) =>
      new Poster({
        take,
        canvas,
        urls: PROJ.map((n) => `/media/img/${n}${small ? '-1024' : ''}.webp`),
        frame: (p) => (p < RAIN_P0 ? 0 : Math.min(PROJ_COUNT - 1, Math.floor(((p - RAIN_P0) / (1 - RAIN_P0)) * PROJ_COUNT))),
        copy: () => undefined,
      }),
    drive: (s, take) => ((s as RainScene).p = take.p),
  },
];

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} stalled after ${ms} ms`)), ms))]);
}

export async function mountTakes(stages: GLStage[], cleanups: (() => void)[]): Promise<void> {
  // posters first, for every take, so nothing is ever a black frame
  const entries = SPECS.map((spec) => {
    const take = getTake(spec.id);
    const canvas = take.el.querySelector<HTMLCanvasElement>(`[data-gl="${spec.id}"]`)!;
    const poster = spec.poster(take, canvas);
    cleanups.push(() => poster.dispose());
    takeState[spec.id] = 'stills';
    return { spec, take, canvas, poster };
  });
  // nearest to the visitor first
  const order = entries.slice().sort((a, b) => Math.abs(a.take.top - scroll.y) - Math.abs(b.take.top - scroll.y));
  for (const e of order) {
    let stage: GLStage | null = null;
    try {
      takeState[e.spec.id] = 'compiling';
      stage = e.spec.make(e.canvas, e.take);
      const s = stage;
      await withTimeout(s.load(), 20000, `${e.spec.id} textures`);
      if (e.spec.drive) e.spec.drive(s, e.take);
      await withTimeout(s.compile(), 30000, `${e.spec.id} shaders`);
      s.ready = true;
      e.canvas.classList.add('is-ready');
      e.poster.active = false;
      s.onHealth = (ok) => {
        e.poster.active = !ok;
        e.canvas.classList.toggle('is-ready', ok);
        takeState[e.spec.id] = ok ? 'ready' : 'context lost: stills';
      };
      if (e.spec.drive) {
        const drive = e.spec.drive;
        cleanups.push(onTick(() => drive(s, e.take), 45));
      }
      stages.push(s);
      takeState[e.spec.id] = 'ready';
    } catch (err) {
      console.warn(`${e.spec.id}: staying on stills`, err);
      takeState[e.spec.id] = `stills: ${(err as Error).message}`;
      stage?.dispose();
    }
    // let a frame through between compiles so scrolling never stalls
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
