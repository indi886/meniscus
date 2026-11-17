// Captures the process take's fallback stills from the scene itself (one per step, desktop and
// phone framing), with every DOM overlay hidden. Reproducible: node scripts/posters.mjs
// (needs the dev server on 5323). These are what a phone shows if the 3D take can't run.
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const STEPS = [0.04, 0.15, 0.26, 0.36, 0.49, 0.61, 0.74, 0.86, 1.0];
const points = [0.02, ...STEPS.slice(0, 8).map((a, i) => a + 0.55 * (STEPS[i + 1] - a))];
const VPS = [
  ['', { width: 1440, height: 900, deviceScaleFactor: 1 }, 1440],
  ['-m', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 780],
];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'] });
for (const [suf, vp, w] of VPS) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window.__mn?.stages ?? []).some((s) => s.id === 'process' && s.ready), { timeout: 120000 });
  await page.addStyleTag({ content: '.hud,.cta-fixed,.letterbox,.cursor,.process__head,.process__steps,.process__report,.process__rail,.cut{display:none!important}' });
  for (let i = 0; i < points.length; i++) {
    const y = await page.evaluate((p) => window.__mn.takeY('process', p), points[i]);
    await page.evaluate((y) => window.__mn.jump(y), y);
    await new Promise((r) => setTimeout(r, 1500));
    const buf = await page.screenshot({ type: 'png' });
    const out = `public/media/img/proc-${i}${suf}.webp`;
    const info = await sharp(buf).resize({ width: w }).webp({ quality: 72 }).toFile(out);
    console.log(out, (info.size / 1024).toFixed(0) + ' KB');
  }
  await page.close();
}
await browser.close();
