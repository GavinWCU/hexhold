// 2D pixel-art renderers (top-down and isometric), drawn at low resolution with
// nearest-neighbor upscaling so they share the 3D mode's palette and textures.
import { GameState, PIPS } from '@hexhold/engine';
import { PAL } from './palette';
import { TEX, skyCanvas, reseed } from './textures';

const TOP: Record<string, keyof typeof TEX> = {
  woodland: 'forestFloor', meadow: 'meadow', farmland: 'field', claypits: 'clay', highlands: 'rock', wastes: 'sand',
};
const HEIGHT: Record<string, number> = { woodland: 4, meadow: 3, farmland: 3, claypits: 4, highlands: 6, wastes: 2 };

import type { Marker } from './scene3d';

export class Render2D {
  onPick: ((m: Marker) => void) | null = null;
  private markerList: Marker[] = [];
  private markerPts: { m: Marker; x: number; y: number }[] = [];
  private scale = 1;
  private g: CanvasRenderingContext2D;
  private W = 0; private H = 0;
  private patterns = new Map<string, CanvasPattern>();
  constructor(private canvas: HTMLCanvasElement, private iso: boolean, private pixelHeight = 300) {
    this.g = canvas.getContext('2d')!;
    canvas.addEventListener('click', (e) => {
      const m = this.pickAt(e.clientX, e.clientY);
      if (m && this.onPick) this.onPick(m);
    });
  }
  setMarkers(list: Marker[]) { this.markerList = list; }
  private hl: { list: Marker[]; color: string } = { list: [], color: '#5ff2ff' };
  setHighlights(list: Marker[], color = '#5ff2ff') { this.hl = { list, color }; }
  private Pf: ((x: number, y: number, z?: number) => readonly [number, number]) | null = null;
  private last: GameState | null = null;
  private toScreen(px: number, py: number) { const r = this.canvas.getBoundingClientRect(); return { x: r.left + px * this.scale, y: r.top + py * this.scale }; }
  hexScreen(id: number) { const s = this.last!; const h = s.geo.hexes[id]; const [x, y] = this.Pf!(h.x, h.y, this.iso ? HEIGHT[s.terrains[id]] : 0); return this.toScreen(x, y); }
  vertexScreen(id: number) { const s = this.last!; const v = s.geo.vertices[id]; const [x, y] = this.Pf!(v.x, v.y, this.iso ? Math.max(...v.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0); return this.toScreen(x, y); }
  edgeScreen(id: number) { const s = this.last!; const e = s.geo.edges[id]; const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b]; const [x, y] = this.Pf!((a.x + b.x) / 2, (a.y + b.y) / 2, this.iso ? Math.max(...e.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0); return this.toScreen(x, y); }
  markers() { return this.markerList; }
  pickAt(cx: number, cy: number): Marker | null {
    const r = this.canvas.getBoundingClientRect();
    const x = (cx - r.left) / this.scale, y = (cy - r.top) / this.scale;
    let best: Marker | null = null, bd = 14 / this.scale + 6;
    for (const p of this.markerPts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.m; } }
    return best;
  }
  screenOf(m: Marker) {
    const p = this.markerPts.find((q) => q.m.kind === m.kind && q.m.id === m.id);
    if (!p) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + p.x * this.scale, y: r.top + p.y * this.scale };
  }
  update(_s: GameState) { /* drawn every frame */ }
  resetView() { /* fixed view */ }
  resize(w: number, h: number) {
    const s = this.pixelHeight / h;
    this.W = Math.round(w * s); this.H = Math.round(h * s);
    this.scale = w / this.W;
    this.canvas.width = this.W; this.canvas.height = this.H;
    Object.assign(this.canvas.style, { width: w + 'px', height: h + 'px', imageRendering: 'pixelated' });
    this.g.imageSmoothingEnabled = false;
  }
  private pat(key: keyof typeof TEX) {
    let p = this.patterns.get(key);
    if (!p) { reseed(key.length * 31); p = this.g.createPattern(TEX[key](), 'repeat')!; this.patterns.set(key, p); }
    return p;
  }

  draw(s: GameState) {
    const g = this.g, W = this.W, H = this.H;
    // background: sea (top) or sky+sea (iso)
    if (this.iso) {
      g.drawImage(skyCanvas(64), 0, 0, W, H * 0.35);
      g.fillStyle = this.pat('water'); g.fillRect(0, H * 0.35, W, H);
    } else {
      g.fillStyle = this.pat('water'); g.fillRect(0, 0, W, H);
    }
    const xs = s.geo.vertices.map((v) => v.x), ys = s.geo.vertices.map((v) => v.y);
    const bw = Math.max(...xs) - Math.min(...xs) + 2, bh = Math.max(...ys) - Math.min(...ys) + 2;
    const squash = this.iso ? 0.58 : 1;
    const unit = Math.floor(Math.min((W * 0.92) / bw, (H * (this.iso ? 0.78 : 0.9)) / (bh * squash)));
    const cx = Math.floor(W / 2), cy = Math.floor(this.iso ? H * 0.6 : H / 2);
    const P = (x: number, y: number, z = 0) => [Math.round(cx + x * unit), Math.round(cy + y * unit * squash - z)] as const;
    this.Pf = P; this.last = s;

    const order = [...s.geo.hexes].sort((a, b) => a.y - b.y);
    // beach
    for (const hx of order) {
      g.fillStyle = PAL.sand0;
      this.hexPath(hx.x, hx.y, 1.13, P, 0); g.fill();
    }
    for (const hx of order) {
      const t = s.terrains[hx.id];
      const z = this.iso ? HEIGHT[t] : 0;
      if (this.iso) { // side walls
        g.fillStyle = PAL.wood0;
        this.hexPath(hx.x, hx.y, 0.97, P, 0); g.fill();
        g.fillStyle = PAL.wood1;
        for (let k = 1; k < z; k++) { this.hexPath(hx.x, hx.y, 0.97, P, k); g.fill(); }
      }
      g.fillStyle = this.pat(TOP[t]);
      this.hexPath(hx.x, hx.y, 0.97, P, z); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke();
      this.deco(t, hx.x, hx.y, P, z, unit, hx.id);
    }
    // roads
    for (const [eid, owner] of Object.entries(s.roads)) {
      const e = s.geo.edges[Number(eid)];
      const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b];
      const z = this.iso ? Math.max(...e.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0;
      const [x1, y1] = P(a.x * 0.85 + b.x * 0.15, a.y * 0.85 + b.y * 0.15, z);
      const [x2, y2] = P(b.x * 0.85 + a.x * 0.15, b.y * 0.85 + a.y * 0.15, z);
      g.strokeStyle = PAL.ink; g.lineWidth = Math.max(3, unit * 0.16); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.strokeStyle = s.players[owner].color; g.lineWidth = Math.max(2, unit * 0.1); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    // tokens
    for (const hx of order) {
      const n = s.numbers[hx.id];
      if (n == null) continue;
      const z = this.iso ? HEIGHT[s.terrains[hx.id]] : 0;
      const [x, y] = P(hx.x, hx.y, z);
      const r = Math.max(5, Math.round(unit * 0.27));
      g.fillStyle = PAL.tokenEdge; g.beginPath(); g.ellipse(x, y + 1, r, r * (this.iso ? 0.75 : 1), 0, 0, 7); g.fill();
      g.fillStyle = PAL.token; g.beginPath(); g.ellipse(x, y, r, r * (this.iso ? 0.75 : 1), 0, 0, 7); g.fill();
      g.fillStyle = n === 6 || n === 8 ? PAL.red : PAL.ink;
      g.font = `${Math.max(6, Math.round(r * 0.9))}px "Press Start 2P"`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), x + 1, y - 1);
      const pips = PIPS[n];
      for (let i = 0; i < pips; i++) g.fillRect(x - pips + i * 2, y + Math.round(r * 0.5), 1, 1);
    }
    // buildings
    const blds = Object.entries(s.buildings).map(([v, b]) => ({ v: s.geo.vertices[Number(v)], b })).sort((a, b) => a.v.y - b.v.y);
    for (const { v, b } of blds) {
      const z = this.iso ? Math.max(...v.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0;
      const [x, y] = P(v.x, v.y, z);
      const u = Math.max(4, Math.round(unit * 0.12));
      this.building(x, y, u, s.players[b.owner].color, b.kind === 'keep');
    }
    // bandit
    const bhx = s.geo.hexes[s.bandit];
    const [bx, by] = P(bhx.x + 0.32, bhx.y + 0.2, this.iso ? HEIGHT[s.terrains[bhx.id]] : 0);
    this.banditSprite(bx, by, Math.max(2, Math.round(unit * 0.08)));

    // tutorial highlights (not clickable)
    if (this.hl.list.length) {
      g.globalAlpha = 0.5 + Math.abs(Math.sin(performance.now() / 300)) * 0.5;
      g.strokeStyle = this.hl.color; g.fillStyle = this.hl.color; g.lineWidth = 3;
      for (const m of this.hl.list) {
        if (m.kind === 'hex') { const h = s.geo.hexes[m.id]; this.hexPath(h.x, h.y, 0.9, P, this.iso ? HEIGHT[s.terrains[h.id]] : 0); g.stroke(); }
        else if (m.kind === 'vertex') { const v = s.geo.vertices[m.id]; const [x, y] = P(v.x, v.y, this.iso ? Math.max(...v.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0); g.strokeRect(x - 5, y - 5, 10, 10); }
        else { const e = s.geo.edges[m.id]; const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b]; const z = this.iso ? Math.max(...e.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0; const [x1, y1] = P(a.x, a.y, z), [x2, y2] = P(b.x, b.y, z); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      }
      g.globalAlpha = 1;
    }
    // clickable markers
    this.markerPts = [];
    const pulse = 0.5 + Math.abs(Math.sin(performance.now() / 250)) * 0.5;
    g.globalAlpha = pulse;
    g.fillStyle = '#ffe066'; g.strokeStyle = '#ffe066';
    for (const m of this.markerList) {
      let x = 0, y = 0;
      if (m.kind === 'vertex') {
        const v = s.geo.vertices[m.id];
        const z = this.iso ? Math.max(...v.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0;
        [x, y] = P(v.x, v.y, z);
        g.fillRect(x - 3, y - 3, 6, 6);
      } else if (m.kind === 'edge') {
        const e = s.geo.edges[m.id];
        const a = s.geo.vertices[e.a], b = s.geo.vertices[e.b];
        const z = this.iso ? Math.max(...e.hexes.map((h) => HEIGHT[s.terrains[h]])) : 0;
        const [x1, y1] = P(a.x * 0.8 + b.x * 0.2, a.y * 0.8 + b.y * 0.2, z);
        const [x2, y2] = P(b.x * 0.8 + a.x * 0.2, b.y * 0.8 + a.y * 0.2, z);
        g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        x = (x1 + x2) / 2; y = (y1 + y2) / 2;
      } else {
        const h = s.geo.hexes[m.id];
        const z = this.iso ? HEIGHT[s.terrains[h.id]] : 0;
        g.lineWidth = 2; this.hexPath(h.x, h.y, 0.85, P, z); g.stroke();
        [x, y] = P(h.x, h.y, z);
      }
      this.markerPts.push({ m, x, y });
    }
    g.globalAlpha = 1;
  }

  private hexPath(x: number, y: number, r: number, P: (x: number, y: number, z?: number) => readonly [number, number], z: number) {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      const [px, py] = P(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }

  private deco(t: string, hx: number, hy: number, P: (x: number, y: number, z?: number) => readonly [number, number], z: number, unit: number, seed: number) {
    const g = this.g;
    let a = seed * 9301 + 49297;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
    const u = Math.max(1, Math.round(unit / 12));
    const spots = (n: number) => Array.from({ length: n }, () => {
      const ang = rnd() * Math.PI * 2, r = 0.45 + rnd() * 0.33;
      return P(hx + Math.cos(ang) * r, hy + Math.sin(ang) * r, z);
    }).sort((p, q) => p[1] - q[1]);
    if (t === 'woodland' || t === 'meadow') for (const [x, y] of spots(t === 'woodland' ? 6 : 1)) {
      g.fillStyle = PAL.wood0; g.fillRect(x - u / 2, y - u, u, u * 2);
      for (let k = 0; k < 3; k++) {
        const w = (4 - k) * u * 1.4, yy = y - u - k * u * 1.6;
        g.fillStyle = k % 2 ? PAL.pine2 : PAL.pine1;
        g.beginPath(); g.moveTo(x - w / 2, yy); g.lineTo(x + w / 2, yy); g.lineTo(x, yy - u * 2.6); g.fill();
      }
    }
    if (t === 'meadow') for (const [x, y] of spots(3)) {
      g.fillStyle = PAL.wool; g.fillRect(x - u * 1.5, y - u * 2, u * 3, u * 2);
      g.fillStyle = PAL.dark; g.fillRect(x + u * 1.5, y - u * 2, u, u); g.fillRect(x - u, y, u / 2 + 0.5, u); g.fillRect(x + u, y, u / 2 + 0.5, u);
    }
    if (t === 'farmland') for (const [x, y] of spots(8)) { g.fillStyle = PAL.wheat0; g.fillRect(x, y - u * 3, u, u * 3); g.fillStyle = PAL.wheat2; g.fillRect(x, y - u * 3, u, u); }
    if (t === 'claypits') for (const [x, y] of spots(3)) { g.fillStyle = PAL.clay0; g.fillRect(x - u * 2, y - u * 2, u * 4, u * 2); g.fillStyle = PAL.clay2; g.fillRect(x - u, y - u * 3, u * 2, u); }
    if (t === 'highlands') {
      for (const [x, y] of spots(3)) {
        g.fillStyle = PAL.rock0; g.beginPath(); g.moveTo(x - u * 3, y); g.lineTo(x + u * 3, y); g.lineTo(x, y - u * 6); g.fill();
        g.fillStyle = PAL.rock2; g.beginPath(); g.moveTo(x - u, y - u * 4); g.lineTo(x, y - u * 6); g.lineTo(x, y); g.fill();
        g.fillStyle = PAL.snow; g.fillRect(x - u / 2, y - u * 6, u, u);
      }
    }
    if (t === 'wastes') for (const [x, y] of spots(2)) { g.fillStyle = '#4f9a45'; g.fillRect(x, y - u * 4, u, u * 4); g.fillRect(x + u, y - u * 3, u, u); g.fillRect(x + u * 2, y - u * 4, u, u * 2); }
  }

  private building(x: number, y: number, u: number, color: string, keep: boolean) {
    const g = this.g;
    if (keep) {
      g.fillStyle = PAL.ink; g.fillRect(x - u * 1.6 - 1, y - u * 3.6 - 1, u * 3.2 + 2, u * 3.6 + 2);
      g.fillStyle = color; g.fillRect(x - u * 1.6, y - u * 2, u * 3.2, u * 2);
      g.fillRect(x - u * 0.6, y - u * 3.6, u * 1.6, u * 1.6);
      g.fillStyle = PAL.rock1; g.fillRect(x - u * 0.6, y - u * 3.6, u * 0.5, u * 0.4); g.fillRect(x + u * 0.5, y - u * 3.6, u * 0.5, u * 0.4);
    } else {
      g.fillStyle = PAL.ink; g.fillRect(x - u - 1, y - u * 1.4, u * 2 + 2, u * 1.4 + 1);
      g.fillStyle = color; g.fillRect(x - u, y - u * 1.3, u * 2, u * 1.3);
      g.fillStyle = PAL.wood1; g.beginPath(); g.moveTo(x - u * 1.3, y - u * 1.3); g.lineTo(x + u * 1.3, y - u * 1.3); g.lineTo(x, y - u * 2.6); g.fill();
      g.fillStyle = PAL.wood0; g.fillRect(x - u * 0.25, y - u * 0.6, u * 0.5, u * 0.6);
    }
  }

  private banditSprite(x: number, y: number, p: number) {
    const g = this.g;
    // 10x12 pixel fox-in-cloak sprite
    const rows = [
      '..o....o..',
      '.oo....oo.',
      '.oooooooo.',
      'kkykkkkykk',
      '.oowwwwoo.',
      '..owwkwo..',
      '...pppp...',
      '..pppppp..',
      '.pppqpppp.',
      '.pppqppppy',
      'pppppppppy',
      'pppppppppp',
    ];
    const col: Record<string, string> = { o: PAL.fox, k: PAL.dark, y: '#f2c14e', w: PAL.white, p: PAL.purple, q: PAL.purple2 };
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '.') return;
      g.fillStyle = col[ch];
      g.fillRect(x + (i - 5) * p, y + (j - 12) * p, p, p);
    }));
  }
}
