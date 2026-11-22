import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Animal, makeGround, makeFlyer } from './Animals';
import { heightAt, buildTerrainMesh, WATER_Y } from './Terrain';

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
  private trees: { x: number; z: number }[] = [];
  private animalTime = 0;
  private tmpCol = new THREE.Color();
  private skyDay = new THREE.Color(0xb79af0);
  private skyDusk = new THREE.Color(0xff8a6a);
  private skyNight = new THREE.Color(0x070618);

  constructor(seed = 7) {
    const rng = rngFrom(seed);
    this.world.hull = false; this.world.heightFn = heightAt; this.world.groundSlip = 0.1;

    this.group.add(buildTerrainMesh(groundTexture(rng)));
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2ad8d0, emissive: 0x0a6a74, emissiveIntensity: 0.7, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.2 }),
    );
    this.water.position.y = WATER_Y;
    this.group.add(this.water);

    this.buildGrass(rng);
    this.buildTrees(rng);
    this.buildCrystals(rng);
    this.buildFloatingRocks(rng);
    this.buildMushrooms(rng);
    this.buildMountains(rng);
    this.buildAnimals(rng);

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
      if (h > minH) return { x, z, h };
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
      if (y < ABOVE_WATER - 0.4) continue;
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

  private buildTrees(rng: () => number): void {
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.46, 1, 8).translate(0, 0.5, 0);
    const canopyGeo = new THREE.SphereGeometry(1, 16, 12);
    const spots: { x: number; z: number; y: number; h: number; cr: number; c: number }[] = [];
    for (let tries = 0; tries < 1200 && spots.length < 52; tries++) {
      const p = this.dryPoint(rng, 14, 170, ABOVE_WATER + 0.5);
      if (spots.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 15)) continue; // keep trees separated
      spots.push({ x: p.x, z: p.z, y: p.h, h: 6 + rng() * 5, cr: 2.2 + rng() * 1.4, c: Math.floor(rng() * 4) });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x9a8fb8, roughness: 0.95 }), spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), spots.length);
    const palette = [0x2fd1c1, 0xff6fb5, 0xffa940, 0x7d6bff];
    const m = new THREE.Matrix4(), col = new THREE.Color();
    spots.forEach((s, i) => {
      const w = s.h * 0.1 + 0.6;
      m.compose(new THREE.Vector3(s.x, s.y - 1.5, s.z), new THREE.Quaternion(), new THREE.Vector3(w, s.h + 1.5, w)); // sunk in so slopes don't show a gap
      trunks.setMatrixAt(i, m);
      const cy = s.y + s.h + s.cr * 0.35;
      m.compose(new THREE.Vector3(s.x, cy, s.z), new THREE.Quaternion(), new THREE.Vector3(s.cr, s.cr * 0.8, s.cr));
      canopies.setMatrixAt(i, m);
      canopies.setColorAt(i, col.set(palette[s.c]));
      this.world.addCylinder(s.x, s.z, s.y - 1.5, s.y + s.h, w * 0.38, 0);        // bark: grippy
      this.world.addSphere(new THREE.Vector3(s.x, cy, s.z), s.cr * 0.85, 0.2);     // leafy canopy
      this.trees.push({ x: s.x, z: s.z });
    });
    this.group.add(trunks, canopies);
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
      const a = (i / 34) * Math.PI * 2 + rng() * 0.15, r = 800 + rng() * 1100, h = 220 + rng() * 520;
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

  update(dt: number, scene: THREE.Scene, follow: THREE.Vector3): void {
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
    this.updateAnimals(dt, follow);
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

  private updateAnimals(dt: number, follow: THREE.Vector3): void {
    for (const an of this.animals) {
      const p = an.group.position;
      const far = Math.hypot(p.x - follow.x, p.z - follow.z) > 220;
      an.group.visible = !far;
      if (far && !an.flying) { /* keep walking logic cheap: freeze far ground animals */ continue; }

      if (an.turnBias) an.turn = an.turnBias + (Math.random() - 0.5) * 0.1;
      else {
        an.turn += (Math.random() - 0.5) * 1.5 * dt;
        an.turn = THREE.MathUtils.clamp(an.turn, -0.6, 0.6) * (1 - 0.5 * dt);
      }
      if (Math.hypot(p.x, p.z) > 160) { // steer back toward the middle
        const want = Math.atan2(-p.x, -p.z);
        an.turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(want - an.heading), Math.cos(want - an.heading)), -1, 1);
      }
      if (!an.flying) {
        for (const t of this.trees) { // dodge trunks
          const dx = p.x - t.x, dz = p.z - t.z;
          if (dx * dx + dz * dz < 16) an.turn += 9.6 * dt * (Math.sin(an.heading) * dz - Math.cos(an.heading) * dx > 0 ? 1 : -1);
        }
        // look ahead: turn away from lakes
        const ax = p.x + Math.sin(an.heading) * 5, az = p.z + Math.cos(an.heading) * 5;
        if (heightAt(ax, az) < ABOVE_WATER) an.turn = 1.2;
      }
      an.heading += an.turn * dt;
      p.x += Math.sin(an.heading) * an.speed * dt;
      p.z += Math.cos(an.heading) * an.speed * dt;
      const lift = an.tick(this.animalTime) || 0;
      const ground = heightAt(p.x, p.z);
      p.y = an.flying ? Math.max(ground, WATER_Y) + an.hover + Math.sin(this.animalTime * 0.6 + an.hover) * 0.8 + lift : ground + lift;
      an.group.rotation.y = an.heading;
    }
  }
}
