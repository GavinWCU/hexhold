// A Session is what the game screen talks to, whether the game runs locally,
// is hosted in this browser for friends, or lives in a friend's browser.
import { Action, GameState, viewFor } from '@hexhold/engine';
import { GameHost, Seat, TAKEOVER_AFTER } from './controller';
import { PublicSeat, RoomClient, RoomHost, ToClient } from './net';

export type View = GameState & { deckCount: number; handCounts: number[]; charterCounts: number[] };

export interface Session {
  kind: 'local' | 'host' | 'client';
  me: number;
  code?: string;
  view(): View | null;
  seats(): PublicSeat[];
  act(a: Action): void;
  onChange(cb: () => void): void;
  onError(cb: (m: string) => void): void;
  onSound(cb: (s: string) => void): void;
  host?: GameHost;
  status?: string;
  leave(): void;
}

const pub = (s: Seat): PublicSeat => ({ name: s.name, color: s.color, kind: s.kind, level: s.level, online: s.kind !== 'remote' || s.online });

export class LocalSession implements Session {
  kind: 'local' | 'host' = 'local';
  me = 0;
  protected changeCbs: (() => void)[] = [];
  protected errCbs: ((m: string) => void)[] = [];
  protected soundCbs: ((s: string) => void)[] = [];
  constructor(public host: GameHost) {
    host.on((e) => {
      if (e.type === 'state') this.changeCbs.forEach((f) => f());
      if (e.type === 'error' && e.seat === this.me) this.errCbs.forEach((f) => f(e.message!));
      if (e.type === 'sound') this.soundCbs.forEach((f) => f(e.sound!));
    });
    host.schedule();
  }
  view() { return viewFor(this.host.state, this.me) as View; }
  seats() { return this.host.seats.map(pub); }
  act(a: Action) { this.host.dispatch(this.me, a); }
  onChange(cb: () => void) { this.changeCbs.push(cb); }
  onError(cb: (m: string) => void) { this.errCbs.push(cb); }
  onSound(cb: (s: string) => void) { this.soundCbs.push(cb); }
  leave() { this.host.stop(); }
}

/** Hosting in this browser: a LocalSession plus a room that friends connect to. */
export class HostSession extends LocalSession {
  kind = 'host' as const;
  private tick: ReturnType<typeof setInterval>;
  constructor(host: GameHost, public room: RoomHost, public code: string) {
    super(host);
    room.onAction = (seat, action) => host.dispatch(seat, action);
    room.onLeave = (seat) => { if (seat !== null && host.seats[seat]?.kind === 'remote') host.setOnline(seat, false); };
    room.onHello = (peerId, name) => {
      const idx = host.seats.findIndex((s) => s.kind === 'remote' && s.name.toLowerCase() === name.toLowerCase());
      if (idx < 0) return { t: 'denied', reason: 'This game has already started. Ask the host to add you next game.' };
      setTimeout(() => { host.setOnline(idx, true); this.push(); }, 50);
      return { t: 'welcome', seat: idx, code };
    };
    host.on((e) => {
      if (e.type === 'state') this.push();
      if (e.type === 'error' && e.seat !== undefined && e.seat !== this.me) room.send(e.seat, { t: 'error', message: e.message! });
      if (e.type === 'sound') room.broadcast(() => ({ t: 'sound', sound: e.sound! }));
    });
    // lets bots take over seats of friends who stay disconnected
    this.tick = setInterval(() => {
      if (host.seats.some((s) => s.kind === 'remote' && !s.online && s.offlineSince && Date.now() - s.offlineSince > TAKEOVER_AFTER)) host.schedule();
    }, 5000);
    this.push();
  }
  push() {
    const seats = this.seats();
    this.room.broadcast((seat) => seat === null ? { t: 'lobby', seats, targetVP: this.host.state.targetVP } : { t: 'state', view: viewFor(this.host.state, seat), seats, seat });
  }
  leave() { clearInterval(this.tick); this.room.close(); super.leave(); }
}

/** Playing in a friend's room. */
export class ClientSession implements Session {
  kind = 'client' as const;
  me = -1;
  status = 'Connecting…';
  private v: View | null = null;
  private s: PublicSeat[] = [];
  private changeCbs: (() => void)[] = [];
  private errCbs: ((m: string) => void)[] = [];
  private soundCbs: ((s: string) => void)[] = [];
  lobbyCbs: ((seats: PublicSeat[]) => void)[] = [];
  deniedCbs: ((r: string) => void)[] = [];
  constructor(public room: RoomClient, public code: string) {
    room.onStatus = (st) => {
      this.status = { connecting: 'Connecting…', open: 'Connected', lost: 'Connection lost, reconnecting…', failed: "Couldn't connect to the room. Check the code, make sure the host's screen is still open, then try again. If it keeps failing on this device, the game needs a relay server (see the README)." }[st];
      this.changeCbs.forEach((f) => f());
    };
    room.onMessage = (m: ToClient) => {
      if (m.t === 'welcome') { if (m.seat !== null) this.me = m.seat; }
      else if (m.t === 'denied') this.deniedCbs.forEach((f) => f(m.reason));
      else if (m.t === 'lobby') { this.s = m.seats; this.lobbyCbs.forEach((f) => f(m.seats)); }
      else if (m.t === 'state') { this.v = m.view as View; this.s = m.seats; this.me = m.seat; this.changeCbs.forEach((f) => f()); }
      else if (m.t === 'error') this.errCbs.forEach((f) => f(m.message));
      else if (m.t === 'sound') this.soundCbs.forEach((f) => f(m.sound));
      else if (m.t === 'closed') { this.status = 'The host closed the room'; this.changeCbs.forEach((f) => f()); }
    };
  }
  view() { return this.v; }
  seats() { return this.s; }
  act(a: Action) { this.room.send(a); }
  onChange(cb: () => void) { this.changeCbs.push(cb); }
  onError(cb: (m: string) => void) { this.errCbs.push(cb); }
  onSound(cb: (s: string) => void) { this.soundCbs.push(cb); }
  leave() { this.room.close(); }
}
