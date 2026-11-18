// Frame-time sampling across the process take (headless Chrome on this machine's GPU).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__mn?.stages ?? []).some((s) => s.id === 'process' && s.ready), { timeout: 180000 });
console.log('gpu', await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
for (const p of [0.02, 0.3, 0.5, 0.67, 0.95]) {
  const y = await page.evaluate((p) => window.__mn.takeY('process', p), p);
  await page.evaluate((y) => window.__mn.jump(y), y);
  await new Promise((r) => setTimeout(r, 1200));
  const s = await page.evaluate(() => window.__mn.sampleFrames(3000));
  const q = await page.evaluate(() => window.__proc ? { q: window.__proc.quality, calls: window.__proc.renderer.info.render.calls, tris: window.__proc.renderer.info.render.triangles } : null);
  console.log('p', p, 'avg', s.avg.toFixed(1), 'p95', s.p95.toFixed(1), JSON.stringify(q));
}
await browser.close();
