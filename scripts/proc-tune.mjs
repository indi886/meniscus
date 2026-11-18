// Dev tuning: load the process take at p, run JS against window.__proc for each variant, capture.
// node scripts/proc-tune.mjs <p> <prefix> '<js variant 1>' '<js variant 2>' ...
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const [p, prefix, ...variants] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', (m) => ['error'].includes(m.type()) && console.log(`[${m.type()}] ${m.text()}`.slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__mn?.stages ?? []).some((s) => s.id === 'process' && s.ready), { timeout: 180000 });
await page.addStyleTag({ content: '.hud,.cta-fixed,.letterbox,.cursor,.process__head,.process__steps,.process__report,.process__rail,.cut{display:none!important}' });
const y = await page.evaluate((p) => window.__mn.takeY('process', p), Number(p));
await page.evaluate((y) => window.__mn.jump(y), y);
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < variants.length; i++) {
  const out = await page.evaluate((js) => { try { return String(new Function('P', 'THREE', js)(window.__proc, window.__proc && window.__proc.scene.constructor && null) ?? ''); } catch (e) { return 'ERR ' + e.message; } }, variants[i]);
  if (out) console.log(i, out.slice(0, 400));
  await new Promise((r) => setTimeout(r, 700));
  const buf = await page.screenshot({ type: 'png' });
  await sharp(buf).resize({ width: 720 }).jpeg({ quality: 80 }).toFile(`shots/${prefix}-${i}.jpg`);
}
await browser.close();
