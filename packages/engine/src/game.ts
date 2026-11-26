import {
  Geometry, Resource, RESOURCES, Terrain, TERRAIN_RESOURCE, PortGeo, PortKind,
  buildGeometry, standardCoords, largeCoords, portEdges, portGeo, spiralOrder,
} from './board';
import { nextRandom, randInt, rollDie, shuffle } from './rng';

// ---------- Types ----------

export type CharterType = 'warden' | 'monument' | 'pathmakers' | 'windfall' | 'embargo';
export type Hand = Record<Resource, number>;
export type MapType = 'starter' | 'spiral' | 'random';

export interface GameOptions {
  players: { name: string; color: string; bot?: boolean }[];
  seed?: number;
  mapType?: MapType;
  noAdjacentRed?: boolean; // random numbers only
  targetVP?: number;
  friendlyBandit?: boolean;
  pairedTurns?: boolean; // 5-6 players (default true when 5+)
}

export interface Player {
  id: number;
  name: string;
  color: string;
  bot: boolean;
  hand: Hand;
  charters: { type: CharterType; boughtOn: number }[];
  wardensPlayed: number;
  monumentsRevealed: number;
  hamletsLeft: number;
  keepsLeft: number;
  roadsLeft: number;
}

export type Phase =
  | 'setup' // initial placement
  | 'preRoll' // may play a charter, then must roll
  | 'discard' // players over 7 cards discard
  | 'bandit' // active player moves the bandit (and steals)
  | 'main' // trade / build / play
  | 'pathmakers' // placing free roads
  | 'partner' // 5-6 paired turn action phase
  | 'ended';

export interface TradeOffer {
  from: number;
  to: number[] | null; // null = everyone
  give: Partial<Hand>;
  get: Partial<Hand>;
  accepted: number[];
  declined: number[];
}

export interface GameState {
  version: 1;
  rng: number;
  geo: Geometry;
  terrains: Terrain[]; // by hex id
  numbers: (number | null)[]; // by hex id
  ports: PortGeo[];
  bandit: number; // hex id
  players: Player[];
  buildings: Record<number, { owner: number; kind: 'hamlet' | 'keep' }>; // vertex id
  roads: Record<number, number>; // edge id -> owner
  bank: Hand;
  deck: CharterType[];
  phase: Phase;
  setup: { order: number[]; index: number; step: 'hamlet' | 'road'; lastHamlet: number | null } | null;
  current: number; // active player
  partner: number | null; // 5-6 paired player (acts in 'partner' phase)
  step: number; // increments every turn / partner phase; used for "bought this turn"
  turn: number;
  dice: [number, number] | null;
  pendingDiscards: Record<number, number>;
  actor: number | null; // who resolves bandit / pathmakers (active player or partner)
  afterBandit: Phase; // where to return after bandit (preRoll for warden before roll, main otherwise)
  charterPlayedThisStep: boolean;
  offersThisStep: number;
  freeRoads: number;
  grandRoad: number | null;
  watchCaptain: number | null;
  offer: TradeOffer | null;
  targetVP: number;
  friendlyBandit: boolean;
  pairedTurns: boolean;
  winner: number | null;
  log: string[];
}

export type Action =
  | { type: 'PLACE_HAMLET'; vertex: number }
  | { type: 'PLACE_ROAD'; edge: number }
  | { type: 'ROLL' }
  | { type: 'DISCARD'; cards: Partial<Hand> }
  | { type: 'MOVE_BANDIT'; hex: number; victim?: number | null }
  | { type: 'BUILD_ROAD'; edge: number }
  | { type: 'BUILD_HAMLET'; vertex: number }
  | { type: 'BUILD_KEEP'; vertex: number }
  | { type: 'BUY_CHARTER' }
  | { type: 'PLAY_WARDEN' }
  | { type: 'PLAY_PATHMAKERS' }
  | { type: 'PLAY_WINDFALL'; resources: [Resource, Resource] }
  | { type: 'PLAY_EMBARGO'; resource: Resource }
  | { type: 'REVEAL_MONUMENTS' }
  | { type: 'BANK_TRADE'; give: Resource; get: Resource; times?: number }
  | { type: 'OFFER_TRADE'; to: number[] | null; give: Partial<Hand>; get: Partial<Hand> }
  | { type: 'RESPOND_TRADE'; accept: boolean }
  | { type: 'CONFIRM_TRADE'; with: number }
  | { type: 'CANCEL_TRADE' }
  | { type: 'END_TURN' };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

// ---------- Constants ----------

export const COSTS = {
  road: { clay: 1, timber: 1 },
  hamlet: { clay: 1, timber: 1, fleece: 1, grain: 1 },
  keep: { stone: 3, grain: 2 },
  charter: { stone: 1, fleece: 1, grain: 1 },
} satisfies Record<string, Partial<Hand>>;

const STANDARD_TERRAINS: Record<Terrain, number> = { woodland: 4, meadow: 4, farmland: 4, claypits: 3, highlands: 3, wastes: 1 };
const LARGE_TERRAINS: Record<Terrain, number> = { woodland: 6, meadow: 6, farmland: 6, claypits: 5, highlands: 5, wastes: 2 };
// Official-style spiral sequence (A..R) for the 19-hex island.
const SPIRAL_NUMBERS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
const STANDARD_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const LARGE_NUMBERS = [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12];
const STANDARD_PORTS: PortKind[] = ['any', 'grain', 'stone', 'any', 'fleece', 'any', 'any', 'clay', 'timber'];
const LARGE_PORTS: PortKind[] = ['any', 'grain', 'stone', 'any', 'fleece', 'any', 'fleece', 'any', 'clay', 'timber', 'any'];
// Starter map (19 hexes, in standardCoords order) - an original balanced layout.
const STARTER_TERRAINS: Terrain[] = [
  'highlands', 'meadow', 'woodland',
  'farmland', 'claypits', 'meadow', 'claypits',
  'farmland', 'woodland', 'wastes', 'woodland', 'highlands',
  'woodland', 'highlands', 'farmland', 'meadow',
  'claypits', 'farmland', 'meadow',
];
const STARTER_NUMBERS: (number | null)[] = [
  10, 2, 9,
  12, 6, 4, 10,
  9, 11, null, 3, 8,
  8, 3, 4, 5,
  5, 6, 11,
];

export const emptyHand = (): Hand => ({ timber: 0, clay: 0, fleece: 0, grain: 0, stone: 0 });
export const handSize = (h: Partial<Hand>) => RESOURCES.reduce((s, r) => s + (h[r] ?? 0), 0);

// ---------- Creation ----------

export function createGame(opts: GameOptions): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 6) throw new Error('2 to 6 players');
  const large = n >= 5;
  const holder = { rng: (opts.seed ?? Date.now()) | 0 };
  const geo = buildGeometry(large ? largeCoords() : standardCoords());
  const mapType: MapType = opts.mapType ?? (large ? 'random' : 'spiral');

  let terrains: Terrain[];
  let numbers: (number | null)[];
  if (mapType === 'starter' && !large) {
    terrains = [...STARTER_TERRAINS];
    numbers = [...STARTER_NUMBERS];
  } else {
    const pool: Terrain[] = [];
    for (const [t, c] of Object.entries(large ? LARGE_TERRAINS : STANDARD_TERRAINS)) for (let i = 0; i < c; i++) pool.push(t as Terrain);
    terrains = shuffle(holder, pool);
    if (mapType === 'spiral' && !large) {
      numbers = new Array(geo.hexes.length).fill(null);
      let i = 0;
      for (const hex of spiralOrder(geo)) if (terrains[hex] !== 'wastes') numbers[hex] = SPIRAL_NUMBERS[i++];
    } else {
      numbers = placeRandomNumbers(holder, geo, terrains, large ? LARGE_NUMBERS : STANDARD_NUMBERS, opts.noAdjacentRed ?? true);
    }
  }

  const portKinds = shuffle(holder, [...(large ? LARGE_PORTS : STANDARD_PORTS)]);
  const pe = portEdges(geo, portKinds.length);
  const ports = pe.map((e, i) => portGeo(geo, e, portKinds[i]));

  const deck: CharterType[] = [];
  const add = (t: CharterType, c: number) => { for (let i = 0; i < c; i++) deck.push(t); };
  add('warden', large ? 20 : 14);
  add('monument', 5);
  add('pathmakers', large ? 3 : 2);
  add('windfall', large ? 3 : 2);
  add('embargo', large ? 3 : 2);
  shuffle(holder, deck);

  const bankEach = large ? 24 : 19;
  const players: Player[] = opts.players.map((p, id) => ({
    id, name: p.name, color: p.color, bot: !!p.bot,
    hand: emptyHand(), charters: [], wardensPlayed: 0, monumentsRevealed: 0,
    hamletsLeft: 5, keepsLeft: 4, roadsLeft: 15,
  }));

  // Roll for first player (reroll ties among the highest).
  const log: string[] = [];
  let contenders = players.map((p) => p.id);
  let first = 0;
  while (true) {
    const rolls = contenders.map((id) => ({ id, v: rollDie(holder) + rollDie(holder) }));
    log.push('Start rolls: ' + rolls.map((r) => `${players[r.id].name} ${r.v}`).join(', '));
    const max = Math.max(...rolls.map((r) => r.v));
    contenders = rolls.filter((r) => r.v === max).map((r) => r.id);
    if (contenders.length === 1) { first = contenders[0]; break; }
  }
  const forward = Array.from({ length: n }, (_, i) => (first + i) % n);
  const order = [...forward, ...[...forward].reverse()];

  const banditHex = terrains.indexOf('wastes');
  return {
    version: 1,
    rng: holder.rng,
    geo, terrains, numbers, ports,
    bandit: banditHex >= 0 ? banditHex : 0,
    players,
    buildings: {}, roads: {},
    bank: { timber: bankEach, clay: bankEach, fleece: bankEach, grain: bankEach, stone: bankEach },
    deck,
    phase: 'setup',
    setup: { order, index: 0, step: 'hamlet', lastHamlet: null },
    current: first,
    partner: null,
    step: 0,
    turn: 0,
    dice: null,
    pendingDiscards: {},
    actor: null,
    afterBandit: 'main',
    charterPlayedThisStep: false,
    offersThisStep: 0,
    freeRoads: 0,
    grandRoad: null,
    watchCaptain: null,
    offer: null,
    targetVP: opts.targetVP ?? 10,
    friendlyBandit: !!opts.friendlyBandit,
    pairedTurns: opts.pairedTurns ?? large,
    winner: null,
    log: [...log, `${players[first].name} goes first.`],
  };
}

function placeRandomNumbers(h: { rng: number }, geo: Geometry, terrains: Terrain[], pool: number[], noAdjRed: boolean) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const nums = shuffle(h, [...pool]);
    const out: (number | null)[] = [];
    let i = 0;
    for (let hex = 0; hex < terrains.length; hex++) out.push(terrains[hex] === 'wastes' ? null : nums[i++]);
    if (!noAdjRed) return out;
    const red = (v: number | null) => v === 6 || v === 8;
    const bad = geo.hexes.some((hx) => red(out[hx.id]) && hx.neighbors.some((nb) => red(out[nb])));
    if (!bad) return out;
  }
  throw new Error('Could not place numbers');
}

// ---------- Queries ----------

export function clone(s: GameState): GameState {
  return structuredClone(s);
}

/** The player who must act next (for discards, any listed player may act). */
export function actingPlayers(s: GameState): number[] {
  switch (s.phase) {
    case 'setup': return [s.setup!.order[s.setup!.index]];
    case 'discard': return Object.keys(s.pendingDiscards).map(Number);
    case 'partner': return [s.partner!];
    case 'bandit':
    case 'pathmakers': return [s.actor ?? s.current];
    case 'ended': return [];
    case 'main':
      if (s.offer) return [s.current, ...offerTargets(s).filter((p) => !s.offer!.accepted.includes(p) && !s.offer!.declined.includes(p))];
      return [s.current];
    default: return [s.current];
  }
}

function offerTargets(s: GameState): number[] {
  if (!s.offer) return [];
  return s.offer.to ?? s.players.map((p) => p.id).filter((id) => id !== s.offer!.from);
}

export function publicVP(s: GameState, pid: number): number {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) vp += b.kind === 'keep' ? 2 : 1;
  if (s.grandRoad === pid) vp += 2;
  if (s.watchCaptain === pid) vp += 2;
  vp += s.players[pid].monumentsRevealed;
  return vp;
}

export function totalVP(s: GameState, pid: number): number {
  const hidden = s.players[pid].charters.filter((c) => c.type === 'monument').length;
  return publicVP(s, pid) + hidden;
}

export function portsOf(s: GameState, pid: number): PortKind[] {
  return s.ports.filter((p) => p.vertices.some((v) => s.buildings[v]?.owner === pid)).map((p) => p.kind);
}

export function tradeRate(s: GameState, pid: number, r: Resource): number {
  const ports = portsOf(s, pid);
  if (ports.includes(r)) return 2;
  if (ports.includes('any')) return 3;
  return 4;
}

export function canAfford(h: Hand, cost: Partial<Hand>) {
  return RESOURCES.every((r) => h[r] >= (cost[r] ?? 0));
}

function pay(s: GameState, pid: number, cost: Partial<Hand>) {
  for (const r of RESOURCES) {
    const c = cost[r] ?? 0;
    s.players[pid].hand[r] -= c;
    s.bank[r] += c;
  }
}

function hasRoadAt(s: GameState, pid: number, vertex: number) {
  return s.geo.vertices[vertex].edges.some((e) => s.roads[e] === pid);
}

export function isVertexFree(s: GameState, v: number) {
  if (s.buildings[v]) return false;
  return s.geo.vertices[v].vertices.every((n) => !s.buildings[n]);
}

export function canPlaceHamlet(s: GameState, pid: number, v: number, setup = false) {
  if (!isVertexFree(s, v)) return false;
  if (s.players[pid].hamletsLeft <= 0) return false;
  return setup || hasRoadAt(s, pid, v);
}

export function canPlaceRoad(s: GameState, pid: number, e: number, setupFrom?: number | null) {
  if (s.roads[e] !== undefined) return false;
  if (s.players[pid].roadsLeft <= 0) return false;
  const edge = s.geo.edges[e];
  if (setupFrom !== undefined) return edge.a === setupFrom || edge.b === setupFrom;
  for (const v of [edge.a, edge.b]) {
    const b = s.buildings[v];
    if (b && b.owner === pid) return true;
    if (b && b.owner !== pid) continue; // can't build through an opponent's building
    if (s.geo.vertices[v].edges.some((oe) => oe !== e && s.roads[oe] === pid)) return true;
  }
  return false;
}

export function legalRoadEdges(s: GameState, pid: number) {
  return s.geo.edges.map((e) => e.id).filter((e) => canPlaceRoad(s, pid, e));
}
export function legalHamletVertices(s: GameState, pid: number, setup = false) {
  return s.geo.vertices.map((v) => v.id).filter((v) => canPlaceHamlet(s, pid, v, setup));
}
export function legalKeepVertices(s: GameState, pid: number) {
  if (s.players[pid].keepsLeft <= 0) return [];
  return Object.entries(s.buildings).filter(([, b]) => b.owner === pid && b.kind === 'hamlet').map(([v]) => Number(v));
}

/** Longest single trail of a player's roads; can't pass through opponents' buildings. */
export function longestRoad(s: GameState, pid: number): number {
  const mine = Object.entries(s.roads).filter(([, o]) => o === pid).map(([e]) => Number(e));
  if (!mine.length) return 0;
  const used = new Set<number>();
  let best = 0;
  const blocked = (v: number) => { const b = s.buildings[v]; return !!b && b.owner !== pid; };
  const dfs = (v: number, len: number) => {
    best = Math.max(best, len);
    if (blocked(v) && len > 0) return;
    for (const e of s.geo.vertices[v].edges) {
      if (used.has(e) || s.roads[e] !== pid) continue;
      const edge = s.geo.edges[e];
      const next = edge.a === v ? edge.b : edge.a;
      used.add(e);
      dfs(next, len + 1);
      used.delete(e);
    }
  };
  const starts = new Set<number>();
  for (const e of mine) { starts.add(s.geo.edges[e].a); starts.add(s.geo.edges[e].b); }
  for (const v of starts) dfs(v, 0);
  return best;
}

function updateGrandRoad(s: GameState) {
  const lengths = s.players.map((p) => longestRoad(s, p.id));
  const max = Math.max(...lengths);
  const leaders = lengths.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
  const before = s.grandRoad;
  if (s.grandRoad !== null) {
    const hl = lengths[s.grandRoad];
    if (hl >= 5 && hl >= max) return; // holder keeps it (including ties)
    s.grandRoad = max >= 5 && leaders.length === 1 ? leaders[0] : null;
  } else if (max >= 5 && leaders.length === 1) {
    s.grandRoad = leaders[0];
  }
  if (s.grandRoad !== before) {
    s.log.push(s.grandRoad === null ? 'Grand Road is set aside.' : `${s.players[s.grandRoad].name} takes the Grand Road (${max}).`);
  }
}

function updateWatchCaptain(s: GameState, pid: number) {
  const n = s.players[pid].wardensPlayed;
  if (n < 3 || s.watchCaptain === pid) return;
  const holderN = s.watchCaptain === null ? 0 : s.players[s.watchCaptain].wardensPlayed;
  if (n > holderN) {
    s.watchCaptain = pid;
    s.log.push(`${s.players[pid].name} becomes Watch Captain.`);
  }
}

function checkWin(s: GameState, pid: number) {
  if (s.phase === 'ended') return;
  const actorTurn = pid === s.current || (s.phase === 'partner' && pid === s.partner);
  if (!actorTurn) return;
  if (totalVP(s, pid) >= s.targetVP) {
    const p = s.players[pid];
    const hidden = p.charters.filter((c) => c.type === 'monument').length;
    p.monumentsRevealed += hidden;
    p.charters = p.charters.filter((c) => c.type !== 'monument');
    s.winner = pid;
    s.phase = 'ended';
    s.log.push(`${p.name} wins with ${publicVP(s, pid)} renown!`);
  }
}

/** Opponents with a building on the hex (victims for the bandit). */
export function banditVictims(s: GameState, hex: number, pid: number): number[] {
  const set = new Set<number>();
  for (const v of s.geo.hexes[hex].vertices) {
    const b = s.buildings[v];
    if (b && b.owner !== pid && handSize(s.players[b.owner].hand) > 0) set.add(b.owner);
  }
  return [...set];
}

export function legalBanditHexes(s: GameState, pid: number): number[] {
  const all = s.geo.hexes.map((h) => h.id).filter((h) => h !== s.bandit);
  if (!s.friendlyBandit) return all;
  const protectedP = new Set(s.players.filter((p) => p.id !== pid && publicVP(s, p.id) <= 2).map((p) => p.id));
  const ok = all.filter((h) => !s.geo.hexes[h].vertices.some((v) => { const b = s.buildings[v]; return b && protectedP.has(b.owner); }));
  return ok.length ? ok : all;
}

function produce(s: GameState, roll: number) {
  for (const r of RESOURCES) {
    const owed: Record<number, number> = {};
    s.geo.hexes.forEach((hx) => {
      if (s.numbers[hx.id] !== roll || hx.id === s.bandit) return;
      if (TERRAIN_RESOURCE[s.terrains[hx.id]] !== r) return;
      for (const v of hx.vertices) {
        const b = s.buildings[v];
        if (b) owed[b.owner] = (owed[b.owner] ?? 0) + (b.kind === 'keep' ? 2 : 1);
      }
    });
    const ids = Object.keys(owed).map(Number);
    const total = ids.reduce((a, id) => a + owed[id], 0);
    if (!total) continue;
    if (total <= s.bank[r]) {
      for (const id of ids) { s.players[id].hand[r] += owed[id]; s.bank[r] -= owed[id]; }
    } else if (ids.length === 1) {
      const give = s.bank[r];
      s.players[ids[0]].hand[r] += give;
      s.bank[r] = 0;
      s.log.push(`Bank short on ${r}: ${s.players[ids[0]].name} gets ${give}.`);
    } else {
      s.log.push(`Bank short on ${r}: nobody gets ${r}.`);
    }
  }
}

function stealRandom(s: GameState, thief: number, victim: number) {
  const v = s.players[victim];
  const cards: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < v.hand[r]; i++) cards.push(r);
  if (!cards.length) return;
  const r = cards[randInt(s, cards.length)];
  v.hand[r]--;
  s.players[thief].hand[r]++;
  s.log.push(`${s.players[thief].name} steals a card from ${v.name}.`);
}

function startTurn(s: GameState, pid: number) {
  s.current = pid;
  s.turn++;
  s.step++;
  s.phase = 'preRoll';
  s.dice = null;
  s.charterPlayedThisStep = false;
  s.offersThisStep = 0;
  s.offer = null;
  s.log.push(`— Turn ${s.turn}: ${s.players[pid].name} —`);
  checkWin(s, pid);
}

function playableCharter(s: GameState, pid: number, type: CharterType) {
  return s.players[pid].charters.findIndex((c) => c.type === type && c.boughtOn < s.step);
}

// ---------- Apply ----------

export function apply(prev: GameState, pid: number, a: Action): Result {
  if (prev.phase === 'ended') return err('Game over');
  const s = clone(prev);
  const fail = (m: string): Result => ({ ok: false, error: m });
  const me = s.players[pid];
  if (!me) return fail('No such player');
  const isActor = actingPlayers(s).includes(pid);
  if (!isActor) return fail('Not your turn');
  const inMain = s.phase === 'main' || s.phase === 'partner';

  switch (a.type) {
    case 'PLACE_HAMLET': {
      if (s.phase !== 'setup' || s.setup!.step !== 'hamlet') return fail('Not placing a hamlet now');
      if (!canPlaceHamlet(s, pid, a.vertex, true)) return fail('Illegal hamlet spot');
      s.buildings[a.vertex] = { owner: pid, kind: 'hamlet' };
      me.hamletsLeft--;
      s.setup!.step = 'road';
      s.setup!.lastHamlet = a.vertex;
      const n = s.players.length;
      if (s.setup!.index >= n) {
        for (const h of s.geo.vertices[a.vertex].hexes) {
          const r = TERRAIN_RESOURCE[s.terrains[h]];
          if (r && s.bank[r] > 0) { me.hand[r]++; s.bank[r]--; }
        }
      }
      s.log.push(`${me.name} places a hamlet.`);
      break;
    }
    case 'PLACE_ROAD': {
      if (s.phase !== 'setup' || s.setup!.step !== 'road') return fail('Not placing a road now');
      if (!canPlaceRoad(s, pid, a.edge, s.setup!.lastHamlet)) return fail('Road must touch your new hamlet');
      s.roads[a.edge] = pid;
      me.roadsLeft--;
      s.setup!.index++;
      s.setup!.step = 'hamlet';
      s.setup!.lastHamlet = null;
      if (s.setup!.index >= s.setup!.order.length) {
        const first = s.setup!.order[0];
        s.setup = null;
        startTurn(s, first);
      }
      break;
    }
    case 'ROLL': {
      if (s.phase !== 'preRoll' || pid !== s.current) return fail('Cannot roll now');
      const d: [number, number] = [rollDie(s), rollDie(s)];
      s.dice = d;
      const total = d[0] + d[1];
      s.log.push(`${me.name} rolls ${total}.`);
      if (total === 7) {
        s.pendingDiscards = {};
        for (const p of s.players) { const c = handSize(p.hand); if (c > 7) s.pendingDiscards[p.id] = Math.floor(c / 2); }
        s.afterBandit = 'main';
        s.actor = pid;
        s.phase = Object.keys(s.pendingDiscards).length ? 'discard' : 'bandit';
      } else {
        produce(s, total);
        s.phase = 'main';
      }
      break;
    }
    case 'DISCARD': {
      if (s.phase !== 'discard' || s.pendingDiscards[pid] === undefined) return fail('No discard needed');
      const need = s.pendingDiscards[pid];
      if (handSize(a.cards) !== need) return fail(`Discard exactly ${need}`);
      if (!RESOURCES.every((r) => (a.cards[r] ?? 0) >= 0 && (a.cards[r] ?? 0) <= me.hand[r])) return fail('You do not have those cards');
      pay(s, pid, a.cards);
      delete s.pendingDiscards[pid];
      s.log.push(`${me.name} discards ${need}.`);
      if (!Object.keys(s.pendingDiscards).length) s.phase = 'bandit';
      break;
    }
    case 'MOVE_BANDIT': {
      if (s.phase !== 'bandit') return fail('Cannot move the bandit now');
      if (!legalBanditHexes(s, pid).includes(a.hex)) return fail('Illegal bandit hex');
      s.bandit = a.hex;
      const victims = banditVictims(s, a.hex, pid);
      if (victims.length) {
        if (a.victim == null || !victims.includes(a.victim)) return fail('Choose a player to steal from');
        stealRandom(s, pid, a.victim);
      }
      s.log.push(`${me.name} moves the Bandit.`);
      s.phase = s.afterBandit;
      break;
    }
    case 'BUILD_ROAD': {
      if (s.phase === 'pathmakers') {
        if (!canPlaceRoad(s, pid, a.edge)) return fail('Illegal road');
        s.roads[a.edge] = pid; me.roadsLeft--; s.freeRoads--;
        if (s.freeRoads <= 0 || legalRoadEdges(s, pid).length === 0) { s.freeRoads = 0; s.phase = s.afterBandit; }
        updateGrandRoad(s);
        break;
      }
      if (!inMain || s.offer) return fail('Cannot build now');
      if (!canAfford(me.hand, COSTS.road)) return fail('Not enough resources');
      if (!canPlaceRoad(s, pid, a.edge)) return fail('Illegal road');
      pay(s, pid, COSTS.road);
      s.roads[a.edge] = pid; me.roadsLeft--;
      s.log.push(`${me.name} builds a road.`);
      updateGrandRoad(s);
      break;
    }
    case 'BUILD_HAMLET': {
      if (!inMain || s.offer) return fail('Cannot build now');
      if (!canAfford(me.hand, COSTS.hamlet)) return fail('Not enough resources');
      if (!canPlaceHamlet(s, pid, a.vertex)) return fail('Illegal hamlet spot');
      pay(s, pid, COSTS.hamlet);
      s.buildings[a.vertex] = { owner: pid, kind: 'hamlet' }; me.hamletsLeft--;
      s.log.push(`${me.name} builds a hamlet.`);
      updateGrandRoad(s); // may break an opponent's road
      break;
    }
    case 'BUILD_KEEP': {
      if (!inMain || s.offer) return fail('Cannot build now');
      if (!canAfford(me.hand, COSTS.keep)) return fail('Not enough resources');
      if (!legalKeepVertices(s, pid).includes(a.vertex)) return fail('Must upgrade your own hamlet');
      pay(s, pid, COSTS.keep);
      s.buildings[a.vertex] = { owner: pid, kind: 'keep' }; me.keepsLeft--; me.hamletsLeft++;
      s.log.push(`${me.name} builds a keep.`);
      break;
    }
    case 'BUY_CHARTER': {
      if (!inMain || s.offer) return fail('Cannot buy now');
      if (!s.deck.length) return fail('No charters left');
      if (!canAfford(me.hand, COSTS.charter)) return fail('Not enough resources');
      pay(s, pid, COSTS.charter);
      me.charters.push({ type: s.deck.pop()!, boughtOn: s.step });
      s.log.push(`${me.name} buys a charter.`);
      break;
    }
    case 'PLAY_WARDEN':
    case 'PLAY_PATHMAKERS':
    case 'PLAY_WINDFALL':
    case 'PLAY_EMBARGO': {
      const preRoll = s.phase === 'preRoll';
      if (!(preRoll || (inMain && !s.offer))) return fail('Cannot play a charter now');
      if (s.charterPlayedThisStep) return fail('Only one charter per turn');
      const type = ({ PLAY_WARDEN: 'warden', PLAY_PATHMAKERS: 'pathmakers', PLAY_WINDFALL: 'windfall', PLAY_EMBARGO: 'embargo' } as const)[a.type];
      const idx = playableCharter(s, pid, type);
      if (idx < 0) return fail('No playable charter of that kind (bought this turn?)');
      const back: Phase = s.phase;
      if (type === 'pathmakers' && legalRoadEdges(s, pid).length === 0) return fail('No legal road spots');
      if (type === 'windfall') {
        const [r1, r2] = (a as Extract<Action, { type: 'PLAY_WINDFALL' }>).resources;
        const need: Partial<Hand> = {}; need[r1] = 1; need[r2] = (need[r2] ?? 0) + 1;
        if (!RESOURCES.every((r) => s.bank[r] >= (need[r] ?? 0))) return fail('Bank lacks those resources');
        for (const r of [r1, r2]) { s.bank[r]--; me.hand[r]++; }
      }
      me.charters.splice(idx, 1);
      s.charterPlayedThisStep = true;
      s.log.push(`${me.name} plays ${type}.`);
      if (type === 'warden') {
        me.wardensPlayed++;
        updateWatchCaptain(s, pid);
        s.afterBandit = back;
        s.actor = pid;
        s.phase = 'bandit';
      } else if (type === 'pathmakers') {
        s.freeRoads = Math.min(2, me.roadsLeft);
        s.afterBandit = back;
        s.actor = pid;
        s.phase = 'pathmakers';
      } else if (type === 'embargo') {
        const r = (a as Extract<Action, { type: 'PLAY_EMBARGO' }>).resource;
        let got = 0;
        for (const p of s.players) if (p.id !== pid) { got += p.hand[r]; me.hand[r] += p.hand[r]; p.hand[r] = 0; }
        s.log.push(`${me.name} collects ${got} ${r}.`);
      }
      break;
    }
    case 'REVEAL_MONUMENTS': {
      checkWin(s, pid);
      if (s.phase !== 'ended') return fail('Not enough renown to win yet');
      break;
    }
    case 'BANK_TRADE': {
      if (!inMain || s.offer) return fail('Cannot trade now');
      if (a.give === a.get) return fail('Cannot trade a resource for itself');
      const times = a.times ?? 1;
      const rate = tradeRate(s, pid, a.give);
      if (me.hand[a.give] < rate * times) return fail('Not enough cards');
      if (s.bank[a.get] < times) return fail('Bank is out');
      me.hand[a.give] -= rate * times; s.bank[a.give] += rate * times;
      me.hand[a.get] += times; s.bank[a.get] -= times;
      s.log.push(`${me.name} trades ${rate * times} ${a.give} for ${times} ${a.get} with the bank.`);
      break;
    }
    case 'OFFER_TRADE': {
      if (s.phase !== 'main' || pid !== s.current) return fail('Only the active player may offer trades');
      if (!handSize(a.give) || !handSize(a.get)) return fail('Both sides must give at least one card');
      if (RESOURCES.some((r) => (a.give[r] ?? 0) > 0 && (a.get[r] ?? 0) > 0)) return fail('Cannot trade a resource for itself');
      if (!canAfford(me.hand, a.give)) return fail('You do not have those cards');
      s.offer = { from: pid, to: a.to, give: a.give, get: a.get, accepted: [], declined: [] };
      s.offersThisStep = (s.offersThisStep ?? 0) + 1;
      s.log.push(`${me.name} offers a trade.`);
      break;
    }
    case 'RESPOND_TRADE': {
      if (!s.offer || pid === s.offer.from || !offerTargets(s).includes(pid)) return fail('No offer for you');
      if (a.accept) {
        if (!canAfford(me.hand, s.offer.get)) return fail('You do not have those cards');
        s.offer.accepted.push(pid);
      } else s.offer.declined.push(pid);
      if (s.offer.declined.length === offerTargets(s).length) { s.offer = null; s.log.push('Trade declined by all.'); }
      break;
    }
    case 'CONFIRM_TRADE': {
      if (!s.offer || pid !== s.offer.from || !s.offer.accepted.includes(a.with)) return fail('That player has not accepted');
      const other = s.players[a.with];
      if (!canAfford(me.hand, s.offer.give) || !canAfford(other.hand, s.offer.get)) return fail('Cards changed; trade not possible');
      for (const r of RESOURCES) {
        const g = s.offer.give[r] ?? 0, t = s.offer.get[r] ?? 0;
        me.hand[r] += t - g; other.hand[r] += g - t;
      }
      s.log.push(`${me.name} trades with ${other.name}.`);
      s.offer = null;
      break;
    }
    case 'CANCEL_TRADE': {
      if (!s.offer || pid !== s.offer.from) return fail('No offer to cancel');
      s.offer = null;
      break;
    }
    case 'END_TURN': {
      if (s.offer) s.offer = null;
      const n = s.players.length;
      if (s.phase === 'main' && pid === s.current) {
        if (s.pairedTurns && n >= 5) {
          s.partner = (s.current + 3) % n;
          s.step++;
          s.phase = 'partner';
          s.charterPlayedThisStep = false;
          s.log.push(`${s.players[s.partner].name} takes a paired action phase.`);
          checkWin(s, s.partner);
        } else startTurn(s, (s.current + 1) % n);
      } else if (s.phase === 'partner' && pid === s.partner) {
        s.partner = null;
        startTurn(s, (s.current + 1) % n);
      } else return fail('Cannot end turn now');
      return { ok: true, state: s };
    }
    default:
      return fail('Unknown action');
  }

  checkWin(s, pid);
  return { ok: true, state: s };
}

function err(m: string): Result { return { ok: false, error: m }; }

/** A copy of the state safe to send to one player: hides others' cards and the deck order. */
export function viewFor(s: GameState, pid: number) {
  const v = clone(s) as GameState & { deckCount: number; handCounts: number[]; charterCounts: number[] };
  v.deckCount = s.deck.length;
  v.handCounts = s.players.map((p) => handSize(p.hand));
  v.charterCounts = s.players.map((p) => p.charters.length);
  v.deck = [];
  v.rng = 0;
  v.players = v.players.map((p) => (p.id === pid ? p : { ...p, hand: emptyHand(), charters: [] }));
  return v;
}

export { nextRandom };
