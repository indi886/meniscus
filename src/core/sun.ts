// Where the sun is over Sydney at a given clock time on today's date (NOAA's general solar
// position equations, accurate to a fraction of a degree), and which faces of a building it is NOT
// on. The whole site runs on this: the HUD's sun reading, the face in shade, and the sun in the
// process take all come from here.

export const SYDNEY = { lat: -33.8688, lon: 151.2093 };
const RAD = Math.PI / 180;

export interface SunPos {
  /** altitude above the horizon, degrees */
  alt: number;
  /** azimuth clockwise from true north, degrees */
  az: number;
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const now = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((now - start) / 86400000);
}

/** Sydney is on AEDT (UTC+11) from the first Sunday in October to the first Sunday in April. */
function sydneyOffset(d: Date): number {
  const m = d.getMonth();
  return m >= 9 || m <= 2 ? 11 : 10;
}

/** @param clockHours local Sydney clock time as fractional hours (e.g. 14.5 = 14:30) */
export function sunAt(clockHours: number, date = new Date()): SunPos {
  const N = dayOfYear(date);
  const tz = sydneyOffset(date);
  const g = ((2 * Math.PI) / 365) * (N - 1 + (clockHours - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const offset = eqtime + 4 * SYDNEY.lon - 60 * tz;
  const tst = clockHours * 60 + offset;
  const ha = (tst / 4 - 180) * RAD;
  const lat = SYDNEY.lat * RAD;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / RAD + 180;
  return { alt: 90 - zen / RAD, az: (az + 360) % 360 };
}

const FACES: [string, number][] = [
  ['north', 0],
  ['east', 90],
  ['south', 180],
  ['west', 270],
];

/** Faces with no direct sun. A face is lit when the sun is up and within 90° of its normal. */
export function shadedFaces(s: SunPos): string[] {
  if (s.alt <= 0) return ['all faces'];
  const out = FACES.filter(([, n]) => {
    let d = Math.abs(s.az - n) % 360;
    if (d > 180) d = 360 - d;
    return d >= 88;
  }).map(([f]) => f);
  return out.length ? out : ['none'];
}

export function parseClock(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}
