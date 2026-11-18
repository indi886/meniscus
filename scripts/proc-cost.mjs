// Toggle features on the live process scene and measure frame time for each (at p).
import puppeteer from 'puppeteer-core';
const p = Number(process.argv[2] ?? 0.3);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5323/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__mn?.stages ?? []).some((s) => s.id === 'process' && s.ready), { timeout: 180000 });
const y = await page.evaluate((p) => window.__mn.takeY('process', p), p);
await page.evaluate((y) => window.__mn.jump(y), y);
await new Promise((r) => setTimeout(r, 1500));
// pin quality so the adaptive DPR does not hide the differences
await page.evaluate(() => { const P = window.__proc; P.quality = 0.75; P.adapt = () => {}; P.resize(); });
const variants = [
  ['base', ''],
  ['no shadows', 'P.renderer.shadowMap.enabled=false; P.scene.traverse(o=>{if(o.material){[].concat(o.material).forEach(m=>m.needsUpdate=true)}});'],
  ['restore shadows', 'P.renderer.shadowMap.enabled=true; P.scene.traverse(o=>{if(o.material){[].concat(o.material).forEach(m=>m.needsUpdate=true)}});'],
  ['no cars', 'P.cars.visible=false;'],
  ['no trees', 'P.cars.visible=true; P.scene.children.filter(o=>o.isInstancedMesh && o.count<80 && o.geometry.attributes.color).forEach(o=>o.visible=false); window.__t=P.scene.children.filter(o=>o.isInstancedMesh && !o.visible);'],
  ['shadow 2048', 'window.__t.forEach(o=>o.visible=true); P.sun.shadow.mapSize.set(2048,2048); P.sun.shadow.map && P.sun.shadow.map.dispose(); P.sun.shadow.map=null;'],
  ['no dof', 'P.post.useDof=false;'],
];
for (const [name, js] of variants) {
  if (js) await page.evaluate((js) => new Function('P', js)(window.__proc), js);
  await new Promise((r) => setTimeout(r, 1200));
  const s = await page.evaluate(() => window.__mn.sampleFrames(3000));
  console.log(name.padEnd(16), 'avg', s.avg.toFixed(1), 'p95', s.p95.toFixed(1));
}
await browser.close();
