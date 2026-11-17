// Cuts the Meniscus hero reel from the seven generated clips in assets-src/video.
// Reproducible: `npm run reel` (needs ffmpeg + ffprobe on PATH).
//
// Edit decisions
//  - Opens on the brass blade macro (fade up from black) and closes on the blue-hour shopfront
//    (fade to black), so the loop behind the hero pane is seamless (black to black).
//  - Order follows the working day: blade, tower on rope at dawn, pole on glass, surface cleaner,
//    solar at first light, the drop macro, the finished shopfront.
//  - Speed ramps: real-time into motion-interpolated slow motion (minterpolate, MCI + bidirectional
//    ME, synthesised at 48/60 fps and retimed back to 24 fps) and out into fast.
//  - Hard cuts carry two-frame flash frames (warm white).
//  - Warm grade + vignette are baked in; film grain is NOT (the browser adds it live: baked grain
//    roughly triples the bitrate). No audio track (-an).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src/video';
const TMP = 'assets-src/video/_cut';
const OUT = 'public/media/video';
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const FPS = 24;
const W = 1920, H = 1080;

// Each segment: clip, in, out, speed (<1 = slow motion via interpolation), optional push-in zoom.
const segments = [
  { clip: 'v1-blade', from: 0.15, to: 1.95, speed: 1.0, fadeIn: 0.45 },
  { clip: 'v1-blade', from: 1.95, to: 3.15, speed: 0.5 },
  { flash: true },
  { clip: 'v2-rope', from: 0.2, to: 3.2, speed: 1.4, zoom: [1.0, 1.08] },
  { flash: true },
  { clip: 'v3-pole', from: 0.4, to: 1.8, speed: 1.0 },
  { clip: 'v3-pole', from: 1.8, to: 2.8, speed: 0.4 },
  { clip: 'v3-pole', from: 2.8, to: 4.4, speed: 2.0 },
  { flash: true },
  { clip: 'v4-surface', from: 0.3, to: 4.3, speed: 1.6 },
  { flash: true },
  { clip: 'v5-solar', from: 0.5, to: 2.0, speed: 1.0 },
  { clip: 'v5-solar', from: 2.0, to: 3.0, speed: 0.5 },
  { flash: true },
  { clip: 'v7-drops', from: 0.6, to: 4.2, speed: 1.2 },
  { flash: true },
  { clip: 'v6-shop', from: 0.6, to: 4.2, speed: 1.0, zoom: [1.0, 1.1], fadeOut: 0.7 },
];

// warm grade: lifted contrast, warm highlights / cool-neutral shadows, deep blacks, soft vignette
const GRADE = [
  'eq=contrast=1.07:saturation=1.06:gamma=0.97',
  'colorbalance=rs=-0.02:bs=0.02:rm=0.02:bm=-0.02:rh=0.05:gh=0.015:bh=-0.05',
  'curves=master=0/0 0.06/0.035 0.5/0.5 1/0.98',
  'vignette=angle=PI/4.6',
].join(',');

function run(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

const parts = [];
segments.forEach((s, i) => {
  const out = path.join(TMP, `seg-${String(i).padStart(2, '0')}.mp4`);
  if (s.flash) {
    // two frames of warm white
    run(['-f', 'lavfi', '-i', `color=c=0xFFF4E2:s=${W}x${H}:r=${FPS}:d=${2 / FPS}`, '-frames:v', '2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', out]);
    parts.push(out);
    return;
  }
  const dur = s.to - s.from;
  const f = [];
  if (s.speed < 1) {
    const hiFps = s.speed <= 0.4 ? 60 : 48;
    f.push(`minterpolate=fps=${hiFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
    f.push(`setpts=${(1 / s.speed).toFixed(4)}*PTS`);
  } else if (s.speed > 1) {
    f.push(`setpts=${(1 / s.speed).toFixed(4)}*PTS`);
  }
  f.push(`fps=${FPS}`);
  const outDur = dur / s.speed;
  if (s.zoom) {
    // smooth digital push-in: zoompan on a 2x upscale (halves the sub-pixel jitter of zoompan)
    const [z0, z1] = s.zoom;
    const frames = Math.round(outDur * FPS);
    f.push(`scale=${W * 2}:${H * 2}:flags=bicubic`);
    f.push(`zoompan=z='${z0}+(${(z1 - z0).toFixed(4)})*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`);
  }
  if (s.fadeIn) f.push(`fade=t=in:st=0:d=${s.fadeIn}`);
  if (s.fadeOut) f.push(`fade=t=out:st=${(outDur - s.fadeOut).toFixed(3)}:d=${s.fadeOut}`);
  f.push(GRADE, 'format=yuv420p');
  run(['-ss', String(s.from), '-t', String(dur), '-i', path.join(SRC, `${s.clip}.mp4`), '-an',
    '-vf', f.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', out]);
  parts.push(out);
  console.log('segment', i, s.clip, `${dur.toFixed(2)}s @${s.speed}x → ${outDur.toFixed(2)}s`);
});

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, parts.map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n'));
const master = path.join(TMP, 'master.mp4');
run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master]);

const x264 = (crf, extra = []) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-g', '48', '-movflags', '+faststart', '-an', ...extra];
run(['-i', master, ...x264(21), path.join(OUT, 'reel-1080.mp4')]);
run(['-i', master, '-vf', 'scale=1280:720:flags=lanczos', ...x264(23), path.join(OUT, 'reel-720.mp4')]);
// poster: the blade macro with the bead lit (a strong first frame for the pane)
run(['-ss', '1.2', '-i', master, '-frames:v', '1', '-vf', 'scale=1920:1080', '-c:v', 'libwebp', '-quality', '80', path.join(OUT, 'reel-poster.webp')]);
run(['-ss', '1.2', '-i', master, '-frames:v', '1', '-vf', 'scale=960:540', '-c:v', 'libwebp', '-quality', '76', path.join(OUT, 'reel-poster-960.webp')]);

const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'csv=p=0', f]).toString().trim();
for (const f of ['reel-1080.mp4', 'reel-720.mp4', 'reel-poster.webp']) console.log(f, probe(path.join(OUT, f)));
