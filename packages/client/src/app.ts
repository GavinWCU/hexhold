// The playable app: home screen, lobby, and the interactive game screen.
import {
  Action, BotLevel, COSTS, CharterType, Hand, RESOURCES, Resource, actingPlayers, canAfford, canPlaceRoad,
  handSize, legalBanditHexes, legalHamletVertices, legalKeepVertices, legalRoadEdges, publicVP, totalVP, tradeRate, MapType,
} from '@hexhold/engine';
import { GameHost, Seat } from './controller';
import { PublicSeat, RoomClient, RoomHost, randomCode } from './net';
import { ClientSession, HostSession, LocalSession, Session, View } from './session';
import { Marker, RES_COLOR, Scene3D } from './scene3d';
import { Render2D } from './render2d';
import { PLAYER_COLORS } from './palette';
import { play, isMuted, setMuted } from './sound';
import { icon } from './icons';
import { Pt, centerOf, fly, pop } from './fx';
import { TERRAIN_RESOURCE } from '@hexhold/engine';
import { attachTutorial, Tutorial } from './tutorial';

type Mode = 'pixel3d' | 'smooth3d' | 'iso2d' | 'top2d';
type Renderer = (Scene3D | Render2D) & { setMarkers(l: Marker[]): void; setHighlights(l: Marker[], color?: string): void; onPick: ((m: Marker) => void) | null; update(v: View): void; hexScreen(id: number): Pt; vertexScreen(id: number): Pt; edgeScreen(id: number): Pt };

const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const RES_LABEL: Record<Resource, string> = { timber: 'Timber', clay: 'Clay', fleece: 'Fleece', grain: 'Grain', stone: 'Stone' };
const CHARTER_INFO: Record<CharterType, [string, string]> = {
  warden: ['Warden', 'Move the Bandit and steal a card. Counts toward Watch Captain.'],
  monument: ['Monument', 'Worth 1 renown. Kept hidden until you win.'],
  pathmakers: ['Pathmakers', 'Build 2 roads for free.'],
  windfall: ['Windfall', 'Take any 2 resources from the bank.'],
  embargo: ['Embargo', 'Name a resource. Everyone gives you all of theirs.'],
};
const BOT_NAMES = ['Bramble', 'Juniper', 'Wick', 'Pip', 'Tamsin', 'Moss', 'Rook', 'Fennel'];

function store<T>(key: string, fallback: T): T { try { const v = localStorage.getItem('hexhold.' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key: string, v: unknown) { try { localStorage.setItem('hexhold.' + key, JSON.stringify(v)); } catch { /* ignore */ } }

interface Settings { name: string; mode: Mode; players: number; level: BotLevel; mapType: MapType; targetVP: number; friendly: boolean }
const settings: Settings = store('settings', { name: '', mode: 'pixel3d', players: 4, level: 'normal', mapType: 'spiral', targetVP: 10, friendly: false });
const saveSettings = () => save('settings', settings);

const root = () => $('#app');

// ======================= HOME =======================

export function startApp() {
  const q = new URLSearchParams(location.search);
  const room = q.get('room');
  if (room) return joinScreen(room.toUpperCase());
  homeScreen();
}

function optionsForm() {
  return `
    <label>Players <select name="players">${[3, 4, 5, 6].map((n) => `<option ${n === settings.players ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Bots <select name="level">${(['easy', 'normal', 'hard'] as BotLevel[]).map((l) => `<option value="${l}" ${l === settings.level ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select></label>
    <label>Map <select name="mapType"><option value="starter" ${settings.mapType === 'starter' ? 'selected' : ''}>Starter (balanced)</option><option value="spiral" ${settings.mapType === 'spiral' ? 'selected' : ''}>Random island</option><option value="random" ${settings.mapType === 'random' ? 'selected' : ''}>Random numbers too</option></select></label>
    <label>Win at <select name="targetVP">${[8, 10, 12, 14].map((n) => `<option ${n === settings.targetVP ? 'selected' : ''}>${n}</option>`).join('')}</select> renown</label>
    <label class="chk"><input type="checkbox" name="friendly" ${settings.friendly ? 'checked' : ''}> Friendly Bandit (spares players with 2 renown)</label>`;
}

function readOptions(form: HTMLElement) {
  const v = (n: string) => (form.querySelector(`[name=${n}]`) as HTMLInputElement | HTMLSelectElement | null);
  settings.name = (v('name')?.value || settings.name || 'Player').trim().slice(0, 14);
  settings.players = Number(v('players')!.value);
  settings.level = v('level')!.value as BotLevel;
  settings.mapType = v('mapType')!.value as MapType;
  settings.targetVP = Number(v('targetVP')!.value);
  settings.friendly = (v('friendly') as HTMLInputElement).checked;
  const m = v('mode'); if (m) settings.mode = m.value as Mode;
  saveSettings();
}

function homeScreen(note = '') {
  const autosave = store<string | null>('autosave', null);
  root().innerHTML = `
  <div class="screen home">
    <div class="logo">HEXHOLD</div>
    <div class="tagline">Settle the Isle. Trade. Build. Outsmart the Bandit.</div>
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="panel form" id="form">
      <label>Your name <input name="name" maxlength="14" value="${esc(settings.name)}" placeholder="Your name"></label>
      <label>Look <select name="mode">${[['pixel3d', 'Low-poly pixel 3D'], ['smooth3d', 'Smooth 3D'], ['iso2d', 'Isometric 2D'], ['top2d', 'Top-down 2D']].map(([v, l]) => `<option value="${v}" ${v === settings.mode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${optionsForm()}
    </div>
    ${store('tutorialDone', false) ? '' : '<div class="newhere"><span>New to Hexhold?</span><button class="btn go big" data-act="tutorial">Learn to play</button></div>'}
    <div class="row wrap">
      <button class="btn go" data-act="solo">Play vs bots</button>
      <button class="btn" data-act="host">Host a room</button>
      ${autosave ? '<button class="btn alt" data-act="continue">Continue saved game</button>' : ''}
      <label class="btn alt file">Load file<input type="file" accept=".json,application/json" hidden></label>
    </div>
    <div class="row wrap"><button class="btn alt" data-act="tutorial">Tutorial</button><button class="btn alt" data-act="rules">Rules</button></div>
    <div class="panel join">
      <div class="small">Join a friend</div>
      <div class="row"><input id="code" maxlength="6" placeholder="ROOM CODE"><input id="pw" type="password" placeholder="Password (if any)"><button class="btn" data-act="join">Join</button></div>
    </div>
  </div>`;
  const form = $('#form');
  root().onclick = (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    play('click');
    readOptions(form);
    if (act === 'solo') startSolo();
    if (act === 'tutorial') startTutorial();
    if (act === 'rules') rulesScreen();
    if (act === 'host') hostLobby();
    if (act === 'continue') { try { startGame(new LocalSession(GameHost.load(store('autosave', '')))); } catch (err) { homeScreen(String(err)); } }
    if (act === 'join') {
      const code = ($('#code') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length < 4) return;
      joinScreen(code, ($('#pw') as HTMLInputElement).value);
    }
  };
  const file = root().querySelector('input[type=file]') as HTMLInputElement;
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try { startGame(new LocalSession(GameHost.load(await f.text()))); } catch (err) { homeScreen('Could not load that file: ' + err); }
  };
}

function botSeats(n: number, from: number, level: BotLevel): Seat[] {
  const names = ['Garrold', ...BOT_NAMES.slice().sort(() => Math.random() - 0.5)];
  return Array.from({ length: n - from }, (_, i) => ({ name: names[i], color: PLAYER_COLORS[from + i], kind: 'bot', level, online: true }));
}

function startSolo() {
  const seats: Seat[] = [{ name: settings.name || 'You', color: PLAYER_COLORS[0], kind: 'human', level: 'normal', online: true }, ...botSeats(settings.players, 1, settings.level)];
  const host = new GameHost({ seats, seed: Math.floor(Math.random() * 1e9), mapType: settings.players >= 5 && settings.mapType === 'starter' ? 'spiral' : settings.mapType, targetVP: settings.targetVP, friendlyBandit: settings.friendly, players: [] });
  startGame(new LocalSession(host));
}

function startTutorial() {
  const seats: Seat[] = [
    { name: settings.name || 'You', color: PLAYER_COLORS[0], kind: 'human', level: 'normal', online: true },
    { name: 'Bramble', color: PLAYER_COLORS[1], kind: 'bot', level: 'easy', online: true },
    { name: 'Juniper', color: PLAYER_COLORS[2], kind: 'bot', level: 'easy', online: true },
    { name: 'Wick', color: PLAYER_COLORS[3], kind: 'bot', level: 'easy', online: true },
  ];
  const host = new GameHost({ seats, seed: 20261125, mapType: 'starter', targetVP: 10, players: [] });
  // You go first in the tutorial.
  host.state.setup!.order = [0, 1, 2, 3, 3, 2, 1, 0];
  host.state.current = 0;
  host.state.log = ['Practice game: you go first.'];
  host.paused = true;
  const s = new LocalSession(host);
  startGame(s, { tutorial: true });
}

export function rulesHtml() {
  const c = (h: Partial<Hand>) => RESOURCES.flatMap((r) => Array(h[r] ?? 0).fill(icon(r, 'xs'))).join('');
  return `
  <div class="rules">
    <section><h3>Goal</h3><p>First to <b>10 renown <span class="st">★</span></b> on their own turn wins. Hamlet 1<span class="st">★</span> · Keep 2<span class="st">★</span> · Monument 1<span class="st">★</span> · Grand Road 2<span class="st">★</span> · Watch Captain 2<span class="st">★</span>.</p></section>
    <section><h3>Your turn</h3><ol><li><b>Roll</b> two dice. Every tile with that number pays 1 card to each Hamlet and 2 to each Keep touching it, for everyone.</li><li><b>Trade</b> with players (only on your turn) or the bank.</li><li><b>Build</b> and play up to one charter. Then end your turn.</li></ol></section>
    <section><h3>Costs</h3><div class="costs"><span>Road</span><i>${c({ clay: 1, timber: 1 })}</i><span>Hamlet</span><i>${c({ clay: 1, timber: 1, fleece: 1, grain: 1 })}</i><span>Keep</span><i>${c({ stone: 3, grain: 2 })}</i><span>Charter</span><i>${c({ stone: 1, fleece: 1, grain: 1 })}</i></div>
      <p>Limits: 5 Hamlets, 4 Keeps, 15 Roads each.</p></section>
    <section><h3>Placing pieces</h3><p>Hamlets go on corners, on your road, with no building on any of the 3 neighbouring corners. Roads go on edges and must connect to your pieces; you can't build through someone else's Hamlet. A Keep upgrades your own Hamlet.</p></section>
    <section><h3>Starting</h3><p>Everyone places a Hamlet + Road, then again in reverse order. Your second Hamlet gives you one card from each tile it touches.</p></section>
    <section><h3>Trading</h3><p>Bank: 4 of one kind for 1 of anything. A building on a 3:1 port makes it 3 for 1; a 2:1 port makes that port's resource 2 for 1. Player trades: any deal both sides agree to, but no gifts.</p></section>
    <section><h3>Rolling a 7</h3><p>Nobody collects. Anyone with more than 7 cards discards half (rounded down). The roller moves the <b>Bandit</b> to another tile, which stops producing, and steals a random card from a player with a building there.</p></section>
    <section><h3>Charters</h3><ul><li><b>Warden</b> (14): move the Bandit and steal.</li><li><b>Monument</b> (5): 1<span class="st">★</span>, kept secret.</li><li><b>Pathmakers</b> (2): build 2 free roads.</li><li><b>Windfall</b> (2): take any 2 cards from the bank.</li><li><b>Embargo</b> (2): name a resource; everyone gives you all of theirs.</li></ul><p>One charter per turn, any time on your turn (even before rolling), but not on the turn you bought it.</p></section>
    <section><h3>Bonuses</h3><p><b>Grand Road</b>: first with a 5+ road chain gets +2<span class="st">★</span>; someone with a longer one takes it. <b>Watch Captain</b>: first to play 3 Wardens gets +2<span class="st">★</span>; more Wardens takes it.</p></section>
    <section><h3>5 and 6 players</h3><p>A bigger island. After each turn, the player 3 seats to the left gets a short build-only turn (no rolling or player trades).</p></section>
  </div>`;
}

function rulesScreen() {
  root().innerHTML = `<div class="screen lobby"><div class="logo sm">HOW TO PLAY</div><div class="panel">${rulesHtml()}</div>
    <div class="row"><button class="btn go" data-act="tutorial">Try the tutorial</button><button class="btn alt" data-act="back">Back</button></div></div>`;
  root().onclick = (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'back') homeScreen();
    if (act === 'tutorial') startTutorial();
  };
}

// ======================= HOST LOBBY =======================

function hostLobby() {
  const code = randomCode();
  const password = (store<string>('lastPassword', '') || '');
  const room = new RoomHost(code);
  const seats: Seat[] = [{ name: settings.name || 'Host', color: PLAYER_COLORS[0], kind: 'human', level: 'normal', online: true }, ...botSeats(settings.players, 1, settings.level)];
  let pw = password;
  const link = `${location.origin}${location.pathname}?room=${code}`;
  const pub = (): PublicSeat[] => seats.map((s) => ({ name: s.name, color: s.color, kind: s.kind, level: s.level, online: s.kind !== 'remote' || s.online }));
  const broadcastLobby = () => room.broadcast(() => ({ t: 'lobby', seats: pub(), targetVP: settings.targetVP }));
  room.onHello = (peerId, name, given) => {
    if (pw && given !== pw) return { t: 'denied', reason: 'Wrong password.' };
    const clean = name.trim().slice(0, 14) || 'Friend';
    let idx = seats.findIndex((s) => s.kind === 'remote' && s.name.toLowerCase() === clean.toLowerCase());
    if (idx < 0) idx = seats.findIndex((s) => s.kind === 'bot');
    if (idx < 0) return { t: 'denied', reason: 'The room is full.' };
    seats[idx] = { name: clean, color: PLAYER_COLORS[idx], kind: 'remote', level: seats[idx].level, online: true };
    setTimeout(() => { draw(); broadcastLobby(); }, 30);
    return { t: 'welcome', seat: idx, code };
  };
  room.onLeave = (seat) => {
    if (seat === null || seats[seat]?.kind !== 'remote') return;
    const used = new Set(seats.map((s) => s.name));
    const name = ['Garrold', ...BOT_NAMES].find((n) => !used.has(n)) ?? 'Bot';
    seats[seat] = { ...botSeats(seat + 1, seat, settings.level)[0], name, color: PLAYER_COLORS[seat] };
    draw(); broadcastLobby();
  };
  let status = 'Opening room…';
  room.ready.then(() => { status = 'Room open. Share the code or link.'; draw(); }).catch((e) => { status = 'Could not open the room: ' + (e?.type ?? e); draw(); });

  const draw = () => {
    root().innerHTML = `
    <div class="screen lobby">
      <div class="logo sm">HEXHOLD</div>
      <div class="panel">
        <div class="small">${esc(status)}</div>
        <div class="code" data-testid="room-code">${code}</div>
        <div class="row wrap"><input class="link" readonly value="${esc(link)}"><button class="btn" data-act="copy">Copy link</button></div>
        <label class="row">Password <input id="pw" value="${esc(pw)}" placeholder="optional"></label>
      </div>
      <div class="panel seats">
        ${seats.map((s, i) => `<div class="seat" style="--c:${s.color}"><span class="dot"></span><b>${esc(s.name)}</b>
          <span class="small">${s.kind === 'human' ? 'You (host)' : s.kind === 'remote' ? 'Friend' : `Bot`}</span>
          ${s.kind === 'bot' ? `<select data-level="${i}">${(['easy', 'normal', 'hard'] as BotLevel[]).map((l) => `<option ${l === s.level ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>`).join('')}
        <div class="small">Empty seats are played by bots. Friends who join take a bot's seat.</div>
      </div>
      <div class="row"><button class="btn go" data-act="start">Start game</button><button class="btn alt" data-act="back">Cancel</button></div>
    </div>`;
  };
  draw();
  root().onclick = (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'copy') { navigator.clipboard?.writeText(link); play('click'); }
    if (act === 'back') { room.close(); homeScreen(); }
    if (act === 'start') {
      play('click');
      const host = new GameHost({ seats, seed: Math.floor(Math.random() * 1e9), mapType: settings.players >= 5 && settings.mapType === 'starter' ? 'spiral' : settings.mapType, targetVP: settings.targetVP, friendlyBandit: settings.friendly, players: [] });
      startGame(new HostSession(host, room, code));
    }
  };
  root().onchange = (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'pw') { pw = (t as HTMLInputElement).value; save('lastPassword', pw); }
    const lv = t.getAttribute('data-level');
    if (lv) { seats[Number(lv)].level = (t as HTMLSelectElement).value as BotLevel; broadcastLobby(); }
  };
}

// ======================= JOIN =======================

function joinScreen(code: string, password?: string, note = '') {
  const remembered = store<Record<string, string>>('roomPasswords', {});
  if (password === undefined) password = remembered[code];
  if (!settings.name || note) {
    root().innerHTML = `<div class="screen home"><div class="logo">HEXHOLD</div>${note ? `<div class="note">${esc(note)}</div>` : ''}<div class="panel form"><div class="small">Joining room ${esc(code)}</div>
      <label>Your name <input id="nm" maxlength="14" placeholder="Your name" value="${esc(settings.name)}"></label><label>Password <input id="pw" type="password" placeholder="if the host set one"></label>
      <button class="btn go" id="go">Join</button><button class="btn alt" id="cancel">Cancel</button></div></div>`;
    $('#go').onclick = () => {
      settings.name = ($('#nm') as HTMLInputElement).value.trim().slice(0, 14) || 'Friend';
      saveSettings();
      joinScreen(code, ($('#pw') as HTMLInputElement).value);
    };
    $('#cancel').onclick = () => { history.replaceState(null, '', location.pathname); homeScreen(); };
    return;
  }
  const client = new RoomClient(code, settings.name, password);
  const session = new ClientSession(client, code);
  const lobby = (seats: PublicSeat[]) => {
    if (session.view()) return;
    root().innerHTML = `<div class="screen lobby"><div class="logo sm">HEXHOLD</div><div class="panel"><div class="small">Room</div><div class="code">${esc(code)}</div>
      <div class="small">${esc(session.status ?? '')} · Waiting for the host to start…</div></div>
      <div class="panel seats">${seats.map((s) => `<div class="seat" style="--c:${s.color}"><span class="dot"></span><b>${esc(s.name)}</b><span class="small">${s.kind === 'bot' ? 'Bot' : s.kind === 'human' ? 'Host' : 'Friend'}</span></div>`).join('')}</div>
      <button class="btn alt" id="leave">Leave</button></div>`;
    $('#leave').onclick = () => { session.leave(); history.replaceState(null, '', location.pathname); homeScreen(); };
  };
  root().innerHTML = `<div class="screen lobby"><div class="logo sm">HEXHOLD</div><div class="panel"><div class="small" id="st">Connecting to room ${esc(code)}…</div></div><button class="btn alt" id="leave">Leave</button></div>`;
  $('#leave').onclick = () => { session.leave(); history.replaceState(null, '', location.pathname); homeScreen(); };
  session.lobbyCbs.push(lobby);
  session.deniedCbs.push((r) => { session.leave(); if (/password/i.test(r)) joinScreen(code, undefined, r); else homeScreen(r); });
  session.onChange(() => { if (session.view() && password !== undefined) save('roomPasswords', { ...store<Record<string, string>>('roomPasswords', {}), [code]: password }); });
  let started = false;
  session.onChange(() => {
    if (!started && session.view()) { started = true; startGame(session); }
    else if (!started) { const st = document.getElementById('st'); if (st) st.textContent = session.status ?? ''; }
  });
}

// ======================= GAME =======================

interface UIState {
  build: 'road' | 'hamlet' | 'keep' | null;
  dialog: null | 'trade' | 'menu' | 'windfall' | 'embargo' | 'victim' | 'charters' | 'rules';
  tradeTab: 'players' | 'bank';
  give: Partial<Hand>; get: Partial<Hand>;
  bankGive: Resource; bankGet: Resource;
  discard: Partial<Hand>;
  windfall: Resource[];
  victimHex: number;
  logOpen: boolean;
  toast: string;
}

function startGame(session: Session, opts: { tutorial?: boolean } = {}) {
  const act = (a: Action) => {
    if (tutorial?.active && !tutorial.allows(a)) { toast(tutorial.blockedMessage()); return; }
    session.act(a);
  };
  root().innerHTML = `<canvas id="view"></canvas><div id="hud" class="live"></div>`;
  const hud = $('#hud');
  let renderer!: Renderer;
  let lastDice = '';
  let wasMyTurn = false;
  let built = false;
  const ui: UIState = { build: null, dialog: null, tradeTab: 'players', give: {}, get: {}, bankGive: 'timber', bankGet: 'stone', discard: {}, windfall: [], victimHex: -1, logOpen: false, toast: '' };
  let prev: View | null = null;
  let tutorial: Tutorial | null = null;

  /** (Re)create the renderer for the current look and window size. */
  const rebuild = () => {
    const old = document.getElementById('view') as HTMLCanvasElement;
    const fresh = document.createElement('canvas');
    fresh.id = 'view';
    old.replaceWith(fresh);
    (renderer as unknown as Scene3D | undefined)?.dispose?.();
    const W = window.innerWidth, H = window.innerHeight;
    if (settings.mode === 'iso2d' || settings.mode === 'top2d') {
      const r = new Render2D(fresh, settings.mode === 'iso2d', H < W ? 300 : 420);
      r.resize(W, H);
      renderer = r as unknown as Renderer;
    } else {
      const r = new Scene3D(fresh, { pixel: settings.mode === 'pixel3d', pixelHeight: H < W ? 300 : 440, camera: 'board' });
      r.resize(W, H);
      renderer = r as unknown as Renderer;
    }
    built = false;
    renderer.onPick = onPick;
    refresh();
  };

  const frame = () => {
    const v = session.view();
    if (v && renderer instanceof Render2D) renderer.draw(v);
    else if (v && renderer instanceof Scene3D && built) renderer.render();
    requestAnimationFrame(frame);
  };

  let resizeT: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(rebuild, 200); });

  // ---------- what can I click? ----------
  function markersFor(v: View): Marker[] {
    const me = session.me;
    if (me < 0 || !actingPlayers(v).includes(me)) return [];
    if (v.phase === 'setup') {
      const st = v.setup!;
      if (st.step === 'hamlet') return legalHamletVertices(v, me, true).map((id) => ({ kind: 'vertex', id }));
      return v.geo.vertices[st.lastHamlet!].edges.filter((e) => canPlaceRoad(v, me, e, st.lastHamlet)).map((id) => ({ kind: 'edge', id }));
    }
    if (v.phase === 'bandit') return legalBanditHexes(v, me).map((id) => ({ kind: 'hex', id }));
    if (v.phase === 'pathmakers') return legalRoadEdges(v, me).map((id) => ({ kind: 'edge', id }));
    if ((v.phase === 'main' || v.phase === 'partner') && !v.offer) {
      if (ui.build === 'road') return legalRoadEdges(v, me).map((id) => ({ kind: 'edge', id }));
      if (ui.build === 'hamlet') return legalHamletVertices(v, me).map((id) => ({ kind: 'vertex', id }));
      if (ui.build === 'keep') return legalKeepVertices(v, me).map((id) => ({ kind: 'vertex', id }));
    }
    return [];
  }

  function victimsOf(v: View, hex: number) {
    const set = new Set<number>();
    for (const vx of v.geo.hexes[hex].vertices) { const b = v.buildings[vx]; if (b && b.owner !== session.me && v.handCounts[b.owner] > 0) set.add(b.owner); }
    return [...set];
  }

  function onPick(m: Marker) {
    const v = session.view();
    if (!v) return;
    play('click');
    if (v.phase === 'setup') return act(m.kind === 'vertex' ? { type: 'PLACE_HAMLET', vertex: m.id } : { type: 'PLACE_ROAD', edge: m.id });
    if (v.phase === 'bandit' && m.kind === 'hex') {
      const victims = victimsOf(v, m.id);
      if (victims.length > 1) { ui.victimHex = m.id; ui.dialog = 'victim'; return refresh(); }
      return act({ type: 'MOVE_BANDIT', hex: m.id, victim: victims[0] ?? null });
    }
    if (v.phase === 'pathmakers' && m.kind === 'edge') return act({ type: 'BUILD_ROAD', edge: m.id });
    if (ui.build === 'road' && m.kind === 'edge') { ui.build = null; return act({ type: 'BUILD_ROAD', edge: m.id }); }
    if (ui.build === 'hamlet' && m.kind === 'vertex') { ui.build = null; return act({ type: 'BUILD_HAMLET', vertex: m.id }); }
    if (ui.build === 'keep' && m.kind === 'vertex') { ui.build = null; return act({ type: 'BUILD_KEEP', vertex: m.id }); }
  }

  // ---------- HUD ----------
  function refresh() {
    const v = session.view();
    if (!v) { hud.innerHTML = `<div class="banner">${esc(session.status ?? 'Loading…')}</div>`; return; }
    if (renderer instanceof Scene3D && !built) { renderer.buildStatic(v); built = true; }
    renderer.update(v);
    if (session.kind === 'local') save('autosave', session.host!.save());
    const me = session.me;
    const p = v.players[me];
    const seats = session.seats();
    const acting = actingPlayers(v).includes(me);
    const myTurn = (v.current === me && !['setup', 'ended'].includes(v.phase)) || (v.phase === 'partner' && v.partner === me) || (v.phase === 'setup' && acting);
    if (myTurn && !wasMyTurn) play('yourturn');
    wasMyTurn = myTurn;
    if (!acting || !['main', 'partner'].includes(v.phase)) ui.build = null;
    if (ui.build === 'road' && !canAfford(p.hand, COSTS.road)) ui.build = null;
    renderer.setMarkers(tutorial?.active && tutorial.quiet ? [] : markersFor(v));

    const diceKey = v.dice ? `${v.turn}-${v.dice.join()}` : '';
    const rolling = diceKey && diceKey !== lastDice;
    lastDice = diceKey;

    const name = (id: number) => (id === me ? 'You' : v.players[id].name);
    const banner = (() => {
      if (tutorial?.active && tutorial.quiet) return 'Learning the basics';
      if (v.phase === 'ended') return v.winner === me ? 'You win!' : `${v.players[v.winner!].name} wins!`;
      if (v.phase === 'setup') return acting ? (v.setup!.step === 'hamlet' ? 'Place a Hamlet' : 'Place a Road') : `${name(v.setup!.order[v.setup!.index])} is placing`;
      if (v.phase === 'discard') return v.pendingDiscards[me] !== undefined ? `Discard ${v.pendingDiscards[me]}` : 'Waiting for discards';
      if (v.phase === 'bandit') return acting ? 'Move the Bandit' : `${name(v.actor ?? v.current)} moves the Bandit`;
      if (v.phase === 'pathmakers') return acting ? `Place ${v.freeRoads} free road${v.freeRoads > 1 ? 's' : ''}` : `${name(v.current)} builds roads`;
      if (v.phase === 'partner') return v.partner === me ? 'Your paired turn' : `${name(v.partner!)}'s paired turn`;
      if (v.phase === 'preRoll') return v.current === me ? 'Your turn: roll!' : `${name(v.current)}'s turn`;
      if (ui.build) return `Tap a glowing spot for your ${ui.build}`;
      if (v.dice) return `${name(v.current)} rolled ${v.dice[0] + v.dice[1]}`;
      return `${name(v.current)}'s turn`;
    })();

    const opps = v.players.filter((o) => o.id !== me).map((o) => {
      const st = seats[o.id];
      const tag = st?.kind === 'bot' ? `Bot · ${st.level}` : st?.kind === 'remote' ? (st.online ? 'Friend' : 'Offline') : 'Host';
      const active = v.current === o.id || (v.phase === 'partner' && v.partner === o.id);
      return `<div class="opp ${active ? 'active' : ''}" data-pid="${o.id}" style="--c:${o.color}">
        <div class="opp-name">${esc(o.name)}${active ? ' ▶' : ''}</div>
        <div class="opp-stats"><span class="star">${publicVP(v, o.id)}★</span><span>${v.handCounts[o.id]} cards</span><span>${v.charterCounts[o.id]} ch</span>${o.wardensPlayed ? `<span>${o.wardensPlayed} W</span>` : ''}</div>
        <div class="opp-tag">${tag}${v.grandRoad === o.id ? ' · Grand Road' : ''}${v.watchCaptain === o.id ? ' · Watch Captain' : ''}</div></div>`;
    }).join('');

    const canAct = (v.phase === 'main' || v.phase === 'partner') && acting && !v.offer;
    const playable = (t: CharterType) => t !== 'monument' && !v.charterPlayedThisStep && p.charters.some((c) => c.type === t && c.boughtOn < v.step);
    const myCh = (['warden', 'pathmakers', 'windfall', 'embargo', 'monument'] as CharterType[]).map((t) => ({ t, n: p.charters.filter((c) => c.type === t).length })).filter((c) => c.n);
    const btn = (act: string, label: string, ok: boolean, cls = '') => `<button class="btn ${cls} ${ui.build === act.replace('build-', '') ? 'on' : ''}" data-act="${act}" ${ok ? '' : 'disabled'}>${label}</button>`;

    let actions = '';
    if (v.phase === 'preRoll' && v.current === me) actions = btn('roll', 'Roll dice', true, 'go big') + (myCh.some((c) => playable(c.t)) ? btn('charters', 'Charters', true) : '');
    else if (canAct) {
      const deckLeft = v.deckCount > 0;
      actions = [
        btn('build-road', `Road <i>${costIcons(COSTS.road)}</i>`, canAfford(p.hand, COSTS.road) && legalRoadEdges(v, me).length > 0),
        btn('build-hamlet', `Hamlet <i>${costIcons(COSTS.hamlet)}</i>`, canAfford(p.hand, COSTS.hamlet) && legalHamletVertices(v, me).length > 0),
        btn('build-keep', `Keep <i>${costIcons(COSTS.keep)}</i>`, canAfford(p.hand, COSTS.keep) && legalKeepVertices(v, me).length > 0),
        btn('buy', `Charter <i>${costIcons(COSTS.charter)}</i>`, canAfford(p.hand, COSTS.charter) && deckLeft),
        btn('trade', 'Trade', handSize(p.hand) > 0),
        myCh.length ? btn('charters', 'Charters', true) : '',
        btn('end', 'End turn', true, 'end'),
      ].join('');
    }

    hud.innerHTML = `
      <div class="topbar">
        <div class="title">HEXHOLD</div>
        <div class="banner" data-testid="banner">${esc(banner)}</div>
        <button class="iconbtn" data-act="menu" aria-label="Menu">☰</button>
      </div>
      ${session.kind !== 'local' ? `<div class="roomtag">${session.kind === 'host' ? 'Hosting' : 'Room'} ${esc(session.code ?? '')}${session.status && session.kind === 'client' && session.status !== 'Connected' ? ' · ' + esc(session.status) : ''}</div>` : ''}
      <div class="opps">${opps}</div>
      ${v.dice ? `<div class="dice ${rolling ? 'rolling' : ''} ${v.dice[0] + v.dice[1] === 7 ? 'seven' : ''}"><b>${v.dice[0]}</b><b>${v.dice[1]}</b></div>` : ''}
      <div class="me" style="--c:${p.color}">
        <div class="me-top"><span class="me-name">${esc(p.name)}</span><span class="vp">${totalVP(v, me)}★</span>
          ${v.grandRoad === me ? '<span class="badge">Grand Road</span>' : ''}${v.watchCaptain === me ? '<span class="badge">Watch Captain</span>' : ''}
          <span class="pieces">${p.hamletsLeft}H ${p.keepsLeft}K ${p.roadsLeft}R</span></div>
        <div class="hand">${RESOURCES.map((r) => `<div class="card" data-res="${r}" style="--rc:${RES_COLOR[r]}">${icon(r)}<div class="cnt">${p.hand[r]}</div><div class="lbl">${RES_LABEL[r]}</div></div>`).join('')}
          ${myCh.length ? `<div class="card charter" data-act="charters"><div class="cnt">${p.charters.length}</div><div class="lbl">Charters</div></div>` : ''}</div>
        <div class="builds">${actions}</div>
      </div>
      <div class="log ${ui.logOpen ? 'open' : ''}" data-act="log">${v.log.slice(ui.logOpen ? -14 : -3).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      ${dialogHtml(v)}
      ${ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : ''}`;

    if (v.phase === 'ended' && session.kind === 'local') save('autosave', null);
    document.body.classList.toggle('dialog-open', !!hud.querySelector('.dialog'));
    if (prev && prev !== v) animateChanges(prev, v);
    prev = v;
    tutorial?.refresh(v);
  }

  /** Flying cards for production, building and stealing, so you can see where things come from. */
  function animateChanges(a: View, b: View) {
    const me = session.me;
    if (me < 0 || !renderer) return;
    const handEl = (r: string) => centerOf(hud.querySelector(`.card[data-res=${r}]`));
    const gained = RESOURCES.map((r) => ({ r, n: b.players[me].hand[r] - a.players[me].hand[r] }));
    // production from a roll
    const newRoll = b.dice && (!a.dice || a.turn !== b.turn || a.dice.join() !== b.dice.join() || a.phase === 'preRoll');
    if (newRoll && b.dice![0] + b.dice![1] !== 7) {
      const total = b.dice![0] + b.dice![1];
      let k = 0;
      for (const hx of b.geo.hexes) {
        if (b.numbers[hx.id] !== total || hx.id === b.bandit) continue;
        const r = TERRAIN_RESOURCE[b.terrains[hx.id]];
        if (!r || (gained.find((g) => g.r === r)?.n ?? 0) <= 0) continue;
        for (const vx of hx.vertices) {
          const bl = b.buildings[vx];
          if (!bl || bl.owner !== me) continue;
          const from = renderer.hexScreen(hx.id), to = handEl(r);
          if (!to) continue;
          for (let i = 0; i < (bl.kind === 'keep' ? 2 : 1); i++) fly(r, from, to, 120 * k++);
          pop(`+${bl.kind === 'keep' ? 2 : 1}`, renderer.vertexScreen(vx), 'good');
        }
      }
      if (k) play('collect');
    }
    // starting resources from the second hamlet
    if (b.phase !== 'ended' && a.phase === 'setup' && gained.some((g) => g.n > 0) && !b.dice) {
      const placed = Object.keys(b.buildings).map(Number).find((vx) => !a.buildings[vx] && b.buildings[vx].owner === me);
      if (placed !== undefined) {
        let k = 0;
        for (const h of b.geo.vertices[placed].hexes) {
          const r = TERRAIN_RESOURCE[b.terrains[h]];
          const to = r && handEl(r);
          if (r && to) fly(r, renderer.hexScreen(h), to, 150 * k++);
        }
      }
    }
    // paying for something I built
    const spend = (cost: Partial<Hand>, at: Pt) => {
      let k = 0;
      for (const r of RESOURCES) for (let i = 0; i < (cost[r] ?? 0); i++) { const from = handEl(r); if (from) fly(r, from, at, 70 * k++, 600); }
    };
    if (a.phase !== 'setup' && b.phase !== 'setup') {
      for (const [vx, bl] of Object.entries(b.buildings)) {
        if (bl.owner !== me) continue;
        const old = a.buildings[Number(vx)];
        if (!old) spend(COSTS.hamlet, renderer.vertexScreen(Number(vx)));
        else if (old.kind === 'hamlet' && bl.kind === 'keep') spend(COSTS.keep, renderer.vertexScreen(Number(vx)));
      }
      if (a.phase !== 'pathmakers' && b.phase !== 'pathmakers') {
        for (const [e, o] of Object.entries(b.roads)) if (o === me && a.roads[Number(e)] === undefined) spend(COSTS.road, renderer.edgeScreen(Number(e)));
      }
    }
    // steals
    const fresh = b.log.slice(a.log.length);
    for (const line of fresh) {
      const m = line.match(/^(.+) steals a card from (.+)\.$/);
      if (!m) continue;
      const thief = b.players.find((p) => p.name === m[1]), victim = b.players.find((p) => p.name === m[2]);
      if (!thief || !victim) continue;
      const panel = (id: number) => id === me ? centerOf(hud.querySelector('.hand')) : centerOf(hud.querySelector(`.opp[data-pid="${id}"]`));
      const from = panel(victim.id), to = panel(thief.id);
      if (from && to && (thief.id === me || victim.id === me)) fly('card', from, to, 300, 900);
    }
  }

  function costIcons(c: Partial<Hand>) { return RESOURCES.flatMap((r) => Array(c[r] ?? 0).fill(icon(r, 'xs'))).join(''); }

  function counter(kind: 'give' | 'get' | 'discard', h: Partial<Hand>, max?: Hand) {
    return `<div class="counters">${RESOURCES.map((r) => `<div class="ctr" style="--rc:${RES_COLOR[r]}">${icon(r)}
      <button data-ctr="${kind}:${r}:-1">−</button><b>${h[r] ?? 0}</b><button data-ctr="${kind}:${r}:1" ${max && (h[r] ?? 0) >= max[r] ? 'disabled' : ''}>+</button></div>`).join('')}</div>`;
  }

  function dialogHtml(v: View): string {
    const me = session.me;
    const p = v.players[me];
    const fmt = (h: Partial<Hand>) => RESOURCES.filter((r) => h[r]).map((r) => `${h[r]}${icon(r, 'xs')}`).join(' ');
    // forced dialogs first
    if (v.phase === 'ended') {
      const rows = [...v.players].sort((a, b) => totalVP(v, b.id) - totalVP(v, a.id)).map((o) => `<div class="pill" style="--c:${o.color}">${esc(o.name)} · ${totalVP(v, o.id)} renown</div>`).join('');
      return `<div class="dialog"><div class="big">${v.winner === me ? 'Victory!' : 'Game over'}</div><div class="small">${esc(v.players[v.winner!].name)} won on turn ${v.turn}</div><div class="col">${rows}</div><button class="btn go" data-act="home">Back to menu</button></div>`;
    }
    if (v.phase === 'discard' && v.pendingDiscards[me] !== undefined) {
      const need = v.pendingDiscards[me];
      const n = handSize(ui.discard);
      return `<div class="dialog"><div class="big">Discard ${need}</div><div class="small">A 7 was rolled and you hold ${handSize(p.hand)} cards.</div>${counter('discard', ui.discard, p.hand)}
        <button class="btn go" data-act="discard" ${n === need ? '' : 'disabled'}>Discard ${n}/${need}</button></div>`;
    }
    if (v.offer && v.offer.from !== me && (v.offer.to ?? v.players.map((x) => x.id).filter((id) => id !== v.offer!.from)).includes(me) && !v.offer.accepted.includes(me) && !v.offer.declined.includes(me)) {
      const can = canAfford(p.hand, v.offer.get);
      return `<div class="dialog"><div class="big">Trade?</div><div class="small">${esc(v.players[v.offer.from].name)} gives you ${fmt(v.offer.give)}<br>for your ${fmt(v.offer.get)}</div>
        <div class="row center"><button class="btn go" data-act="accept" ${can ? '' : 'disabled'}>Accept</button><button class="btn alt" data-act="decline">Decline</button></div></div>`;
    }
    if (v.offer && v.offer.from === me) {
      const targets = v.offer.to ?? v.players.map((x) => x.id).filter((id) => id !== me);
      return `<div class="dialog"><div class="big">Your offer</div><div class="small">You give ${fmt(v.offer.give)} for ${fmt(v.offer.get)}</div>
        <div class="col">${targets.map((id) => `<div class="row center"><span class="pill" style="--c:${v.players[id].color}">${esc(v.players[id].name)}: ${v.offer!.accepted.includes(id) ? 'accepts' : v.offer!.declined.includes(id) ? 'declines' : 'thinking…'}</span>${v.offer!.accepted.includes(id) ? `<button class="btn go sm" data-act="confirm:${id}">Trade</button>` : ''}</div>`).join('')}</div>
        <button class="btn alt" data-act="cancel-offer">Cancel offer</button></div>`;
    }
    if (ui.dialog === 'victim') {
      return `<div class="dialog"><div class="big">Steal from</div><div class="col">${victimsOf(v, ui.victimHex).map((id) => `<button class="btn" style="background:${v.players[id].color}" data-act="victim:${id}">${esc(v.players[id].name)} (${v.handCounts[id]} cards)</button>`).join('')}</div></div>`;
    }
    if (ui.dialog === 'charters') {
      const groups = (['warden', 'pathmakers', 'windfall', 'embargo', 'monument'] as CharterType[]).map((t) => {
        const mine = p.charters.filter((c) => c.type === t);
        if (!mine.length) return '';
        const ready = mine.some((c) => c.boughtOn < v.step) && !v.charterPlayedThisStep && t !== 'monument' && ((v.phase === 'preRoll' && v.current === me) || ((v.phase === 'main' || v.phase === 'partner') && actingPlayers(v).includes(me) && !v.offer));
        const why = t === 'monument' ? 'Counts automatically' : v.charterPlayedThisStep ? 'One charter per turn' : !mine.some((c) => c.boughtOn < v.step) ? 'Bought this turn' : '';
        return `<div class="chrow"><div><b>${CHARTER_INFO[t][0]} ×${mine.length}</b><div class="small">${CHARTER_INFO[t][1]}</div></div>${t !== 'monument' ? `<button class="btn sm go" data-act="playch:${t}" ${ready ? '' : 'disabled'}>Play</button>` : ''}${why ? `<div class="small dim">${why}</div>` : ''}</div>`;
      }).join('');
      return `<div class="dialog wide"><div class="big">Charters</div>${groups}<button class="btn alt" data-act="close">Close</button></div>`;
    }
    if (ui.dialog === 'windfall' || ui.dialog === 'embargo') {
      const n = ui.dialog === 'windfall' ? 2 : 1;
      return `<div class="dialog"><div class="big">${ui.dialog === 'windfall' ? 'Windfall' : 'Embargo'}</div><div class="small">${ui.dialog === 'windfall' ? 'Pick 2 resources to take.' : 'Pick the resource everyone hands over.'}</div>
        <div class="row center wrap">${RESOURCES.map((r) => `<button class="pick ${ui.windfall.filter((x) => x === r).length ? 'on' : ''}" style="--rc:${RES_COLOR[r]}" data-act="pick:${r}">${icon(r)}<span>${RES_LABEL[r]}${ui.windfall.filter((x) => x === r).length > 1 ? ' ×2' : ''}</span></button>`).join('')}</div>
        <div class="row center"><button class="btn go" data-act="pickgo" ${ui.windfall.length === n ? '' : 'disabled'}>OK</button><button class="btn alt" data-act="close">Cancel</button></div></div>`;
    }
    if (ui.dialog === 'trade') {
      const bankRate = tradeRate(v, me, ui.bankGive);
      const offerOk = handSize(ui.give) > 0 && handSize(ui.get) > 0 && canAfford(p.hand, ui.give) && !RESOURCES.some((r) => (ui.give[r] ?? 0) > 0 && (ui.get[r] ?? 0) > 0);
      const tabs = `<div class="tabs">${v.phase === 'main' ? `<button class="${ui.tradeTab === 'players' ? 'on' : ''}" data-act="tab:players">Players</button>` : ''}<button class="${ui.tradeTab === 'bank' || v.phase !== 'main' ? 'on' : ''}" data-act="tab:bank">Bank & ports</button></div>`;
      const body = ui.tradeTab === 'players' && v.phase === 'main'
        ? `<div class="small">You give</div>${counter('give', ui.give, p.hand)}<div class="small">You want</div>${counter('get', ui.get)}
           <button class="btn go" data-act="offer" ${offerOk ? '' : 'disabled'}>Offer to everyone</button>`
        : `<div class="small">Your rates: ${RESOURCES.map((r) => `${icon(r, 'xs')}${tradeRate(v, me, r)}:1`).join(' ')}</div>
           <div class="row center wrap"><span class="small">Give ${bankRate}</span>${RESOURCES.map((r) => `<button class="pick ${ui.bankGive === r ? 'on' : ''}" style="--rc:${RES_COLOR[r]}" data-act="bg:${r}">${icon(r)}</button>`).join('')}</div>
           <div class="row center wrap"><span class="small">Get 1</span>${RESOURCES.map((r) => `<button class="pick ${ui.bankGet === r ? 'on' : ''}" style="--rc:${RES_COLOR[r]}" data-act="bt:${r}">${icon(r)}</button>`).join('')}</div>
           <button class="btn go" data-act="bank" ${p.hand[ui.bankGive] >= bankRate && ui.bankGive !== ui.bankGet && v.bank[ui.bankGet] > 0 ? '' : 'disabled'}>Trade ${bankRate} ${RES_LABEL[ui.bankGive]} → 1 ${RES_LABEL[ui.bankGet]}</button>`;
      return `<div class="dialog wide"><div class="big">Trade</div>${tabs}${body}<button class="btn alt" data-act="close">Close</button></div>`;
    }
    if (ui.dialog === 'rules') return `<div class="dialog wide scroll"><div class="big">Rules</div>${rulesHtml()}<button class="btn" data-act="close">Close</button></div>`;
    if (ui.dialog === 'menu') {
      return `<div class="dialog"><div class="big">Menu</div><div class="col">
        <label class="row">Look <select data-set="mode">${[['pixel3d', 'Low-poly pixel 3D'], ['smooth3d', 'Smooth 3D'], ['iso2d', 'Isometric 2D'], ['top2d', 'Top-down 2D']].map(([val, l]) => `<option value="${val}" ${val === settings.mode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn" data-act="mute">${isMuted() ? 'Sound: off' : 'Sound: on'}</button>
        <button class="btn" data-act="rules">Rules</button>
        <button class="btn" data-act="resetview">Reset camera</button>
        ${session.host ? `<button class="btn" data-act="fast">${session.host.fastBots ? 'Bots: fast' : 'Bots: normal speed'}</button><button class="btn" data-act="savefile">Save game to file</button>` : ''}
        <button class="btn alt" data-act="leave">Leave game</button><button class="btn" data-act="close">Close</button></div></div>`;
    }
    return '';
  }

  function toast(m: string) {
    ui.toast = m; play('error'); refresh();
    setTimeout(() => { if (ui.toast === m) { ui.toast = ''; refresh(); } }, 2500);
  }

  hud.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const ctr = t.closest('[data-ctr]')?.getAttribute('data-ctr');
    const v = session.view();
    if (!v) return;
    const p = v.players[session.me];
    if (ctr) {
      const [kind, r, d] = ctr.split(':') as ['give' | 'get' | 'discard', Resource, string];
      const h = ui[kind];
      h[r] = Math.max(0, (h[r] ?? 0) + Number(d));
      if (kind !== 'get') h[r] = Math.min(h[r]!, p.hand[r]);
      play('click');
      return refresh();
    }
    const cmd = t.closest('[data-act]')?.getAttribute('data-act');
    if (!cmd) return;
    const [a, arg] = cmd.split(':');
    if (a !== 'log') play('click');
    switch (a) {
      case 'roll': return act({ type: 'ROLL' });
      case 'end': ui.build = null; return act({ type: 'END_TURN' });
      case 'build-road': case 'build-hamlet': case 'build-keep': {
        const k = a.split('-')[1] as UIState['build'];
        ui.build = ui.build === k ? null : k;
        return refresh();
      }
      case 'buy': return act({ type: 'BUY_CHARTER' });
      case 'trade': ui.dialog = 'trade'; ui.give = {}; ui.get = {}; ui.tradeTab = v.phase === 'main' ? 'players' : 'bank'; return refresh();
      case 'tab': ui.tradeTab = arg as 'players' | 'bank'; return refresh();
      case 'bg': ui.bankGive = arg as Resource; return refresh();
      case 'bt': ui.bankGet = arg as Resource; return refresh();
      case 'bank': return act({ type: 'BANK_TRADE', give: ui.bankGive, get: ui.bankGet });
      case 'offer': ui.dialog = null; return act({ type: 'OFFER_TRADE', to: null, give: ui.give, get: ui.get });
      case 'accept': return act({ type: 'RESPOND_TRADE', accept: true });
      case 'decline': return act({ type: 'RESPOND_TRADE', accept: false });
      case 'confirm': return act({ type: 'CONFIRM_TRADE', with: Number(arg) });
      case 'cancel-offer': return act({ type: 'CANCEL_TRADE' });
      case 'discard': { const cards = ui.discard; ui.discard = {}; return act({ type: 'DISCARD', cards }); }
      case 'victim': { ui.dialog = null; return act({ type: 'MOVE_BANDIT', hex: ui.victimHex, victim: Number(arg) }); }
      case 'charters': ui.dialog = 'charters'; return refresh();
      case 'playch': {
        if (arg === 'windfall' || arg === 'embargo') { ui.dialog = arg; ui.windfall = []; return refresh(); }
        ui.dialog = null;
        return act(arg === 'warden' ? { type: 'PLAY_WARDEN' } : { type: 'PLAY_PATHMAKERS' });
      }
      case 'pick': {
        const n = ui.dialog === 'windfall' ? 2 : 1;
        if (n === 1) ui.windfall = [arg as Resource];
        else if (ui.windfall.length < 2) ui.windfall.push(arg as Resource);
        else ui.windfall = [arg as Resource];
        return refresh();
      }
      case 'pickgo': {
        const d = ui.dialog; ui.dialog = null;
        return act(d === 'windfall' ? { type: 'PLAY_WINDFALL', resources: [ui.windfall[0], ui.windfall[1]] } : { type: 'PLAY_EMBARGO', resource: ui.windfall[0] });
      }
      case 'menu': ui.dialog = ui.dialog === 'menu' ? null : 'menu'; return refresh();
      case 'mute': setMuted(!isMuted()); return refresh();
      case 'rules': ui.dialog = 'rules'; return refresh();
      case 'resetview': (renderer as Scene3D).resetView?.(); ui.dialog = null; return refresh();
      case 'fast': if (session.host) session.host.fastBots = !session.host.fastBots; return refresh();
      case 'savefile': {
        const blob = new Blob([session.host!.save()], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `hexhold-turn-${v.turn}.json`;
        link.click();
        return;
      }
      case 'leave': case 'home': session.leave(); if (session.kind === 'local' && v.phase !== 'ended') { /* autosave kept */ } history.replaceState(null, '', location.pathname); location.reload(); return;
      case 'close': ui.dialog = null; return refresh();
      case 'log': ui.logOpen = !ui.logOpen; return refresh();
    }
  });
  hud.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.getAttribute('data-set') === 'mode') { settings.mode = t.value as Mode; saveSettings(); ui.dialog = null; rebuild(); }
  });

  session.onChange(() => {
    const v = session.view();
    if (v && ui.dialog === 'trade' && (v.offer || !actingPlayers(v).includes(session.me))) ui.dialog = null;
    if (v && ui.dialog === 'victim' && v.phase !== 'bandit') ui.dialog = null;
    refresh();
  });
  session.onError((m) => toast(m));
  session.onSound((s) => play(s));
  rebuild();
  requestAnimationFrame(frame);
  if (opts.tutorial && session.host) {
    tutorial = attachTutorial({
      host: session.host,
      renderer: () => renderer,
      closeDialogs: () => { ui.dialog = null; ui.build = null; refresh(); },
      refresh: () => refresh(),
      finish: (keep) => { save('tutorialDone', true); if (!keep) { session.leave(); location.reload(); } else refresh(); },
    }, session.view()!);
  }
  (window as unknown as { __test: unknown }).__test = {
    view: () => session.view(), me: () => session.me,
    markers: () => renderer.markers?.() ?? [],
    screenOf: (m: Marker) => (renderer as Scene3D).screenOf(m),
    act: (a: Action) => session.act(a),
    host: () => session.host,
  };
}

