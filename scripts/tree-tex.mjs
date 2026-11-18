// Key the white background out of the plane-tree photo and cut foliage cards + bark.
// node scripts/tree-tex.mjs [preview]
import sharp from 'sharp';
const SRC = 'assets-src/street/tree.jpg';
const OUT = 'assets-src/street/tree';
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const rgba = Buffer.alloc(W * H * 4);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < W * H; i++) {
  const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  // white / pale-grey background: bright and unsaturated
  const bg = ss(198, 236, mn) * (1 - ss(18, 46, mx - mn));
  let a = 1 - bg;
  // de-fringe: pull bright edge pixels toward foliage green so halos do not glow
  const k = 1 - a;
  rgba[i * 4] = Math.round(r * (1 - k * 0.6) + 70 * k * 0.6);
  rgba[i * 4 + 1] = Math.round(g * (1 - k * 0.6) + 92 * k * 0.6);
  rgba[i * 4 + 2] = Math.round(b * (1 - k * 0.6) + 40 * k * 0.6);
  rgba[i * 4 + 3] = Math.round(a * 255);
}
const keyed = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });
if (process.argv[2] === 'preview') {
  await keyed.clone().resize(1024).flatten({ background: '#ff00ff' }).jpeg().toFile('shots/gen/tree-keyed.jpg');
  process.exit(0);
}
const cells = JSON.parse(process.argv[2]);
const parts = [];
for (let n = 0; n < cells.length; n++) {
  const [x, y, s] = cells[n];
  const cut = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x, top: y, width: s, height: s }).resize(512, 512).raw().toBuffer();
  // ragged round card: dark gaps between leaves drop out first, bright leaves reach the rim
  for (let py = 0; py < 512; py++) for (let px = 0; px < 512; px++) {
    const j = (py * 512 + px) * 4;
    const rr = Math.hypot(px - 255.5, py - 255.5) / 256;
    const lum = (cut[j] * 0.3 + cut[j + 1] * 0.59 + cut[j + 2] * 0.11) / 255;
    const keep = (1 - rr) * 1.7 + (lum - 0.42) * 1.1;
    cut[j + 3] = Math.round(cut[j + 3] * ss(0.06, 0.32, keep));
  }
  const buf = await sharp(cut, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer();
  parts.push({ input: buf, left: (n % 2) * 512, top: Math.floor(n / 2) * 512 });
}
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 70, g: 92, b: 40, alpha: 0 } } })
  .composite(parts).png().toFile(`${OUT}/leaves.png`);
await sharp(`${OUT}/leaves.png`).flatten({ background: '#ff00ff' }).jpeg().toFile('shots/gen/leaves-check.jpg');
// bark: mirror-tiled crop of the trunk
const [bx, by, bw, bh] = JSON.parse(process.argv[3]);
const crop = await sharp(SRC).extract({ left: bx, top: by, width: bw, height: bh }).resize(128, 256).toBuffer();
const flip = await sharp(crop).flop().toBuffer();
const row = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#777' } })
  .composite([{ input: crop, left: 0, top: 0 }, { input: flip, left: 128, top: 0 }]).png().toBuffer();
const rowF = await sharp(row).flip().toBuffer();
await sharp({ create: { width: 256, height: 512, channels: 3, background: '#777' } })
  .composite([{ input: row, left: 0, top: 0 }, { input: rowF, left: 0, top: 256 }]).png().toFile(`${OUT}/bark.png`);
console.log('ok');
