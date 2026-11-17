// Optimises the generated stills (assets-src/stills) into WebP for public/media/img, after a local
// retouch pass. Reproducible: npm run stills
//
// Retouch: the image model painted camera-brand lettering on two jackets and a helmet (the prompt's
// "shot on an ARRI Alexa" leaked into the wardrobe) and signage on the forecourt building. Each is
// covered by an offset clone of neighbouring fabric/shell, feathered in, or darkened into the night
// facade. No edit model: a local clone keeps colours exact.
// Grade: one shared pass (slightly lower saturation, a touch more contrast) so every still sits in
// the same grade as the reel.
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'assets-src/stills';
const OUT = 'public/media/img';
fs.mkdirSync(OUT, { recursive: true });

// name → list of [width, quality, suffix]
const plan = {
  'about-room': [[1920, 80, ''], [1080, 76, '-1080']],
  'about-sky': [[1920, 78, ''], [1080, 74, '-1080']],
  'svc-office': [[1600, 80, ''], [900, 76, '-900']],
  'svc-highrise': [[1600, 80, ''], [900, 76, '-900']],
  'svc-gutter': [[1600, 80, ''], [900, 76, '-900']],
  'svc-facade': [[1600, 80, ''], [900, 76, '-900']],
  'svc-pressure': [[1600, 80, ''], [900, 76, '-900']],
  'svc-skylight': [[1600, 80, ''], [900, 76, '-900']],
  'svc-solar': [[1600, 80, ''], [900, 76, '-900']],
  'proj-tower': [[1920, 80, ''], [1024, 76, '-1024']],
  'proj-arcade': [[1920, 80, ''], [1024, 76, '-1024']],
  'proj-carpark': [[1920, 80, ''], [1024, 76, '-1024']],
  'proj-solar': [[1920, 80, ''], [1024, 76, '-1024']],
  'proj-bond': [[1920, 80, ''], [1024, 76, '-1024']],
  'proj-strip': [[1920, 80, ''], [1024, 76, '-1024']],
  'team-tess': [[720, 82, ''], [1080, 80, '-1080']],
  'team-duc': [[720, 82, ''], [1080, 80, '-1080']],
  'team-mere': [[720, 82, ''], [1080, 80, '-1080']],
  'team-callum': [[720, 82, ''], [1080, 80, '-1080']],
  'contact-forecourt': [[1920, 80, ''], [1080, 76, '-1080']],
  'key-pole': [[1600, 78, '']],
  'key-shop': [[1600, 78, '']],
};

// [x, y, w, h, dx, dy, gain?] clone source offset (gain matches brightness), or [x, y, w, h, 'dark']
const retouch = {
  'team-mere': [[830, 1070, 190, 75, 0, 80]],
  'team-tess': [[1152, 1316, 144, 90, 0, 118]],
  'team-duc': [[1102, 534, 94, 64, 0, -86, 0.97]],
  'svc-office': [[374, 826, 94, 76, 104, 0]],
  'contact-forecourt': [[290, 225, 300, 85, 'dark'], [100, 380, 230, 75, 'dark']],
};

async function feather(w, h, r) {
  // white core on black, blurred by sharp (librsvg clips SVG filters to the shape's bounds)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><rect x="${r * 1.6}" y="${r * 1.6}" width="${w - r * 3.2}" height="${h - r * 3.2}" fill="#fff"/></svg>`;
  // raw single channel: an encoded PNG comes back as 3 channels and joinChannel would add no alpha
  return sharp(Buffer.from(svg)).blur(r * 0.7).extractChannel(0).raw().toBuffer();
}

async function load(name) {
  let img = sharp(`${SRC}/${name}.jpg`);
  const fixes = retouch[name];
  if (!fixes) return img;
  const base = await img.toBuffer();
  const comps = [];
  for (const f of fixes) {
    const [x, y, w, h] = f;
    const pad = 22;
    const W = w + pad * 2, H = h + pad * 2;
    const mask = await feather(W, H, 12);
    let patch;
    if (f[4] === 'dark') {
      patch = await sharp(base).extract({ left: x - pad, top: y - pad, width: W, height: H }).blur(14).modulate({ brightness: 0.35 }).toBuffer();
    } else {
      const [, , , , dx, dy, gain = 1] = f;
      patch = await sharp(base).extract({ left: x - pad + dx, top: y - pad + dy, width: W, height: H }).modulate({ brightness: gain }).toBuffer();
    }
    // RGB patch (from a JPEG, so no alpha yet) + feathered mask as its alpha. Not removeAlpha():
    // sharp runs it after joinChannel and would strip the new alpha again.
    const rgba = await sharp(patch).joinChannel(mask, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
    comps.push({ input: rgba, left: x - pad, top: y - pad });
  }
  return sharp(await sharp(base).composite(comps).jpeg({ quality: 95 }).toBuffer());
}

let total = 0;
for (const [name, outs] of Object.entries(plan)) {
  const src = await (await load(name)).modulate({ saturation: 0.96 }).linear(1.035, -3).jpeg({ quality: 95 }).toBuffer();
  for (const [w, q, suf] of outs) {
    const dst = `${OUT}/${name}${suf}.webp`;
    const info = await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: q, effort: 5 }).toFile(dst);
    total += info.size;
    console.log(dst, info.width + 'x' + info.height, (info.size / 1024).toFixed(0) + ' KB');
  }
}

// material textures for the shaders: grey, square, cropped off the window frame the model drew
const tex = [
  ['tex-grime', { left: 150, top: 60, width: 1840, height: 1840 }, 1024],
  ['tex-concrete', { left: 0, top: 0, width: 2048, height: 2048 }, 1024],
];
for (const [name, crop, size] of tex) {
  const dst = `${OUT}/${name}.webp`;
  const info = await sharp(`${SRC}/${name}.jpg`).extract(crop).resize(size, size).greyscale().webp({ quality: 82 }).toFile(dst);
  total += info.size;
  console.log(dst, (info.size / 1024).toFixed(0) + ' KB');
}
console.log('total', (total / 1024 / 1024).toFixed(2), 'MB');
