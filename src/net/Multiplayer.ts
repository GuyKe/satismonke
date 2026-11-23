import Peer, { DataConnection, PeerOptions } from 'peerjs';

/** Unambiguous characters for lobby codes (no 0/O/1/I). */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;
const PREFIX = 'satismonke-';
const SEND_HZ = 12;

/** How a player looks to others (fur colour is `color`). */
export interface PlayerLook { suit: number; hat: string; badge: string }
export interface PlayerInfo { id: string; name: string; color: number; look?: PlayerLook }
/** head x,y,z + quaternion x,y,z,w, then left hand x,y,z, right hand x,y,z */
export type Pose = number[];
/** A request to the host (place a machine, build a wall...) or its answer. */
export type Op = Record<string, unknown>;
export type WorldEvent = [string, number, number[]?];
/** What hosting a saved realm needs from its save. */
export interface RealmSeed { code: string; maxPlayers: number; members: Record<string, { name: string; color: number }>; progressOf: Record<string, { progress: unknown; pos: number[] | null }> }

type Msg =
  | { t: 'hello'; name: string; color: number; pid: string; look?: PlayerLook }
  | { t: 'reject'; msg: string }
  | { t: 'restore'; d: unknown; pos: number[] | null }
  | { t: 'saveReq' }
  | { t: 'prog'; d: unknown; pos: number[] }
  | { t: 'saved'; code: string; host: string }
  | { t: 'welcome'; id: string; clock: number; started: boolean; players: PlayerInfo[]; world: WorldEvent[] }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'start'; clock: number; world?: WorldEvent[] }
  | { t: 'clock'; clock: number }
  | { t: 'w'; k: string; i: number; d?: number[] }
  | { t: 'op'; rid: number; op: Op }
  | { t: 'res'; rid: number; r: Op }
  | { t: 'fs'; d: unknown }
  | { t: 'bs'; d: unknown }
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

/** Who you are across sessions (so a realm can recognise you when you come back). */
export function playerId(): string {
  try { const v = localStorage.getItem('satismonke.pid'); if (v) return v; } catch { /* private mode */ }
  const id = Array.from({ length: 14 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  try { localStorage.setItem('satismonke.pid', id); } catch { /* ignore */ }
  return id;
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
  onWorld: (kind: string, i: number, d?: number[]) => void = () => {};
  /** Host only: handle a client's request and return the answer. */
  onOp: (from: string, op: Op) => Op = () => ({ ok: false });
  /** Clients: the host's latest factory / building snapshots. */
  onFactory: (d: unknown) => void = () => {};
  onBuild: (d: unknown) => void = () => {};
  /** Host settings for this lobby. */
  allowSaving = false;
  maxPlayers = 8;
  /** Realm members (by player id): once a lobby has been saved, only they can join it. null = open lobby. */
  members: Map<string, { name: string; color: number }> | null = null;
  /** Host: saved progress of members, handed back when they rejoin. */
  memberData = new Map<string, { progress: unknown; pos: number[] | null }>();
  /** Client: progress/position the host restored for us (applied when the world starts). */
  restoreData: { progress: unknown; pos: number[] | null } | null = null;
  /** Client: the host saved the realm. */
  onSaved: (code: string, host: string) => void = () => {};
  /** Client: the host asks for our progress to save it. */
  onSaveReq: () => { d: unknown; pos: number[] } = () => ({ d: null, pos: [0, 0, 0] });
  private peerPid = new Map<string, string>();     // host: peer id -> player id
  private pendingProg: ((peer: string, d: unknown, pos: number[]) => void) | null = null;
  lastFactory: unknown = null;
  lastBuild: unknown = null;
  /** Host: current snapshots for someone who just joined. */
  snapshots: () => { f: unknown; b: unknown } = () => ({ f: null, b: null });
  private rid = 1;
  private pendingOps = new Map<number, (r: Op) => void>();
  /** Every resource used up so far in this lobby (for late joiners and the start of the game). */
  worldLog: WorldEvent[] = [];
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

  /** The WebRTC peer (voice chat makes its calls through it). */
  get peerObj(): Peer | null { return this.peer; }

  get list(): PlayerInfo[] { return [this.me, ...[...this.players.values()].filter(p => p.id !== this.me.id)]; }

  /** Create a lobby and wait for friends. */
  host(attempt = 0, realm?: RealmSeed): void {
    this.leave(true);
    this.state = 'connecting'; this.isHost = true; this.error = ''; this.code = attempt > 0 || !realm ? randomCode() : realm.code; this.onChange();
    if (realm) { this.members = new Map(Object.entries(realm.members)); this.allowSaving = true; this.maxPlayers = realm.maxPlayers; for (const [pid, v] of Object.entries(realm.progressOf)) this.memberData.set(pid, v); }
    const peer = new Peer(PREFIX + this.code, this.peerOptions());
    this.peer = peer;
    peer.on('open', id => {
      this.myId = id; this.me.id = id; this.players.clear(); this.players.set(id, this.me);
      this.state = 'lobby'; this.onChange();
    });
    peer.on('connection', c => this.hostAccept(c));
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (e.type === 'unavailable-id' && realm) { this.fail('That realm is still online or its code is busy. Try again in a minute.'); return; }
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
      c.on('open', () => c.send({ t: 'hello', name: this.me.name, color: this.me.color, pid: playerId(), look: this.me.look } as Msg));
      c.on('data', d => this.clientMsg(d as Msg));
      c.on('close', () => { if (this.state !== 'off' && this.state !== 'error') this.fail('The host closed the lobby'); });
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      clearTimeout(timeout);
      this.fail(e.type === 'peer-unavailable' ? 'No lobby found with that code' : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Cannot reach the lobby server' : (e.message ?? 'Network error'));
    });
  }

  leave(quiet = false): void {
    this.peer?.destroy(); this.peer = null; this.conns.clear(); this.players.clear();
    this.members = null; this.allowSaving = false; this.maxPlayers = 8; this.memberData.clear(); this.restoreData = null; this.peerPid.clear();
    this.state = 'off'; this.isHost = false; this.code = ''; this.worldLog = []; this.worldSeen.clear(); this.pendingOps.clear(); this.lastFactory = this.lastBuild = null;
    if (!quiet) this.onChange();
  }

  /** Host: everyone in the lobby starts the game. */
  start(): void {
    if (!this.isHost || this.state !== 'lobby') return;
    this.state = 'game';
    this.broadcast({ t: 'start', clock: this.getClock(), world: this.worldLog });
    this.onStart(this.getClock()); this.onChange();
  }

  private hostAccept(c: DataConnection): void {
    c.on('data', d => {
      const m = d as Msg;
      if (m.t === 'hello') {
        const pid = String(m.pid ?? '');
        if (this.members && !this.members.has(pid)) { c.send({ t: 'reject', msg: 'You are not a member of this realm' } as Msg); setTimeout(() => c.close(), 300); return; }
        if (this.players.size >= this.maxPlayers) { c.send({ t: 'reject', msg: 'This lobby is full' } as Msg); setTimeout(() => c.close(), 300); return; }
        const lk = m.look, p: PlayerInfo = { id: c.peer, name: String(m.name).slice(0, 20), color: m.color | 0, look: lk ? { suit: lk.suit | 0, hat: String(lk.hat).slice(0, 12), badge: String(lk.badge).slice(0, 12) } : undefined };
        this.players.set(p.id, p); this.conns.set(p.id, c); this.peerPid.set(p.id, pid);
        const mem = this.memberData.get(pid); if (mem) c.send({ t: 'restore', d: mem.progress, pos: mem.pos } as Msg);
        c.send({ t: 'welcome', id: p.id, clock: this.getClock(), started: this.state === 'game', players: this.list, world: this.worldLog } as Msg);
        this.broadcast({ t: 'join', p } as Msg, p.id);
        if (this.state === 'game') { const s = this.snapshots(); c.send({ t: 'fs', d: s.f } as Msg); c.send({ t: 'bs', d: s.b } as Msg); }
        this.onChange();
      } else if (m.t === 'prog') {
        this.pendingProg?.(c.peer, m.d, m.pos);
      } else if (m.t === 'op') {
        let r: Op; try { r = this.onOp(c.peer, m.op); } catch (e) { r = { ok: false, msg: String(e) }; }
        c.send({ t: 'res', rid: m.rid, r } as Msg);
      } else if (m.t === 'w') {
        if (this.logWorld(m.k, m.i, m.d)) { this.onWorld(m.k, m.i, m.d); this.broadcast(m, c.peer); }
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
        for (const [k, i, d] of m.world ?? []) this.logWorld(k, i, d);
        this.state = m.started ? 'game' : 'lobby'; this.onChange();
        if (m.started) this.onStart(m.clock);
        break;
      case 'join': this.players.set(m.p.id, m.p); this.onChange(); break;
      case 'leave': this.players.delete(m.id); this.onLeave(m.id); this.onChange(); break;
      case 'start': for (const [k, i, d] of m.world ?? []) this.logWorld(k, i, d); this.state = 'game'; this.onStart(m.clock); this.onChange(); break;
      case 'clock': this.onClock(m.clock); break;
      case 'reject': this.fail(m.msg); break;
      case 'restore': this.restoreData = { progress: m.d, pos: m.pos }; break;
      case 'saved': this.onSaved(m.code, this.players.get(this.conns.get('host')?.peer ?? '')?.name ?? 'the host'); break;
      case 'saveReq': { const r = this.onSaveReq(); this.conns.get('host')?.send({ t: 'prog', d: r.d, pos: r.pos } as Msg); break; }
      case 'w': if (this.logWorld(m.k, m.i, m.d)) this.onWorld(m.k, m.i, m.d); break;
      case 'res': { const cb = this.pendingOps.get(m.rid); this.pendingOps.delete(m.rid); cb?.(m.r); break; }
      case 'fs': this.lastFactory = m.d; if (m.d) this.onFactory(m.d); break;
      case 'bs': this.lastBuild = m.d; if (m.d) this.onBuild(m.d); break;
      case 's': this.onPose(m.id, m.p); break;
    }
  }

  private logWorld(k: string, i: number, d?: number[]): boolean {
    const key = k + ':' + i + (d ? ':' + d.join(',') : ''); if (this.worldSeen.has(key)) return false;
    this.worldSeen.add(key); this.worldLog.push(d ? [k, i, d] : [k, i]); return true;
  }

  /** Clients: ask the host to do something and get its answer. (The host just does things itself.) */
  sendOp(op: Op, done: (r: Op) => void): void {
    const c = this.conns.get('host');
    if (this.isHost || !c?.open) { done({ ok: false, msg: 'Not connected to the host' }); return; }
    const rid = this.rid++; this.pendingOps.set(rid, done); c.send({ t: 'op', rid, op } as Msg);
  }

  /** Host: ask every player for their progress, wait a moment, and hand back who answered (by player id). */
  collectProgress(timeoutMs = 2500): Promise<Map<string, { progress: unknown; pos: number[] }>> {
    return new Promise(resolve => {
      const got = new Map<string, { progress: unknown; pos: number[] }>(), want = new Set(this.conns.keys());
      if (!want.size) { resolve(got); return; }
      const done = () => { clearTimeout(t); this.pendingProg = null; resolve(got); };
      const t = setTimeout(done, timeoutMs);
      this.pendingProg = (peer, d, pos) => { const pid = this.peerPid.get(peer); if (pid) got.set(pid, { progress: d, pos }); want.delete(peer); if (!want.size) done(); };
      this.broadcast({ t: 'saveReq' });
    });
  }

  /** Host: replace the record of what has been used up (a loaded realm starts with its saved world). */
  seedWorld(events: WorldEvent[]): void { this.worldLog = []; this.worldSeen.clear(); for (const [k, i, d] of events) this.logWorld(k, i, d); }

  /** Host: who is connected right now, by player id. */
  get connectedPids(): { pid: string; name: string; color: number }[] {
    return [...this.peerPid.entries()].filter(([id]) => this.players.has(id)).map(([id, pid]) => ({ pid, name: this.players.get(id)!.name, color: this.players.get(id)!.color }));
  }

  /** Host: tell everyone the realm was saved. */
  announceSaved(): void { this.broadcast({ t: 'saved', code: this.code, host: this.me.name }); }

  broadcastFactory(d: unknown): void { if (this.isHost && this.state === 'game') this.broadcast({ t: 'fs', d }); }
  broadcastBuild(d: unknown): void { if (this.isHost && this.state === 'game') this.broadcast({ t: 'bs', d }); }

  /** You did something to the world (used up a resource, built the Hub...): remember it and tell everyone. */
  sendWorld(k: string, i: number, d?: number[]): void {
    if (this.state !== 'game' || !this.logWorld(k, i, d)) return;
    const m: Msg = { t: 'w', k, i, d };
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
