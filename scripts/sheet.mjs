// Contact sheet of screenshots: node scripts/sheet.mjs out.jpg cols width file1 file2 ...
import sharp from 'sharp';
const [out, cols, w, ...files] = process.argv.slice(2);
const C = Number(cols), W = Number(w);
const metas = await Promise.all(files.map((f) => sharp(f).metadata()));
const H = Math.round((W * metas[0].height) / metas[0].width);
const tiles = await Promise.all(files.map((f) => sharp(f).resize(W, H, { fit: 'cover' }).toBuffer()));
const rows = Math.ceil(tiles.length / C);
await sharp({ create: { width: W * C + (C - 1) * 4, height: H * rows + (rows - 1) * 4, channels: 3, background: '#f0f' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % C) * (W + 4), top: Math.floor(i / C) * (H + 4) })))
  .jpeg({ quality: 82 })
  .toFile(out);
