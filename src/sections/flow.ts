// The flowing (unpinned) sections: team, FAQ and the contact closing transition.
import { onTick } from '../core/ticker';
import { getTake, scroll } from '../core/scroll';
import { clamp, band, isTouch, prefersReducedMotion, lerp } from '../core/util';

const reduced = prefersReducedMotion();

// ---------------------------------------------------------------------------------------------
// TEAM · Truck along the glazing rack. The rack trucks sideways as it crosses the frame; each
// portrait is behind a glass sample (acid-etched, reeded, grey tint, mirror) that slides away when
// you point at it, focus it, or (on touch) when it reaches the middle of the screen.
export function initTeam(): () => void {
  const take = getTake('team');
  const rack = take.el.querySelector<HTMLElement>('[data-rack]')!;
  const members = Array.from(take.el.querySelectorAll<HTMLElement>('[data-member]'));
  const touch = isTouch();
  const set = (m: HTMLElement, on: boolean) => m.classList.toggle('is-open', on);
  members.forEach((m) => {
    m.addEventListener('pointerenter', () => !touch && set(m, true));
    m.addEventListener('pointerleave', () => !touch && set(m, false));
    m.addEventListener('focus', () => set(m, true));
    m.addEventListener('blur', () => set(m, false));
  });
  const off = onTick(() => {
    if (!take.visible) return;
    const r = take.el.getBoundingClientRect();
    const k = clamp((scroll.vh - r.top) / (r.height + scroll.vh));
    if (!reduced) rack.style.transform = `translate3d(${lerp(4, -4, k).toFixed(2)}vw, 0, 0)`;
    if (touch) {
      members.forEach((m) => {
        const b = m.getBoundingClientRect();
        const c = b.top + b.height / 2;
        set(m, Math.abs(c - scroll.vh * 0.5) < scroll.vh * 0.28);
      });
    }
  }, 40);
  return off;
}

// ---------------------------------------------------------------------------------------------
// FAQ · Nozzle change. One answer open at a time; it opens on grid-template-rows while a spray fan
// at the tip's real angle (0°, 15°, 25°, 40°, soap at 65°) opens behind it, with a small snap zoom.
export function initFaq(): () => void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-faq]'));
  const handlers: [HTMLElement, () => void][] = [];
  items.forEach((it) => {
    const tip = Number(it.dataset.tip ?? 15);
    it.querySelector<HTMLElement>('.qa__fan')?.style.setProperty('--half', `${Math.max(2, tip / 2)}deg`);
    const btn = it.querySelector<HTMLButtonElement>('button')!;
    const fn = () => {
      const open = !it.classList.contains('is-open');
      items.forEach((o) => {
        o.classList.remove('is-open');
        o.querySelector('button')!.setAttribute('aria-expanded', 'false');
      });
      if (open) {
        it.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        if (!reduced) {
          it.classList.remove('is-snap');
          void it.offsetWidth;
          it.classList.add('is-snap');
        }
      }
    };
    btn.addEventListener('click', fn);
    handlers.push([btn, fn]);
  });
  // the first answer starts open, so the device is visible before anyone asks
  items[0]?.querySelector('button')?.click();
  return () => handlers.forEach(([b, f]) => b.removeEventListener('click', f));
}

// ---------------------------------------------------------------------------------------------
// CONTACT · Tilt-down into the wet forecourt. The camera tilts from the lit shopfront down to its
// reflection in the freshly washed pavers; the water ripples (an SVG turbulence displacement on the
// reflection, animated through the filter) and stills as you arrive, and the form surfaces in it.
export function initContact(): () => void {
  const take = getTake('contact');
  const tilt = take.el.querySelector<HTMLElement>('[data-tilt]')!;
  const shop = tilt.querySelector<HTMLElement>('.contact__shop')!;
  const pool = take.el.querySelector<HTMLElement>('[data-pool]')!;
  const title = take.el.querySelector<HTMLElement>('[data-contact-title]')!;
  const mirror = take.el.querySelector<HTMLElement>('[data-contact-mirror]')!;
  const turb = document.querySelector<SVGFETurbulenceElement>('#ripple feTurbulence');
  const disp = document.querySelector<SVGFEDisplacementMapElement>('#ripple feDisplacementMap');
  const plate = take.el.querySelector<HTMLElement>('.contact__plate')!;
  let t = 0;
  const off = onTick((_time, dt) => {
    const r = plate.getBoundingClientRect();
    if (r.bottom < -50 || r.top > scroll.vh + 50) return;
    t += dt;
    // 0 when the plate's top meets the top of the frame, 1 when it has scrolled one plate-height
    const k = clamp(-r.top / Math.max(1, r.height - scroll.vh));
    const tiltK = band(0.0, 0.85, k);
    // tilt down: the shopfront rises out of frame and its reflection takes its place
    shop.style.transform = `translate3d(0, ${(-tiltK * 46).toFixed(2)}%, 0) scale(${(1.08 - tiltK * 0.04).toFixed(4)})`;
    pool.style.opacity = band(0.15, 0.65, k).toFixed(3);
    title.style.transform = `translate3d(0, ${(-tiltK * 30).toFixed(1)}vh, 0)`;
    title.style.opacity = (1 - band(0.55, 0.9, k)).toFixed(3);
    mirror.style.transform = `translate3d(0, ${(-tiltK * 30).toFixed(1)}vh, 0) scaleY(-1)`;
    mirror.style.opacity = (0.32 * (1 - band(0.55, 0.9, k))).toFixed(3);
    if (turb && disp && !reduced) {
      // the ripple calms as you arrive
      const calm = 1 - band(0.3, 1.0, k);
      turb.setAttribute('baseFrequency', `${(0.008 + calm * 0.004).toFixed(4)} ${(0.06 + Math.sin(t * 0.8) * 0.01).toFixed(4)}`);
      turb.setAttribute('seed', String(Math.floor(t * 6) % 40));
      disp.setAttribute('scale', (4 + calm * 26).toFixed(1));
    }
  }, 40);
  return off;
}

// ---------------------------------------------------------------------------------------------
// FORM · plain validation in the interface's own voice; nothing is sent anywhere (this is a demo).
export function initForm(): () => void {
  const form = document.querySelector<HTMLFormElement>('[data-form]');
  if (!form) return () => undefined;
  const msg = form.querySelector<HTMLElement>('[data-form-msg]')!;
  const onSubmit = (e: Event) => {
    e.preventDefault();
    const missing: string[] = [];
    form.querySelectorAll<HTMLInputElement>('[required]').forEach((inp) => {
      const field = inp.closest('.field');
      const bad = !inp.value.trim() || (inp.type === 'email' && !/^\S+@\S+\.\S+$/.test(inp.value));
      field?.classList.toggle('is-bad', bad);
      if (bad) missing.push(field?.querySelector('span')?.textContent?.toLowerCase() ?? inp.name);
    });
    if (missing.length) {
      msg.classList.add('is-bad');
      msg.textContent = `Add ${missing.join(', ')} so we can send the shade plan.`;
      return;
    }
    msg.classList.remove('is-bad');
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim().split(' ')[0];
    const reply = new Date(Date.now() + 86400000);
    const day = reply.toLocaleDateString('en-AU', { weekday: 'long' });
    msg.textContent = `Request received, ${name}. Callum will send a shade plan and a price by 17:00 ${day}.`;
    form.querySelectorAll('input, textarea').forEach((el) => ((el as HTMLInputElement).disabled = true));
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}
