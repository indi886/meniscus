// Boot order:
//  1. sticky takes registered; scroll and the single ticker running (HUD and cursor subscribe)
//  2. the preloader purges the line with real progress: font bytes as they stream, the grime
//     texture, and the reel's buffered bytes; the hero pane compiles (compileAsync) meanwhile
//  3. the preloader drains away completely, and only then does the fan stroke start and the film
//     play from frame one
//  4. the other WebGL takes are created and compiled nearest-first in the background, each
//     fading in when ready; each renders only while its take is on screen (adaptive resolution),
//     and until then (or if it never can) the take runs on stills (sections/poster.ts)
import './styles/main.css';
import { startTicker, onTick, stopTicker } from './core/ticker';
import { initScroll, registerTakes, getTake, lockScroll, destroyScroll, scroll } from './core/scroll';
import { Preloader } from './core/preloader';
import { fetchAll, registerFont, disposeTextures } from './core/assets';
import { initHud, hudState } from './core/hud';
import { initCursor } from './core/cursor';
import { initDiag, takeState } from './core/diag';
import { prefersReducedMotion } from './core/util';
import { HeroScene, STROKE } from './scenes/hero';
import { HeroUI } from './sections/hero-ui';
import { initAbout, initServices, initProcessUI, initWorkUI, initVoices, workStateFromP } from './sections/takes';
import { initTeam, initFaq, initContact, initForm } from './sections/flow';
import { mountTakes } from './sections/stages';
import type { GLStage } from './gl/stage';

const cleanups: (() => void)[] = [];
const stages: GLStage[] = [];
const reduced = prefersReducedMotion();

export const app = {
  ready: false,
  introDone: false,
  stages,
  hero: null as HeroScene | null,
};

const FONTS = [
  { url: '/fonts/mona-sans-var-latin.woff2', estimate: 98124, family: 'Mona Sans', desc: { weight: '200 900', stretch: '75% 125%' } },
  { url: '/fonts/newsreader-italic-var-latin.woff2', estimate: 146872, family: 'Newsreader', desc: { weight: '200 800', style: 'italic' } },
  { url: '/media/img/tex-grime.webp', estimate: 287_000 },
];

async function boot(): Promise<void> {
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  initDiag();
  registerTakes();
  initScroll();
  startTicker();
  cleanups.push(onTick((t, dt) => {
    for (const s of stages) s.frame(t, dt);
  }, 50));
  lockScroll(true);
  cleanups.push(initHud(document.querySelector('[data-hud]')!));
  cleanups.push(initCursor(document.querySelector('[data-cursor]')!));
  if (import.meta.env.DEV) (await import('./dev')).installDevHooks(app, scroll);

  const pl = new Preloader(document.querySelector('[data-preloader]')!);
  const heroTake = getTake('hero');
  const heroUI = new HeroUI(heroTake.el, heroTake);
  cleanups.push(() => heroUI.dispose());
  const mobile = matchMedia('(max-width: 860px)').matches;
  const film = heroTake.el.querySelector<HTMLVideoElement>('[data-film]')!;
  const filmUrl = mobile ? '/media/video/reel-720.mp4' : '/media/video/reel-1080.mp4';
  film.poster = mobile ? '/media/video/reel-poster-960.webp' : '/media/video/reel-poster.webp';
  film.src = filmUrl;
  film.load();
  // phones don't buffer a video nobody has asked to play: a muted play/pause starts the download
  let held = true;
  film.play().then(() => held && film.pause()).catch(() => undefined);
  const filmSize = Number((await fetch(filmUrl, { method: 'HEAD' }).catch(() => null))?.headers.get('content-length')) || (mobile ? 4_424_832 : 12_503_667);

  let fontLoaded = 0, fontTotal = FONTS.reduce((a, f) => a + f.estimate, 0);
  const filmFrac = () => {
    const b = film.buffered;
    return b.length && film.duration ? Math.min(1, b.end(b.length - 1) / film.duration) : 0;
  };
  const report = () => {
    const loaded = fontLoaded + filmFrac() * filmSize;
    const total = fontTotal + filmSize;
    pl.setProgress((loaded / total) * 0.94, loaded, total);
  };
  const iv = setInterval(report, 80);
  // enough of the reel to play its first act without a stall, or a ceiling on the wait
  const filmReady = new Promise<void>((resolve) => {
    const check = () => {
      if (filmFrac() > 0.45 || film.readyState >= 4) resolve();
      else setTimeout(check, 120);
    };
    film.addEventListener('canplaythrough', () => resolve(), { once: true });
    check();
    setTimeout(resolve, 12000);
  });
  const blobs = fetchAll(FONTS, (l, t) => {
    fontLoaded = l;
    fontTotal = t;
    report();
  }).then(async (map) => {
    // decoration must never block the boot: a font that fails just leaves the fallback in place
    await Promise.all(
      FONTS.filter((f) => f.family).map((f) => registerFont(f.family!, map.get(f.url)!, f.desc as FontFaceDescriptors).catch(() => undefined)),
    );
  }).catch(() => undefined);

  // the hero pane compiles while the bytes stream
  let hero: HeroScene | null = null;
  const heroReady = (async () => {
    try {
      const canvas = heroTake.el.querySelector<HTMLCanvasElement>('[data-gl="hero"]')!;
      hero = new HeroScene(canvas, heroTake, film);
      await hero.load();
      await hero.compile();
      hero.ready = true;
      canvas.classList.add('is-ready');
      stages.push(hero);
      app.hero = hero;
      heroUI.scene = hero;
      takeState.hero = 'ready';
    } catch (err) {
      console.warn('hero pane unavailable, showing the film directly', err);
      takeState.hero = `fallback: ${(err as Error).message}`;
      hero?.dispose();
      hero = null;
    }
  })();

  await Promise.all([blobs, heroReady, filmReady]);
  clearInterval(iv);
  pl.setProgress(1, fontTotal + filmSize, fontTotal + filmSize);
  held = false;
  // the sections measure type, so they come up once the fonts are in
  initSections();
  await pl.finish();
  // ---- the preloader has completely cleared: now the intro ----
  heroUI.start();
  if (hero) {
    if (reduced) (hero as HeroScene).skip();
    else (hero as HeroScene).play();
  } else {
    film.currentTime = 0;
    film.play().catch(() => undefined);
  }
  app.ready = true;
  setTimeout(() => lockScroll(false), reduced ? 0 : 900);
  setTimeout(() => (app.introDone = true), reduced ? 0 : 3400);
  // the other takes compile in the background, nearest first, but only once the fan stroke is
  // done: a compile blocks the main thread and would stutter the one moment that matters
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const check = () => ((hero?.introT ?? 99) > STROKE.end + 0.2 || performance.now() - t0 > 4500 ? resolve() : setTimeout(check, 100));
    check();
  });
  mountTakes(stages, cleanups).catch((err) => console.warn(err));
}

function initSections(): void {
  cleanups.push(initAbout());
  cleanups.push(initVoices());
  cleanups.push(initTeam());
  cleanups.push(initFaq());
  cleanups.push(initContact());
  cleanups.push(initForm());
  // takes with scenes: the DOM half runs regardless of whether the scene ever comes up
  cleanups.push(initServices((i, q) => {
    const s = stages.find((x) => x.take.id === 'services') as unknown as { index: number; q: number } | undefined;
    if (s) {
      s.index = i;
      s.q = q;
    }
  }));
  cleanups.push(initProcessUI(() => {
    const s = stages.find((x) => x.take.id === 'process');
    return s ? s.focalMM : 32;
  }));
  cleanups.push(initWorkUI(() => {
    const s = stages.find((x) => x.take.id === 'work') as unknown as { state: { index: number; card: number }; ready: boolean } | undefined;
    return s && s.ready ? s.state : workStateFromP(getTake('work').p);
  }));
  void hudState;
}

function dispose(): void {
  cleanups.splice(0).forEach((f) => f());
  stages.splice(0).forEach((s) => s.dispose());
  disposeTextures();
  destroyScroll();
  stopTicker();
}

window.addEventListener('pagehide', dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);

boot().catch((err) => {
  console.error(err);
  document.documentElement.classList.add('boot-failed');
  document.querySelector('[data-preloader]')?.classList.add('is-gone');
  lockScroll(false);
});
