import * as THREE from 'three';

export interface Animal {
  group: THREE.Group;
  speed: number;       // m/s
  flying: boolean;
  hover: number;       // flight height
  tick(time: number, moving: boolean): void;
  heading: number;
  turn: number;        // current turn rate (rad/s)
}

type Rng = () => number;
const PALETTES: [number, number][] = [
  [0x35d0c0, 0x063a36], [0xff7ac8, 0x4a0a30], [0xffb04a, 0x4a2a00], [0x9a7bff, 0x1c0a4a], [0xb8ff5a, 0x1a3a00],
];

function mat(rng: Rng, glow = 0.35): THREE.MeshStandardMaterial {
  const [c, e] = PALETTES[Math.floor(rng() * PALETTES.length)];
  return new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: glow, roughness: 0.65 });
}
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
const pupil = new THREE.MeshStandardMaterial({ color: 0x110018 });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o;
}
function eye(size: number, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, y, z);
  g.add(mesh(new THREE.SphereGeometry(size, 10, 8), eyeWhite));
  g.add(mesh(new THREE.SphereGeometry(size * 0.5, 8, 6), pupil, 0, 0, size * 0.75));
  return g;
}
/** A leg that hangs from a pivot at the hip so rotation.x swings it. */
function leg(m: THREE.Material, len: number, r: number, x: number, y: number, z: number): THREE.Group {
  const p = new THREE.Group(); p.position.set(x, y, z);
  p.add(mesh(new THREE.CylinderGeometry(r, r * 0.7, len, 6).translate(0, -len / 2, 0), m));
  return p;
}

/** Long-necked four-legged grazer with three eyes. */
function longneck(rng: Rng): Animal {
  const body = mat(rng), g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.7, 14, 10).scale(1.3, 0.9, 1), body, 0, 1.6, 0));
  const legs = [[-0.5, 0.55], [0.5, -0.55], [0.5, 0.55], [-0.5, -0.55]].map(([x, z]) => {
    const l = leg(body, 1.5, 0.11, x, 1.5, z); g.add(l); return l;
  });
  const neck = new THREE.Group(); neck.position.set(0, 1.9, 0.8); g.add(neck);
  for (let i = 0; i < 6; i++) neck.add(mesh(new THREE.SphereGeometry(0.28 - i * 0.025, 10, 8), body, 0, i * 0.45, i * 0.08));
  const head = new THREE.Group(); head.position.set(0, 2.9, 0.55); neck.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.34, 12, 10).scale(1, 0.9, 1.3), body));
  head.add(eye(0.1, -0.2, 0.12, 0.3), eye(0.1, 0.2, 0.12, 0.3), eye(0.08, 0, 0.3, 0.25));
  g.add(mesh(new THREE.ConeGeometry(0.2, 1.2, 8).rotateX(-Math.PI / 2.4), body, 0, 1.4, -1.2));
  const ph = rng() * 6;
  return { group: g, speed: 0.9, flying: false, hover: 0, heading: 0, turn: 0,
    tick(t, moving) {
      const k = moving ? 0.55 : 0.05;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 3 + (i % 2 ? Math.PI : 0) + ph) * k; });
      neck.rotation.x = Math.sin(t * 0.8 + ph) * 0.15; neck.rotation.z = Math.sin(t * 0.5 + ph) * 0.12;
    } };
}

/** Tall stilt-walker with one huge eye and six floppy arms. */
function stilter(rng: Rng): Animal {
  const body = mat(rng, 0.5), g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.65, 14, 10), body, 0, 3.6, 0));
  g.add(eye(0.3, 0, 3.7, 0.45));
  const legs = [-0.25, 0.25].map(x => { const l = leg(body, 3.4, 0.05, x, 3.3, 0); g.add(l); return l; });
  const arms = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    const p = new THREE.Group(); p.position.set(Math.cos(a) * 0.55, 3.6, Math.sin(a) * 0.55); p.rotation.y = -a;
    p.add(mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.4, 5).rotateZ(Math.PI / 2).translate(0.7, 0, 0), body));
    g.add(p); return p;
  });
  const ph = rng() * 6;
  return { group: g, speed: 1.4, flying: false, hover: 0, heading: 0, turn: 0,
    tick(t, moving) {
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2.2 + i * Math.PI + ph) * (moving ? 0.45 : 0.03); });
      arms.forEach((a, i) => { a.rotation.z = Math.sin(t * 2 + i + ph) * 0.5 - 0.2; });
      g.position.y = 0;
    } };
}

/** Segmented glow-worm with two bulb antennae. */
function worm(rng: Rng): Animal {
  const body = mat(rng, 0.45), g = new THREE.Group();
  const segs: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = mesh(new THREE.SphereGeometry(0.5 - i * 0.03, 12, 8), body, 0, 0.5, -i * 0.62);
    g.add(s); segs.push(s);
  }
  segs[0].add(eye(0.14, -0.2, 0.2, 0.35), eye(0.14, 0.2, 0.2, 0.35));
  const bulb = new THREE.MeshStandardMaterial({ color: 0xfff1a0, emissive: 0xffe060, emissiveIntensity: 1.6 });
  for (const x of [-0.18, 0.18]) {
    segs[0].add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), body, x, 0.7, 0.1));
    segs[0].add(mesh(new THREE.SphereGeometry(0.1, 8, 6), bulb, x, 1.2, 0.1));
  }
  const ph = rng() * 6;
  return { group: g, speed: 0.7, flying: false, hover: 0, heading: 0, turn: 0,
    tick(t) { segs.forEach((s, i) => { s.position.y = 0.5 + Math.sin(t * 3 - i * 0.8 + ph) * 0.14; s.position.x = Math.sin(t * 1.6 - i * 0.5 + ph) * 0.2; }); } };
}

/** Drifting jellyfish balloon with trailing tentacles. */
function floater(rng: Rng): Animal {
  const [c, e] = PALETTES[Math.floor(rng() * PALETTES.length)];
  const bell = new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 1.1, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(1.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), bell));
  const tents = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const p = new THREE.Group(); p.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    p.add(mesh(new THREE.CylinderGeometry(0.03, 0.01, 2.6 + rng(), 4).translate(0, -1.4, 0), bell));
    g.add(p); return p;
  });
  const ph = rng() * 6;
  return { group: g, speed: 0.8, flying: true, hover: 4 + rng() * 3, heading: 0, turn: 0,
    tick(t) { tents.forEach((p, i) => { p.rotation.x = Math.sin(t * 1.5 + i + ph) * 0.2; p.rotation.z = Math.cos(t * 1.2 + i * 2 + ph) * 0.2; });
      g.scale.y = 1 + Math.sin(t * 2 + ph) * 0.08; } };
}

export const SPECIES = [longneck, stilter, worm, floater];
export function makeAnimal(kind: number, rng: Rng): Animal { return SPECIES[kind % SPECIES.length](rng); }
