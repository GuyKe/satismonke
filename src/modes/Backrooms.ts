import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rig } from './Rig';
import type { Mode, ModeCtx } from './Mode';

const CELL = 4, N = 30, WALL_H = 3.1, SPAN = N * CELL;
type ItemKind = 'water' | 'beans' | 'crackers' | 'juice';
const ITEM_INFO: Record<ItemKind, { name: string; thirst: number; hunger: number }> = {
  water: { name: 'almond water', thirst: 40, hunger: 0 },
  beans: { name: 'canned beans', thirst: 0, hunger: 35 },
  crackers: { name: 'crackers', thirst: -4, hunger: 20 },
  juice: { name: 'juice box', thirst: 20, hunger: 10 },
};

const rngFrom = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function wallpaper(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#c9b45a'; g.fillRect(0, 0, 128, 256);
  for (let x = 0; x < 128; x += 16) { g.fillStyle = x % 32 ? '#bba74d' : '#d2bf68'; g.fillRect(x, 0, 8, 256); }
  g.fillStyle = 'rgba(80,60,10,0.25)'; for (let i = 0; i < 140; i++) g.fillRect(Math.random() * 128, Math.random() * 256, 2 + Math.random() * 3, 1 + Math.random() * 6);
  g.fillStyle = '#8a7430'; g.fillRect(0, 232, 128, 24);   // skirting
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function carpet(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#8a7a3a'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? '#7a6a30' : '#9a8a44'; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(SPAN / 3, SPAN / 3); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Monster { rig: Rig; cx: number; cz: number; path: [number, number][]; state: 'patrol' | 'chase' | 'stunned'; stun: number; repath: number }

/** The yellow halls: an endless-feeling maze of damp carpet and humming lights, with things lurking in it. */
export class Backrooms implements Mode {
  readonly id = 'backrooms' as const;
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly spawn: THREE.Vector3;
  hunger = 100; thirst = 100; collected = 0; caught = 0; time = 0;
  private open: boolean[][][];           // open[x][z] = [east, south] passages
  private items: { kind: ItemKind; x: number; z: number; slot: number; taken: boolean }[] = [];
  private itemMeshes!: Record<ItemKind, THREE.InstancedMesh>;
  private monsters: Monster[] = [];
  private lights!: THREE.InstancedMesh;
  private flick: number[] = [];
  private hum: { ctx: AudioContext; stop: () => void } | null = null;
  private warned = { hunger: false, thirst: false };
  private torch: THREE.PointLight;
  private cam: THREE.Camera | null = null;

  constructor(private scene: THREE.Scene, seed = 1337) {
    const rng = rngFrom(seed);
    this.world.hull = false; this.world.groundY = 0; this.world.groundSlip = 0.1;
    // ---- the maze: depth-first carve, then knock out walls for loops and carve a few open rooms ----
    const open: boolean[][][] = Array.from({ length: N }, () => Array.from({ length: N }, () => [false, false]));
    const seen = Array.from({ length: N }, () => new Array(N).fill(false));
    const stack: [number, number][] = [[N >> 1, N >> 1]]; seen[N >> 1][N >> 1] = true;
    while (stack.length) {
      const [x, z] = stack[stack.length - 1];
      const nb = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(([dx, dz]) => x + dx >= 0 && z + dz >= 0 && x + dx < N && z + dz < N && !seen[x + dx][z + dz]);
      if (!nb.length) { stack.pop(); continue; }
      const [dx, dz] = nb[Math.floor(rng() * nb.length)], nx = x + dx, nz = z + dz;
      if (dx === 1) open[x][z][0] = true; else if (dx === -1) open[nx][nz][0] = true; else if (dz === 1) open[x][z][1] = true; else open[nx][nz][1] = true;
      seen[nx][nz] = true; stack.push([nx, nz]);
    }
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) { if (x < N - 1 && rng() < 0.16) open[x][z][0] = true; if (z < N - 1 && rng() < 0.16) open[x][z][1] = true; }
    const rooms: { x: number; z: number; w: number; d: number }[] = [];
    for (let k = 0; k < 7; k++) {
      const w = 3 + Math.floor(rng() * 3), d = 3 + Math.floor(rng() * 2), x0 = 1 + Math.floor(rng() * (N - w - 2)), z0 = 1 + Math.floor(rng() * (N - d - 2));
      rooms.push({ x: x0, z: z0, w, d });
      for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) { if (x < x0 + w - 1) open[x][z][0] = true; if (z < z0 + d - 1) open[x][z][1] = true; }
    }
    this.open = open;
    const cx = (x: number) => (x + 0.5) * CELL - SPAN / 2, cz = (z: number) => (z + 0.5) * CELL - SPAN / 2;
    // the middle room is where you start
    const mid = rooms[0]; this.spawn = new THREE.Vector3(cx(mid.x + (mid.w >> 1)), 0.05, cz(mid.z + (mid.d >> 1)));

    // ---- walls: instanced meshes for looks, merged runs for collision ----
    const wallTex = wallpaper(); wallTex.repeat.set(1, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
    const edges: { x: number; z: number; horiz: boolean }[] = [];   // horiz: a wall running along x at the south edge of (x,z); else along z at the east edge
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
      if (z < N - 1 && !open[x][z][1]) edges.push({ x, z, horiz: true });
      if (x < N - 1 && !open[x][z][0]) edges.push({ x, z, horiz: false });
    }
    for (let i = 0; i < N; i++) { edges.push({ x: i, z: -1, horiz: true }, { x: i, z: N - 1, horiz: true }, { x: -1, z: i, horiz: false }, { x: N - 1, z: i, horiz: false }); }
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL + 0.2, WALL_H, 0.2), wallMat, edges.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    edges.forEach((e, i) => {
      const x = e.horiz ? cx(e.x) : cx(e.x) + CELL / 2, z = e.horiz ? cz(e.z) + CELL / 2 : cz(e.z);
      m.compose(new THREE.Vector3(x, WALL_H / 2, z), q.setFromEuler(new THREE.Euler(0, e.horiz ? 0 : Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)); walls.setMatrixAt(i, m);
    });
    this.group.add(walls);
    // merged collision runs
    const addRuns = (horiz: boolean) => {
      const byLine = new Map<number, number[]>();
      for (const e of edges.filter(e => e.horiz === horiz)) { const line = horiz ? e.z : e.x, pos = horiz ? e.x : e.z; (byLine.get(line) ?? byLine.set(line, []).get(line)!).push(pos); }
      for (const [line, ps] of byLine) {
        ps.sort((a, b) => a - b);
        for (let i = 0; i < ps.length;) {
          let j = i; while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
          const len = (ps[j] - ps[i] + 1) * CELL + 0.2, mid2 = ((ps[i] + ps[j]) / 2 + 0.5) * CELL - SPAN / 2, fixed = (line + 0.5) * CELL - SPAN / 2 + CELL / 2;
          this.world.addBox(horiz ? new THREE.Vector3(mid2, WALL_H / 2, fixed) : new THREE.Vector3(fixed, WALL_H / 2, mid2), horiz ? new THREE.Vector3(len, WALL_H, 0.3) : new THREE.Vector3(0.3, WALL_H, len), 0.25);
          i = j + 1;
        }
      }
    };
    addRuns(true); addRuns(false);
    // pillars inside the open rooms
    for (const r of rooms.slice(1)) for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) for (let z = r.z + 1; z < r.z + r.d - 1; z += 2) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, WALL_H, 0.8), wallMat); p.position.set(cx(x), WALL_H / 2, cz(z)); this.group.add(p);
      this.world.addBox(p.position.clone(), new THREE.Vector3(0.8, WALL_H, 0.8), 0.25);
    }
    // floor, ceiling and the humming lights
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SPAN + 8, SPAN + 8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: carpet(), roughness: 1 })); this.group.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(SPAN + 8, SPAN + 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfc080, roughness: 1 })); ceil.position.y = WALL_H; this.group.add(ceil);
    this.world.addBox(new THREE.Vector3(0, WALL_H + 0.25, 0), new THREE.Vector3(SPAN + 8, 0.5, SPAN + 8), 0.2);
    const lightCells: [number, number][] = []; for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) if ((x + z) % 2 === 0) lightCells.push([x, z]);
    this.lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), new THREE.MeshBasicMaterial({ color: 0xfffbe0, toneMapped: false }), lightCells.length);
    lightCells.forEach(([x, z], i) => {
      m.compose(new THREE.Vector3(cx(x), WALL_H - 0.03, cz(z)), q.identity(), new THREE.Vector3(1, 1, 1)); this.lights.setMatrixAt(i, m);
      this.lights.setColorAt(i, new THREE.Color(rng() < 0.12 ? 0x403a20 : 0xffffff)); this.flick.push(rng() < 0.2 ? 1 : 0);
    });
    this.lights.frustumCulled = false; this.group.add(this.lights);
    this.group.add(new THREE.HemisphereLight(0xe8d890, 0x5a4a20, 0.55));
    this.torch = new THREE.PointLight(0xfff0b8, 1.5, 15, 1.6);

    // ---- things to find ----
    const geos: Record<ItemKind, [THREE.BufferGeometry, number]> = {
      water: [new THREE.CylinderGeometry(0.05, 0.055, 0.26, 10).translate(0, 0.13, 0), 0x9fd8ff], beans: [new THREE.CylinderGeometry(0.07, 0.07, 0.11, 12).translate(0, 0.055, 0), 0xb0b4bc],
      crackers: [new THREE.BoxGeometry(0.2, 0.05, 0.14).translate(0, 0.025, 0), 0xe8b050], juice: [new THREE.BoxGeometry(0.08, 0.14, 0.05).translate(0, 0.07, 0), 0x7fe05a],
    };
    const kinds: ItemKind[] = ['water', 'water', 'water', 'beans', 'beans', 'crackers', 'crackers', 'crackers', 'juice', 'juice'];
    const counts: Record<ItemKind, number> = { water: 0, beans: 0, crackers: 0, juice: 0 };
    const want = 80;
    for (let i = 0; i < want; i++) {
      const kind = kinds[Math.floor(rng() * kinds.length)], x = Math.floor(rng() * N), z = Math.floor(rng() * N);
      if (Math.hypot(cx(x) - this.spawn.x, cz(z) - this.spawn.z) < 8) continue;
      this.items.push({ kind, x: cx(x) + (rng() - 0.5) * 2.2, z: cz(z) + (rng() - 0.5) * 2.2, slot: counts[kind]++, taken: false });
    }
    this.itemMeshes = {} as Record<ItemKind, THREE.InstancedMesh>;
    for (const k of Object.keys(geos) as ItemKind[]) {
      const [g, color] = geos[k];
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: k === 'water' ? 0x204a6a : 0x111111, emissiveIntensity: 0.8, transparent: k === 'water', opacity: k === 'water' ? 0.85 : 1 }), Math.max(1, counts[k]));
      im.count = counts[k]; im.frustumCulled = false; this.itemMeshes[k] = im; this.group.add(im);
    }
    for (const it of this.items) { m.compose(new THREE.Vector3(it.x, 0.02, it.z), q.setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(1, 1, 1)); this.itemMeshes[it.kind].setMatrixAt(it.slot, m); }

    // ---- lurkers ----
    const mc = (x: number) => Math.floor((x + SPAN / 2) / CELL);
    for (let i = 0; i < 4; i++) {
      let x = 0, z = 0; for (let t = 0; t < 40; t++) { x = Math.floor(rng() * N); z = Math.floor(rng() * N); if (Math.hypot(cx(x) - this.spawn.x, cz(z) - this.spawn.z) > 40) break; }
      const rig = new Rig('lurker'); rig.group.position.set(cx(x), 0, cz(z)); this.group.add(rig.group);
      this.monsters.push({ rig, cx: x, cz: z, path: [], state: 'patrol', stun: 0, repath: 0 }); void mc;
    }
    this.scene.add(this.group);
    this.scene.fog = new THREE.FogExp2(0xa8923c, 0.05); this.scene.background = new THREE.Color(0xa8923c);
    this.startHum();
  }

  // ---- helpers ----
  private cellOf(x: number, z: number): [number, number] { return [Math.min(N - 1, Math.max(0, Math.floor((x + SPAN / 2) / CELL))), Math.min(N - 1, Math.max(0, Math.floor((z + SPAN / 2) / CELL)))]; }
  private centerOf(x: number, z: number): [number, number] { return [(x + 0.5) * CELL - SPAN / 2, (z + 0.5) * CELL - SPAN / 2]; }
  private passable(x: number, z: number, dx: number, dz: number): boolean {
    if (x + dx < 0 || z + dz < 0 || x + dx >= N || z + dz >= N) return false;
    if (dx === 1) return this.open[x][z][0]; if (dx === -1) return this.open[x - 1][z][0]; if (dz === 1) return this.open[x][z][1]; return this.open[x][z - 1][1];
  }
  /** Shortest way between two cells through the open passages. */
  private route(a: [number, number], b: [number, number]): [number, number][] {
    const key = (x: number, z: number) => x * N + z, prev = new Map<number, number>(), q: [number, number][] = [a]; prev.set(key(a[0], a[1]), -1);
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i]; if (x === b[0] && z === b[1]) break;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) { if (!this.passable(x, z, dx, dz) || prev.has(key(x + dx, z + dz))) continue; prev.set(key(x + dx, z + dz), key(x, z)); q.push([x + dx, z + dz]); }
    }
    const out: [number, number][] = []; let k = key(b[0], b[1]); if (!prev.has(k)) return out;
    while (k !== -1) { out.push([Math.floor(k / N), k % N]); k = prev.get(k)!; }
    return out.reverse().slice(1);
  }
  private sees(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az); if (d > 28) return false;
    let [px, pz] = this.cellOf(ax, az);
    for (let s = 0.5; s <= d; s += 0.5) {
      const [cxn, czn] = this.cellOf(ax + (bx - ax) * s / d, az + (bz - az) * s / d);
      if (cxn !== px || czn !== pz) { if (Math.abs(cxn - px) + Math.abs(czn - pz) !== 1 || !this.passable(px, pz, cxn - px, czn - pz)) return false; px = cxn; pz = czn; }
    }
    return true;
  }

  private startHum(): void {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext, ctx = new Ctx(), g = ctx.createGain(); g.gain.value = 0.05; g.connect(ctx.destination);
      const oscs = [58, 116, 175].map((f, i) => { const o = ctx.createOscillator(); o.type = i ? 'sine' : 'sawtooth'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = i ? 0.25 : 0.5; o.connect(og); og.connect(g); o.start(); return o; });
      void ctx.resume(); this.hum = { ctx, stop: () => { oscs.forEach(o => { try { o.stop(); } catch { /* stopped */ } }); void ctx.close(); } };
    } catch { /* no audio */ }
  }

  hud(): [string, string] {
    return ['Survive the backrooms', `Hunger ${Math.max(0, Math.round(this.hunger))}  Thirst ${Math.max(0, Math.round(this.thirst))}  Found ${this.collected}`];
  }

  update(dt: number, ctx: ModeCtx): void {
    this.time += dt;
    if (!this.cam) { this.cam = ctx.camera; ctx.camera.add(this.torch); this.torch.position.set(0, 0.1, 0); }
    // flickering lights and torch
    const fl = Math.sin(this.time * 31) * Math.sin(this.time * 7.3);
    this.torch.intensity = 1.4 + fl * 0.25 + (Math.random() < 0.01 ? -0.9 : 0);
    // hunger and thirst
    this.hunger = Math.max(0, this.hunger - dt * 0.21); this.thirst = Math.max(0, this.thirst - dt * 0.33);
    if (this.thirst < 25 && !this.warned.thirst) { this.warned.thirst = true; ctx.say('brThirsty'); } if (this.thirst > 40) this.warned.thirst = false;
    if (this.hunger < 25 && !this.warned.hunger) { this.warned.hunger = true; ctx.say('brHungry'); } if (this.hunger > 40) this.warned.hunger = false;
    if (this.hunger <= 0 || this.thirst <= 0) ctx.hurt(dt * 2.2);
    // things to find: touch them with a hand (or walk over them)
    const near = (it: { x: number; z: number }) => ctx.hands.some(h => Math.hypot(h.x - it.x, h.z - it.z) < 0.5 && h.y < 1.0) || (Math.hypot(ctx.head.x - it.x, ctx.head.z - it.z) < 0.6);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const it of this.items) {
      if (it.taken || !near(it)) continue;
      it.taken = true; this.itemMeshes[it.kind].setMatrixAt(it.slot, zero); this.itemMeshes[it.kind].instanceMatrix.needsUpdate = true;
      const info = ITEM_INFO[it.kind]; this.thirst = Math.min(100, this.thirst + info.thirst); this.hunger = Math.min(100, this.hunger + info.hunger); this.collected++;
      ctx.toast(`+ ${info.name}${info.thirst > 0 ? `  thirst +${info.thirst}` : ''}${info.hunger > 0 ? `  hunger +${info.hunger}` : ''}`, new THREE.Vector3(it.x, 0.8, it.z)); ctx.pickup();
      if (it.kind === 'water') ctx.say('brWater');
    }
    // lurkers
    for (const mo of this.monsters) {
      const p = mo.rig.group.position, d = Math.hypot(ctx.head.x - p.x, ctx.head.z - p.z), seesYou = d < 26 && this.sees(p.x, p.z, ctx.head.x, ctx.head.z);
      if (mo.state === 'stunned') { mo.stun -= dt; if (mo.stun <= 0) mo.state = 'patrol'; mo.rig.update(this.time, false); continue; }
      if (seesYou && mo.state !== 'chase') { mo.state = 'chase'; mo.repath = 0; ctx.say('brChased'); ctx.growl(p); }
      else if (!seesYou && mo.state === 'chase' && d > 34) mo.state = 'patrol';
      mo.repath -= dt;
      const here = this.cellOf(p.x, p.z);
      if (mo.state === 'chase') { if (mo.repath <= 0) { mo.path = this.route(here, this.cellOf(ctx.head.x, ctx.head.z)); mo.repath = 0.45; } }
      else if (!mo.path.length) { mo.path = this.route(here, [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]).slice(0, 14); }
      const speed = mo.state === 'chase' ? 4.1 : 1.7;
      let tx = mo.state === 'chase' && d < 3 ? ctx.head.x : 0, tz = mo.state === 'chase' && d < 3 ? ctx.head.z : 0;
      if (!tx && !tz) { if (!mo.path.length) { mo.rig.update(this.time, false); continue; } [tx, tz] = this.centerOf(mo.path[0][0], mo.path[0][1]); }
      const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz);
      if (dl < 0.35 && mo.path.length) mo.path.shift();
      if (dl > 0.01) { const s = Math.min(dl, speed * dt); p.x += dx / dl * s; p.z += dz / dl * s; const target = Math.atan2(-dx, -dz); let da = target - mo.rig.group.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; mo.rig.group.rotation.y += da * Math.min(1, dt * 8); }
      mo.rig.update(this.time, true);
      if (d < 1.25 && Math.abs(ctx.head.y - 1.5) < 1.6) {   // it got you
        this.caught++; ctx.hurt(34); ctx.growl(p); ctx.say('brCaught');
        mo.state = 'stunned'; mo.stun = 5; mo.path = [];
        const far = this.route(here, [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]); if (far.length) { const [fx, fz] = this.centerOf(far[far.length - 1][0], far[far.length - 1][1]); p.x = fx; p.z = fz; }
      }
    }
  }

  /** Nearest lurker's distance (for the danger tint). */
  nearestMonster(head: THREE.Vector3): number { return Math.min(...this.monsters.map(m => Math.hypot(head.x - m.rig.group.position.x, head.z - m.rig.group.position.z))); }

  /** Called when you were knocked out: back to the start with full meters. */
  respawn(): THREE.Vector3 { this.hunger = Math.max(this.hunger, 60); this.thirst = Math.max(this.thirst, 60); return this.spawn.clone(); }

  dispose(): void {
    this.scene.remove(this.group); this.scene.fog = null; this.torch.removeFromParent(); this.hum?.stop(); this.hum = null;
    this.group.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose?.(); });
  }
}
