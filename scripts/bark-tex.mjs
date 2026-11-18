// Seamless plane-tree bark: mottled cream / olive / umber camo patches from
// domain-warped periodic value noise, plus fine grain. node scripts/bark-tex.mjs
import sharp from 'sharp';

const W = 512, H = 1024;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function lattice(px, py) {
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (x, y) => {
    // x, y in [0,1) -> periodic bicubic-ish (smoothstep) interpolation
    const fx = x * px, fy = y * py;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => g[((j % py + py) % py) * px + ((i % px + px) % px)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
// aspect 1:2 texture -> lattice cells twice as many vertically
const oct = [lattice(4, 8), lattice(8, 16), lattice(16, 32), lattice(32, 64), lattice(64, 128)];
const fbm = (x, y, n = 5) => { let s = 0, a = 0.5, t = 0; for (let i = 0; i < n; i++) { s += oct[i](x, y) * a; t += a; a *= 0.5; } return s / t; };
const warpX = [lattice(3, 6), lattice(6, 12)], warpY = [lattice(3, 6), lattice(6, 12)];
const grain = lattice(256, 512);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const cream = [206, 200, 172], sage = [150, 152, 118], olive = [104, 104, 80], umber = [78, 70, 58];
const out = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const u = x / W, v = y / H;
  const wx = (warpX[0](u, v) - 0.5) * 0.22 + (warpX[1](u, v) - 0.5) * 0.08;
  const wy = (warpY[0](u, v) - 0.5) * 0.22 + (warpY[1](u, v) - 0.5) * 0.08;
  const uu = (u + wx + 1) % 1, vv = (v + wy + 1) % 1;
  const n1 = fbm(uu, vv), n2 = fbm((uu + 0.37) % 1, (vv + 0.61) % 1);
  let c = mix(olive, cream, ss(0.47, 0.53, n1));          // flaked-off cream plates
  c = mix(c, sage, ss(0.5, 0.56, n2) * 0.8);               // younger sage patches
  c = mix(c, umber, ss(0.62, 0.68, n1 * 0.6 + n2 * 0.6 - 0.12) * 0.85); // old dark bark
  const g = (grain(u, v) - 0.5) * 26 + (fbm(u, v, 5) - 0.5) * 18;
  const i = (y * W + x) * 3;
  out[i] = Math.max(0, Math.min(255, c[0] + g));
  out[i + 1] = Math.max(0, Math.min(255, c[1] + g));
  out[i + 2] = Math.max(0, Math.min(255, c[2] + g * 0.9));
}
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile('assets-src/street/tree/bark.png');
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).resize(256).jpeg().toFile('shots/gen/bark-check.jpg');
console.log('ok');
