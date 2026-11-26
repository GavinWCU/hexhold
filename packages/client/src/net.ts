// Peer-to-peer rooms over WebRTC (PeerJS). The host's browser is authoritative:
// friends send actions, the host validates them and sends each friend their own filtered view.
import Peer, { DataConnection, PeerOptions } from 'peerjs';
import type { Action, GameState } from '@hexhold/engine';
import type { Seat } from './controller';

export type ToHost =
  | { t: 'hello'; name: string; password?: string }
  | { t: 'action'; action: Action }
  | { t: 'ping' };

export type ToClient =
  | { t: 'welcome'; seat: number | null; code: string }
  | { t: 'denied'; reason: string }
  | { t: 'lobby'; seats: PublicSeat[]; targetVP: number }
  | { t: 'state'; view: GameState; seats: PublicSeat[]; seat: number }
  | { t: 'error'; message: string }
  | { t: 'sound'; sound: string }
  | { t: 'closed' };

export interface PublicSeat { name: string; color: string; kind: Seat['kind']; level: Seat['level']; online: boolean }

const PREFIX = 'hexhold-room-';

/** STUN finds a direct route; TURN relays traffic when two devices can't reach each other directly
 *  (e.g. an Android/Windows device and a Mac on the same Wi-Fi). TURN comes from build-time env vars
 *  (set as GitHub repo variables, see README). PeerJS's own fallback relay is dead, so it isn't used. */
function iceServers(): RTCIceServer[] {
  const env = import.meta.env;
  const list: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const urls = String(env.VITE_TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length) list.push({ urls, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  return list;
}

/** PeerJS options. Defaults to the free public PeerJS server; URL params override for self-hosting/tests. */
export function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerHost');
  const base = { debug: 1, config: { iceServers: iceServers() } };
  if (!host) return base;
  return {
    ...base,
    host,
    port: Number(q.get('peerPort') ?? 9000),
    path: q.get('peerPath') ?? '/',
    secure: q.get('peerSecure') === '1',
  };
}

export function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Host side: accepts connections and relays messages. */
export class RoomHost {
  peer: Peer;
  conns = new Map<string, { conn: DataConnection; seat: number | null; name: string; seen: number }>();
  onHello: (id: string, name: string, password?: string) => ToClient = () => ({ t: 'denied', reason: 'not ready' });
  onAction: (seat: number, action: Action) => void = () => {};
  onLeave: (seat: number | null) => void = () => {};
  ready: Promise<void>;

  constructor(public code: string) {
    this.peer = new Peer(PREFIX + code, peerOptions());
    this.ready = new Promise((res, rej) => {
      this.peer.on('open', () => res());
      this.peer.on('error', (e) => rej(e));
    });
    this.peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const msg = raw as ToHost;
        if (msg.t === 'hello') {
          const reply = this.onHello(conn.peer, msg.name, msg.password);
          if (reply.t === 'welcome') this.conns.set(conn.peer, { conn, seat: reply.seat, name: msg.name, seen: Date.now() });
          conn.send(reply);
          if (reply.t === 'denied') setTimeout(() => conn.close(), 500);
        } else if (msg.t === 'ping') {
          const c = this.conns.get(conn.peer);
          if (c) c.seen = Date.now();
        } else if (msg.t === 'action') {
          const c = this.conns.get(conn.peer);
          if (c && c.seat !== null) this.onAction(c.seat, msg.action);
        }
      });
      const gone = () => {
        const c = this.conns.get(conn.peer);
        if (!c || c.conn !== conn) return;
        this.conns.delete(conn.peer);
        this.onLeave(c.seat);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    // keep the signaling link alive
    this.peer.on('disconnected', () => { if (!this.peer.destroyed) this.peer.reconnect(); });
    // friends ping every 2 s; treat 7 s of silence as a dropped connection
    this.heartbeat = setInterval(() => {
      for (const [id, c] of this.conns) {
        if (Date.now() - c.seen > 7000) { this.conns.delete(id); c.conn.close(); this.onLeave(c.seat); }
      }
    }, 1000);
  }
  private heartbeat: ReturnType<typeof setInterval>;

  setSeat(peerId: string, seat: number) { const c = this.conns.get(peerId); if (c) c.seat = seat; }
  send(seat: number, msg: ToClient) { for (const c of this.conns.values()) if (c.seat === seat && c.conn.open) c.conn.send(msg); }
  broadcast(make: (seat: number | null) => ToClient) { for (const c of this.conns.values()) if (c.conn.open) c.conn.send(make(c.seat)); }
  close() { clearInterval(this.heartbeat); this.broadcast(() => ({ t: 'closed' })); setTimeout(() => this.peer.destroy(), 300); }
}

/** Client side: one connection to the host. Reconnects automatically. */
export class RoomClient {
  peer: Peer;
  conn: DataConnection | null = null;
  onMessage: (m: ToClient) => void = () => {};
  onStatus: (s: 'connecting' | 'open' | 'lost' | 'failed') => void = () => {};
  private closed = false;
  private tries = 0;
  private everOpened = false;
  private pinger = setInterval(() => { if (this.conn?.open) this.conn.send({ t: 'ping' } satisfies ToHost); }, 2000);

  constructor(public code: string, private name: string, private password?: string) {
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => this.connect());
    this.peer.on('error', (e) => {
      if ((e as { type?: string }).type === 'peer-unavailable') this.retry();
      else if (!this.conn?.open) this.onStatus('failed');
    });
  }

  private connect() {
    this.onStatus('connecting');
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = conn;
    // A direct link that can't be made (and no relay) never opens or errors, so give each attempt 12 s.
    const timer = setTimeout(() => {
      if (conn.open || this.conn !== conn || this.closed) return;
      this.conn = null;
      conn.close();
      this.retry();
    }, 12000);
    conn.on('open', () => {
      clearTimeout(timer);
      this.tries = 0;
      this.everOpened = true;
      this.onStatus('open');
      conn.send({ t: 'hello', name: this.name, password: this.password } satisfies ToHost);
    });
    conn.on('data', (d) => this.onMessage(d as ToClient));
    conn.on('close', () => { clearTimeout(timer); if (!this.closed && this.conn === conn) { this.onStatus('lost'); this.retry(); } });
  }

  private retry() {
    if (this.closed) return;
    // Never connected: give up after 4 tries (~1 min) with a clear message. Dropped mid-game: keep trying longer.
    if (++this.tries > (this.everOpened ? 30 : 4)) { this.onStatus('failed'); return; }
    setTimeout(() => { if (!this.closed) { if (this.peer.disconnected) this.peer.reconnect(); this.connect(); } }, Math.min(5000, 800 * this.tries));
  }

  send(action: Action) { if (this.conn?.open) this.conn.send({ t: 'action', action } satisfies ToHost); }
  close() { this.closed = true; clearInterval(this.pinger); this.peer.destroy(); }
}
