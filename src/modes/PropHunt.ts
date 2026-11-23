import * as THREE from 'three';
import { Screen } from '../ui/Screen';
import type { Net } from '../net/Multiplayer';
import type { RemotePlayers } from '../world/RemotePlayers';
import type { Planet } from '../world/Planet';
import { heightAt } from '../world/Terrain';
import { PROPS, makeProp, propDef } from './Props';
import type { Mode, ModeCtx } from './Mode';

export type Role = 'wait' | 'hider' | 'catcher' | 'caught';
export interface PHPlayer { id: string; role: Role; prop: string }
export interface PHState { phase: 'waiting' | 'prep' | 'hunt' | 'end'; t: number; elapsed: number; players: PHPlayer[]; reveal: boolean; blind: boolean; winner: '' | 'catcher' | 'hiders'; round: number }

const FAST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('phfast');
/** Seconds: waiting for the round (with 2+ players), the hunt, how long the catcher is blindfolded, picking a prop, every reveal. */
export const PH = FAST ? { prep: 4, hunt: 40, blind: 4, pick: 3, revealEvery: 15, revealFor: 3, end: 3 } : { prep: 30, hunt: 180, blind: 20, pick: 15, revealEvery: 60, revealFor: 3, end: 10 };
export const ARENA_R = 100;

const W = 640, H = 470;
interface Btn { label: string; x: number; y: number; w: number; h: number; act: () => void }

/** "Choose your prop": shown to hiders for the first seconds of a round. */
export class PropPanel extends Screen {
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private dirty = true;
  chosen = '';
  secondsLeft = 0;
  constructor(private pick: (id: string) => void) {
    super(0.95, 0.95 * H / W, W, H);
    this.btns = PROPS.map((p, i) => ({ label: p.name, x: 24 + (i % 2) * 300, y: 96 + Math.floor(i / 2) * 80, w: 292, h: 68, act: () => { this.chosen = p.id; this.pick(p.id); this.dirty = true; } }));
  }
  private idx(uv: THREE.Vector2 | null): number { if (!uv) return -1; const px = uv.x * W, py = (1 - uv.y) * H; return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h); }
  hover(pointer: number, uv: THREE.Vector2 | null): boolean { const i = this.idx(uv); if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.dirty = true; } return i >= 0; }
  click(pointer: number): boolean { const i = this.hovered.get(pointer) ?? -1; if (i < 0 || !this.btns[i]) return false; this.btns[i].act(); return true; }
  touch(): void { this.dirty = true; }
  update(): void {
    if (!this.dirty) return; this.dirty = false;
    const { ctx } = this;
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 34px monospace'; ctx.fillText('CHOOSE YOUR PROP', 24, 56);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd23a'; ctx.font = 'bold 30px monospace'; ctx.fillText(`${Math.max(0, Math.ceil(this.secondsLeft))} s`, W - 24, 54);
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      const on = this.chosen === PROPS[i].id;
      ctx.fillStyle = hov.has(i) ? '#ffb347' : on ? '#2f7a4a' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 10);
    });
    ctx.fillStyle = '#9ab'; ctx.font = '18px monospace'; ctx.textAlign = 'center'; ctx.fillText('Others will see you as this, standing where you stand. Then hide!', W / 2, H - 16);
    this.refresh();
  }
}

/**
 * Prop Hunt. One player is the catcher; everyone else disguises as a prop and hides among the arena's props for three
 * minutes. Every minute all hiders are marked for three seconds. The host runs the clock; everybody sends what they do.
 */
export class PropHunt implements Mode {
  readonly id = 'propHunt' as const;
  st: PHState = { phase: 'waiting', t: 0, elapsed: 0, players: [], reveal: false, blind: false, winner: '', round: 0 };
  readonly panel: PropPanel;
  private markers = new THREE.Group();
  private acc = 0;
  private lastPhase = ''; private lastReveal = false; private lastRole: Role = 'wait'; private lastCaught = 0;
  private catchCd = 0;
  private arenaGroup = new THREE.Group();
  private disguiseCache = new Map<string, string>();
  private spawnedFor = -1;
  private prevHead = new THREE.Vector3();
  caughtCount = 0;

  constructor(private net: Net, private planet: Planet, private scene: THREE.Scene, private remotes: RemotePlayers,
    private teleportTo: (p: THREE.Vector3) => void, private say: (key: string) => void) {
    this.panel = new PropPanel(id => this.net.sendGameEvent({ k: 'pick', prop: id }));
    this.buildArena();
    planet.group.add(this.markers);
    net.phase = () => this.st.phase;
    net.onGame = d => this.apply(d as PHState);
    net.onGameEvent = (from, d) => this.hostEvent(from, d as { k: string; [k: string]: unknown });
    if (net.isHost) this.syncPlayers();
  }

  /** The playing field: a yard full of props to hide among (everyone builds the same one). */
  private buildArena(): void {
    let s = 4242; const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const world = this.planet.world;
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2, r = 16 + Math.sqrt(rng()) * (ARENA_R - 22), x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
      if (y < -2.5) continue;
      const def = PROPS[Math.floor(rng() * PROPS.length)], g = makeProp(def.id, Math.floor(rng() * 4));
      g.position.set(x, y, z); g.rotation.y = rng() * 6.28; this.arenaGroup.add(g);
      world.addCylinder(x, z, y - 0.2, y + def.h, def.r * 0.9, 0.3);
    }
    world.finalize(); this.planet.group.add(this.arenaGroup);
  }

  // ---------------- host: the clock and the rules ----------------
  private get me(): string { return this.net.me.id; }
  private syncPlayers(): void {
    if (!this.net.isHost) return;
    const ids = this.net.list.map(p => p.id), st = this.st;
    st.players = st.players.filter(p => ids.includes(p.id));
    for (const id of ids) if (!st.players.some(p => p.id === id)) st.players.push({ id, role: st.phase === 'waiting' || st.phase === 'prep' ? 'hider' : 'wait', prop: '' });
    if (st.phase === 'hunt') {
      if (!st.players.some(p => p.role === 'catcher')) return this.finish('hiders');
      if (!st.players.some(p => p.role === 'hider')) return this.finish('catcher');
    }
    this.broadcast();
  }
  onPlayersChanged(): void { this.syncPlayers(); }

  private broadcast(): void { this.net.sendGame(this.st); this.apply(this.st, true); }

  private startRound(): void {
    const st = this.st, ids = st.players.map(p => p.id), catcher = ids[Math.floor(Math.random() * ids.length)];
    st.players = st.players.map(p => ({ id: p.id, role: p.id === catcher ? 'catcher' : 'hider', prop: p.id === catcher ? '' : PROPS[Math.floor(Math.random() * PROPS.length)].id }));
    st.phase = 'hunt'; st.t = PH.hunt; st.elapsed = 0; st.reveal = false; st.blind = true; st.winner = ''; st.round++;
    this.broadcast();
  }
  private finish(w: 'catcher' | 'hiders'): void { const st = this.st; st.phase = 'end'; st.t = PH.end; st.winner = w; st.reveal = false; st.blind = false; this.broadcast(); }

  private hostTick(): void {
    const st = this.st, n = this.net.list.length;
    if (st.phase === 'waiting') { if (n >= 2) { st.phase = 'prep'; st.t = PH.prep; this.syncPlayers(); } }
    else if (st.phase === 'prep') { if (n < 2) { st.phase = 'waiting'; this.syncPlayers(); } else if (--st.t <= 0) { this.syncPlayers(); this.startRound(); return; } }
    else if (st.phase === 'hunt') {
      st.elapsed++; st.t--; st.blind = st.elapsed < PH.blind;
      st.reveal = st.elapsed >= PH.revealEvery && st.elapsed % PH.revealEvery < PH.revealFor;
      if (!st.players.some(p => p.role === 'hider')) return this.finish('catcher');
      if (st.t <= 0) return this.finish('hiders');
      if (st.elapsed === PH.pick) for (const p of st.players) if (p.role === 'hider' && !p.prop) p.prop = PROPS[Math.floor(Math.random() * PROPS.length)].id;
    } else if (st.phase === 'end') { if (--st.t <= 0) { st.phase = n >= 2 ? 'prep' : 'waiting'; st.t = PH.prep; st.winner = ''; st.players = st.players.map(p => ({ id: p.id, role: 'hider' as Role, prop: '' })); this.syncPlayers(); return; } }
    this.broadcast();
  }

  private hostEvent(from: string, d: { k: string; [k: string]: unknown }): void {
    const st = this.st;
    if (d.k === 'pick' && st.phase === 'hunt' && st.elapsed < PH.pick + 1) {
      const p = st.players.find(x => x.id === from); if (p && p.role === 'hider' && PROPS.some(pr => pr.id === d.prop)) { p.prop = String(d.prop); this.broadcast(); }
    } else if (d.k === 'catch' && st.phase === 'hunt' && !st.blind) {
      const c = st.players.find(x => x.id === from), t = st.players.find(x => x.id === d.id);
      if (!c || c.role !== 'catcher' || !t || t.role !== 'hider') return;
      const pc = this.net.poses.get(from), pt = this.net.poses.get(t.id);
      if (pc && pt && Math.hypot(pc[0] - pt[0], pc[2] - pt[2]) > 7) return;   // too far away to have been touched
      t.role = 'caught'; this.broadcast();
      if (!st.players.some(p => p.role === 'hider')) this.finish('catcher');
    }
  }

  // ---------------- everyone: show it, play it ----------------
  private apply(d: PHState, local = false): void {
    if (!local) this.st = d;
    const st = this.st;
    if (st.phase !== this.lastPhase) {
      if (st.phase === 'prep') this.say('phPrep'); if (st.phase === 'hunt') this.say(this.roleOf(this.me) === 'catcher' ? 'phCatcher' : 'phHider');
      if (st.phase === 'end') this.say(st.winner === 'catcher' ? 'phCatcherWins' : 'phHidersWin');
      this.lastPhase = st.phase;
    }
    if (st.reveal && !this.lastReveal) this.say('phReveal');
    this.lastReveal = st.reveal;
    const caught = st.players.filter(p => p.role === 'caught').length;
    if (caught > this.lastCaught && this.roleOf(this.me) === 'caught') this.say('phCaught');
    this.lastCaught = caught; this.caughtCount = caught;
    if (st.phase === 'hunt' && this.spawnedFor !== st.round) {   // a new round: everyone to their start place
      this.spawnedFor = st.round; this.panel.chosen = ''; this.panel.touch();
      const idx = Math.max(0, st.players.findIndex(p => p.id === this.me)), role = this.roleOf(this.me);
      const a = idx * 2.4, r = role === 'catcher' ? 0 : 14 + (idx % 5) * 5;
      this.teleportTo(new THREE.Vector3(Math.cos(a) * r, heightAt(Math.cos(a) * r, Math.sin(a) * r) + 0.1, Math.sin(a) * r));
    }
  }
  roleOf(id: string): Role { return this.st.players.find(p => p.id === id)?.role ?? 'wait'; }
  get myRole(): Role { return this.roleOf(this.me); }
  /** The catcher cannot see for the first seconds of the hunt. */
  get blind(): boolean { return this.st.phase === 'hunt' && this.st.blind && this.myRole === 'catcher'; }
  get choosing(): boolean { return this.st.phase === 'hunt' && this.myRole === 'hider' && this.st.elapsed < PH.pick; }

  hud(): [string, string] {
    const st = this.st, n = this.net.list.length, role = this.myRole, left = st.players.filter(p => p.role === 'hider').length;
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
    if (st.phase === 'waiting') return ['Prop Hunt', `Waiting for players (${n}/15). Need 2.`];
    if (st.phase === 'prep') return ['Get ready!', `Round starts in ${st.t} s (${n} players)`];
    if (st.phase === 'end') return [st.winner === 'catcher' ? 'The catcher wins!' : 'The hiders win!', `Next round in ${st.t} s`];
    if (role === 'catcher') return [st.blind ? 'Counting... you cannot see' : 'You are the CATCHER', `${mmss(st.t)} left. Hiders left: ${left}`];
    if (role === 'caught') return ['You were caught', `Watching. ${mmss(st.t)} left, ${left} hiding`];
    if (role === 'hider') return [`You are a ${propDef(st.players.find(p => p.id === this.me)?.prop || 'crate').name}`, `${mmss(st.t)} left. ${st.reveal ? 'YOU ARE SHOWING!' : `${left} hiding`}`];
    return ['Round in progress', `Next round soon (${mmss(st.t)})`];
  }

  update(dt: number, ctx: ModeCtx): void {
    this.catchCd = Math.max(0, this.catchCd - dt);
    if (this.net.isHost) { this.acc += dt; while (this.acc >= 1) { this.acc -= 1; this.hostTick(); } }
    this.planet.clock = 60;   // always daytime
    // choosing props
    this.panel.secondsLeft = PH.pick - this.st.elapsed; if (this.choosing && Math.floor(this.panel.secondsLeft) !== Math.floor(this.panel.secondsLeft + dt)) this.panel.touch(); this.panel.update();
    // others see hiders as props (and caught players not at all)
    for (const p of this.st.players) {
      if (p.id === this.me) continue;
      const hiding = this.st.phase === 'hunt' && p.role === 'hider' && p.prop, caught = p.role === 'caught' || p.role === 'wait' && this.st.phase === 'hunt';
      this.remotes.setDisguise(p.id, hiding ? 'prop:' + p.prop : caught ? 'hidden' : null, hiding ? () => ({ prop: makeProp(p.prop, 1), groundY: heightAt }) : undefined);
    }
    // the arena has edges
    if (Math.hypot(ctx.head.x, ctx.head.z) > ARENA_R + 6) { this.teleportTo(new THREE.Vector3(ctx.head.x * 0.85, heightAt(ctx.head.x * 0.85, ctx.head.z * 0.85) + 0.1, ctx.head.z * 0.85)); ctx.toast('The edge of the arena', ctx.head); }
    // the catcher punches props
    if (this.myRole === 'catcher' && this.st.phase === 'hunt' && !this.st.blind && this.catchCd <= 0) {
      ctx.hands.forEach((h, i) => {
        if (this.catchCd > 0 || ctx.handSpeed[i] < 2.2) return;
        for (const p of this.st.players) {
          if (p.role !== 'hider') continue;
          const hd = this.remotes.headOf(p.id); if (!hd) continue;
          const def = propDef(p.prop || 'crate'), gy = heightAt(hd.x, hd.z);
          if (Math.hypot(h.x - hd.x, h.z - hd.z) < def.r + 0.7 && h.y > gy - 0.2 && h.y < gy + def.h + 0.7) { this.net.sendGameEvent({ k: 'catch', id: p.id }); this.catchCd = 0.5; ctx.toast('CAUGHT', h); ctx.pickup(); return; }
        }
      });
    }
    // all hiders are marked for a moment, every minute
    this.updateMarkers(ctx);
    this.prevHead.copy(ctx.head);
  }

  private updateMarkers(ctx: ModeCtx): void {
    const show = this.st.reveal && this.st.phase === 'hunt';
    while (this.markers.children.length > (show ? this.st.players.length : 0)) this.markers.remove(this.markers.children[this.markers.children.length - 1]);
    if (!show) return;
    const hiders = this.st.players.filter(p => p.role === 'hider');
    while (this.markers.children.length < hiders.length) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 60, 10, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0xff3fd0, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })));
      g.add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1.2, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe040, side: THREE.DoubleSide, toneMapped: false })));
      this.markers.add(g);
    }
    hiders.forEach((p, i) => {
      const pos = p.id === this.me ? ctx.head : this.remotes.headOf(p.id), g = this.markers.children[i]; g.visible = !!pos;
      if (pos) g.position.set(pos.x, heightAt(pos.x, pos.z) + 0.05, pos.z);
    });
  }

  dispose(): void { this.net.phase = () => 'waiting'; this.net.onGame = () => {}; this.net.onGameEvent = () => {}; this.planet.group.remove(this.markers, this.arenaGroup); }
}
