// 8x8 pixel icons drawn in code, returned as <img> tags.
const ICON_ROWS: Record<string, string[]> = {
  timber: ['...g....', '..ggg...', '.ggGgg..', '..ggg...', '.gGgggg.', 'ggggGggg', '...bb...', '...bb...'],
  clay: ['........', 'rrrRrrrR', 'rrrRrrrR', 'RRRRRRRR', 'rRrrrRrr', 'rRrrrRrr', 'RRRRRRRR', '........'],
  fleece: ['........', '.wwwww..', 'wwwwwwwk', 'wwwwwwkk', 'wwwwwwwk', '.wwwww..', '.k...k..', '.k...k..'],
  grain: ['.y.y.y..', '.yyyyy..', '..yyy.y.', '.y.y.yy.', '..yyyy..', '...yy...', '...gg...', '...gg...'],
  stone: ['........', '...ss...', '..sSss..', '.sSssss.', '.ssssSs.', 'ssSsssss', 'ssssssSs', '........'],
};
const ICON_COL: Record<string, string> = { g: '#2d7a45', G: '#3f9450', b: '#6b3f22', r: '#c25a35', R: '#8a3a22', w: '#f4f1ea', k: '#241c2b', y: '#eec04a', s: '#7b8394', S: '#5d6473' };
const cache: Record<string, string> = {};
export function iconUrl(r: string) {
  if (!cache[r]) {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d')!;
    ICON_ROWS[r].forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = ICON_COL[ch]; g.fillRect(x, y, 1, 1); } }));
    cache[r] = c.toDataURL();
  }
  return cache[r];
}
export const icon = (r: string, size = '') => `<img class="px ${size}" alt="${r}" src="${iconUrl(r)}">`;
