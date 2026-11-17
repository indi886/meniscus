// Headless verification: drives the running site in the installed Chrome (GPU on), waits for the
// preloader to clear and the intro to play, then captures every take at several scroll positions
// at 1440×900 and 390×844. Logs console errors, failed requests and frame time per shot.
//   node scripts/capture.mjs [--url http://127.0.0.1:5323] [--vp desktop|mobile] [--only hero,process] [--out shots/pass1] [--reduced]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? '1' : arr[i + 1]]] : acc), []));
const URL = args.url ?? 'http://127.0.0.1:5323/';
const OUT = args.out ?? 'shots/latest';
const VPS = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const which = !args.vp || args.vp === 'both' ? ['desktop', 'mobile'] : args.vp.split(',');
const only = args.only ? args.only.split(',') : null;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PLAN = {
  hero: [0.0, 0.5, 0.95],
  about: [0.08, 0.35, 0.6, 0.85],
  services: [0.03, 0.07, 0.1, 0.25, 0.47, 0.6, 0.78, 0.95],
  process: [0.02, 0.1, 0.2, 0.31, 0.4, 0.46, 0.55, 0.67, 0.72, 0.8, 0.9, 0.97],
  work: [0.03, 0.08, 0.13, 0.16, 0.19, 0.24, 0.31, 0.45, 0.6, 0.75, 0.92],
  voices: [0.05, 0.12, 0.17, 0.3, 0.55, 0.8],
  team: [0.3, 0.6],
  faq: [0.3, 0.7],
  contact: [0.05, 0.25, 0.45, 0.7, 1],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(vpName) {
  const dir = path.join(OUT, vpName);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
    defaultViewport: VPS[vpName],
  });
  const page = await browser.newPage();
  if (args.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (vpName === 'mobile') await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36');
  const log = [];
  page.on('console', (m) => {
    if (['error', 'warning', 'warn'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && log.push(`[http ${r.status()}] ${r.url()}`));
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(300);
  await page.screenshot({ path: path.join(dir, '00-preloader-a.png') });
  await sleep(900);
  await page.screenshot({ path: path.join(dir, '00-preloader-b.png') });
  await page.waitForFunction(() => window.__mn?.ready === true || document.documentElement.classList.contains('boot-failed'), { timeout: 90000 }).catch((e) => log.push('[capture] ready wait: ' + e.message));
  const readyMs = Date.now() - t0;
  log.push(`[capture] ready after ${readyMs} ms`);
  if (!only || only.includes('hero')) {
    for (const at of [0.25, 0.7, 1.2, 1.7, 2.3, 2.9, 3.6, 5.0]) {
      await page.waitForFunction((at) => (window.__mn?.introT ?? -1) >= at, { timeout: 30000 }, at).catch(() => log.push(`[capture] introT ${at} not reached`));
      const t = await page.evaluate(() => window.__mn.introT);
      await page.screenshot({ path: path.join(dir, `01-intro-${at.toFixed(1)}s.png`) });
      log.push(`[intro] wanted ${at}s, shot at ${t.toFixed(2)}s`);
    }
  }
  await page.waitForFunction(() => window.__mn?.introDone === true, { timeout: 30000 }).catch(() => log.push('[capture] intro never finished'));
  await page.waitForFunction(() => (window.__mn?.stages ?? []).filter((s) => s.ready).length >= 4, { timeout: 120000 }).catch(() => log.push('[capture] not all stages ready'));
  log.push(`[capture] stages ready after ${Date.now() - t0} ms: ${JSON.stringify(await page.evaluate(() => window.__mn.state))}`);
  await sleep(800);
  const ids = Object.keys(PLAN).filter((k) => !only || only.includes(k));
  let n = 1;
  for (const id of ids) {
    n++;
    for (const p of PLAN[id]) {
      try {
        const y = await page.evaluate((id, p) => window.__mn.takeY(id, p), id, p);
        await page.evaluate((y) => window.__mn.jump(y), y);
        await sleep(['process', 'work', 'services'].includes(id) ? 1300 : 900);
        const f = await page.evaluate(() => window.__mn.sampleFrames(900));
        const name = `${String(n).padStart(2, '0')}-${id}-${String(Math.round(p * 100)).padStart(3, '0')}.png`;
        await page.screenshot({ path: path.join(dir, name) });
        log.push(`[shot] ${name} frame avg ${f.avg.toFixed(1)} ms p95 ${f.p95.toFixed(1)} ms`);
      } catch (e) {
        log.push(`[capture] ${id}@${p} failed: ${e.message}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'log.txt'), log.join('\n'));
  console.log(vpName, 'done', readyMs, 'ms to ready;', log.filter((l) => /error|failed|http 4|http 5/i.test(l)).length, 'error lines');
  await browser.close();
}

for (const vp of which) await run(vp);
