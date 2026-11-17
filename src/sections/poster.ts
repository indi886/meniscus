// What a WebGL take shows while its scene can't: a still for the current moment, under the canvas,
// with the take's copy still following the scroll. A phone can take half a minute to compile a
// scene, drop a request, refuse a context or lose one to memory pressure, and a take must never
// be a black page in the meantime. Stills are fetched only as the visitor nears them, so a device
// that runs the scenes in time never downloads one.
import { onTick } from '../core/ticker';
import { scroll, type Take } from '../core/scroll';

export interface PosterSpec {
  take: Take;
  canvas: HTMLCanvasElement;
  urls: string[];
  /** which still a progress value lands on */
  frame(p: number): number;
  /** keeps the take's copy moving while the scene isn't */
  copy(p: number): void;
  /** where each still anchors when it's cropped to the frame (object-position) */
  focus?: (i: number) => string;
  /** a photograph with its own frame rather than a full-bleed still */
  print?: boolean;
}

export class Poster {
  private el = document.createElement('div');
  private imgs: (HTMLImageElement | null)[];
  private shown = -1;
  private on = true;
  private off: () => void;

  constructor(private spec: PosterSpec) {
    this.imgs = spec.urls.map(() => null);
    this.el.className = spec.print ? 'poster poster--print' : 'poster';
    this.el.setAttribute('aria-hidden', 'true');
    spec.canvas.before(this.el);
    this.off = onTick(() => this.tick(), 60);
  }

  /** true while the scene can't draw; the still and the copy take over */
  set active(v: boolean) {
    this.on = v;
    this.el.classList.toggle('is-off', !v);
  }

  private tick(): void {
    if (!this.on) return;
    const { take, frame, copy, urls } = this.spec;
    // start fetching a couple of screens early, so the still is there when the take arrives
    if (scroll.y + scroll.vh * 3 < take.top || scroll.y > take.top + take.height) return;
    const i = frame(take.p);
    this.fetch(i);
    if (i + 1 < urls.length) this.fetch(i + 1);
    if (i !== this.shown) this.show(i);
    if (take.visible) copy(take.p);
  }

  private fetch(i: number): HTMLImageElement {
    let img = this.imgs[i];
    if (!img) {
      img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = this.spec.urls[i]!;
      if (this.spec.focus) img.style.objectPosition = this.spec.focus(i);
      this.imgs[i] = img;
      this.el.appendChild(img);
    }
    return img;
  }

  private show(i: number): void {
    if (this.shown >= 0) this.imgs[this.shown]?.classList.remove('is-on');
    this.imgs[i]?.classList.add('is-on');
    this.shown = i;
  }

  dispose(): void {
    this.off();
    this.el.remove();
  }
}
