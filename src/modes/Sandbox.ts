import * as THREE from 'three';
import type * as THREEt from 'three';
import { Screen } from '../ui/Screen';
import { Rig, DebrisSystem, PartId } from './Rig';
import { GROUND, makePuffhog, Animal } from '../world/Animals';
import { heightAt } from '../world/Terrain';
import type { Planet } from '../world/Planet';
import type { Mode, ModeCtx } from './Mode';

type BodyKind = 'human' | 'brute' | 'lurker';
const BODIES: BodyKind[] = ['human', 'brute', 'lurker'];
const MONSTERS: ('brute' | 'lurker')[] = ['brute', 'lurker'];
const ANIMAL_NAMES = ['LONGNECK', 'STILTER', 'WORM', 'HOPPER', 'CRAWLER', 'BULBHOG', 'SHELLWALKER', 'SPINNER', 'ANTLERBACK', 'PUFFHOG'];

interface Npc { rig: Rig | null; animal: Animal | null; kind: 'dummy' | 'brute' | 'lurker' | 'animal'; dead: boolean; deadT: number; hitCd: number; atkCd: number; wander: THREE.Vector3; flail: number; counted: boolean }

const W = 640, H = 470;
interface Btn { label: string; x: number; y: number; w: number; h: number; act: () => void; danger?: boolean; on?: boolean }

/** The spawn menu: dummies, animals, monsters, and which monster you want to be. Opens with X in the sandbox. */
export class SandboxPanel extends Screen {
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private dirty = true;
  animal = 0; monster = 0;
  constructor(private sb: Sandbox) { super(0.95, 0.95 * H / W, W, H); this.build(); }
  build(): void {
    this.dirty = true;
    const row = (i: number) => 92 + i * 66;
    this.btns = [
      { label: 'DUMMIES x5', x: 24, y: row(0), w: 592, h: 56, act: () => this.sb.spawn('dummy', 5) },
      { label: '<', x: 24, y: row(1), w: 60, h: 56, act: () => { this.animal = (this.animal + ANIMAL_NAMES.length - 1) % ANIMAL_NAMES.length; this.build(); } },
      { label: `SPAWN ${ANIMAL_NAMES[this.animal]}`, x: 92, y: row(1), w: 456, h: 56, act: () => this.sb.spawn('animal', 1, this.animal) },
      { label: '>', x: 556, y: row(1), w: 60, h: 56, act: () => { this.animal = (this.animal + 1) % ANIMAL_NAMES.length; this.build(); } },
      { label: '<', x: 24, y: row(2), w: 60, h: 56, act: () => { this.monster = (this.monster + MONSTERS.length - 1) % MONSTERS.length; this.build(); } },
      { label: `SPAWN ${MONSTERS[this.monster].toUpperCase()}`, x: 92, y: row(2), w: 456, h: 56, danger: true, act: () => this.sb.spawn(MONSTERS[this.monster], 1) },
      { label: '>', x: 556, y: row(2), w: 60, h: 56, act: () => { this.monster = (this.monster + 1) % MONSTERS.length; this.build(); } },
      { label: `BE: ${this.sb.body.toUpperCase()}`, x: 24, y: row(3), w: 388, h: 56, on: this.sb.body !== 'human', act: () => { this.sb.cycleBody(); this.build(); } },
      { label: 'CLEAR', x: 424, y: row(3), w: 192, h: 56, danger: true, act: () => this.sb.clear() },
      { label: 'CLOSE', x: 224, y: row(4), w: 192, h: 50, act: () => this.sb.closePanel() },
    ];
  }
  private idx(uv: THREE.Vector2 | null): number { if (!uv) return -1; const px = uv.x * W, py = (1 - uv.y) * H; return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h); }
  hover(pointer: number, uv: THREE.Vector2 | null): boolean { const i = this.idx(uv); if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.dirty = true; } return i >= 0; }
  click(pointer: number): boolean { const i = this.hovered.get(pointer) ?? -1; if (i < 0 || !this.btns[i]) return false; this.btns[i].act(); this.dirty = true; return true; }
  touch(): void { this.dirty = true; }
  update(): void {
    if (!this.dirty) return; this.dirty = false;
    const { ctx } = this;
    ctx.fillStyle = '#12080c'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ff7a6a'; ctx.font = 'bold 36px monospace'; ctx.fillText('SANDBOX', 24, 52);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd9a0'; ctx.font = 'bold 24px monospace'; ctx.fillText(`KILLS ${this.sb.kills}`, W - 24, 50);
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      ctx.fillStyle = hov.has(i) ? '#ffb347' : b.on ? '#2f7a4a' : b.danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; let fs = 26; ctx.font = `bold ${fs}px monospace`;
      while (fs > 12 && ctx.measureText(b.label).width > b.w - 14) { fs--; ctx.font = `bold ${fs}px monospace`; }
      ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + fs * 0.35);
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#9ab'; ctx.font = '16px monospace'; ctx.fillText('Swing your fists: heads, arms and legs come off. Hard hit on the chest, or pull it apart with both hands.', W / 2, H - 14);
    this.refresh();
  }
}

/** A sandbox: spawn dummies, animals and monsters, or become a monster, and tear into them (cartoon pieces, no gore). */
export class Sandbox implements Mode {
  readonly id = 'sandbox' as const;
  readonly debris: DebrisSystem;
  readonly panel: SandboxPanel;
  private npcs: Npc[] = [];
  kills = 0;
  body: BodyKind = 'human';
  bodyRig: Rig | null = null;
  panelOpen = false;
  private hitCd = [0, 0];
  private t = 0;
  private lastHands: (THREEt.Vector3 | null)[] = [null, null];

  constructor(private planet: Planet, private scene: THREE.Scene, private forward: () => { pos: THREE.Vector3; dir: THREE.Vector3 }, private onKill: () => void, private openPanel: (open: boolean) => void) {
    this.debris = new DebrisSystem(planet.group, heightAt);
    this.panel = new SandboxPanel(this);
  }

  hud(): [string, string] { return ['Sandbox', `Kills ${this.kills}   You: ${this.body}   X: spawn menu`]; }
  get power(): number { return this.body === 'human' ? 1 : 1.8; }
  get alive(): number { return this.npcs.filter(n => !n.dead).length; }
  get npcCount(): number { return this.npcs.length; }

  cycleBody(): void {
    this.body = BODIES[(BODIES.indexOf(this.body) + 1) % BODIES.length];
    if (this.bodyRig) { this.scene.remove(this.bodyRig.group); this.bodyRig = null; }
    if (this.body !== 'human') { this.bodyRig = new Rig(this.body, this.body === 'brute' ? { body: 0x4a8a3a, limb: 0x5a9a48, skin: 0x7ac85a } : undefined); this.scene.add(this.bodyRig.group); }
  }
  closePanel(): void { this.panelOpen = false; this.openPanel(false); }

  spawn(kind: 'dummy' | 'brute' | 'lurker' | 'animal', n: number, which = 0): void {
    const f = this.forward();
    for (let i = 0; i < n; i++) {
      const a = (n === 1 ? 0 : (i / n - 0.5) * 1.6), dist = 5 + (n > 1 ? 1.5 + (i % 3) : 0);
      const dir = f.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const x = f.pos.x + dir.x * dist, z = f.pos.z + dir.z * dist;
      if (kind === 'animal') {
        const an = which === ANIMAL_NAMES.length - 1 ? makePuffhog(Math.random) : GROUND[which % GROUND.length](Math.random);
        this.planet.addAnimal(an, x, z); this.npcs.push({ rig: null, animal: an, kind: 'animal', dead: false, deadT: 0, hitCd: 0, atkCd: 0, wander: new THREE.Vector3(), flail: 0, counted: false });
      } else {
        const rig = new Rig(kind, kind === 'dummy' ? { accent: [0x3f78c8, 0xc0553a, 0x4fa86a, 0xe2b84a, 0x9a5fd0][i % 5] } : undefined);
        rig.group.position.set(x, heightAt(x, z), z); rig.group.rotation.y = Math.atan2(-(f.pos.x - x), -(f.pos.z - z)); this.planet.group.add(rig.group);
        this.npcs.push({ rig, animal: null, kind, dead: false, deadT: 0, hitCd: 0, atkCd: 0, wander: new THREE.Vector3(x, 0, z), flail: 0, counted: false });
      }
    }
    this.panel.touch();
  }

  clear(): void {
    for (const n of this.npcs) { if (n.rig) this.planet.group.remove(n.rig.group); if (n.animal) this.planet.removeAnimal(n.animal); }
    this.npcs = []; this.debris.clear(); this.panel.touch();
  }

  private killed(n: Npc, ctx: ModeCtx): void {
    if (n.counted) return; n.counted = true; n.dead = true; this.kills++; this.onKill(); this.panel.touch();
    if (this.kills === 1) ctx.say('sbFirstKill'); else if (this.kills % 10 === 0) ctx.say('sbKills');
  }

  /** One fist against everything in reach. */
  private punch(i: number, hand: THREE.Vector3, speed: number, ctx: ModeCtx): void {
    if (this.hitCd[i] > 0) return;
    const eff = speed * this.power, reach = 0.5 + (this.power > 1 ? 0.15 : 0);
    for (const n of this.npcs) {
      if (n.animal && !n.dead) {   // animals just pop into stuffing
        const p = n.animal.group.position; if (Math.hypot(p.x - hand.x, p.z - hand.z) < 1.2 && Math.abs(p.y + 0.8 - hand.y) < 1.6 && eff > 3) {
          this.planet.burst(new THREE.Vector3(p.x, p.y + 0.8, p.z), 14, 0xffe0f0, 0.2, 6); this.planet.removeAnimal(n.animal); n.animal = null; this.killed(n, ctx); this.hitCd[i] = 0.3; ctx.toast('POP', hand); return;
        }
        continue;
      }
      if (!n.rig || n.rig.dead && n.rig.remaining.length === 0) continue;
      const hit = n.rig.nearest(hand, reach); if (!hit) continue;
      const dir = n.rig.centerOf(hit.id).sub(hand).setY(0).normalize().multiplyScalar(Math.min(9, 2 + eff)); if (!isFinite(dir.x)) dir.set(1, 0, 0);
      let tear: PartId | null = null;
      if (hit.id === 'head' && eff > 2.4) tear = 'head';
      else if ((hit.id === 'armL' || hit.id === 'armR' || hit.id === 'legL' || hit.id === 'legR') && eff > 2.4) tear = hit.id;
      else if (hit.id === 'torsoU' && eff > 4.4) tear = 'torsoU';
      else if (hit.id === 'torsoL' && eff > 4.4) tear = n.rig.has('legL') ? 'legL' : n.rig.has('legR') ? 'legR' : 'torsoU';
      if (tear) this.rip(n, tear, dir, ctx); else { n.rig.group.position.x += dir.x * 0.04; n.rig.group.position.z += dir.z * 0.04; n.flail = 0.5; ctx.pickup(); }
      this.hitCd[i] = 0.28; return;
    }
  }

  private rip(n: Npc, part: PartId, dir: THREE.Vector3, ctx: ModeCtx): void {
    const rig = n.rig!, at = rig.centerOf(part);
    const gone = rig.tear(part, dir, this.debris);
    this.planet.burst(at, 12, 0xfff4e8, 0.16, 5); this.planet.burst(at, 5, rig.kind === 'brute' ? 0x9a6ae0 : 0x9fd8ff, 0.1, 6);
    n.flail = 2.5;
    ctx.toast(part === 'head' ? 'HEAD OFF' : part === 'torsoU' ? 'TORN IN HALF' : gone.length > 1 ? 'TORN APART' : (part.startsWith('arm') ? 'ARM OFF' : 'LEG OFF'), at);
    if (rig.dead) this.killed(n, ctx);
  }

  /** Both fists on a chest and pulled apart: tear it in half. */
  private tearWithBoth(ctx: ModeCtx): boolean {
    const [a, b] = ctx.hands; if (!a || !b || !ctx.gripDown[0] || !ctx.gripDown[1]) return false;
    const sep = a.distanceTo(b), prev = this.lastSep; this.lastSep = sep;
    if (sep < 0.9 || sep < prev + 0.02) return false;
    for (const n of this.npcs) {
      if (!n.rig || n.rig.dead) continue; const c = n.rig.centerOf('torsoU');
      if (c.distanceTo(a) < 0.9 && c.distanceTo(b) < 0.9) { this.rip(n, 'torsoU', new THREE.Vector3(0, 0, 0).add(b).sub(a).setY(0).normalize().multiplyScalar(4), ctx); return true; }
    }
    return false;
  }
  private lastSep = 0;

  update(dt: number, ctx: ModeCtx): void {
    this.t += dt; this.debris.update(dt);
    this.hitCd = this.hitCd.map(c => Math.max(0, c - dt));
    // fists
    ctx.hands.forEach((h, i) => { if (h && ctx.handSpeed[i] > 2.2) this.punch(i, h, ctx.handSpeed[i], ctx); });
    this.tearWithBoth(ctx);
    // wear the monster body
    if (this.bodyRig) { const yaw = Math.atan2(-ctx.camera.getWorldDirection(new THREE.Vector3()).x, -ctx.camera.getWorldDirection(new THREE.Vector3()).z); this.bodyRig.followPlayer(ctx.head, yaw, ctx.hands[0], ctx.hands[1], true); }
    // the cast
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      if (n.animal) continue;
      const rig = n.rig!, p = rig.group.position;
      if (n.dead) { n.deadT += dt; rig.update(this.t, false, 0); if (n.deadT > 25) { this.planet.group.remove(rig.group); this.npcs.splice(i, 1); } continue; }
      n.flail = Math.max(0, n.flail - dt);
      const d = Math.hypot(ctx.head.x - p.x, ctx.head.z - p.z), hostile = n.kind !== 'dummy' && this.body === 'human';
      let tx = n.wander.x, tz = n.wander.z, speed = 0.9, moving = true;
      if (hostile && d < 36) { tx = ctx.head.x; tz = ctx.head.z; speed = n.kind === 'brute' ? 3.2 : 3.6; if (d < 1.8) { moving = false; n.atkCd -= dt; if (n.atkCd <= 0) { n.atkCd = 1.3; ctx.hurt(n.kind === 'brute' ? 18 : 12); ctx.growl(p); } } }
      else if (n.kind === 'dummy' && (this.body !== 'human' && d < 14 || n.flail > 0)) { tx = p.x + (p.x - ctx.head.x) * 4; tz = p.z + (p.z - ctx.head.z) * 4; speed = n.flail > 0 ? 3.4 : 2.6; }
      else if (Math.hypot(tx - p.x, tz - p.z) < 1) { n.wander.set(p.x + (Math.random() - 0.5) * 24, 0, p.z + (Math.random() - 0.5) * 24); moving = false; }
      const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz);
      if (moving && dl > 0.05) { const s = Math.min(dl, speed * dt); p.x += dx / dl * s; p.z += dz / dl * s; const target = Math.atan2(-dx, -dz); let da = target - rig.group.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; rig.group.rotation.y += da * Math.min(1, dt * 7); }
      else if (!moving) { const target = Math.atan2(-(ctx.head.x - p.x), -(ctx.head.z - p.z)); let da = target - rig.group.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; rig.group.rotation.y += da * Math.min(1, dt * 6); }
      p.y = heightAt(p.x, p.z);
      rig.update(this.t, moving, n.flail > 0 ? 1 : 0);
    }
    this.panel.update();
  }

  dispose(): void {
    this.clear(); if (this.bodyRig) this.scene.remove(this.bodyRig.group);
  }
}
