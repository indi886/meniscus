// Asset loading with real byte progress (streamed fetch) for the preloader, plus lazy texture
// helpers for the scenes that warm after the intro.
import * as THREE from 'three';

export const MEDIA = {
  fontFlex: '/fonts/roboto-flex-latin.woff2',
  fontBodoni: '/fonts/bodoni-moda-italic-latin.woff2',
  film720: '/media/video/film-720.mp4',
  film1080: '/media/video/film-1080.mp4',
  filmPoster: '/media/video/film-poster.webp',
  filmPosterSmall: '/media/video/film-poster-960.webp',
  wheel: '/media/img/contact-wheel.webp',
  proj: ['proj-1973-t', 'proj-1989-32', 'proj-1995-993', 'proj-2003-996', 'proj-2008-gt3', 'proj-2021-992'],
};

export interface LoadItem {
  url: string;
  /** estimated bytes until the response reports Content-Length */
  estimate: number;
}

export interface Loaded {
  url: string;
  blob: Blob;
}

/**
 * Fetch several URLs in parallel, reporting summed byte progress. Totals start from estimates and
 * are replaced by Content-Length as each response arrives, so the bar never runs backwards by much.
 */
export async function fetchAll(items: LoadItem[], onProgress: (loaded: number, total: number) => void): Promise<Map<string, Blob>> {
  const loaded = new Array(items.length).fill(0);
  const totals = items.map((i) => i.estimate);
  const report = () => onProgress(loaded.reduce((a, b) => a + b, 0), totals.reduce((a, b) => a + b, 0));
  const out = new Map<string, Blob>();
  await Promise.all(
    items.map(async (item, i) => {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`${item.url}: ${res.status}`);
      const len = Number(res.headers.get('content-length'));
      if (len > 0) totals[i] = len;
      const type = res.headers.get('content-type') ?? '';
      if (!res.body) {
        const b = await res.blob();
        loaded[i] = b.size;
        totals[i] = b.size;
        out.set(item.url, b);
        report();
        return;
      }
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        loaded[i] += value.byteLength;
        if (loaded[i] > totals[i]) totals[i] = loaded[i];
        report();
      }
      totals[i] = loaded[i];
      report();
      out.set(item.url, new Blob(chunks, { type }));
    }),
  );
  return out;
}

export async function registerFont(family: string, blob: Blob, descriptors: FontFaceDescriptors): Promise<void> {
  const face = new FontFace(family, await blob.arrayBuffer(), descriptors);
  await face.load();
  document.fonts.add(face);
}

const texCache = new Map<string, Promise<THREE.Texture>>();

function fetchTexture(url: string, opts: { anisotropy?: number; repeat?: boolean }, tries: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = opts.anisotropy ?? 4;
        if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        resolve(t);
      },
      undefined,
      (err) => {
        if (tries <= 1) reject(err);
        else setTimeout(() => fetchTexture(url, opts, tries - 1).then(resolve, reject), 800);
      },
    );
  });
}

/** Load an sRGB texture once (shared between scenes). Phones drop requests, so it tries three times. */
export function loadTexture(url: string, opts: { anisotropy?: number; repeat?: boolean } = {}): Promise<THREE.Texture> {
  const key = url;
  let p = texCache.get(key);
  if (!p) {
    p = fetchTexture(url, opts, 3);
    p.catch(() => texCache.delete(key));
    texCache.set(key, p);
  }
  return p;
}

export function disposeTextures(): void {
  texCache.forEach((p) => p.then((t) => t.dispose()).catch(() => undefined));
  texCache.clear();
}
