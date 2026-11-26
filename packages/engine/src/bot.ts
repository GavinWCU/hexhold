// Rule-based bots with three levels. Bots only read public information plus their own hand
// (they never look at other players' hands or the deck order).
import { PIPS, RESOURCES, Resource, TERRAIN_RESOURCE } from './board';
import {
  Action, COSTS, GameState, Hand, actingPlayers, banditVictims, canAfford, handSize, isVertexFree,
  legalBanditHexes, legalHamletVertices, legalKeepVertices, legalRoadEdges, publicVP, tradeRate,
} from './game';

export type BotLevel = 'easy' | 'normal' | 'hard';

const SCARCITY: Record<Resource, number> = { timber: 1, clay: 1.2, fleece: 0.9, grain: 1.1, stone: 1.2 };

export function vertexValue(s: GameState, v: number, pid?: number): number {
  let score = 0;
  const seen = new Set<Resource>();
  for (const h of s.geo.vertices[v].hexes) {
    const r = TERRAIN_RESOURCE[s.terrains[h]];
    const n = s.numbers[h];
    if (!r || n == null || h === s.bandit) continue;
    score += PIPS[n] * SCARCITY[r];
    seen.add(r);
  }
  score += seen.size * 1.5;
  if (pid !== undefined) {
    const have = producedResources(s, pid);
    for (const r of seen) if (!have.has(r)) score += 2;
  }
  const port = s.ports.find((p) => p.vertices.includes(v));
  if (port) {
    if (port.kind === 'any') score += 1.5;
    else if (pid !== undefined && productionOf(s, pid)[port.kind] >= 5) score += 3;
    else score += 1;
  }
  return score;
}

function producedResources(s: GameState, pid: number) {
  const set = new Set<Resource>();
  const prod = productionOf(s, pid);
  for (const r of RESOURCES) if (prod[r] > 0) set.add(r);
  return set;
}

/** Expected pips per resource for a player (public information). */
export function productionOf(s: GameState, pid: number): Record<Resource, number> {
  const out = { timber: 0, clay: 0, fleece: 0, grain: 0, stone: 0 };
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.owner !== pid) continue;
    for (const h of s.geo.vertices[Number(v)].hexes) {
      const r = TERRAIN_RESOURCE[s.terrains[h]];
      const n = s.numbers[h];
      if (r && n != null) out[r] += PIPS[n] * (b.kind === 'keep' ? 2 : 1);
    }
  }
  return out;
}

function missing(h: Hand, cost: Partial<Hand>) {
  return RESOURCES.reduce((m, r) => m + Math.max(0, (cost[r] ?? 0) - h[r]), 0);
}

function roadEdgeScore(s: GameState, pid: number, e: number): number {
  const edge = s.geo.edges[e];
  let best = 0;
  for (const end of [edge.a, edge.b]) {
    if (isVertexFree(s, end)) best = Math.max(best, vertexValue(s, end, pid) + 2);
    for (const n of s.geo.vertices[end].vertices) if (isVertexFree(s, n)) best = Math.max(best, vertexValue(s, n, pid) * 0.7);
  }
  return best;
}

function leaderOf(s: GameState, pid: number) {
  return s.players.filter((p) => p.id !== pid).sort((a, b) => publicVP(s, b.id) - publicVP(s, a.id))[0]?.id;
}

/** What the bot is saving for, in priority order. */
function goals(s: GameState, pid: number): Partial<Hand>[] {
  const me = s.players[pid];
  const g: Partial<Hand>[] = [];
  const keeps = legalKeepVertices(s, pid);
  const spots = legalHamletVertices(s, pid);
  if (keeps.length) g.push(COSTS.keep);
  if (spots.length) g.push(COSTS.hamlet);
  else if (me.roadsLeft > 0 && me.hamletsLeft > 0) g.push(COSTS.road);
  if (s.deck.length || (s as GameState & { deckCount?: number }).deckCount) g.push(COSTS.charter);
  return g.sort((a, b) => missing(me.hand, a) - missing(me.hand, b));
}

/** A 1-for-1 offer to everyone: surplus card for a needed card. */
function tradeIdea(s: GameState, pid: number): { give: Resource; get: Resource } | null {
  const me = s.players[pid];
  for (const goal of goals(s, pid)) {
    const need = RESOURCES.find((r) => me.hand[r] < (goal[r] ?? 0));
    if (!need) continue;
    const give = RESOURCES.filter((r) => r !== need && me.hand[r] - (goal[r] ?? 0) >= 1).sort((a, b) => me.hand[b] - me.hand[a])[0];
    if (give) return { give, get: need };
  }
  return null;
}

/** Would this bot accept receiving `gets` in exchange for `gives`? */
export function botLikesTrade(s: GameState, pid: number, gets: Partial<Hand>, gives: Partial<Hand>, level: BotLevel, from: number) {
  const me = s.players[pid];
  if (!canAfford(me.hand, gives)) return false;
  if (publicVP(s, from) >= s.targetVP - 2) return false; // don't feed someone about to win
  if (level === 'easy') return handSize(gets) >= handSize(gives);
  const after = { ...me.hand };
  for (const r of RESOURCES) after[r] += (gets[r] ?? 0) - (gives[r] ?? 0);
  const goal = goals(s, pid)[0];
  if (!goal) return handSize(gets) > handSize(gives);
  const better = missing(after, goal) < missing(me.hand, goal);
  const same = missing(after, goal) === missing(me.hand, goal) && handSize(gets) > handSize(gives);
  return better || same;
}

export function botAction(s: GameState, pid: number, rand: () => number = Math.random, level: BotLevel = 'normal'): Action | null {
  if (s.phase === 'ended' || !actingPlayers(s).includes(pid)) return null;
  const me = s.players[pid];
  const sloppy = level === 'easy';
  const hard = level === 'hard';

  if (s.phase === 'setup') {
    if (s.setup!.step === 'hamlet') {
      const opts = legalHamletVertices(s, pid, true);
      opts.sort((a, b) => vertexValue(s, b, pid) - vertexValue(s, a, pid));
      const spread = sloppy ? 6 : hard ? 1 : 2;
      return { type: 'PLACE_HAMLET', vertex: opts[Math.min(opts.length - 1, Math.floor(rand() * spread))] };
    }
    const v = s.setup!.lastHamlet!;
    const edges = s.geo.vertices[v].edges.filter((e) => s.roads[e] === undefined);
    edges.sort((a, b) => roadEdgeScore(s, pid, b) - roadEdgeScore(s, pid, a));
    return { type: 'PLACE_ROAD', edge: sloppy ? edges[Math.floor(rand() * edges.length)] : edges[0] };
  }

  if (s.phase === 'discard') {
    let need = s.pendingDiscards[pid];
    const h = { ...me.hand };
    const goal = goals(s, pid)[0] ?? {};
    const cards: Partial<Hand> = {};
    while (need-- > 0) {
      // drop what the current goal needs least
      const r = RESOURCES.filter((x) => h[x] > 0).sort((a, b) => (h[b] - (goal[b] ?? 0)) - (h[a] - (goal[a] ?? 0)))[0];
      h[r]--; cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'DISCARD', cards };
  }

  if (s.phase === 'bandit') {
    const hexes = legalBanditHexes(s, pid);
    if (sloppy) {
      const h = hexes[Math.floor(rand() * hexes.length)];
      const v = banditVictims(s, h, pid);
      return { type: 'MOVE_BANDIT', hex: h, victim: v[0] ?? null };
    }
    const leader = leaderOf(s, pid);
    let best = hexes[0], bestScore = -Infinity;
    for (const h of hexes) {
      const n = s.numbers[h];
      const pips = n == null ? 0 : PIPS[n];
      let score = 0;
      for (const v of s.geo.hexes[h].vertices) {
        const b = s.buildings[v];
        if (!b) continue;
        const w = (b.kind === 'keep' ? 2 : 1) * pips;
        score += b.owner === pid ? -w * 3 : b.owner === leader ? w * (hard ? 2.5 : 1.5) : w;
      }
      if (score > bestScore) { bestScore = score; best = h; }
    }
    const victims = banditVictims(s, best, pid).sort((a, b) => publicVP(s, b) - publicVP(s, a));
    return { type: 'MOVE_BANDIT', hex: best, victim: victims[0] ?? null };
  }

  if (s.phase === 'pathmakers') {
    const edges = legalRoadEdges(s, pid).sort((a, b) => roadEdgeScore(s, pid, b) - roadEdgeScore(s, pid, a));
    return { type: 'BUILD_ROAD', edge: edges[0] };
  }

  const canPlay = (t: string) => !s.charterPlayedThisStep && me.charters.some((c) => c.type === t && c.boughtOn < s.step);

  if (s.phase === 'preRoll') {
    const banditOnMe = s.geo.hexes[s.bandit].vertices.some((v) => s.buildings[v]?.owner === pid);
    if (canPlay('warden') && banditOnMe && !sloppy) return { type: 'PLAY_WARDEN' };
    return { type: 'ROLL' };
  }

  // Answering someone else's offer.
  if (s.offer && s.offer.from !== pid) {
    return { type: 'RESPOND_TRADE', accept: botLikesTrade(s, pid, s.offer.give, s.offer.get, level, s.offer.from) };
  }
  // Our own offer: confirm with the first taker, cancel when everyone has answered, else wait.
  if (s.offer && s.offer.from === pid) {
    if (s.offer.accepted.length) return { type: 'CONFIRM_TRADE', with: s.offer.accepted[0] };
    const targets = s.offer.to ?? s.players.map((p) => p.id).filter((id) => id !== pid);
    if (s.offer.accepted.length + s.offer.declined.length >= targets.length) return { type: 'CANCEL_TRADE' };
    return null;
  }

  // ---- main / partner phase ----
  if (sloppy && rand() < 0.15) return { type: 'END_TURN' };

  const keeps = legalKeepVertices(s, pid);
  if (keeps.length && canAfford(me.hand, COSTS.keep)) {
    keeps.sort((a, b) => vertexValue(s, b) - vertexValue(s, a));
    return { type: 'BUILD_KEEP', vertex: keeps[0] };
  }
  const hamletSpots = legalHamletVertices(s, pid);
  if (hamletSpots.length && canAfford(me.hand, COSTS.hamlet)) {
    hamletSpots.sort((a, b) => vertexValue(s, b, pid) - vertexValue(s, a, pid));
    return { type: 'BUILD_HAMLET', vertex: hamletSpots[0] };
  }
  if (canPlay('windfall')) {
    const goal = goals(s, pid)[0] ?? COSTS.keep;
    const need = RESOURCES.filter((r) => me.hand[r] < (goal[r] ?? 0) && s.bank[r] > 0);
    const r1 = need[0] ?? 'stone';
    const r2 = need[1] ?? need[0] ?? 'grain';
    if (s.bank[r1] > 0 && s.bank[r2] > (r1 === r2 ? 1 : 0)) return { type: 'PLAY_WINDFALL', resources: [r1, r2] };
  }
  if (canPlay('pathmakers') && me.roadsLeft > 0 && legalRoadEdges(s, pid).length) return { type: 'PLAY_PATHMAKERS' };
  if (canPlay('embargo')) {
    // Guess the resource opponents produce most (public info only).
    const tally = { timber: 0, clay: 0, fleece: 0, grain: 0, stone: 0 };
    for (const p of s.players) if (p.id !== pid) { const pr = productionOf(s, p.id); for (const r of RESOURCES) tally[r] += pr[r]; }
    const pick = sloppy ? RESOURCES[Math.floor(rand() * 5)] : RESOURCES.slice().sort((a, b) => tally[b] - tally[a])[0];
    return { type: 'PLAY_EMBARGO', resource: pick };
  }
  if (canPlay('warden') && s.watchCaptain !== pid) return { type: 'PLAY_WARDEN' };
  if (!hamletSpots.length && me.roadsLeft > 0 && canAfford(me.hand, COSTS.road) && me.hamletsLeft > 0) {
    const edges = legalRoadEdges(s, pid).sort((a, b) => roadEdgeScore(s, pid, b) - roadEdgeScore(s, pid, a));
    if (edges.length) return { type: 'BUILD_ROAD', edge: edges[0] };
  }
  const deckLeft = s.deck.length || (s as GameState & { deckCount?: number }).deckCount || 0;
  if (deckLeft && canAfford(me.hand, COSTS.charter) && (keeps.length === 0 || missing(me.hand, COSTS.keep) > 2)) {
    return { type: 'BUY_CHARTER' };
  }
  // Offer a trade to the table once per turn (only the active player may).
  if (!sloppy && s.phase === 'main' && pid === s.current && (s.offersThisStep ?? 0) < (hard ? 2 : 1)) {
    const idea = tradeIdea(s, pid);
    if (idea) return { type: 'OFFER_TRADE', to: null, give: { [idea.give]: 1 }, get: { [idea.get]: 1 } };
  }
  // Bank trade toward the cheapest-to-finish goal.
  for (const goal of goals(s, pid)) {
    const needR = RESOURCES.find((r) => me.hand[r] < (goal[r] ?? 0) && s.bank[r] > 0);
    if (!needR) continue;
    const giveR = RESOURCES.find((r) => r !== needR && me.hand[r] - (goal[r] ?? 0) >= tradeRate(s, pid, r));
    if (giveR) return { type: 'BANK_TRADE', give: giveR, get: needR };
  }
  // Hard bots avoid sitting on more than 7 cards.
  if (hard && handSize(me.hand) > 7) {
    const giveR = RESOURCES.slice().sort((a, b) => me.hand[b] - me.hand[a])[0];
    const rate = tradeRate(s, pid, giveR);
    const getR = RESOURCES.filter((r) => r !== giveR && s.bank[r] > 0).sort((a, b) => me.hand[a] - me.hand[b])[0];
    if (me.hand[giveR] >= rate && getR) return { type: 'BANK_TRADE', give: giveR, get: getR };
  }
  return { type: 'END_TURN' };
}
