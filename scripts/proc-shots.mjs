// Dev capture of the process take: one frame per step (or the points given), console output and
// page errors printed. node scripts/proc-shots.mjs [desktop|mobile] [p,p,...] [prefix]
// Needs the dev server on 5323. Writes shots/<prefix>-<i>.jpg.
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const STEPS = [0.04, 0.15, 0.26, 0.36, 0.49, 0.61, 0.74, 0.86, 1.0];
const mode = process.argv[2] ?? 'desktop';
const points = process.argv[3] ? process.argv[3].split(',').map(Number) : [0.02, ...STEPS.slice(0, 8).map((a, i) => a + 0.55 * (STEPS[i + 1] - a))];
const prefix = process.argv[4] ?? (mode === 'mobile' ? 'proc-m' : 'proc');
const vp = mode === 'mobile' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport(vp);
page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && console.log(`[${m.type()}] ${m.text()}`.slice(0, 500)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => r.status() >= 400 && console.log('[http]', r.status(), r.url()));
const t0 = Date.now();
await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__mn?.stages ?? []).some((s) => s.id === 'process' && (s.ready || s.failed)), { timeout: 180000 });
console.log('process ready after', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify(await page.evaluate(() => window.__mn.stages.find((s) => s.id === 'process'))));
await page.addStyleTag({ content: '.hud,.cta-fixed,.letterbox,.cursor,.process__head,.process__steps,.process__report,.process__rail,.cut{display:none!important}' });
for (let i = 0; i < points.length; i++) {
  const y = await page.evaluate((p) => window.__mn.takeY('process', p), points[i]);
  await page.evaluate((y) => window.__mn.jump(y), y);
  await new Promise((r) => setTimeout(r, 1800));
  const buf = await page.screenshot({ type: 'png' });
  await sharp(buf).resize({ width: mode === 'mobile' ? 390 : 1440 }).jpeg({ quality: 82 }).toFile(`shots/${prefix}-${i}.jpg`);
}
console.log('frames', points.length);
await browser.close();
