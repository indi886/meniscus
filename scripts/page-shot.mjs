// Screenshots a page at several scroll positions: node scripts/page-shot.mjs url outPrefix [width height]
import puppeteer from 'puppeteer-core';
const [url, out, w = '1440', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(e.message));
page.on('response', (r) => r.status() >= 400 && errs.push(`${r.status()} ${r.url()}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));
const H = await page.evaluate(() => document.documentElement.scrollHeight);
const stops = [0, 0.12, 0.3, 0.5, 0.75, 1];
for (let i = 0; i < stops.length; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round((H - Number(h)) * stops[i]));
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${out}-${i}.png` });
}
console.log('errors', JSON.stringify(errs));
await browser.close();
