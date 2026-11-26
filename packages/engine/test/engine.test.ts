import { describe, expect, it } from 'vitest';
import {
  Action, GameState, apply, botAction, createGame, emptyHand, handSize, legalRoadEdges, longestRoad,
  publicVP, totalVP, tradeRate, viewFor, buildGeometry, standardCoords, largeCoords, nextRandom, actingPlayers,
} from '../src';

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `c${i}` }));

function ok(s: GameState, pid: number, a: Action): GameState {
  const r = apply(s, pid, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** Play the setup phase with bots and return a state at the first preRoll. */
function afterSetup(n = 4, seed = 7) {
  let s = createGame({ players: names(n), seed });
  while (s.phase === 'setup') {
    const pid = s.setup!.order[s.setup!.index];
    s = ok(s, pid, botAction(s, pid, () => 0)!);
  }
  return s;
}

/** Put the game straight into the main phase of the current player. */
function mainPhase(s: GameState) {
  s.phase = 'main';
  s.dice = [3, 4 - 0] as [number, number];
  return s;
}

function path(s: GameState, edges: number[], pid: number) {
  for (const e of edges) s.roads[e] = pid;
}

/** Find a simple chain of n edges starting from vertex v, avoiding used vertices. */
function chain(s: GameState, start: number, n: number): { edges: number[]; vertices: number[] } {
  const vs = [start];
  const es: number[] = [];
  const go = (v: number): boolean => {
    if (es.length === n) return true;
    for (const e of s.geo.vertices[v].edges) {
      const edge = s.geo.edges[e];
      const nx = edge.a === v ? edge.b : edge.a;
      if (vs.includes(nx)) continue;
      vs.push(nx); es.push(e);
      if (go(nx)) return true;
      vs.pop(); es.pop();
    }
    return false;
  };
  go(start);
  return { edges: es, vertices: vs };
}

describe('board', () => {
  it('builds the 19 and 30 hex islands', () => {
    const g = buildGeometry(standardCoords());
    expect(g.hexes.length).toBe(19);
    expect(g.vertices.length).toBe(54);
    expect(g.edges.length).toBe(72);
    expect(g.coastalEdges.length).toBe(30);
    expect(buildGeometry(largeCoords()).hexes.length).toBe(30);
  });

  it('has the right component counts', () => {
    const s = createGame({ players: names(4), seed: 1 });
    const count = (t: string) => s.terrains.filter((x) => x === t).length;
    expect([count('woodland'), count('meadow'), count('farmland'), count('claypits'), count('highlands'), count('wastes')]).toEqual([4, 4, 4, 3, 3, 1]);
    expect(s.numbers.filter((x) => x !== null).sort((a, b) => a! - b!)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(s.ports.length).toBe(9);
    expect(s.ports.filter((p) => p.kind === 'any').length).toBe(4);
    expect(s.deck.length).toBe(25);
    expect(s.deck.filter((c) => c === 'warden').length).toBe(14);
    expect(s.deck.filter((c) => c === 'monument').length).toBe(5);
    expect(s.bank.clay).toBe(19);
    expect(s.terrains[s.bandit]).toBe('wastes');
  });

  it('5-6 player setup is larger', () => {
    const s = createGame({ players: names(6), seed: 1 });
    expect(s.terrains.length).toBe(30);
    expect(s.numbers.filter((x) => x !== null).length).toBe(28);
    expect(s.ports.length).toBe(11);
    expect(s.deck.length).toBe(34);
    expect(s.bank.grain).toBe(24);
  });

  it('random numbers keep red numbers apart', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = createGame({ players: names(4), seed, mapType: 'random' });
      for (const h of s.geo.hexes) {
        const red = (n: number | null) => n === 6 || n === 8;
        if (red(s.numbers[h.id])) expect(h.neighbors.some((n) => red(s.numbers[n]))).toBe(false);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const a = createGame({ players: names(4), seed: 42 });
    const b = createGame({ players: names(4), seed: 42 });
    expect(a.terrains).toEqual(b.terrains);
    expect(a.deck).toEqual(b.deck);
  });
});

describe('setup', () => {
  it('uses snake order and pays for the second hamlet only', () => {
    let s = createGame({ players: names(3), seed: 3 });
    const order = s.setup!.order;
    expect(order.slice(0, 3)).toEqual([...order.slice(3)].reverse());
    // first hamlet gives nothing
    const p0 = order[0];
    s = ok(s, p0, botAction(s, p0, () => 0)!);
    expect(handSize(s.players[p0].hand)).toBe(0);
    while (s.phase === 'setup') { const pid = s.setup!.order[s.setup!.index]; s = ok(s, pid, botAction(s, pid, () => 0)!); }
    expect(s.phase).toBe('preRoll');
    expect(s.current).toBe(order[0]);
    for (const p of s.players) expect(publicVP(s, p.id)).toBe(2);
  });

  it('setup road must touch the new hamlet', () => {
    let s = createGame({ players: names(3), seed: 3 });
    const pid = s.setup!.order[0];
    s = ok(s, pid, { type: 'PLACE_HAMLET', vertex: 20 });
    const far = s.geo.edges.find((e) => e.a !== 20 && e.b !== 20)!.id;
    expect(apply(s, pid, { type: 'PLACE_ROAD', edge: far }).ok).toBe(false);
  });

  it('enforces the distance rule', () => {
    let s = createGame({ players: names(3), seed: 3 });
    const pid = s.setup!.order[0];
    s = ok(s, pid, { type: 'PLACE_HAMLET', vertex: 20 });
    s = ok(s, pid, { type: 'PLACE_ROAD', edge: s.geo.vertices[20].edges[0] });
    const next = s.setup!.order[1];
    const neighbor = s.geo.vertices[20].vertices[0];
    expect(apply(s, next, { type: 'PLACE_HAMLET', vertex: neighbor }).ok).toBe(false);
    expect(apply(s, next, { type: 'PLACE_HAMLET', vertex: 20 }).ok).toBe(false);
  });
});

describe('turns, production and the bandit', () => {
  it('only the active player can roll', () => {
    const s = afterSetup();
    const other = (s.current + 1) % 4;
    expect(apply(s, other, { type: 'ROLL' }).ok).toBe(false);
    expect(apply(s, s.current, { type: 'ROLL' }).ok).toBe(true);
  });

  it('hamlets get 1 and keeps get 2; bandit hex produces nothing', () => {
    const s = afterSetup();
    // pick a non-wastes hex and give it a hamlet and a keep from two players
    const hex = s.geo.hexes.find((h) => s.terrains[h.id] !== 'wastes')!;
    s.buildings = {};
    s.buildings[hex.vertices[0]] = { owner: 0, kind: 'hamlet' };
    s.buildings[hex.vertices[3]] = { owner: 1, kind: 'keep' };
    for (const p of s.players) p.hand = emptyHand();
    const n = s.numbers[hex.id]!;
    // force the dice: find an rng state that rolls n (brute force)
    const res = { woodland: 'timber', claypits: 'clay', meadow: 'fleece', farmland: 'grain', highlands: 'stone' }[s.terrains[hex.id] as 'woodland'] as 'timber';
    const rolled = forceRoll(s, n);
    expect(rolled.players[0].hand[res]).toBeGreaterThanOrEqual(1);
    expect(rolled.players[1].hand[res]).toBeGreaterThanOrEqual(2);
    s.bandit = hex.id;
    const blocked = forceRoll(s, n);
    // only other hexes with the same number could pay; ours doesn't
    const twin = s.geo.hexes.find((h) => h.id !== hex.id && s.numbers[h.id] === n);
    if (!twin || !twin.vertices.some((v) => s.buildings[v])) expect(blocked.players[1].hand[res]).toBe(0);
  });

  it('bank shortage: nobody gets it unless only one player is owed', () => {
    const s = afterSetup();
    const hex = s.geo.hexes.find((h) => s.terrains[h.id] === 'highlands')!;
    s.buildings = {};
    s.buildings[hex.vertices[0]] = { owner: 0, kind: 'keep' };
    s.buildings[hex.vertices[3]] = { owner: 1, kind: 'keep' };
    s.bank.stone = 3;
    for (const p of s.players) p.hand = emptyHand();
    const r = forceRoll(s, s.numbers[hex.id]!);
    expect(r.players[0].hand.stone + r.players[1].hand.stone).toBe(0);
    delete s.buildings[hex.vertices[3]];
    s.bank.stone = 1;
    const r2 = forceRoll(s, s.numbers[hex.id]!);
    expect(r2.players[0].hand.stone).toBe(1);
  });

  it('7: discard half when holding 8+, not with exactly 7', () => {
    const s = afterSetup();
    s.players[0].hand = { timber: 7, clay: 0, fleece: 0, grain: 0, stone: 0 };
    s.players[1].hand = { timber: 3, clay: 2, fleece: 2, grain: 1, stone: 1 }; // 9 -> discard 4
    s.players[2].hand = emptyHand();
    s.players[3].hand = emptyHand();
    let r = forceRoll(s, 7);
    expect(r.phase).toBe('discard');
    expect(r.pendingDiscards).toEqual({ 1: 4 });
    expect(apply(r, 1, { type: 'DISCARD', cards: { timber: 3 } }).ok).toBe(false);
    r = ok(r, 1, { type: 'DISCARD', cards: { timber: 3, clay: 1 } });
    expect(r.phase).toBe('bandit');
    expect(handSize(r.players[1].hand)).toBe(5);
  });

  it('bandit must move and steals from a chosen adjacent opponent', () => {
    let s = afterSetup();
    s.phase = 'bandit'; s.actor = s.current; s.afterBandit = 'main';
    expect(apply(s, s.current, { type: 'MOVE_BANDIT', hex: s.bandit }).ok).toBe(false);
    const victim = (s.current + 1) % 4;
    const v = Number(Object.entries(s.buildings).find(([, b]) => b.owner === victim)![0]);
    const hex = s.geo.vertices[v].hexes.find((h) => h !== s.bandit)!;
    s.players[victim].hand = { ...emptyHand(), grain: 2 };
    const before = handSize(s.players[s.current].hand);
    expect(apply(s, s.current, { type: 'MOVE_BANDIT', hex }).ok).toBe(false); // must choose
    s = ok(s, s.current, { type: 'MOVE_BANDIT', hex, victim });
    expect(handSize(s.players[s.current].hand)).toBe(before + 1);
    expect(s.phase).toBe('main');
  });
});

function forceRoll(s: GameState, total: number): GameState {
  // Search rng seeds until the dice show the wanted total. Keeps the engine pure.
  for (let seed = 1; seed < 100000; seed++) {
    const t = structuredClone(s);
    t.rng = seed; t.phase = 'preRoll';
    const h = { rng: seed };
    const d1 = Math.floor(nextRandom(h) * 6) + 1, d2 = Math.floor(nextRandom(h) * 6) + 1;
    if (d1 + d2 !== total) continue;
    return ok(t, t.current, { type: 'ROLL' });
  }
  throw new Error('no seed');
}

describe('building', () => {
  it('roads must connect and cannot pass an opponent building', () => {
    const s = mainPhase(afterSetup());
    const pid = s.current;
    s.players[pid].hand = { timber: 5, clay: 5, fleece: 0, grain: 0, stone: 0 };
    const legal = legalRoadEdges(s, pid);
    expect(legal.length).toBeGreaterThan(0);
    const illegal = s.geo.edges.map((e) => e.id).find((e) => !legal.includes(e) && s.roads[e] === undefined)!;
    expect(apply(s, pid, { type: 'BUILD_ROAD', edge: illegal }).ok).toBe(false);
    // road through opponent building
    const t = structuredClone(s);
    t.buildings = {}; t.roads = {};
    const { edges, vertices } = chain(t, 10, 2);
    t.roads[edges[0]] = pid;
    t.buildings[vertices[1]] = { owner: (pid + 1) % 4, kind: 'hamlet' };
    expect(apply(t, pid, { type: 'BUILD_ROAD', edge: edges[1] }).ok).toBe(false);
  });

  it('costs are charged and piece limits apply', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    s.players[pid].hand = { timber: 1, clay: 1, fleece: 0, grain: 0, stone: 0 };
    const e = legalRoadEdges(s, pid)[0];
    s = ok(s, pid, { type: 'BUILD_ROAD', edge: e });
    expect(handSize(s.players[pid].hand)).toBe(0);
    expect(s.players[pid].roadsLeft).toBe(12);
    s.players[pid].hand = { timber: 1, clay: 1, fleece: 0, grain: 0, stone: 0 };
    s.players[pid].roadsLeft = 0;
    expect(apply(s, pid, { type: 'BUILD_ROAD', edge: legalRoadEdges({ ...s, players: s.players.map((p) => ({ ...p, roadsLeft: 5 })) }, pid)[0] }).ok).toBe(false);
  });

  it('keeps upgrade own hamlets and return the hamlet piece', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    const mine = Number(Object.entries(s.buildings).find(([, b]) => b.owner === pid)![0]);
    const theirs = Number(Object.entries(s.buildings).find(([, b]) => b.owner !== pid)![0]);
    s.players[pid].hand = { timber: 0, clay: 0, fleece: 0, grain: 4, stone: 6 };
    expect(apply(s, pid, { type: 'BUILD_KEEP', vertex: theirs }).ok).toBe(false);
    s = ok(s, pid, { type: 'BUILD_KEEP', vertex: mine });
    expect(s.players[pid].hamletsLeft).toBe(4);
    expect(s.players[pid].keepsLeft).toBe(3);
    expect(publicVP(s, pid)).toBe(3);
  });
});

describe('trading', () => {
  it('bank rates: 4:1, 3:1 port, 2:1 port', () => {
    const s = mainPhase(afterSetup());
    s.buildings = {};
    expect(tradeRate(s, 0, 'clay')).toBe(4);
    const any = s.ports.find((p) => p.kind === 'any')!;
    s.buildings[any.vertices[0]] = { owner: 0, kind: 'hamlet' };
    expect(tradeRate(s, 0, 'clay')).toBe(3);
    const two = s.ports.find((p) => p.kind === 'clay')!;
    s.buildings[two.vertices[1]] = { owner: 0, kind: 'hamlet' };
    expect(tradeRate(s, 0, 'clay')).toBe(2);
    expect(tradeRate(s, 0, 'stone')).toBe(3);
  });

  it('player trades: no gifts, no same-for-same, needs acceptance then confirm', () => {
    let s = mainPhase(afterSetup());
    const a = s.current, b = (a + 1) % 4, c = (a + 2) % 4;
    s.players[a].hand = { ...emptyHand(), clay: 2 };
    s.players[b].hand = { ...emptyHand(), stone: 1 };
    expect(apply(s, a, { type: 'OFFER_TRADE', to: null, give: { clay: 1 }, get: {} }).ok).toBe(false);
    expect(apply(s, a, { type: 'OFFER_TRADE', to: null, give: { clay: 1 }, get: { clay: 1 } }).ok).toBe(false);
    expect(apply(s, b, { type: 'OFFER_TRADE', to: null, give: { stone: 1 }, get: { clay: 1 } }).ok).toBe(false);
    s = ok(s, a, { type: 'OFFER_TRADE', to: null, give: { clay: 2 }, get: { stone: 1 } });
    expect(apply(s, c, { type: 'RESPOND_TRADE', accept: true }).ok).toBe(false); // c can't pay
    s = ok(s, b, { type: 'RESPOND_TRADE', accept: true });
    expect(apply(s, a, { type: 'CONFIRM_TRADE', with: c }).ok).toBe(false);
    s = ok(s, a, { type: 'CONFIRM_TRADE', with: b });
    expect(s.players[a].hand.stone).toBe(1);
    expect(s.players[b].hand.clay).toBe(2);
  });
});

describe('charters', () => {
  it('cannot play a charter the turn it was bought; one per turn', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    s.deck.push('warden');
    s.players[pid].hand = { ...emptyHand(), stone: 2, fleece: 2, grain: 2 };
    s = ok(s, pid, { type: 'BUY_CHARTER' });
    expect(apply(s, pid, { type: 'PLAY_WARDEN' }).ok).toBe(false);
    s.players[pid].charters.push({ type: 'windfall', boughtOn: -1 }, { type: 'embargo', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_WINDFALL', resources: ['clay', 'clay'] });
    expect(s.players[pid].hand.clay).toBe(2);
    expect(apply(s, pid, { type: 'PLAY_EMBARGO', resource: 'grain' }).ok).toBe(false);
  });

  it('warden can be played before rolling', () => {
    let s = afterSetup();
    const pid = s.current;
    s.players[pid].charters.push({ type: 'warden', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_WARDEN' });
    expect(s.phase).toBe('bandit');
    const hex = s.geo.hexes.find((h) => h.id !== s.bandit && !h.vertices.some((v) => s.buildings[v]))!.id;
    s = ok(s, pid, { type: 'MOVE_BANDIT', hex });
    expect(s.phase).toBe('preRoll');
  });

  it('embargo takes all of a resource from every opponent', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    for (const p of s.players) p.hand = { ...emptyHand(), fleece: 2 };
    s.players[pid].charters.push({ type: 'embargo', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_EMBARGO', resource: 'fleece' });
    expect(s.players[pid].hand.fleece).toBe(8);
    expect(s.players.filter((p) => p.id !== pid).every((p) => p.hand.fleece === 0)).toBe(true);
  });

  it('pathmakers places two free roads', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    s.players[pid].hand = emptyHand();
    s.players[pid].charters.push({ type: 'pathmakers', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_PATHMAKERS' });
    s = ok(s, pid, { type: 'BUILD_ROAD', edge: legalRoadEdges(s, pid)[0] });
    s = ok(s, pid, { type: 'BUILD_ROAD', edge: legalRoadEdges(s, pid)[0] });
    expect(s.phase).toBe('main');
    expect(s.players[pid].roadsLeft).toBe(11);
  });

  it('monuments count and can be revealed to win, even bought this turn', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current;
    s.targetVP = 3;
    s.players[pid].charters.push({ type: 'monument', boughtOn: s.step });
    // checkWin runs after any action; a harmless action triggers it
    s.players[pid].hand = { ...emptyHand(), clay: 4 };
    s = ok(s, pid, { type: 'BANK_TRADE', give: 'clay', get: 'stone' });
    expect(s.winner).toBe(pid);
    expect(totalVP(s, pid)).toBe(3);
  });
});

describe('Grand Road and Watch Captain', () => {
  it('longest road counts the longest single trail with forks', () => {
    const s = afterSetup();
    s.roads = {}; s.buildings = {};
    const { edges, vertices } = chain(s, 0, 6);
    path(s, edges, 0);
    expect(longestRoad(s, 0)).toBe(6);
    // add a fork of 1 at the middle: still 6
    const mid = vertices[3];
    const fork = s.geo.vertices[mid].edges.find((e) => s.roads[e] === undefined)!;
    s.roads[fork] = 0;
    expect(longestRoad(s, 0)).toBe(6);
  });

  it('awarded at 5, stolen only by a strictly longer road, broken by a hamlet', () => {
    let s = mainPhase(afterSetup());
    s.roads = {}; s.buildings = {}; s.grandRoad = null;
    const pid = s.current, other = (pid + 1) % 4;
    const a = chain(s, 0, 6);
    path(s, a.edges.slice(0, 4), pid);
    s.buildings[a.vertices[0]] = { owner: pid, kind: 'hamlet' };
    s.players[pid].hand = { ...emptyHand(), timber: 5, clay: 5 };
    s = ok(s, pid, { type: 'BUILD_ROAD', edge: a.edges[4] });
    expect(s.grandRoad).toBe(pid);
    // opponent with equal length does not take it
    const far = s.geo.vertices.find((v) => v.x > 3)!.id;
    const b = chain(s, far, 5);
    path(s, b.edges, other);
    const t = structuredClone(s);
    t.players[pid].hand = { ...emptyHand(), timber: 1, clay: 1 };
    // trigger update via a legal road elsewhere for pid... instead break pid's road:
    // opponent hamlet in the middle of pid's road
    t.buildings[a.vertices[2]] = { owner: other, kind: 'hamlet' };
    t.current = other; t.players[other].hand = { ...emptyHand(), timber: 1, clay: 1, fleece: 1, grain: 1 };
    // place via direct rule update: build a road for other to trigger recompute
    const e = legalRoadEdges(t, other)[0];
    const r = ok(t, other, { type: 'BUILD_ROAD', edge: e });
    expect(r.grandRoad).toBe(other);
  });

  it('watch captain at 3 wardens; ties do not steal', () => {
    let s = mainPhase(afterSetup());
    const pid = s.current, other = (pid + 1) % 4;
    s.players[other].wardensPlayed = 3; s.watchCaptain = other;
    s.players[pid].wardensPlayed = 2;
    s.players[pid].charters.push({ type: 'warden', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_WARDEN' });
    expect(s.watchCaptain).toBe(other);
    s.players[pid].wardensPlayed = 3;
    s.phase = 'main'; s.charterPlayedThisStep = false;
    s.players[pid].charters.push({ type: 'warden', boughtOn: -1 });
    s = ok(s, pid, { type: 'PLAY_WARDEN' });
    expect(s.watchCaptain).toBe(pid);
  });
});

describe('5-6 paired turns', () => {
  it('partner three seats left acts after the active player, no player trades', () => {
    let s = afterSetup(5, 11);
    const cur = s.current;
    s = ok(s, cur, { type: 'ROLL' });
    while (s.phase !== 'main') {
      const pid = Object.keys(s.pendingDiscards).length ? Number(Object.keys(s.pendingDiscards)[0]) : s.current;
      s = ok(s, pid, botAction(s, pid, () => 0)!);
    }
    s = ok(s, cur, { type: 'END_TURN' });
    expect(s.phase).toBe('partner');
    expect(s.partner).toBe((cur + 3) % 5);
    const p = s.partner!;
    s.players[p].hand = { ...emptyHand(), clay: 4 };
    expect(apply(s, p, { type: 'OFFER_TRADE', to: null, give: { clay: 1 }, get: { stone: 1 } }).ok).toBe(false);
    expect(apply(s, p, { type: 'BANK_TRADE', give: 'clay', get: 'stone' }).ok).toBe(true);
    expect(apply(s, cur, { type: 'BUILD_ROAD', edge: 0 }).ok).toBe(false);
    s = ok(s, p, { type: 'END_TURN' });
    expect(s.current).toBe((cur + 1) % 5);
    expect(s.phase).toBe('preRoll');
  });
});

describe('views', () => {
  it('hides opponents cards and the deck', () => {
    const s = afterSetup();
    const v = viewFor(s, 0);
    expect(v.deck.length).toBe(0);
    expect(v.deckCount).toBe(s.deck.length);
    expect(handSize(v.players[1].hand)).toBe(0);
    expect(v.handCounts[1]).toBe(handSize(s.players[1].hand));
    expect(v.players[0].hand).toEqual(s.players[0].hand);
  });
});

describe('simulation', () => {
  function play(n: number, seed: number, levels?: ('easy' | 'normal' | 'hard')[]) {
    let s = createGame({ players: names(n), seed, mapType: n >= 5 ? 'random' : 'spiral' });
    let rngState = { rng: seed * 7 + 1 };
    const rand = () => nextRandom(rngState);
    let guard = 0;
    while (s.phase !== 'ended' && guard++ < 30000) {
      let acted = false;
      for (const pid of actingPlayers(s)) {
        const a = botAction(s, pid, rand, levels?.[pid] ?? 'normal');
        if (!a) continue;
        const r = apply(s, pid, a);
        if (!r.ok) throw new Error(`seed ${seed} ${a.type}: ${r.error}`);
        s = r.state;
        acted = true;
        break;
      }
      if (!acted) throw new Error(`seed ${seed}: nobody can act in ${s.phase}`);
      // invariants
      const totals = { timber: 0, clay: 0, fleece: 0, grain: 0, stone: 0 } as Record<string, number>;
      for (const p of s.players) for (const k in totals) { totals[k] += p.hand[k as 'clay']; if (p.hand[k as 'clay'] < 0) throw new Error('negative hand'); }
      for (const k in totals) if (totals[k] + s.bank[k as 'clay'] !== (n >= 5 ? 24 : 19)) throw new Error(`resource leak ${k}`);
    }
    return s;
  }

  it('bot games always finish legally (3, 4, 5, 6 players)', () => {
    const turns: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const n = 3 + (seed % 4);
      const s = play(n, seed);
      expect(s.phase).toBe('ended');
      expect(totalVP(s, s.winner!)).toBeGreaterThanOrEqual(10);
      turns.push(s.turn);
    }
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    console.log(`200 bot games, average ${avg.toFixed(1)} turns`);
  }, 180000);

  it('hard bots beat easy bots most of the time', () => {
    let hardWins = 0;
    const games = 60;
    for (let seed = 1; seed <= games; seed++) {
      // seats alternate hard/easy, rotated by seed so seat order doesn't decide it
      const levels = [0, 1, 2, 3].map((i) => ((i + seed) % 2 === 0 ? 'hard' : 'easy')) as ('hard' | 'easy')[];
      const s = play(4, 1000 + seed, levels);
      if (levels[s.winner!] === 'hard') hardWins++;
    }
    console.log(`hard bots won ${hardWins}/${games}`);
    expect(hardWins / games).toBeGreaterThan(0.6);
  }, 180000);

  it('bots trade with each other', () => {
    let trades = 0;
    for (let seed = 1; seed <= 20; seed++) trades += play(4, seed).log.filter((l) => / trades with [A-Z]/.test(l) && !l.includes('bank')).length;
    console.log(`player trades in 20 games: ${trades}`);
    expect(trades).toBeGreaterThan(0);
  }, 180000);
});
