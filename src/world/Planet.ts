import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Animal, makeAnimal } from './Animals';

export const DAY_SECONDS = 7 * 60;
export const NIGHT_SECONDS = 5 * 60;
const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
const SKY_R = 1500;

function rngFrom(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function groundTexture(rng: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a4fb0'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const h = 285 + rng() * 60, l = 35 + rng() * 30;
    g.fillStyle = `hsl(${h} ${55 + rng() * 30}% ${l}%)`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(700, 700); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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

/** The alien planet: flat pink-purple fields, spaced trees, strange animals, Saturn as the sun. */
export class Planet {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  /** Seconds since landing plus the starting offset (so you arrive mid-morning). */
  clock = 40;

  private celestial = new THREE.Group();   // follows the player so the sky is infinitely far
  private saturn = new THREE.Group();
  private moon: THREE.Mesh;
  private stars: THREE.Points;
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
    this.world.hull = false; this.world.groundY = 0; this.world.groundSlip = 0.1;

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4200, 4200).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: groundTexture(rng), roughness: 1 }),
    );
    this.group.add(ground);

    this.buildGrass(rng);
    this.buildTrees(rng);
    this.buildMountains(rng);
    this.buildAnimals(rng);

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
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.celestial.add(this.stars);

    this.group.add(this.celestial, this.sun, this.sun.target, this.hemi);
  }

  private buildGrass(rng: () => number): void {
    const N = 12000;
    const geo = new THREE.ConeGeometry(0.07, 0.75, 3, 1).translate(0, 0.375, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2, r = 1.5 + Math.pow(rng(), 1.5) * 110; // denser near the landing spot, clear right at the feet
      e.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4);
      const s = 0.5 + rng() * 0.6;
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q.setFromEuler(e), new THREE.Vector3(s, s * (0.8 + rng() * 0.6), s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHSL(0.76 + rng() * 0.2, 0.55 + rng() * 0.3, 0.42 + rng() * 0.22));
    }
    this.group.add(mesh);
  }

  private buildTrees(rng: () => number): void {
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.46, 1, 8).translate(0, 0.5, 0);
    const canopyGeo = new THREE.SphereGeometry(1, 16, 12);
    const spots: { x: number; z: number; h: number; cr: number; c: number }[] = [];
    for (let tries = 0; tries < 900 && spots.length < 48; tries++) {
      const a = rng() * Math.PI * 2, r = 14 + rng() * 150;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < 15)) continue; // keep trees separated
      spots.push({ x, z, h: 6 + rng() * 5, cr: 2.2 + rng() * 1.4, c: Math.floor(rng() * 4) });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x9a8fb8, roughness: 0.95 }), spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), spots.length);
    const palette = [0x2fd1c1, 0xff6fb5, 0xffa940, 0x7d6bff];
    const m = new THREE.Matrix4(), col = new THREE.Color();
    spots.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion(), new THREE.Vector3(s.h * 0.1 + 0.6, s.h, s.h * 0.1 + 0.6));
      trunks.setMatrixAt(i, m);
      const cy = s.h + s.cr * 0.35;
      m.compose(new THREE.Vector3(s.x, cy, s.z), new THREE.Quaternion(), new THREE.Vector3(s.cr, s.cr * 0.8, s.cr));
      canopies.setMatrixAt(i, m);
      canopies.setColorAt(i, col.set(palette[s.c]));
      this.world.addCylinder(s.x, s.z, 0, s.h, (s.h * 0.1 + 0.6) * 0.38, 0);      // bark: grippy
      this.world.addSphere(new THREE.Vector3(s.x, cy, s.z), s.cr * 0.85, 0.2);     // leafy canopy
      this.trees.push({ x: s.x, z: s.z });
    });
    this.group.add(trunks, canopies);
  }

  private buildMountains(rng: () => number): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a3f8c, roughness: 1, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rng() * 0.2, r = 900 + rng() * 500, h = 160 + rng() * 380;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * (0.5 + rng() * 0.4), h, 6 + Math.floor(rng() * 3)), mat);
      m.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
      this.group.add(m);
    }
  }

  private buildAnimals(rng: () => number): void {
    for (let i = 0; i < 16; i++) {
      const an = makeAnimal(i, rng);
      const a = rng() * Math.PI * 2, r = 18 + rng() * 120;
      an.group.position.set(Math.cos(a) * r, an.flying ? an.hover : 0, Math.sin(a) * r);
      an.heading = rng() * Math.PI * 2;
      this.animals.push(an);
      this.group.add(an.group);
    }
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
    (this.stars.material as THREE.PointsMaterial).opacity = Math.pow(1 - day, 1.5);

    const sky = this.tmpCol.copy(this.skyNight).lerp(this.skyDay, day).lerp(this.skyDusk, dusk * 0.55 * (day > 0.02 ? 1 : 0.5));
    scene.background = sky.clone();
    if (!scene.fog) scene.fog = new THREE.FogExp2(sky.getHex(), 0.0016);
    (scene.fog as THREE.FogExp2).color.copy(sky);

    this.sun.position.copy(follow).addScaledVector(dir, 300);
    this.sun.target.position.copy(follow);
    this.sun.intensity = 2.3 * day;
    this.hemi.intensity = 0.3 + 0.9 * day;

    this.updateAnimals(dt);
  }

  private updateAnimals(dt: number): void {
    for (const an of this.animals) {
      an.turn += (Math.random() - 0.5) * 1.5 * dt;
      an.turn = THREE.MathUtils.clamp(an.turn, -0.6, 0.6) * (1 - 0.5 * dt);
      const p = an.group.position;
      if (p.length() > 140) { // steer back toward the middle
        const want = Math.atan2(-p.x, -p.z);
        an.turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(want - an.heading), Math.cos(want - an.heading)), -1, 1);
      }
      for (const t of this.trees) { // dodge trunks
        const dx = p.x - t.x, dz = p.z - t.z;
        if (dx * dx + dz * dz < 16) { an.turn += 1.6 * dt * (Math.sin(an.heading) * dz - Math.cos(an.heading) * dx > 0 ? 1 : -1) * 6; }
      }
      an.heading += an.turn * dt;
      p.x += Math.sin(an.heading) * an.speed * dt;
      p.z += Math.cos(an.heading) * an.speed * dt;
      p.y = an.flying ? an.hover + Math.sin(this.animalTime * 0.6 + an.hover) * 0.8 : 0;
      an.group.rotation.y = an.heading;
      an.tick(this.animalTime, true);
    }
  }
}
