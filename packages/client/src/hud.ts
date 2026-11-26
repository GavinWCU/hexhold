// HTML overlay: chunky outlined display text + pixel-font labels.
import { COSTS, GameState, RESOURCES, handSize, publicVP, totalVP } from '@hexhold/engine';
import { RES_COLOR } from './scene3d';

const RES_LABEL: Record<string, string> = { timber: 'Timber', clay: 'Clay', fleece: 'Fleece', grain: 'Grain', stone: 'Stone' };
// 8x8 pixel icons drawn in code.
const ICON_ROWS: Record<string, string[]> = {
  timber: ['...g....', '..ggg...', '.ggGgg..', '..ggg...', '.gGgggg.', 'ggggGggg', '...bb...', '...bb...'],
  clay: ['........', 'rrrRrrrR', 'rrrRrrrR', 'RRRRRRRR', 'rRrrrRrr', 'rRrrrRrr', 'RRRRRRRR', '........'],
  fleece: ['........', '.wwwww..', 'wwwwwwwk', 'wwwwwwkk', 'wwwwwwwk', '.wwwww..', '.k...k..', '.k...k..'],
  grain: ['.y.y.y..', '.yyyyy..', '..yyy.y.', '.y.y.yy.', '..yyyy..', '...yy...', '...gg...', '...gg...'],
  stone: ['........', '...ss...', '..sSss..', '.sSssss.', '.ssssSs.', 'ssSsssss', 'ssssssSs', '........'],
};
const ICON_COL: Record<string, string> = { g: '#2d7a45', G: '#3f9450', b: '#6b3f22', r: '#c25a35', R: '#8a3a22', w: '#f4f1ea', k: '#241c2b', y: '#eec04a', s: '#7b8394', S: '#5d6473' };
const iconCache: Record<string, string> = {};
function icon(r: string) {
  if (!iconCache[r]) {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d')!;
    ICON_ROWS[r].forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = ICON_COL[ch]; g.fillRect(x, y, 1, 1); } }));
    iconCache[r] = c.toDataURL();
  }
  return `<img class="px" src="${iconCache[r]}">`;
}
const RES_ICON = new Proxy({} as Record<string, string>, { get: (_, k: string) => icon(k) });

export function renderHud(root: HTMLElement, s: GameState, me = 0, moment = '') {
  const p = s.players[me];
  const banner = (() => {
    if (s.phase === 'ended') return `${s.players[s.winner!].name === 'You' ? 'You win!' : s.players[s.winner!].name + ' wins!'}`;
    if (s.phase === 'setup') return 'Place your first Hamlet';
    if (s.phase === 'discard') return 'Seven! Discard';
    if (s.offer) return 'Trade offer!';
    if (s.dice) return `${s.players[s.current].name} rolled ${s.dice[0] + s.dice[1]}`;
    return `${s.players[s.current].name}'s turn`;
  })();

  const opponents = s.players.filter((o) => o.id !== me).map((o) => `
    <div class="opp" style="--c:${o.color}">
      <div class="opp-name">${o.name}${s.current === o.id ? ' ▶' : ''}</div>
      <div class="opp-stats"><span class="star">VP ${publicVP(s, o.id)}</span><span>Cards ${handSize(o.hand)}</span><span>Ch ${o.charters.length}</span>${o.wardensPlayed ? `<span>W ${o.wardensPlayed}</span>` : ''}</div>
      ${s.grandRoad === o.id ? '<div class="badge">Grand Road</div>' : ''}${s.watchCaptain === o.id ? '<div class="badge">Watch Captain</div>' : ''}
    </div>`).join('');

  const cards = RESOURCES.map((r) => `
    <div class="card" style="--rc:${RES_COLOR[r]}"><div class="ico">${RES_ICON[r]}</div><div class="cnt">${p.hand[r]}</div><div class="lbl">${RES_LABEL[r]}</div></div>`).join('');

  const builds = ([['Road', COSTS.road], ['Hamlet', COSTS.hamlet], ['Keep', COSTS.keep], ['Charter', COSTS.charter]] as const).map(([n]) => `<button class="btn">${n}</button>`).join('');

  let dialog = '';
  if (s.phase === 'discard') {
    const pid = Number(Object.keys(s.pendingDiscards)[0]);
    const who = s.players[pid];
    dialog = `<div class="dialog"><div class="big">Discard ${s.pendingDiscards[pid]}</div><div class="small">${who.name} has ${handSize(who.hand)} cards</div>
      <div class="row">${RESOURCES.map((r) => `<div class="card sm" style="--rc:${RES_COLOR[r]}"><div class="ico">${RES_ICON[r]}</div><div class="cnt">${who.hand[r]}</div></div>`).join('')}</div>
      <button class="btn go">Discard</button></div>`;
  }
  if (s.offer) {
    const fmt = (h: Partial<Record<string, number>>) => Object.entries(h).filter(([, n]) => n).map(([r, n]) => `${n}${RES_ICON[r]}`).join(' ');
    dialog = `<div class="dialog"><div class="big">Trade</div><div class="small">${s.players[s.offer.from].name} offers ${fmt(s.offer.give)} for ${fmt(s.offer.get)}</div>
      <div class="row">${s.players.filter((o) => o.id !== s.offer!.from).map((o) => `<div class="pill" style="--c:${o.color}">${o.name}: ${s.offer!.accepted.includes(o.id) ? '✔' : s.offer!.declined.includes(o.id) ? '✖' : '…'}</div>`).join('')}</div>
      <button class="btn go">Confirm</button> <button class="btn">Cancel</button></div>`;
  }
  if (s.phase === 'ended') {
    const rows = [...s.players].sort((a, b) => totalVP(s, b.id) - totalVP(s, a.id)).map((o) => `<div class="pill" style="--c:${o.color}">${o.name} ★${totalVP(s, o.id)}</div>`).join('');
    dialog = `<div class="dialog"><div class="big">Game over</div><div class="small">Turn ${s.turn}</div><div class="col">${rows}</div><button class="btn go">Play again</button></div>`;
  }

  root.innerHTML = `
    <div class="title">HEXHOLD</div>
    <div class="banner">${banner}</div>
    <div class="opps">${opponents}</div>
    <div class="me" style="--c:${p.color}">
      <div class="me-top"><span class="me-name">${p.name}</span><span class="vp">★ ${totalVP(s, me)}</span>${s.dice ? `<span class="dice"><b>${s.dice[0]}</b><b>${s.dice[1]}</b></span>` : ''}</div>
      <div class="hand">${cards}</div>
      <div class="builds">${builds}<button class="btn end">End turn</button></div>
    </div>
    ${dialog}
    <div class="tag">${moment}</div>`;
}
