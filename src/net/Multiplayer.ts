import Peer, { DataConnection, PeerOptions } from 'peerjs';

/** Unambiguous characters for lobby codes (no 0/O/1/I). */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;
const PREFIX = 'satismonke-';
const SEND_HZ = 12;

export interface PlayerInfo { id: string; name: string; color: number }
/** head x,y,z + quaternion x,y,z,w, then left hand x,y,z, right hand x,y,z */
export type Pose = number[];

type Msg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'welcome'; id: string; clock: number; started: boolean; players: PlayerInfo[]; world: [string, number][] }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'start'; clock: number }
  | { t: 'clock'; clock: number }
  | { t: 'w'; k: string; i: number }
  | { t: 's'; id: string; p: Pose };

export type NetState = 'off' | 'connecting' | 'lobby' | 'game' | 'error';

const ADJ = ['Brave', 'Sneaky', 'Fuzzy', 'Cosmic', 'Grumpy', 'Lucky', 'Wobbly', 'Mighty', 'Sleepy', 'Zesty'];
const ANI = ['Monke', 'Ape', 'Lemur', 'Gibbon', 'Mandrill', 'Macaque', 'Baboon', 'Tamarin'];
const randName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${ANI[Math.floor(Math.random() * ANI.length)]}`;
const pickColor = () => { const h = Math.random() * 360; const c = (n: number) => Math.round(255 * (0.55 + 0.35 * Math.cos(((h + n) * Math.PI) / 180))); return (c(0) << 16) | (c(120) << 8) | c(240); };

/** Your fur colour is picked once and remembered. */
export function savedColor(): number {
  try { const v = localStorage.getItem('satismonke.fur'); if (v) return parseInt(v, 10); } catch { /* private mode */ }
  const c = pickColor();
  try { localStorage.setItem('satismonke.fur', String(c)); } catch { /* ignore */ }
  return c;
}

export function randomCode(): string {
  let s = ''; for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/**
 * Peer-to-peer lobbies over WebRTC (PeerJS). The host's peer id is derived from the lobby code, so there is no game
 * server: friends type the code and connect to the host, who relays everyone's poses to everyone else.
 */
export class Net {
  state: NetState = 'off';
  error = '';
  code = '';
  isHost = false;
  myId = '';
  me: PlayerInfo = { id: '', name: randName(), color: savedColor() };
  players = new Map<string, PlayerInfo>();
  onChange: () => void = () => {};
  onStart: (clock: number) => void = () => {};
  onClock: (clock: number) => void = () => {};
  onPose: (id: string, p: Pose) => void = () => {};
  onLeave: (id: string) => void = () => {};
  /** A friend used up a resource (kind, index). */
  onWorld: (kind: string, i: number) => void = () => {};
  /** Every resource used up so far in this lobby (for late joiners and the start of the game). */
  worldLog: [string, number][] = [];
  private worldSeen = new Set<string>();
  /** Provided by the game: the clock the host shares with everyone. */
  getClock: () => number = () => 0;

  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();   // host: id -> client; client: 'host' -> host
  private sendT = 0;
  private clockT = 0;

  private peerOptions(): PeerOptions {
    const q = new URLSearchParams(location.search);
    const host = q.get('peerhost');
    return host ? { host, port: Number(q.get('peerport') ?? 9000), path: q.get('peerpath') ?? '/', secure: false } : {};
  }

  private fail(msg: string): void { this.error = msg; this.state = 'error'; this.onChange(); }

  get list(): PlayerInfo[] { return [this.me, ...[...this.players.values()].filter(p => p.id !== this.me.id)]; }

  /** Create a lobby and wait for friends. */
  host(attempt = 0): void {
    this.leave(true);
    this.state = 'connecting'; this.isHost = true; this.error = ''; this.code = randomCode(); this.onChange();
    const peer = new Peer(PREFIX + this.code, this.peerOptions());
    this.peer = peer;
    peer.on('open', id => {
      this.myId = id; this.me.id = id; this.players.clear(); this.players.set(id, this.me);
      this.state = 'lobby'; this.onChange();
    });
    peer.on('connection', c => this.hostAccept(c));
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (e.type === 'unavailable-id' && attempt < 5) { peer.destroy(); this.host(attempt + 1); return; }
      this.fail(e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Cannot reach the lobby server' : (e.message ?? 'Network error'));
    });
  }

  /** Join a friend's lobby by its code. */
  join(code: string): void {
    this.leave(true);
    code = code.toUpperCase();
    this.state = 'connecting'; this.isHost = false; this.error = ''; this.code = code; this.onChange();
    const peer = new Peer(this.peerOptions());
    this.peer = peer;
    const timeout = setTimeout(() => { if (this.state === 'connecting') this.fail('No lobby found with that code'); }, 12000);
    peer.on('open', id => {
      this.myId = id; this.me.id = id;
      const c = peer.connect(PREFIX + code, { reliable: true });
      this.conns.set('host', c);
      c.on('open', () => c.send({ t: 'hello', name: this.me.name, color: this.me.color } as Msg));
      c.on('data', d => this.clientMsg(d as Msg));
      c.on('close', () => { if (this.state !== 'off') this.fail('The host closed the lobby'); });
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      clearTimeout(timeout);
      this.fail(e.type === 'peer-unavailable' ? 'No lobby found with that code' : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Cannot reach the lobby server' : (e.message ?? 'Network error'));
    });
  }

  leave(quiet = false): void {
    this.peer?.destroy(); this.peer = null; this.conns.clear(); this.players.clear();
    this.state = 'off'; this.isHost = false; this.code = ''; this.worldLog = []; this.worldSeen.clear();
    if (!quiet) this.onChange();
  }

  /** Host: everyone in the lobby starts the game. */
  start(): void {
    if (!this.isHost || this.state !== 'lobby') return;
    this.state = 'game';
    this.broadcast({ t: 'start', clock: this.getClock() });
    this.onStart(this.getClock()); this.onChange();
  }

  private hostAccept(c: DataConnection): void {
    c.on('data', d => {
      const m = d as Msg;
      if (m.t === 'hello') {
        if (this.players.size >= 8) { c.close(); return; }
        const p: PlayerInfo = { id: c.peer, name: String(m.name).slice(0, 20), color: m.color | 0 };
        this.players.set(p.id, p); this.conns.set(p.id, c);
        c.send({ t: 'welcome', id: p.id, clock: this.getClock(), started: this.state === 'game', players: this.list, world: this.worldLog } as Msg);
        this.broadcast({ t: 'join', p } as Msg, p.id);
        this.onChange();
      } else if (m.t === 'w') {
        if (this.logWorld(m.k, m.i)) { this.onWorld(m.k, m.i); this.broadcast(m, c.peer); }
      } else if (m.t === 's') {
        this.onPose(c.peer, m.p);
        this.broadcast({ t: 's', id: c.peer, p: m.p }, c.peer);
      }
    });
    c.on('close', () => {
      if (!this.players.delete(c.peer)) return;
      this.conns.delete(c.peer); this.onLeave(c.peer);
      this.broadcast({ t: 'leave', id: c.peer });
      this.onChange();
    });
  }

  private clientMsg(m: Msg): void {
    switch (m.t) {
      case 'welcome':
        this.players.clear(); for (const p of m.players) this.players.set(p.id, p); this.players.set(this.me.id, this.me);
        for (const [k, i] of m.world ?? []) this.logWorld(k, i);
        this.state = m.started ? 'game' : 'lobby'; this.onChange();
        if (m.started) this.onStart(m.clock);
        break;
      case 'join': this.players.set(m.p.id, m.p); this.onChange(); break;
      case 'leave': this.players.delete(m.id); this.onLeave(m.id); this.onChange(); break;
      case 'start': this.state = 'game'; this.onStart(m.clock); this.onChange(); break;
      case 'clock': this.onClock(m.clock); break;
      case 'w': if (this.logWorld(m.k, m.i)) this.onWorld(m.k, m.i); break;
      case 's': this.onPose(m.id, m.p); break;
    }
  }

  private logWorld(k: string, i: number): boolean {
    const key = k + ':' + i; if (this.worldSeen.has(key)) return false;
    this.worldSeen.add(key); this.worldLog.push([k, i]); return true;
  }

  /** You used up a resource: remember it and tell everyone. */
  sendWorld(k: string, i: number): void {
    if (this.state !== 'game' || !this.logWorld(k, i)) return;
    const m: Msg = { t: 'w', k, i };
    if (this.isHost) this.broadcast(m); else if (this.conns.get('host')?.open) this.conns.get('host')!.send(m);
  }

  private broadcast(m: Msg, except?: string): void {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m);
  }

  /** Call every frame while in game: sends your pose ~12 times a second (and the day clock, from the host). */
  tick(dt: number, pose: () => Pose): void {
    if (this.state !== 'game') return;
    if ((this.sendT += dt) >= 1 / SEND_HZ) {
      this.sendT = 0;
      const m: Msg = { t: 's', id: this.me.id, p: pose() };
      if (this.isHost) this.broadcast(m); else this.conns.get('host')?.open && this.conns.get('host')!.send(m);
    }
    if (this.isHost && (this.clockT += dt) >= 5) { this.clockT = 0; this.broadcast({ t: 'clock', clock: this.getClock() }); }
  }
}
