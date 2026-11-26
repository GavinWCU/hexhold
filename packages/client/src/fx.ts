// Small DOM animations layered over the board: flying resource cards, floating labels.
import { iconUrl } from './icons';

export type Pt = { x: number; y: number };

function layer() {
  let el = document.getElementById('fx');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx';
    document.getElementById('app')!.appendChild(el);
  }
  return el;
}

export function centerOf(el: Element | null): Pt | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Fly a resource icon (or a card back) from one point to another along an arc. */
export function fly(kind: string | 'card', from: Pt, to: Pt, delay = 0, dur = 750): Promise<void> {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'fly' + (kind === 'card' ? ' back' : '');
    if (kind !== 'card') el.innerHTML = `<img class="px" src="${iconUrl(kind)}">`;
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    el.style.opacity = '0';
    layer().appendChild(el);
    const start = performance.now() + delay;
    const lift = Math.min(140, 40 + Math.hypot(to.x - from.x, to.y - from.y) * 0.25);
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start) / dur));
      if (now < start) { requestAnimationFrame(step); return; }
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e - Math.sin(k * Math.PI) * lift;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.opacity = String(k < 0.1 ? k * 10 : k > 0.9 ? (1 - k) * 10 : 1);
      el.style.transform = `translate(-50%, -50%) scale(${1 + Math.sin(k * Math.PI) * 0.35})`;
      if (k < 1) requestAnimationFrame(step);
      else { el.remove(); done(); }
    };
    requestAnimationFrame(step);
  });
}

/** A short pop of text (e.g. "+1") at a point. */
export function pop(text: string, at: Pt, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  el.style.left = at.x + 'px';
  el.style.top = at.y + 'px';
  layer().appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/** Labels that follow board points every frame until removed. */
export class FloatingLabels {
  private els: { el: HTMLElement; at: () => Pt | null }[] = [];
  private raf = 0;
  add(html: string, at: () => Pt | null, cls = '') {
    const el = document.createElement('div');
    el.className = 'floatlabel ' + cls;
    el.innerHTML = html;
    el.style.animationDelay = `${-Math.random() * 1.5}s`;
    layer().appendChild(el);
    this.els.push({ el, at });
    if (!this.raf) this.tick();
  }
  private tick = () => {
    for (const { el, at } of this.els) {
      const p = at();
      if (p) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  clear() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const { el } of this.els) el.remove();
    this.els = [];
  }
}
