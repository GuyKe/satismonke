import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Animal, makeGround, makeFlyer } from './Animals';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, buildTerrainMesh, pathMask, PONDS, LAKE, pondY, WATER_Y } from './Terrain';

export interface TreeRec {
  pine: boolean; x: number; y: number; z: number; h: number;
  color: number; trunkIdx: number; foliageIdx: number; felled: boolean;
  trunkLocal: THREE.Matrix4; foliageLocal: THREE.Matrix4;
}

export const DAY_SECONDS = 7 * 60;
export const NIGHT_SECONDS = 5 * 60;
const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
const SKY_R = 1500;
const ABOVE_WATER = WATER_Y + 1.2;

function rngFrom(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function groundTexture(rng: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 256); // multiplied with the terrain's vertex colours
  for (let i = 0; i < 2600; i++) {
    const l = 70 + rng() * 40;
    g.fillStyle = `hsl(0 0% ${l}%)`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function saturnTextures(): { body: THREE.CanvasTexture; ring: THREE.CanvasTexture } {
  const b = document.createElement('canvas'); b.width = 16; b.height = 256;
  const g = b.getContext('2d')!;
  const bands = ['#f4e3b0', '#e8c987', '#d9a85f', '#f0d8a0', '#c99a5a', '#ebd09a', '#dcb877', '#f6e6bb'];
  for (let y = 0; y < 256; y++) {
    const k = Math.floor((y / 256) * bands.length * 3) % bands.length;
    g.fillStyle = bands[(k + Math.floor(Math.sin(y * 0.21) * 1.2 + 1)) % bands.length];
    g.fillRect(0, y, 16, 1);
  }
  const r = document.createElement('canvas'); r.width = r.height = 512;
  const rg = r.getContext('2d')!;
  rg.translate(256, 256);
  for (let rad = 256; rad > 130; rad -= 2) {
    const a = rad > 215 && rad < 225 ? 0 : 0.35 + 0.55 * Math.abs(Math.sin(rad * 0.37));
    rg.strokeStyle = `rgba(${210 + (rad % 30)},${180 + (rad % 25)},${130},${a})`;
    rg.lineWidth = 2.2; rg.beginPath(); rg.arc(0, 0, rad, 0, Math.PI * 2); rg.stroke();
  }
  const body = new THREE.CanvasTexture(b), ring = new THREE.CanvasTexture(r);
  body.colorSpace = ring.colorSpace = THREE.SRGBColorSpace;
  return { body, ring };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

/** The alien planet: rolling hills, lakes, spaced trees, crystals, floating rocks, strange animals, Saturn as the sun. */
export class Planet {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  /** Seconds since landing plus the starting offset (so you arrive mid-morning). */
  clock = 40;

  private celestial = new THREE.Group();   // follows the player so the sky is infinitely far
  private saturn = new THREE.Group();
  private moon: THREE.Mesh;
  private stars: THREE.Points;
  private fireflies: THREE.Points;
  private ffSeeds: Float32Array;
  private water: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffe2a8, 2);
  private hemi = new THREE.HemisphereLight(0xc9a8ff, 0x7a3a8a, 0.8);
  private animals: Animal[] = [];
  private treeRecs: TreeRec[] = [];
  private trunkMesh!: THREE.InstancedMesh;
  private canopyMesh!: THREE.InstancedMesh;
  private pineMesh!: THREE.InstancedMesh;
  private falling: { rec: TreeRec; group: THREE.Group; t: number; axis: THREE.Vector3; landed: boolean }[] = [];
  /** Landmarks for the map. */
  readonly marks = { mesas: [] as [number, number, number][], spires: [] as [number, number, number][], crystals: [] as [number, number][] };
  /** A tree has finished falling and vanished: here is the wood it gave. */
  onWood: ((amount: number, pos: THREE.Vector3) => void) | null = null;
  /** A felled tree hit the ground. */
  onTreeLanded: ((pos: THREE.Vector3) => void) | null = null;
  private clocks = new Map<Animal, number>();
  private probe = new THREE.Vector3();
  private smoke: THREE.Sprite[] = [];
  private pod: THREE.Group | null = null;
  private podLight: THREE.PointLight | null = null;
  /** Called when a creature roars, with its position and species. */
  onRoar: ((pos: THREE.Vector3, kind: string) => void) | null = null;
  private animalTime = 0;
  private tmpCol = new THREE.Color();
  private skyDay = new THREE.Color(0xb79af0);
  private skyDusk = new THREE.Color(0xff8a6a);
  private skyNight = new THREE.Color(0x070618);

  constructor(seed = 7) {
    const rng = rngFrom(seed);
    this.world.hull = false; this.world.heightFn = heightAt; this.world.groundSlip = 0.1;

    this.group.add(buildTerrainMesh(groundTexture(rng)));
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3fd6e6, emissive: 0x0a6a78, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2 });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2), waterMat);
    this.water.position.y = WATER_Y;
    this.group.add(this.water);
    for (const pd of PONDS) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(pd.r * 1.1, 28).rotateX(-Math.PI / 2), waterMat);
      w.position.set(pd.x, pondY(pd), pd.z);
      this.group.add(w);
    }

    this.buildGrass(rng);
    this.buildTrees(rng);
    this.buildBoulders(rng);
    this.buildMesas(rng);
    this.buildCrystals(rng);
    this.buildFloatingRocks(rng);
    this.buildMushrooms(rng);
    this.buildMountains(rng);
    this.buildAnimals(rng);
    this.world.finalize();

    // Fireflies (visible at night)
    this.ffSeeds = new Float32Array(260 * 3).map(() => rng() * 100);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(260 * 3), 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff2a0, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);

    // Sky objects
    const { body, ring } = saturnTextures();
    const R = 95;
    this.saturn.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), new THREE.MeshBasicMaterial({ map: body, toneMapped: false, fog: false })));
    const rm = new THREE.Mesh(new THREE.RingGeometry(R * 1.35, R * 2.35, 72),
      new THREE.MeshBasicMaterial({ map: ring, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false, depthWrite: false }));
    rm.rotation.x = -Math.PI / 2 + 0.38;
    this.saturn.add(rm);
    this.celestial.add(this.saturn);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xcfe9ff, toneMapped: false, fog: false }));
    this.celestial.add(this.moon);

    const sp: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp.push(Math.cos(a) * s * SKY_R * 1.2, Math.abs(u) * SKY_R * 1.2, Math.sin(a) * s * SKY_R * 1.2);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.celestial.add(this.stars);

    this.group.add(this.celestial, this.sun, this.sun.target, this.hemi);
  }

  /** Random spot on dry land within [rMin, rMax] of the landing site. */
  private dryPoint(rng: () => number, rMin: number, rMax: number, minH = ABOVE_WATER): { x: number; z: number; h: number } {
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
      if (h > minH && pathMask(x, z) < 0.5) return { x, z, h };
    }
    return { x: rMin, z: 0, h: 0 };
  }

  private buildGrass(rng: () => number): void {
    const N = 10000;
    // Short grass: blades are 0.15-0.45 m tall
    const geo = new THREE.ConeGeometry(0.045, 0.4, 3, 1).translate(0, 0.2, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 2; tries++) {
      const a = rng() * Math.PI * 2, r = 1.2 + Math.pow(rng(), 1.5) * 120;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
      if (y < ABOVE_WATER - 0.4 || pathMask(x, z) > 0.3) continue;
      e.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4);
      const s = 0.55 + rng() * 0.6;
      m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e), new THREE.Vector3(s, s * (0.8 + rng() * 0.5), s));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.setHSL(0.76 + rng() * 0.2, 0.55 + rng() * 0.3, 0.42 + rng() * 0.22));
      n++;
    }
    mesh.count = n;
    this.group.add(mesh);
  }

  /** Clusters of alien trees across the plains, plus a few loners. Trees stay at least 9 m apart. */
  private buildTrees(rng: () => number): void {
    type Spot = { x: number; z: number; y: number; h: number; cr: number; c: number; pine: boolean };
    const spots: Spot[] = [];
    const tryAdd = (x: number, z: number, gap = 9): boolean => {
      const y = heightAt(x, z);
      if (y < ABOVE_WATER + 0.5 || Math.hypot(x, z) < 14 || pathMask(x, z) > 0.4) return false;
      if (spots.some(t => Math.hypot(t.x - x, t.z - z) < gap)) return false;
      spots.push({ x, z, y, h: 6 + rng() * 6, cr: 2.2 + rng() * 1.4, c: Math.floor(rng() * 4), pine: rng() < 0.45 });
      return true;
    };
    for (let k = 0; k < 18; k++) {
      const c = this.dryPoint(rng, 35, 200, ABOVE_WATER + 0.5);
      const n = 3 + Math.floor(rng() * 6);
      for (let t = 0, added = 0; t < 40 && added < n; t++) {
        const a = rng() * Math.PI * 2, d = rng() * 28;
        if (tryAdd(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d)) added++;
      }
    }
    for (let k = 0; k < 40 && spots.length < 110; k++) { const p = this.dryPoint(rng, 18, 200); tryAdd(p.x, p.z, 14); }

    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(1.0, 0.5, 8).translate(0, 0.25, 0),
      new THREE.ConeGeometry(0.75, 0.45, 8).translate(0, 0.55, 0),
      new THREE.ConeGeometry(0.5, 0.4, 8).translate(0, 0.82, 0),
    ].map(g => g.toNonIndexed()))!;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x9a8fb8, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.46, 1, 8).translate(0, 0.5, 0), trunkMat, spots.length);
    const nPine = spots.filter(s => s.pine).length;
    const canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.7 }), spots.length - nPine);
    const pines = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), nPine);
    const palette = [0x2fd1c1, 0xff6fb5, 0xffa940, 0x7d6bff], pinePal = [0x38c9a0, 0x9a6bff, 0xff7ac0, 0x4aa8ff];
    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    let ci = 0, pi = 0;
    this.trunkMesh = trunks; this.canopyMesh = canopies; this.pineMesh = pines;
    spots.forEach((t, i) => {
      const rec: TreeRec = { pine: t.pine, x: t.x, y: t.y, z: t.z, h: t.h, color: t.pine ? pinePal[t.c] : palette[t.c], trunkIdx: i, foliageIdx: t.pine ? pi : ci, felled: false, trunkLocal: new THREE.Matrix4(), foliageLocal: new THREE.Matrix4() };
      this.treeRecs.push(rec);
      if (!t.pine) {
        const w = t.h * 0.1 + 0.6;
        m.compose(new THREE.Vector3(t.x, t.y - 1.5, t.z), q, new THREE.Vector3(w, t.h + 1.5, w)); trunks.setMatrixAt(i, m);
        rec.trunkLocal.compose(new THREE.Vector3(0, -1.5, 0), q, new THREE.Vector3(w, t.h + 1.5, w));
        const cy = t.y + t.h + t.cr * 0.35;
        m.compose(new THREE.Vector3(t.x, cy, t.z), q, new THREE.Vector3(t.cr, t.cr * 0.8, t.cr));
        rec.foliageLocal.compose(new THREE.Vector3(0, cy - t.y, 0), q, new THREE.Vector3(t.cr, t.cr * 0.8, t.cr));
        canopies.setMatrixAt(ci, m); canopies.setColorAt(ci++, col.set(palette[t.c]));
        this.world.addCylinder(t.x, t.z, t.y - 1.5, t.y + t.h, w * 0.38, 0, i);        // bark: grippy
        this.world.addSphere(new THREE.Vector3(t.x, cy, t.z), t.cr * 0.85, 0.2, i);     // leafy canopy
      } else {
        const th = t.h * 0.55, w = 0.8, fh = t.h * 1.0, rad = t.cr * 0.95;
        m.compose(new THREE.Vector3(t.x, t.y - 1.5, t.z), q, new THREE.Vector3(w, th + 1.5, w)); trunks.setMatrixAt(i, m);
        rec.trunkLocal.compose(new THREE.Vector3(0, -1.5, 0), q, new THREE.Vector3(w, th + 1.5, w));
        m.compose(new THREE.Vector3(t.x, t.y + th * 0.45, t.z), q, new THREE.Vector3(rad, fh, rad));
        rec.foliageLocal.compose(new THREE.Vector3(0, th * 0.45, 0), q, new THREE.Vector3(rad, fh, rad));
        pines.setMatrixAt(pi, m); pines.setColorAt(pi++, col.set(pinePal[t.c]));
        this.world.addCylinder(t.x, t.z, t.y - 1.5, t.y + th + 1, w * 0.38, 0, i);
        this.world.addSphere(new THREE.Vector3(t.x, t.y + th * 0.45 + fh * 0.3, t.z), rad * 0.5, 0.2, i);
        this.world.addSphere(new THREE.Vector3(t.x, t.y + th * 0.45 + fh * 0.62, t.z), rad * 0.3, 0.2, i);
      }
    });
    this.group.add(trunks, canopies, pines);
  }

  /** Round boulders dotted over the plains: solid and grippy-ish. */
  private buildBoulders(rng: () => number): void {
    const N = 70;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 10, 210), r = 0.9 + Math.pow(rng(), 2) * 4.5;
      m.compose(new THREE.Vector3(p.x, p.h + r * 0.25, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(r, r * 0.7, r * (0.8 + rng() * 0.4)));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHSL(0.74 + rng() * 0.08, 0.12, 0.36 + rng() * 0.2));
      this.world.addSphere(new THREE.Vector3(p.x, p.h + r * 0.3, p.z), r * 0.78, 0.3);
    }
    this.group.add(mesh);
  }

  /** Flat-topped mesas and tall mushroom-capped spires standing in the lake. */
  private buildMesas(rng: () => number): void {
    const band = [new THREE.Color(0x8a6a9a), new THREE.Color(0xb08ab8), new THREE.Color(0x6a4f86), new THREE.Color(0xc4a0b0)];
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xb25ac8, roughness: 1 });
    const BASE = -32;
    const rock = (rTop: number, rBot: number, base: number, top: number, seg = 22): THREE.Mesh => {
      const H = top - base;
      const g = new THREE.CylinderGeometry(rTop, rBot, H, seg, Math.max(6, Math.round(H / 5)), true).translate(0, base + H / 2, 0);
      const p = g.attributes.position, col: number[] = [], c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + (hash3(x, y, z) - 0.5) * 0.12;
        p.setXYZ(i, x * j, y, z * j);
        const k = Math.max(0, Math.floor((y - base) / 3.2));
        c.copy(band[k % 4]).lerp(band[(k + 1) % 4], 0.25).multiplyScalar(0.9 + hash3(k, 1, 2) * 0.2);
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, rockMat);
    };
    // x, z, radius, top height
    for (const [x, z, r, top] of [[-110, -430, 38, 9], [90, -500, 52, 12], [-30, -610, 44, 8], [170, -640, 36, 10], [-190, -650, 48, 14], [40, -450, 26, 6]]) {
      const m = rock(r * 0.9, r * 1.1, BASE, top); m.position.set(x, 0, z); this.group.add(m);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 24).rotateX(-Math.PI / 2), grassMat);
      cap.position.set(x, top + 0.05, z); this.group.add(cap);
      this.world.addPillar(x, z, BASE, top, r * 0.95, 0.15);
      this.marks.mesas.push([x, z, r]);
    }
    // spires like a giant stone mushroom: x, z, radius, height above the water
    for (const [x, z, r, hgt] of [[-45, -520, 7, 70], [120, -560, 9, 90], [-140, -300, 6, 55], [60, -235, 6, 48]]) {
      const base = Math.min(BASE, heightAt(x, z) - 2), top = Math.max(heightAt(x, z), WATER_Y) + hgt;
      const m = rock(r * 0.8, r * 1.15, base, top, 12); m.position.set(x, 0, z); this.group.add(m);
      const cap = rock(r * 1.8, r * 1.5, top - 6, top, 14); cap.position.set(x, 0, z); this.group.add(cap);
      const lid = new THREE.Mesh(new THREE.CircleGeometry(r * 1.8, 14).rotateX(-Math.PI / 2), grassMat);
      lid.position.set(x, top + 0.05, z); this.group.add(lid);
      this.marks.spires.push([x, z, r * 1.8]);
      this.world.addPillar(x, z, base, top, r * 0.9, 0.15);
      this.world.addPillar(x, z, top - 6, top, r * 1.7, 0.15);
    }
  }

  /** Glowing crystal spires you can climb. */
  private buildCrystals(rng: () => number): void {
    const items: { x: number; y: number; z: number; r: number; h: number; c: number }[] = [];
    for (let k = 0; k < 11; k++) {
      const c = this.dryPoint(rng, 30, 170, ABOVE_WATER + 1);
      const n = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = 1 + rng() * 4;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        items.push({ x, z, y: heightAt(x, z), r: 0.6 + rng() * 0.9, h: 4 + rng() * 9, c: k % 3 });
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ emissive: 0x552288, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, flatShading: true }), items.length);
    const palette = [0x66f0ff, 0xff7adf, 0xb89cff], m = new THREE.Matrix4(), col = new THREE.Color();
    items.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, s.y - 0.5, s.z), new THREE.Quaternion(), new THREE.Vector3(s.r, s.h, s.r));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.set(palette[s.c]));
      this.world.addCylinder(s.x, s.z, s.y - 0.5, s.y + s.h * 0.8, s.r * 0.5, 0.05);
      if (i % 3 === 0) this.marks.crystals.push([s.x, s.z]);
    });
    this.group.add(mesh);
  }

  /** Rocks floating in the air: reachable by chaining launches off tall trees. */
  private buildFloatingRocks(rng: () => number): void {
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 10);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < 10; i++) {
      const p = this.dryPoint(rng, 25, 150, ABOVE_WATER), r = 3 + rng() * 4, y = p.h + 14 + rng() * 22;
      m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)), new THREE.Vector3(r, r * 0.8, r));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHSL(0.72 + rng() * 0.12, 0.25, 0.35 + rng() * 0.15));
      this.world.addSphere(new THREE.Vector3(p.x, y, p.z), r * 0.85, 0.15);
      // glowing moss cap on top
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3),
        new THREE.MeshStandardMaterial({ color: 0xff7adf, emissive: 0x802060, emissiveIntensity: 0.6 }));
      cap.position.set(p.x, y + r * 0.35, p.z); this.group.add(cap);
    }
    this.group.add(mesh);
  }

  private buildMushrooms(rng: () => number): void {
    const N = 420;
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xf0e6ff }), N);
    const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ toneMapped: false }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    const palette = [0xff5ad0, 0x5af0ff, 0xb08cff, 0xffd45a];
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 4, 140), h = 0.25 + rng() * 0.6, w = 0.25 + rng() * 0.4;
      m.compose(new THREE.Vector3(p.x, p.h, p.z), q, new THREE.Vector3(1, h, 1)); stems.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, p.h + h, p.z), q, new THREE.Vector3(w, w * 0.9, w)); caps.setMatrixAt(i, m);
      caps.setColorAt(i, col.set(palette[i % 4]));
    }
    this.group.add(stems, caps);
  }

  /** Rugged snow-capped peaks on the horizon. */
  private buildMountains(rng: () => number): void {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const low = new THREE.Color(0x4f3585), mid = new THREE.Color(0x8566b8), snow = new THREE.Color(0xf4eeff), c = new THREE.Color();
    const make = (radius: number, height: number): THREE.BufferGeometry => {
      const g = new THREE.ConeGeometry(radius, height, 11, 9, true).translate(0, height / 2, 0);
      const p = g.attributes.position, col: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / height;
        if (t > 0.02) { // jitter by position hash so seam vertices stay joined
          const j = (hash3(x, y, z) - 0.5) * radius * 0.35 * (1 - t * 0.5), j2 = (hash3(z, x, y) - 0.5) * height * 0.06;
          p.setXYZ(i, x + j, y + j2, z + (hash3(y, z, x) - 0.5) * radius * 0.35 * (1 - t * 0.5));
        }
        c.copy(low).lerp(mid, smoothstep(0, 0.7, t)).lerp(snow, smoothstep(0.62, 0.8, t + (hash3(x, y, z) - 0.5) * 0.12));
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    };
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rng() * 0.15, r = 1500 + rng() * 800, h = 260 + rng() * 520;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const m = new THREE.Mesh(make(h * (0.55 + rng() * 0.35), h), mat);
      m.position.set(x, heightAt(x, z) - 25, z); m.rotation.y = rng() * 6;
      this.group.add(m);
      if (rng() > 0.4) { // shoulder peak
        const s = new THREE.Mesh(make(h * 0.35, h * 0.55), mat);
        s.position.set(x + (rng() - 0.5) * h * 0.7, heightAt(x, z) - 25, z + (rng() - 0.5) * h * 0.7); this.group.add(s);
      }
    }
  }

  private buildAnimals(rng: () => number): void {
    const place = (an: Animal, rMin: number, rMax: number) => {
      const p = this.dryPoint(rng, rMin, rMax, ABOVE_WATER + 0.5);
      an.group.position.set(p.x, p.h, p.z);
      an.heading = rng() * Math.PI * 2;
      this.animals.push(an); this.group.add(an.group);
    };
    for (let i = 0; i < 16; i++) place(makeGround(i, rng), 14, 130);
    for (let i = 0; i < 16; i++) place(makeFlyer(i, rng), 10, 150);
  }

  /** 0..CYCLE seconds into the day/night cycle. */
  get cycleTime(): number { return this.clock % CYCLE; }
  get isDay(): boolean { return this.cycleTime < DAY_SECONDS; }

  update(dt: number, scene: THREE.Scene, follow: THREE.Vector3, head: THREE.Vector3): void {
    this.clock += dt;
    this.animalTime += dt;

    // Saturn's arc: DAY_SECONDS above the horizon, NIGHT_SECONDS below it.
    const ct = this.cycleTime;
    const theta = ct < DAY_SECONDS ? Math.PI * (ct / DAY_SECONDS) : Math.PI + Math.PI * ((ct - DAY_SECONDS) / NIGHT_SECONDS);
    const dir = new THREE.Vector3(Math.cos(theta), Math.sin(theta), -0.35).normalize();
    const elev = dir.y;
    const day = smoothstep(-0.08, 0.22, elev);
    const dusk = 1 - smoothstep(0.0, 0.3, Math.abs(elev)); // warm near the horizon

    this.celestial.position.copy(follow);
    this.saturn.position.copy(dir).multiplyScalar(SKY_R);
    this.saturn.rotation.y += 0.0002;
    this.moon.position.set(-dir.x, -dir.y * 0.9, 0.4).multiplyScalar(SKY_R * 0.9);
    this.moon.visible = this.moon.position.y > -50;
    const night = Math.pow(1 - day, 1.5);
    (this.stars.material as THREE.PointsMaterial).opacity = night;

    const sky = this.tmpCol.copy(this.skyNight).lerp(this.skyDay, day).lerp(this.skyDusk, dusk * 0.55 * (day > 0.02 ? 1 : 0.5));
    scene.background = sky.clone();
    if (!scene.fog) scene.fog = new THREE.FogExp2(sky.getHex(), 0.0016);
    (scene.fog as THREE.FogExp2).color.copy(sky);

    this.sun.position.copy(follow).addScaledVector(dir, 300);
    this.sun.target.position.copy(follow);
    this.sun.intensity = 2.3 * day;
    this.hemi.intensity = 0.3 + 0.9 * day;

    this.updateFireflies(night, follow);
    this.updateAnimals(dt, follow, head);
    this.updatePod(dt, night);
    this.updateFalling(dt);
  }

  private updateFireflies(night: number, follow: THREE.Vector3): void {
    (this.fireflies.material as THREE.PointsMaterial).opacity = night * 0.9;
    this.fireflies.visible = night > 0.02;
    if (!this.fireflies.visible) return;
    const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute, t = this.animalTime;
    for (let i = 0; i < pos.count; i++) {
      const sx = this.ffSeeds[i * 3], sy = this.ffSeeds[i * 3 + 1], sz = this.ffSeeds[i * 3 + 2];
      // wrap each firefly inside a 80 m box centred on the player, drifting gently
      const x = follow.x + ((sx * 7.3 + t * 0.6 + Math.sin(t * 0.4 + sy) * 3) % 80 + 80) % 80 - 40;
      const z = follow.z + ((sz * 5.1 + t * 0.4 + Math.cos(t * 0.3 + sx) * 3) % 80 + 80) % 80 - 40;
      pos.setXYZ(i, x, Math.max(heightAt(x, z), WATER_Y) + 0.5 + (sy % 5) + Math.sin(t + sx) * 0.5, z);
    }
    pos.needsUpdate = true;
  }

  /** Is there open space (no rock, tree or water edge) around this ground point? */
  private clearAt(x: number, z: number): number {
    return this.world.distance(this.probe.set(x, heightAt(x, z) + 2.2, z));
  }

  private updateAnimals(dt: number, follow: THREE.Vector3, head: THREE.Vector3): void {
    for (const an of this.animals) {
      const p = an.group.position;
      const dx = head.x - p.x, dz = head.z - p.z, d = Math.hypot(dx, dz);
      const far = d > 220;
      an.group.visible = !far;
      if (far && !an.flying) continue; // freeze distant ground animals

      // ---- attention span: it studies you for a while, then looks away for a while ----
      const lk = an.look;
      lk.timer -= dt;
      if (d >= 45) { lk.away = false; lk.timer = Math.max(lk.timer, 2); }
      else if (lk.timer <= 0) {
        lk.away = !lk.away;
        if (lk.away) { lk.timer = 3 + Math.random() * 5; lk.ay = (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.7); lk.ap = (Math.random() - 0.7) * 0.5; }
        else lk.timer = 4 + Math.random() * 6;
      }
      const attentive = !lk.away;

      // ---- how it reacts to you ----
      const want = Math.atan2(dx, dz);            // heading that points at you
      const delta = wrap(want - an.heading);      // >0: you're on its +heading side
      let steer: number | null = null, speedMul = 1;
      switch (an.mood) {
        case 'curious':
          if (!attentive && d > 6) break;                                // lost interest: carries on
          if (an.flying) { if (d < 45 && d > 10) { steer = want; speedMul = 0.6; } else if (d <= 10) { steer = want; speedMul = 0; } }
          else if (d < 22 && d > 6) { steer = want; speedMul = 0; }       // stops to study you
          else if (d <= 6) { steer = want + Math.PI; speedMul = 0.8; }    // too close: backs away
          break;
        case 'shy': if (d < 28) { steer = want + Math.PI; speedMul = 1.6; } break;
        case 'skittish': if (d < (an.flying ? 25 : 14)) { steer = want + Math.PI; speedMul = 2; } break;
        case 'defensive': if (d < 18 && (attentive || d < 8)) { steer = want; speedMul = 0; } break;
        case 'friendly': if (d < 40 && attentive) { steer = want + (d < 5 ? 1.5 : 0); speedMul = d < 3 ? 0.3 : 1.2; } break;
        default: break;
      }
      // Walk into its path and it goes around you.
      if (steer === null && d < 15 && Math.abs(delta) < 0.6) steer = an.heading - Math.sign(delta || 1) * 1.0;

      if (steer !== null) {
        an.turn = THREE.MathUtils.clamp(wrap(steer - an.heading) * 2, -1.6, 1.6);
      } else if (an.turnBias) {
        an.turn = an.turnBias + (Math.random() - 0.5) * 0.1;
      } else {
        an.turn += (Math.random() - 0.5) * 1.5 * dt;
        an.turn = THREE.MathUtils.clamp(an.turn, -0.6, 0.6) * (1 - 0.5 * dt);
        if (Math.hypot(p.x, p.z) > 170) an.turn = THREE.MathUtils.clamp(wrap(Math.atan2(-p.x, -p.z) - an.heading), -1, 1);
      }
      if (!an.flying) { // steer around rocks, trunks and lakes
        const ahead = (a: number) => this.clearAt(p.x + Math.sin(a) * 4, p.z + Math.cos(a) * 4);
        if (ahead(an.heading) < 1.2 || heightAt(p.x + Math.sin(an.heading) * 5, p.z + Math.cos(an.heading) * 5) < ABOVE_WATER)
          an.turn = ahead(an.heading + 0.7) > ahead(an.heading - 0.7) ? 1.4 : -1.4;
      }

      an.heading += an.turn * dt;
      const sp = an.speed * speedMul;
      p.x += Math.sin(an.heading) * sp * dt;
      p.z += Math.cos(an.heading) * sp * dt;
      const clk = (this.clocks.get(an) ?? 0) + dt * (0.15 + 0.85 * Math.min(speedMul, 1.6)); // legs slow when it stops
      this.clocks.set(an, clk);
      const lift = an.tick(clk) || 0;
      const ground = heightAt(p.x, p.z);
      p.y = an.flying ? Math.max(ground, WATER_Y) + an.hover + Math.sin(this.animalTime * 0.6 + an.hover) * 0.8 + lift : ground + lift;
      an.group.rotation.y = an.heading;

      // ---- roars ----
      const r = an.roar;
      if (d > 60) r.noticed = false;
      else if (d < 30 && !r.noticed) { r.noticed = true; r.next = Math.min(r.next, 0.4 + Math.random()); } // roars when it first sees you
      r.next -= dt;
      if (r.next <= 0) {
        r.next = 14 + Math.random() * 28;
        if (d < 160) { r.timer = 1.4; this.onRoar?.(this.probe.set(p.x, p.y + (an.flying ? 0 : 2), p.z), an.name); }
      }
      const env = r.timer > 0 ? Math.sin(Math.PI * (1 - r.timer / 1.4)) : 0;
      if (r.timer > 0) r.timer -= dt;
      an.group.scale.setScalar(1 + 0.07 * env);

      // ---- head follows you ----
      if (an.head) {
        const near = d < 45;
        let ty = near ? THREE.MathUtils.clamp(delta, -1.3, 1.3) : 0;
        let tp = near ? THREE.MathUtils.clamp(Math.atan2(head.y - (p.y + (an.flying ? 0 : 1.8)), d), -0.6, 0.6) : 0;
        if (near && !attentive) { ty = lk.ay; tp = lk.ap; }                 // looks away
        const k = Math.min(1, dt * 4);
        an.look.yaw += (ty - an.look.yaw) * k; an.look.pitch += (tp - an.look.pitch) * k;
        an.head.rotation.y = an.look.yaw;
        if (an.yawOnly) an.head.rotation.x += -0.4 * env;   // neck rears back to roar
        else an.head.rotation.x = -an.look.pitch * 0.8 - 0.5 * env;
      }
    }
  }

  /** Live data for the map. */
  get trees(): readonly TreeRec[] { return this.treeRecs; }
  get creatures(): readonly Animal[] { return this.animals; }
  get podPosition(): THREE.Vector3 | null { return this.pod ? this.pod.position : null; }

  /**
   * Knock a tree down, away from `from`. It tips over in a second, lies there, and after 3 s
   * vanishes and `onWood` fires. Returns false if it was already felled.
   */
  fellTree(id: number, from: THREE.Vector3): boolean {
    const rec = this.treeRecs[id];
    if (!rec || rec.felled) return false;
    rec.felled = true;
    this.world.removeOwner(id);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.trunkMesh.setMatrixAt(rec.trunkIdx, zero); this.trunkMesh.instanceMatrix.needsUpdate = true;
    const fol = rec.pine ? this.pineMesh : this.canopyMesh;
    fol.setMatrixAt(rec.foliageIdx, zero); fol.instanceMatrix.needsUpdate = true;

    const group = new THREE.Group(); group.position.set(rec.x, rec.y, rec.z);
    const trunk = new THREE.Mesh(this.trunkMesh.geometry, this.trunkMesh.material);
    trunk.matrixAutoUpdate = false; trunk.matrix.copy(rec.trunkLocal);
    const leaves = new THREE.Mesh(fol.geometry, new THREE.MeshStandardMaterial({ color: rec.color, roughness: 0.75, flatShading: rec.pine }));
    leaves.matrixAutoUpdate = false; leaves.matrix.copy(rec.foliageLocal);
    group.add(trunk, leaves);
    this.group.add(group);

    const f = new THREE.Vector3(rec.x - from.x, 0, rec.z - from.z);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    // rotating about (f.z, 0, -f.x) tips the tree's up-vector toward f
    this.falling.push({ rec, group, t: 0, axis: new THREE.Vector3(f.z, 0, -f.x), landed: false });
    return true;
  }

  private updateFalling(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const k = Math.min(f.t / 1.0, 1);
      const bounce = f.t > 1 ? 0.07 * Math.max(0, 1 - (f.t - 1) * 4) * Math.abs(Math.sin((f.t - 1) * 18)) : 0;
      f.group.quaternion.setFromAxisAngle(f.axis, (Math.PI / 2) * k * k - bounce);
      f.group.position.y = f.rec.y + 0.35 * k * k;
      if (f.t >= 1 && !f.landed) { f.landed = true; this.onTreeLanded?.(new THREE.Vector3(f.rec.x, f.rec.y, f.rec.z)); }
      if (f.t >= 3) { // gone after 3 s: hand over the wood
        this.group.remove(f.group);
        ((f.group.children[1] as THREE.Mesh).material as THREE.Material).dispose();
        this.falling.splice(i, 1);
        this.onWood?.(Math.max(2, Math.round(f.rec.h / 3)) + (f.rec.pine ? 1 : 0), new THREE.Vector3(f.rec.x, f.rec.y + 2, f.rec.z));
      }
    }
  }

  /** Your escape pod, wedged in the ground a few metres behind where you landed. */
  placePod(head: THREE.Vector3, forward: THREE.Vector3): void {
    const back = new THREE.Vector3(-forward.x, 0, -forward.z).normalize();
    const x = head.x + back.x * 4.6, z = head.z + back.z * 4.6, y = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(back.x, back.z);

    // scorched crater and churned-up rim
    const crater = new THREE.Mesh(new THREE.CircleGeometry(2.4, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x241822, roughness: 1 }));
    crater.position.y = 0.05; g.add(crater);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 8, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a4a58, roughness: 1 }));
    rim.position.y = 0.12; rim.scale.y = 0.6; g.add(rim);

    // hull: capsule ~2.6 m long, 1.7 m wide (a bit bigger than a person), nose-down and half buried
    const hullGeo = new THREE.CapsuleGeometry(0.85, 0.9, 6, 20).rotateX(Math.PI / 2);
    const pp = hullGeo.attributes.position, hc: number[] = [], base = new THREE.Color(0xaab2c6), char = new THREE.Color(0x2e2528), c = new THREE.Color();
    for (let i = 0; i < pp.count; i++) { // soot toward the tail (toward you)
      c.copy(base).lerp(char, smoothstep(0.2, -1.1, pp.getZ(i)) * 0.9);
      hc.push(c.r, c.g, c.b);
    }
    hullGeo.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
    const hull = new THREE.Group(); hull.position.y = 0.6; hull.rotation.x = 0.32; g.add(hull);
    hull.add(new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 })));
    const metal = new THREE.MeshStandardMaterial({ color: 0x6f778c, metalness: 0.7, roughness: 0.4 });
    for (const z of [-0.7, 0, 0.7]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.035, 6, 24), metal); t.position.z = z; hull.add(t); }
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10).scale(1, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0x40e0ff, emissive: 0x30c8ff, emissiveIntensity: 1.3 }));
    win.position.set(0, 0.7, 0.3); hull.add(win);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a3a46, metalness: 0.6, roughness: 0.5 }));
    hatch.position.set(0.95, 0.35, 0.2); hatch.rotation.z = -0.9; hull.add(hatch);        // blown-open hatch
    for (const a of [0, 2.1, 4.2]) { // tail fins
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.55), metal);
      f.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, -1.25); f.rotation.z = a; hull.add(f);
    }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.3, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2428, metalness: 0.5, roughness: 0.6 }));
    nozzle.position.z = -1.45; hull.add(nozzle);
    const ember = new THREE.Mesh(new THREE.CircleGeometry(0.2, 14).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: 0xff7020, toneMapped: false }));
    ember.position.z = -1.61; hull.add(ember);

    // debris scattered around the impact
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4a4a58, metalness: 0.6, roughness: 0.5 }), 16);
    const m = new THREE.Matrix4(), rr = rngFrom(99);
    for (let i = 0; i < 16; i++) {
      const a = rr() * Math.PI * 2, r = 1.8 + rr() * 5, sz = 0.1 + rr() * 0.35;
      m.compose(new THREE.Vector3(Math.cos(a) * r, sz * 0.3, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr() * 3, rr() * 3, rr() * 3)), new THREE.Vector3(sz, sz * 0.5, sz * (1 + rr())));
      debris.setMatrixAt(i, m);
    }
    g.add(debris);

    // smoke plume
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sg = sc.getContext('2d')!, grad = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(90,80,95,0.9)'); grad.addColorStop(1, 'rgba(90,80,95,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(sc);
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.phase = i / 14; sp.position.set(0, 1, -1.2); g.add(sp); this.smoke.push(sp);
    }
    this.podLight = new THREE.PointLight(0xff8a40, 3, 12, 2); this.podLight.position.set(0, 0.8, -1.6); g.add(this.podLight);

    // solid enough to push off
    const axis = new THREE.Vector3(back.x * Math.cos(0.32), -Math.sin(0.32), back.z * Math.cos(0.32));
    for (const t of [-0.8, 0, 0.8]) this.world.addSphere(new THREE.Vector3(x, y + 0.6, z).addScaledVector(axis, t), 0.8, 0.3);
    this.world.finalize();
    this.pod = g;
    this.group.add(g);
  }

  private updatePod(dt: number, night: number): void {
    if (!this.pod) return;
    const t = this.animalTime;
    for (const sp of this.smoke) {
      const ph = (sp.userData.phase + t * 0.12) % 1; // 0..1 along its life
      sp.position.set(Math.sin(ph * 6 + sp.userData.phase * 9) * 0.3 + ph * 1.8, 1 + ph * 7, -1.2 + ph * 1.2);
      const sc = 0.7 + ph * 3.2; sp.scale.set(sc, sc, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.45;
    }
    if (this.podLight) this.podLight.intensity = (2 + night * 3) * (0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 5.3));
    void dt;
  }
}
