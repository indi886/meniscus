// Production smoke test against `npm run preview` (4323): real wheel scrolling through Lenis from top
// to bottom on both pages, the FAQ and form exercised, every console error, page error and failed
// request collected. Also checks the WebGL takes came up, and runs once with reduced motion.
//   node scripts/smoke-prod.mjs [--url http://127.0.0.1:4323]
import puppeteer from 'puppeteer-core';

const base = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:4323';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

async function run(path, { reduced = false, mobile = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errs = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning') && errs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errs.push(`[failed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && errs.push(`[${r.status()}] ${r.url()}`));
  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await sleep(path === '/' ? 9000 : 2000);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  // wheel down the whole page in steps (Lenis handles wheel input)
  await page.mouse.move(700, 450);
  let y = 0;
  while (y < H) {
    if (mobile) await page.evaluate(() => window.scrollBy(0, 700));
    else await page.mouse.wheel({ deltaY: 900 });
    await sleep(140);
    y = await page.evaluate(() => window.scrollY + window.innerHeight);
    if (Date.now() - t0 > 120000) break;
  }
  await sleep(1500);
  if (path === '/') {
    const faq = await page.$('[data-faq]:nth-child(3) button');
    await faq?.click();
    await page.evaluate(() => document.querySelector('[data-form] button[type=submit]')?.click());
    await sleep(500);
    const msg = await page.evaluate(() => document.querySelector('[data-form-msg]')?.textContent);
    const state = await page.evaluate(() => (window.__mn ? window.__mn.state : document.querySelectorAll('canvas.is-ready').length));
    console.log(`${path}${reduced ? ' reduced' : ''}${mobile ? ' mobile' : ''}: canvases ready ${JSON.stringify(state)}; form says "${msg}"`);
  }
  console.log(`${path}${reduced ? ' reduced' : ''}${mobile ? ' mobile' : ''}: scrolled ${y}/${H} px in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${errs.length} problems`);
  errs.forEach((e) => console.log('   ', e));
  failures += errs.length;
  await page.close();
}

await run('/');
await run('/', { mobile: true });
await run('/', { reduced: true });
await run('/services.html');
await run('/services.html', { mobile: true });
await browser.close();
console.log(failures ? `FAIL: ${failures} problems` : 'PASS: no console errors, page errors or failed requests');
process.exit(failures ? 1 : 0);
