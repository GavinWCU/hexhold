// The authoritative game host. Runs in the browser of whoever hosts (or plays solo):
// validates every action with the engine, runs bots, and tells listeners about new states.
import { Action, BotLevel, GameState, actingPlayers, apply, botAction, createGame, viewFor, GameOptions } from '@hexhold/engine';

export type SeatKind = 'human' | 'bot' | 'remote';
export interface Seat {
  name: string;
  color: string;
  kind: SeatKind;
  level: BotLevel;
  online: boolean; // remote seats: currently connected
  offlineSince?: number;
}

export interface HostEvent { type: 'state' | 'error' | 'sound'; seat?: number; message?: string; sound?: string }

export const BOT_DELAY = { min: 600, max: 1400 };
const OFFER_TIMEOUT = 20000; // bots give up on unanswered offers
export const TAKEOVER_AFTER = 60000; // a bot plays for a disconnected player after this long

export class GameHost {
  state: GameState;
  seats: Seat[];
  fastBots = false;
  paused = false; // tutorial: bots wait until unpaused
  botDelay: number | null = null; // override delay in ms
  private listeners = new Set<(e: HostEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private offerSince = 0;
  private rng = 1;

  constructor(opts: GameOptions & { seats: Seat[] } | { state: GameState; seats: Seat[] }) {
    if ('state' in opts) {
      this.state = opts.state;
      this.seats = opts.seats;
    } else {
      this.seats = opts.seats;
      this.state = createGame({ ...opts, players: opts.seats.map((s) => ({ name: s.name, color: s.color, bot: s.kind === 'bot' })) });
    }
    this.rng = (this.state.rng ^ 0x5bd1e995) | 0;
  }

  on(fn: (e: HostEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: HostEvent) { for (const fn of this.listeners) fn(e); }

  view(seat: number) { return viewFor(this.state, seat); }

  /** Apply an action from a seat. Returns an error message, or null on success. */
  dispatch(seat: number, action: Action): string | null {
    const before = this.state;
    const r = apply(this.state, seat, action);
    if (!r.ok) { this.emit({ type: 'error', seat, message: r.error }); return r.error; }
    this.state = r.state;
    if (this.state.offer && !before.offer) this.offerSince = Date.now();
    this.emit({ type: 'sound', sound: soundFor(action, before, this.state) });
    this.emit({ type: 'state' });
    this.schedule();
    return null;
  }

  private botControls(seat: number) {
    const s = this.seats[seat];
    if (s.kind === 'bot') return true;
    if (s.kind === 'remote' && !s.online && s.offlineSince && Date.now() - s.offlineSince > TAKEOVER_AFTER) return true;
    return false;
  }

  private rand = () => {
    let t = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Run the next bot move after a short, human-like delay. */
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.state.phase === 'ended') return;
    const delay = this.botDelay ?? (this.fastBots ? 30 : BOT_DELAY.min + Math.random() * (BOT_DELAY.max - BOT_DELAY.min));
    this.timer = setTimeout(() => this.stepBots(), delay);
  }

  stepBots() {
    this.timer = null;
    const s = this.state;
    if (s.phase === 'ended' || this.paused) return;
    for (const pid of actingPlayers(s)) {
      if (!this.botControls(pid)) continue;
      const a = botAction(s, pid, this.rand, this.seats[pid].level);
      if (a) { this.dispatch(pid, a); return; }
    }
    // A bot's offer waiting on humans: give up after a while.
    if (s.offer && this.botControls(s.offer.from) && Date.now() - this.offerSince > OFFER_TIMEOUT) {
      this.dispatch(s.offer.from, { type: 'CANCEL_TRADE' });
      return;
    }
    // Something still pending (a human must act, or a timeout is running): check again later.
    if (s.offer || this.seats.some((x) => x.kind === 'remote' && !x.online)) this.timer = setTimeout(() => this.stepBots(), 1000);
  }

  /** Re-send the current state to everyone (used after loading or by tests). */
  touch() { this.emit({ type: 'state' }); }

  setOnline(seat: number, online: boolean) {
    const s = this.seats[seat];
    s.online = online;
    s.offlineSince = online ? undefined : Date.now();
    this.emit({ type: 'state' });
    this.schedule();
  }

  save() { return JSON.stringify({ version: 1, state: this.state, seats: this.seats }); }
  static load(json: string) {
    const d = JSON.parse(json);
    if (!d.state || !d.seats) throw new Error('Not a Hexhold save file');
    return new GameHost({ state: d.state, seats: d.seats });
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}

function soundFor(a: Action, before: GameState, after: GameState): string {
  switch (a.type) {
    case 'ROLL': return after.dice && after.dice[0] + after.dice[1] === 7 ? 'seven' : 'dice';
    case 'PLACE_HAMLET': case 'BUILD_HAMLET': case 'BUILD_KEEP': return 'build';
    case 'PLACE_ROAD': case 'BUILD_ROAD': return 'road';
    case 'MOVE_BANDIT': return 'steal';
    case 'CONFIRM_TRADE': case 'BANK_TRADE': return 'trade';
    case 'OFFER_TRADE': return 'offer';
    case 'BUY_CHARTER': return 'card';
    case 'END_TURN': return after.phase === 'ended' && before.phase !== 'ended' ? 'win' : 'turn';
    default: return after.phase === 'ended' ? 'win' : 'click';
  }
}
