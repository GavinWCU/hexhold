// Procedural pixel-noise textures. Every texture is tiny (16-64 px) and sampled with
// nearest-neighbor filtering so its pixels read as crisp squares.
import { PAL } from './palette';

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
export const reseed = (s: number) => { seed = s >>> 0; };

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

/** Fill with a base color, then scatter short horizontal dashes of the other colors. */
function noise(size: number, base: string, specks: string[], density = 0.35, dash = [1, 3]) {
  const { c, g } = makeCanvas(size, size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const n = Math.floor(size * size * density / 2);
  for (let i = 0; i < n; i++) {
    g.fillStyle = specks[Math.floor(rnd() * specks.length)];
    const w = dash[0] + Math.floor(rnd() * (dash[1] - dash[0] + 1));
    g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), w, 1);
  }
  return c;
}

export const TEX: Record<string, () => HTMLCanvasElement> = {
  grass: () => noise(32, PAL.grass1, [PAL.grass0, PAL.grass2, PAL.grass3, PAL.grass4, PAL.grass2], 0.6, [1, 3]),
  meadow: () => noise(32, PAL.grass2, [PAL.grass1, PAL.grass3, PAL.grass0, '#a6dc6a'], 0.6, [1, 3]),
  forestFloor: () => noise(32, PAL.grass0, [PAL.grass4, PAL.grass1, PAL.pine1, PAL.wood1], 0.6, [1, 2]),
  field: () => {
    const { c, g } = makeCanvas(32, 32);
    g.fillStyle = PAL.wheat1; g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y += 4) { g.fillStyle = PAL.wheat0; g.fillRect(0, y, 32, 1); g.fillStyle = PAL.soil; g.fillRect(0, y + 3, 32, 1); }
    for (let i = 0; i < 120; i++) { g.fillStyle = rnd() < 0.5 ? PAL.wheat2 : PAL.wheat0; g.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 1, 2); }
    return c;
  },
  clay: () => noise(32, PAL.clay1, [PAL.clay0, PAL.clay2, PAL.wood1, '#e08a5c'], 0.55, [1, 3]),
  rock: () => noise(32, PAL.rock1, [PAL.rock0, PAL.rock2, '#6a7082', PAL.snow], 0.5, [1, 2]),
  sand: () => noise(32, PAL.sand0, [PAL.sand1, PAL.sand2, '#e2bd78'], 0.45, [1, 2]),
  dirt: () => noise(16, PAL.wood1, [PAL.wood0, PAL.wood2, PAL.soil], 0.6, [1, 2]),
  pine: () => noise(16, PAL.pine1, [PAL.pine0, PAL.pine2, '#256b3e'], 0.6, [1, 2]),
  wool: () => noise(16, PAL.wool, [PAL.woolShade, '#ffffff'], 0.5, [1, 2]),
  water: () => {
    const { c, g } = makeCanvas(64, 64);
    g.fillStyle = PAL.sea1; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = [PAL.sea0, PAL.sea2, PAL.sea0, PAL.foam][Math.floor(rnd() * 4)];
      g.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 2 + Math.floor(rnd() * 4), 1);
    }
    return c;
  },
  plank: () => {
    const { c, g } = makeCanvas(32, 32);
    g.fillStyle = PAL.wood2; g.fillRect(0, 0, 32, 32);
    for (let x = 0; x < 32; x += 8) {
      g.fillStyle = PAL.wood0; g.fillRect(x, 0, 1, 32);
      g.fillStyle = PAL.wood3; g.fillRect(x + 1, 0, 1, 32);
      for (let i = 0; i < 8; i++) { g.fillStyle = PAL.wood1; g.fillRect(x + 2 + Math.floor(rnd() * 5), Math.floor(rnd() * 32), 1, 2 + Math.floor(rnd() * 3)); }
      g.fillStyle = PAL.wood0; g.fillRect(x + 3 + Math.floor(rnd() * 3), Math.floor(rnd() * 28), 2, 2); // knot
    }
    return c;
  },
  /** Painted wall / cloth: a player color with subtle pixel noise. */
};

export function tinted(color: string, size = 16) {
  const { c, g } = makeCanvas(size, size);
  g.fillStyle = color; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.3; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)';
    g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 1);
  }
  return c;
}

/** Banded, dithered sunset gradient. */
export function skyCanvas(h = 128) {
  const { c, g } = makeCanvas(4, h);
  const stops = [PAL.sky0, PAL.sky1, PAL.sky2, PAL.sky3, PAL.sky4];
  const band = h / (stops.length - 1);
  for (let y = 0; y < h; y++) {
    const i = Math.min(stops.length - 2, Math.floor(y / band));
    const t = (y - i * band) / band;
    for (let x = 0; x < 4; x++) {
      const dither = ((x + y) % 2) * 0.5;
      g.fillStyle = t + dither * 0.25 > 0.62 ? stops[i + 1] : stops[i];
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Blocky stretched cloud strip. */
export function cloudCanvas() {
  const w = 48, h = 12;
  const { c, g } = makeCanvas(w, h);
  const rows = [[8, 22], [3, 36], [0, 46], [5, 30]];
  rows.forEach(([x0, len], i) => {
    const off = Math.floor(rnd() * 6);
    g.fillStyle = i === rows.length - 1 ? PAL.cloudShade : PAL.cloud;
    g.fillRect(x0 + off, 3 + i * 2, len - off, 2);
  });
  return c;
}

/** Number token face (drawn with a pixel font). */
export function tokenCanvas(n: number, pips: number) {
  const { c, g } = makeCanvas(40, 40);
  g.fillStyle = PAL.tokenEdge; g.beginPath(); g.arc(20, 20, 20, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAL.token; g.beginPath(); g.arc(20, 20, 18, 0, Math.PI * 2); g.fill();
  const red = n === 6 || n === 8;
  g.fillStyle = red ? PAL.red : PAL.ink;
  g.font = n >= 10 ? '13px "Press Start 2P"' : '16px "Press Start 2P"';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 21, 18);
  for (let i = 0; i < pips; i++) g.fillRect(20 - pips * 2.5 + i * 5 + 1, 30, 3, 3);
  return c;
}

export function labelCanvas(text: string, bg: string, fg = PAL.ink) {
  const { c, g } = makeCanvas(32, 16);
  g.fillStyle = PAL.ink; g.fillRect(0, 0, 32, 16);
  g.fillStyle = bg; g.fillRect(1, 1, 30, 14);
  g.fillStyle = fg; g.font = '8px "Press Start 2P"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 16, 9);
  return c;
}

/** Sky dome texture: v=1 zenith (blue) -> v=0 horizon (peach). Colors bunch up near the
 *  horizon so the sunset bands are visible at low camera angles. */
export function domeCanvas(h = 128) {
  const { c, g } = makeCanvas(4, h);
  // fraction of height measured from the BOTTOM (horizon)
  const bands: [number, string][] = [[0.04, PAL.sky4], [0.09, PAL.sky3], [0.16, PAL.sky2], [0.3, PAL.sky1], [1, PAL.sky0]];
  for (let y = 0; y < h; y++) {
    const f = 1 - y / h;
    let i = bands.findIndex(([t]) => f <= t);
    const [t, col] = bands[i];
    const prev = i > 0 ? bands[i - 1][0] : 0;
    for (let x = 0; x < 4; x++) {
      // dither near band edges
      const edge = (f - prev) / (t - prev);
      const useNext = i > 0 && edge < 0.25 && (x + y) % 2 === 0;
      g.fillStyle = useNext ? bands[i - 1][1] : col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
