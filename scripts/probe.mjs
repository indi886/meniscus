// Quick probe: load the page, wait, screenshot, print hook state and console output.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5323/';
const wait = Number(process.argv[3] ?? 12000);
const out = process.argv[4] ?? 'shots/probe.png';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => r.status() >= 400 && console.log('[http]', r.status(), r.url()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, wait));
console.log('state', JSON.stringify(await page.evaluate(() => ({ ready: window.__mn?.ready, introT: window.__mn?.introT, stages: window.__mn?.stages, state: window.__mn?.state, pl: document.querySelector('[data-pl-ppm]')?.textContent, bytes: document.querySelector('[data-pl-bytes]')?.textContent }))));
await page.screenshot({ path: out });
await browser.close();
