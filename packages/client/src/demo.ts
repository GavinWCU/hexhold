// Builds example game states for previews and screenshots, using the real engine and bots.
import { GameState, apply, botAction, createGame, nextRandom, actingPlayers } from '@hexhold/engine';
import { PLAYER_COLORS } from './palette';

export type Moment = 'empty' | 'setup' | 'mid' | 'seven' | 'trade' | 'end' | 'style';

const NAMES = ['You', 'Bramble', 'Juniper', 'Wick', 'Pip', 'Tamsin'];

export function newGame(seed: number, players = 4) {
  return createGame({
    seed,
    mapType: players >= 5 ? 'random' : 'spiral',
    players: Array.from({ length: players }, (_, i) => ({ name: NAMES[i], color: PLAYER_COLORS[i], bot: i > 0 })),
  });
}

function step(s: GameState, rand: () => number): GameState {
  const pid = actingPlayers(s)[0];
  const a = botAction(s, pid, rand);
  if (!a) return s;
  const r = apply(s, pid, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

export function playUntil(s: GameState, pred: (s: GameState) => boolean, seed = 1, max = 20000) {
  const h = { rng: seed };
  const rand = () => nextRandom(h);
  for (let i = 0; i < max && s.phase !== 'ended' && !pred(s); i++) s = step(s, rand);
  return s;
}

export function demoState(moment: Moment, seed: number, players = 4): GameState {
  let s = newGame(seed, players);
  switch (moment) {
    case 'empty': return s;
    case 'setup': return playUntil(s, (x) => x.phase !== 'setup', seed);
    case 'mid': return playUntil(s, (x) => x.turn >= 30 && x.phase === 'main', seed);
    case 'seven': return playUntil(s, (x) => x.turn > 12 && x.phase === 'discard', seed);
    case 'trade': {
      s = playUntil(s, (x) => x.turn >= 20 && x.phase === 'main' && x.current === 0, seed);
      if (s.phase === 'main') s.offer = { from: s.current, to: null, give: { clay: 1, timber: 1 }, get: { stone: 1 }, accepted: [1], declined: [2] };
      return s;
    }
    case 'end': return playUntil(s, () => false, seed);
    case 'style': {
      s = playUntil(s, (x) => x.phase !== 'setup', seed);
      // Focus: the front-most meadow hex, with a hamlet and the Bandit on it.
      const meadow = [...s.geo.hexes].filter((h) => s.terrains[h.id] === 'meadow').sort((a, b) => b.y - a.y)[0];
      const v = meadow.vertices[2];
      s.buildings[v] = { owner: 0, kind: 'hamlet' };
      s.bandit = meadow.id;
      (s as GameState & { focusHex?: number }).focusHex = meadow.id;
      return s;
    }
  }
}
