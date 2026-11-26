import { describe, expect, it } from 'vitest';
import { GameHost, Seat, TAKEOVER_AFTER } from '../src/controller';
import { actingPlayers } from '@hexhold/engine';

const seat = (name: string, kind: Seat['kind']): Seat => ({ name, color: '#f00', kind, level: 'normal', online: kind !== 'remote' });

describe('GameHost', () => {
  it('bots fill their seats and a whole bot game finishes', () => {
    const h = new GameHost({ seats: [seat('A', 'bot'), seat('B', 'bot'), seat('C', 'bot')], seed: 3, players: [] });
    for (let i = 0; i < 20000 && h.state.phase !== 'ended'; i++) h.stepBots();
    expect(h.state.phase).toBe('ended');
    h.stop();
  });

  it('waits for a connected friend, but a bot takes over after they stay offline', () => {
    const h = new GameHost({ seats: [seat('A', 'bot'), seat('Friend', 'remote'), seat('C', 'bot')], seed: 9, players: [] });
    h.seats[1].online = true;
    // run until it's the friend's move
    for (let i = 0; i < 200 && !actingPlayers(h.state).includes(1); i++) h.stepBots();
    expect(actingPlayers(h.state)).toContain(1);
    const before = JSON.stringify(h.state);
    h.stepBots();
    expect(JSON.stringify(h.state)).toBe(before); // nobody moves for an online human
    h.setOnline(1, false);
    h.seats[1].offlineSince = Date.now() - TAKEOVER_AFTER - 1000;
    h.stepBots();
    expect(JSON.stringify(h.state)).not.toBe(before); // bot played the friend's move
    h.stop();
  });

  it('save and load round-trips a game', () => {
    const h = new GameHost({ seats: [seat('A', 'bot'), seat('B', 'bot'), seat('C', 'bot')], seed: 5, players: [] });
    for (let i = 0; i < 300; i++) h.stepBots();
    const copy = GameHost.load(h.save());
    expect(copy.state).toEqual(h.state);
    expect(copy.seats).toEqual(h.seats);
    h.stop(); copy.stop();
  });
});
