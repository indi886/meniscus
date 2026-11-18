// Checks the hero's dew and the pointer squeegee: waits for the dew to form, then drags the mouse
// across the glass in an S and screenshots before and after.  node scripts/dew-test.mjs [out-dir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const out = process.argv[2] ?? 'shots/dew';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__mn?.introT ?? -1) > 32, { timeout: 90000 });
await page.screenshot({ path: `${out}/1-dew.png` });
// an S-stroke with the mouse: three passes across the middle of the frame
await page.mouse.move(200, 260);
for (const [y, dir] of [[260, 1], [430, -1], [600, 1]]) {
  for (let i = 0; i <= 40; i++) {
    const x = dir > 0 ? 200 + i * 26 : 1240 - i * 26;
    await page.mouse.move(x, y + Math.sin(i / 6) * 10);
    await new Promise((r) => setTimeout(r, 16));
  }
}
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${out}/2-wiped.png` });
console.log('errors', JSON.stringify(errs));
await browser.close();
