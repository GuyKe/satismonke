import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Animal {
  name: string;
  group: THREE.Group;
  speed: number;       // m/s
  flying: boolean;
  hover: number;       // flight height above ground
  heading: number;
  turn: number;        // current turn rate (rad/s)
  turnBias: number;    // constant turn (birds circle)
  /** Animate; may return a vertical lift (hops). */
  tick(time: number): number | void;
  /** Personality drives how it reacts to the player (see Planet.behave). */
  mood: 'curious' | 'shy' | 'skittish' | 'defensive' | 'wary' | 'friendly';
  /** Part that turns to look at the player; null = the whole body does the looking. */
  head: THREE.Object3D | null;
  /** Neck-style heads only yaw (their tick already animates pitch). */
  yawOnly: boolean;
  /** Smoothed head angles and roar bookkeeping, owned by Planet. */
  look: { yaw: number; pitch: number; away: boolean; timer: number; ay: number; ap: number };
  roar: { timer: number; next: number; noticed: boolean };
  /** Lives in lakes and rivers. */
  water?: boolean;
  /** Only comes out at night. */
  nocturnal?: boolean;
  /** Follows a herd/school leader. */
  leader?: Animal | null;
  /** Drawn to campfires and lamps. */
  moth?: boolean;
  /** Fish that leap out of the water now and then. */
  leaps?: boolean;
}
const base = () => ({ look: { yaw: 0, pitch: 0, away: false, timer: 3 + Math.random() * 5, ay: 0, ap: 0 }, roar: { timer: 0, next: 8 + Math.random() * 25, noticed: false } });

type Rng = () => number;
type V3 = [number, number, number];

// [main, accent, belly]
const SCHEMES: [number, number, number][] = [
  [0x2fbfb0, 0xff7ac8, 0xc8fff0], [0xff6fb5, 0xffd45a, 0xffd8ec], [0xffa940, 0x6b3bff, 0xffe6b8],
  [0x8a6bff, 0x44f0d0, 0xd8ccff], [0xa8e84a, 0xff5a8a, 0xf0ffc0], [0x4aa8ff, 0xffe25a, 0xd0ecff],
];
const pick = <T>(rng: Rng, a: T[]) => a[Math.floor(rng() * a.length)];

// Shared materials: every body part is baked into vertex-coloured merged meshes to keep draw calls low.
const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

interface Opt { p?: V3; r?: V3; s?: V3; glow?: boolean }

/** Collects coloured primitives and merges them into one body mesh + one glow mesh. */
class Builder {
  private solid: THREE.BufferGeometry[] = [];
  private lit: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private c = new THREE.Color();

  add(geo: THREE.BufferGeometry, color: number, o: Opt = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    this.e.set(...(o.r ?? [0, 0, 0] as V3)); this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(...(o.p ?? [0, 0, 0] as V3)), this.q, new THREE.Vector3(...(o.s ?? [1, 1, 1] as V3)));
    g.applyMatrix4(this.m);
    this.c.set(color);
    const n = g.attributes.normal, count = g.attributes.position.count, arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const k = o.glow ? 1 : 0.7 + 0.3 * (n.getY(i) * 0.5 + 0.5); // lighter on top
      arr[i * 3] = this.c.r * k; arr[i * 3 + 1] = this.c.g * k; arr[i * 3 + 2] = this.c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    (o.glow ? this.lit : this.solid).push(g);
    return this;
  }

  into(parent: THREE.Object3D): THREE.Object3D {
    if (this.solid.length) parent.add(new THREE.Mesh(mergeGeometries(this.solid)!, BODY));
    if (this.lit.length) parent.add(new THREE.Mesh(mergeGeometries(this.lit)!, GLOW));
    return parent;
  }
}

const S = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const C = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
const K = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const T = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 14);

/** A group at `at` whose contents come from `fn`: used for animated limbs. */
function limb(parent: THREE.Object3D, at: V3, fn: (b: Builder) => void): THREE.Group {
  const g = new THREE.Group(); g.position.set(...at);
  const b = new Builder(); fn(b); b.into(g);
  parent.add(g);
  return g;
}

/** Eyes: white ball + dark pupil, drawn in the glow batch so they stay bright. */
function eyes(b: Builder, spots: [number, number, number, number][]): void {
  for (const [x, y, z, r] of spots) {
    b.add(S(r, 10, 8), 0xffffff, { p: [x, y, z], glow: true });
    b.add(S(r * 0.5, 8, 6), 0x1a0030, { p: [x, y, z + r * 0.8], glow: true });
  }
}

/** Hanging leg with thigh, shin and foot, pivoting at the hip. */
function legBuild(b: Builder, color: number, accent: number, len: number, r: number, foot = 0.16): void {
  b.add(C(r, r * 0.8, len * 0.5), color, { p: [0, -len * 0.25, 0] })
   .add(S(r * 0.95), accent, { p: [0, -len * 0.5, 0] })
   .add(C(r * 0.75, r * 0.5, len * 0.5), color, { p: [0, -len * 0.75, 0] })
   .add(S(foot, 8, 6), accent, { p: [0, -len, foot * 0.4], s: [1, 0.6, 1.4] });
}

function longneck(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.75, 14, 10), main, { p: [0, 1.7, 0], s: [1.3, 0.9, 1] })
   .add(S(0.6, 12, 8), belly, { p: [0, 1.42, 0.05], s: [1.2, 0.6, 0.9] });
  for (let i = 0; i < 6; i++) b.add(K(0.14, 0.4 - i * 0.03), acc, { p: [0, 2.3 - Math.abs(i - 2.5) * 0.04, -0.7 + i * 0.28] });
  for (let i = 0; i < 7; i++) b.add(S(0.12 + rng() * 0.07, 6, 5), acc, { p: [(rng() > 0.5 ? 1 : -1) * (0.62 + rng() * 0.2), 1.6 + rng() * 0.5, -0.5 + rng() * 1.0], s: [0.4, 1, 1] });
  for (let i = 0; i < 4; i++) b.add(S(0.26 - i * 0.05, 8, 6), main, { p: [0, 1.7 - i * 0.12, -1.1 - i * 0.38] });
  b.add(S(0.14, 8, 6), 0xffe680, { p: [0, 1.4, -2.7], glow: true });
  b.into(g);
  const legs = [[-0.55, 0.6], [0.55, -0.6], [0.55, 0.6], [-0.55, -0.6]].map(([x, z]) =>
    limb(g, [x, 1.55, z], lb => legBuild(lb, main, acc, 1.55, 0.13)));
  const neck = limb(g, [0, 1.95, 0.85], nb => {
    for (let i = 0; i < 7; i++) {
      nb.add(S(0.3 - i * 0.02, 10, 8), main, { p: [0, i * 0.42, i * 0.07] });
      if (i > 0) nb.add(K(0.07, 0.3 + (i % 2) * 0.1), acc, { p: [0, i * 0.42 + 0.2, i * 0.07 - 0.3], r: [-0.5, 0, 0] });
    }
    nb.add(S(0.36, 12, 10), main, { p: [0, 3.05, 0.5], s: [1, 0.85, 1.35] })
      .add(S(0.18, 8, 6), belly, { p: [0, 2.95, 0.95], s: [1, 0.8, 1.2] })
      .add(K(0.1, 0.55), acc, { p: [-0.18, 3.45, 0.3], r: [-0.3, 0, 0.3] })
      .add(K(0.1, 0.55), acc, { p: [0.18, 3.45, 0.3], r: [-0.3, 0, -0.3] })
      .add(K(0.12, 0.3), main, { p: [-0.34, 3.2, 0.2], r: [0, 0, 1.2] })
      .add(K(0.12, 0.3), main, { p: [0.34, 3.2, 0.2], r: [0, 0, -1.2] });
    eyes(nb, [[-0.22, 3.18, 0.78, 0.1], [0.22, 3.18, 0.78, 0.1], [0, 3.38, 0.7, 0.08]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'curious', head: neck, yawOnly: true,
    name: 'longneck', group: g, speed: 0.9, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 3 + (i % 2 ? Math.PI : 0) + ph) * 0.5; });
      neck.rotation.x = Math.sin(t * 0.8 + ph) * 0.15; neck.rotation.z = Math.sin(t * 0.5 + ph) * 0.12;
    } };
}

function stilter(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const top = limb(g, [0, 3.7, 0], b => {
    b.add(S(0.7, 14, 10), main);
    for (let i = 0; i < 3; i++) b.add(T(0.62 - Math.abs(i - 1) * 0.15, 0.05), acc, { p: [0, -0.2 + i * 0.22, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.add(K(0.05, 0.6 + rng() * 0.4, 4), acc, { p: [Math.cos(a) * 0.25, 0.8, Math.sin(a) * 0.25], r: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4] }); }
    b.add(S(0.34, 12, 10), 0xffffff, { p: [0, 0.1, 0.5], glow: true })
     .add(S(0.17, 10, 8), 0x2a0050, { p: [0, 0.1, 0.78], glow: true })
     .add(S(0.07, 6, 5), 0xff80ff, { p: [0.05, 0.15, 0.88], glow: true })
     .add(S(0.45, 10, 8), belly, { p: [0, -0.45, 0], s: [1, 0.6, 1] });
  });
  const legs = [-0.28, 0.28].map(x => limb(g, [x, 3.2, 0], lb => legBuild(lb, main, acc, 3.2, 0.06, 0.3)));
  const arms = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    const p = limb(g, [Math.cos(a) * 0.6, 3.7, Math.sin(a) * 0.6], ab => {
      ab.add(C(0.05, 0.035, 0.8, 5), main, { p: [0.4, 0, 0], r: [0, 0, Math.PI / 2] })
        .add(S(0.07, 6, 5), acc, { p: [0.8, 0, 0] })
        .add(C(0.035, 0.02, 0.7, 5), main, { p: [1.15, 0, 0], r: [0, 0, Math.PI / 2] })
        .add(S(0.12, 8, 6), acc, { p: [1.55, 0, 0], s: [1, 0.4, 1] });
    });
    p.rotation.y = -a; return p;
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'shy', head: top, yawOnly: false,
    name: 'stilter', group: g, speed: 1.4, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2.2 + i * Math.PI + ph) * 0.45; });
      arms.forEach((a, i) => { a.rotation.z = Math.sin(t * 2 + i + ph) * 0.5 - 0.2; });
    } };
}

function worm(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const segs: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.5 - i * 0.025;
    segs.push(limb(g, [0, 0.5, -i * 0.65], sb => {
      sb.add(S(r, 12, 9), i % 2 ? main : belly, { s: [1, 0.9, 1.15] })
        .add(K(0.1, 0.35), acc, { p: [0, r * 0.85, 0] });
      sb.add(K(0.07, 0.35, 5), acc, { p: [-r * 0.9, -r * 0.4, 0], r: [0, 0, 0.9] })
        .add(K(0.07, 0.35, 5), acc, { p: [r * 0.9, -r * 0.4, 0], r: [0, 0, -0.9] });
    }));
  }
  const head = limb(segs[0], [0, 0.1, 0.35], hb => {
    hb.add(S(0.32, 10, 8), main, { p: [0, 0, 0.2], s: [1, 0.9, 1.1] })
      .add(C(0.025, 0.025, 0.9, 4), acc, { p: [-0.2, 0.7, 0.2], r: [0.25, 0, 0.2] })
      .add(C(0.025, 0.025, 0.9, 4), acc, { p: [0.2, 0.7, 0.2], r: [0.25, 0, -0.2] })
      .add(S(0.12, 8, 6), 0xfff1a0, { p: [-0.28, 1.15, 0.3], glow: true })
      .add(S(0.12, 8, 6), 0xfff1a0, { p: [0.28, 1.15, 0.3], glow: true });
    eyes(hb, [[-0.2, 0.15, 0.45, 0.1], [0.2, 0.15, 0.45, 0.1]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'wary', head, yawOnly: false,
    name: 'worm', group: g, speed: 0.7, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      segs.forEach((s, i) => { s.position.y = 0.5 + Math.sin(t * 3 - i * 0.8 + ph) * 0.14; s.position.x = Math.sin(t * 1.6 - i * 0.5 + ph) * 0.2; });
    } };
}

/** Big-eared hopper with strong hind legs. Hops. */
function hopper(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.6, 12, 10), main, { p: [0, 1.0, 0], s: [0.9, 1.15, 1.1], r: [0.4, 0, 0] })
   .add(S(0.42, 10, 8), belly, { p: [0, 0.95, 0.2], s: [0.9, 1, 0.8] });
  for (let i = 0; i < 5; i++) b.add(S(0.13, 6, 5), acc, { p: [(i % 2 ? 1 : -1) * 0.38, 0.9 + rng() * 0.5, -0.1 + rng() * 0.3], s: [0.4, 1, 1] });
  for (let i = 0; i < 4; i++) b.add(S(0.2 - i * 0.04, 8, 6), main, { p: [0, 0.6 - i * 0.14, -0.7 - i * 0.28] });
  b.add(S(0.17, 8, 6), 0xffe680, { p: [0, 0.1, -1.7], glow: true });
  b.into(g);
  const head = limb(g, [0, 1.7, 0.3], hb => {
    hb.add(S(0.36, 10, 8), main, { p: [0, 0.05, 0.05], s: [1, 0.9, 1.1] })
      .add(S(0.16, 8, 6), acc, { p: [0, -0.05, 0.4], s: [1.1, 0.8, 1] })
      .add(K(0.14, 1.0), main, { p: [-0.2, 0.7, -0.1], r: [0, 0, 0.25] })
      .add(K(0.1, 0.7), acc, { p: [-0.2, 0.65, -0.05], r: [0, 0, 0.25] })
      .add(K(0.14, 1.0), main, { p: [0.2, 0.7, -0.1], r: [0, 0, -0.25] })
      .add(K(0.1, 0.7), acc, { p: [0.2, 0.65, -0.05], r: [0, 0, -0.25] });
    eyes(hb, [[-0.17, 0.15, 0.32, 0.1], [0.17, 0.15, 0.32, 0.1]]);
  });
  const hind = [-0.35, 0.35].map(x => limb(g, [x, 0.9, -0.1], lb => {
    lb.add(S(0.28, 8, 6), main, { s: [0.8, 1.2, 1] }).add(C(0.1, 0.07, 0.9), main, { p: [0, -0.5, 0.15], r: [-0.5, 0, 0] })
      .add(S(0.18, 8, 6), acc, { p: [0, -0.95, 0.5], s: [1, 0.5, 2] });
  }));
  const arms = [-0.4, 0.4].map(x => limb(g, [x, 1.35, 0.35], ab => {
    ab.add(C(0.06, 0.04, 0.55, 5), main, { p: [0, -0.28, 0.1], r: [-0.4, 0, 0] }).add(S(0.07, 6, 5), acc, { p: [0, -0.55, 0.2] });
  }));
  const ph = rng() * 6;
  return { ...base(), mood: 'skittish', head, yawOnly: false,
    name: 'hopper', group: g, speed: 2.2, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      const hop = Math.abs(Math.sin(t * 3 + ph));
      hind.forEach(l => { l.rotation.x = -hop * 0.7 + 0.2; });
      arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 3 + ph + i) * 0.3; });
      return hop * 1.1;
    } };
}

/** Armoured six-legged crawler with eye stalks. */
function crawler(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(1.0, 16, 10), belly, { p: [0, 0.7, 0], s: [1.3, 0.5, 1.5] })
   .add(new THREE.SphereGeometry(1.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main, { p: [0, 0.8, 0], s: [1.2, 0.95, 1.4] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, rr = i < 6 ? 0.55 : 1.0, h = i < 6 ? 1.62 : 1.0;
    b.add(S(0.28, 6, 5), acc, { p: [Math.cos(a) * rr * 1.2, h - (i < 6 ? 0 : rr * 0.12), Math.sin(a) * rr * 1.4], s: [1, 0.4, 1] });
  }
  b.add(K(0.18, 0.6), acc, { p: [0, 1.95, 0] });
  b.into(g);
  const head = limb(g, [0, 0.75, 1.6], hb => {
    hb.add(S(0.42, 10, 8), main, { s: [1, 0.85, 1.1] })
      .add(C(0.03, 0.03, 0.5, 4), acc, { p: [-0.2, 0.45, 0.2] }).add(C(0.03, 0.03, 0.5, 4), acc, { p: [0.2, 0.45, 0.2] });
    eyes(hb, [[-0.2, 0.75, 0.2, 0.13], [0.2, 0.75, 0.2, 0.13]]);
  });
  const legs = [-1, 0, 1].flatMap(zi => [-1, 1].map(side =>
    limb(g, [side * 1.1, 0.65, zi * 0.8], lb => {
      lb.add(C(0.09, 0.07, 0.7, 5), main, { p: [side * 0.3, -0.1, 0], r: [0, 0, side * 1.1] })
        .add(C(0.07, 0.04, 0.7, 5), main, { p: [side * 0.6, -0.5, 0] })
        .add(S(0.1, 6, 5), acc, { p: [side * 0.6, -0.85, 0], s: [1, 0.5, 1.3] });
    })));
  const ph = rng() * 6;
  return { ...base(), mood: 'defensive', head, yawOnly: false,
    name: 'crawler', group: g, speed: 0.6, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 4 + (i % 2) * Math.PI + i + ph) * 0.18; l.rotation.x = Math.cos(t * 4 + i + ph) * 0.2; }); } };
}

/** Translucent glowing jellyfish balloon. */
function floater(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const bell = new THREE.MeshStandardMaterial({ color: main, emissive: main, emissiveIntensity: 0.55, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), bell);
  g.add(dome);
  const b = new Builder();
  b.add(S(0.45, 10, 8), belly, { p: [0, 0.35, 0], glow: true });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(S(0.1, 6, 5), acc, { p: [Math.cos(a) * 1.28, 0.05, Math.sin(a) * 1.28], glow: true }); }
  b.into(g);
  const tents = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2, len = 2.4 + rng() * 1.2;
    return limb(g, [Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9], tb => {
      for (let k = 0; k < 4; k++) tb.add(C(0.04 - k * 0.007, 0.036 - k * 0.007, len / 4, 4), k % 2 ? acc : main, { p: [0, -(k + 0.5) * len / 4, 0] });
    });
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'curious', head: null, yawOnly: false,
    name: 'floater', group: g, speed: 0.8, flying: true, hover: 4 + rng() * 4, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      tents.forEach((p, i) => { p.rotation.x = Math.sin(t * 1.5 + i + ph) * 0.25; p.rotation.z = Math.cos(t * 1.2 + i * 2 + ph) * 0.25; });
      dome.scale.y = 1 + Math.sin(t * 2 + ph) * 0.1;
    } };
}

/** A flat wing panel: root at the origin, extending along +x. */
function wingMesh(span: number, chord: number, color: number, opacity = 1, sweep = 0.3): THREE.Mesh {
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, chord / 2), new THREE.Vector3(0, 0, -chord / 2), new THREE.Vector3(span, 0, -chord * sweep),
    new THREE.Vector3(0, 0, chord / 2), new THREE.Vector3(span, 0, -chord * sweep), new THREE.Vector3(span * 0.85, 0, chord * 0.1),
  ]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, transparent: opacity < 1, opacity, roughness: 0.6 }));
}

/** Huge gliding manta with flapping wings and a long tail. */
function manta(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(1.0, 14, 10), main, { s: [1, 0.35, 1.7] })
   .add(S(0.7, 12, 8), belly, { p: [0, -0.1, 0.2], s: [1, 0.3, 1.5] })
   .add(K(0.3, 0.9, 5), acc, { p: [-0.5, 0.05, 1.9], r: [Math.PI / 2, 0, 0] })
   .add(K(0.3, 0.9, 5), acc, { p: [0.5, 0.05, 1.9], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 9; i++) b.add(S(0.14 - i * 0.012, 6, 5), i % 2 ? acc : main, { p: [0, 0, -1.7 - i * 0.55] });
  b.add(S(0.12, 6, 5), 0xfff0a0, { p: [0, 0, -6.8], glow: true });
  for (let i = 0; i < 6; i++) b.add(S(0.09, 6, 5), 0xfff0a0, { p: [(i % 2 ? 1 : -1) * (0.3 + i * 0.12), 0.32, 0.4 - i * 0.2], glow: true });
  eyes(b, [[-0.35, 0.18, 1.35, 0.1], [0.35, 0.18, 1.35, 0.1]]);
  b.into(g);
  const mk = (side: number) => {
    const p = new THREE.Group(); p.position.set(side * 0.7, 0, 0.1); p.scale.x = side;
    p.add(wingMesh(4.2, 2.6, main, 1, 0.9));
    const tip = wingMesh(1.6, 1.2, acc, 1, 0.9); tip.position.x = 3.6; p.add(tip);
    g.add(p); return p;
  };
  const wl = mk(-1), wr = mk(1), ph = rng() * 6;
  return { ...base(), mood: 'wary', head: null, yawOnly: false,
    name: 'manta', group: g, speed: 3.2, flying: true, hover: 28 + rng() * 14, heading: 0, turn: 0, turnBias: 0.12 * (rng() > 0.5 ? 1 : -1),
    tick(t) { const f = Math.sin(t * 1.4 + ph) * 0.45; wr.rotation.z = f; wl.rotation.z = -f; g.rotation.z = Math.sin(t * 0.5 + ph) * 0.1; } };
}

/** Fast little glider bird. */
function bird(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.3, 10, 8), main, { s: [0.8, 0.8, 1.5] })
   .add(S(0.22, 8, 6), belly, { p: [0, -0.06, 0.05], s: [0.8, 0.6, 1.3] })
   .add(K(0.05, 0.5, 4), acc, { p: [0, 0.2, 0.35], r: [-0.8, 0, 0] });
  for (let i = -2; i <= 2; i++) b.add(K(0.06, 0.8, 4), i % 2 ? acc : main, { p: [i * 0.1, 0, -0.7], r: [-Math.PI / 2, 0, i * 0.12] });
  b.into(g);
  const head = limb(g, [0, 0.1, 0.5], hb => {
    hb.add(S(0.18, 8, 6), main).add(K(0.06, 0.3, 4), acc, { p: [0, -0.02, 0.28], r: [Math.PI / 2, 0, 0] });
    eyes(hb, [[-0.1, 0.06, 0.1, 0.045], [0.1, 0.06, 0.1, 0.045]]);
  });
  const mk = (side: number) => {
    const p = new THREE.Group(); p.position.set(side * 0.18, 0.05, 0); p.scale.x = side;
    p.add(wingMesh(1.3, 0.7, main, 1, 0.8));
    const t = wingMesh(0.6, 0.4, acc, 1, 0.8); t.position.x = 1.15; p.add(t);
    g.add(p); return p;
  };
  const wl = mk(-1), wr = mk(1), ph = rng() * 6;
  return { ...base(), mood: 'skittish', head, yawOnly: false,
    name: 'bird', group: g, speed: 6 + rng() * 2, flying: true, hover: 10 + rng() * 14, heading: 0, turn: 0, turnBias: (rng() > 0.5 ? 1 : -1) * (0.25 + rng() * 0.25),
    tick(t) { const f = Math.sin(t * 9 + ph) * 0.8; wr.rotation.z = f; wl.rotation.z = -f; g.rotation.z = -0.25 * Math.sign(this.turnBias); } };
}

/** Hovering dragonfly-like buzzer with four glassy wings. */
function buzzer(rng: Rng): Animal {
  const [main, acc] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.14, 8, 6), main, { p: [0, 0, 0.3], s: [1, 1, 1.4] });
  for (let i = 0; i < 6; i++) b.add(C(0.05 - i * 0.004, 0.055 - i * 0.004, 0.3, 5), i % 2 ? acc : main, { p: [0, 0, -0.1 - i * 0.28], r: [Math.PI / 2, 0, 0] });
  b.into(g);
  const head = limb(g, [0, 0, 0.55], hb => {
    hb.add(S(0.14, 8, 6), 0xff90ff, { p: [0, 0, 0.07], glow: true });
    eyes(hb, [[-0.1, 0.08, 0.07, 0.07], [0.1, 0.08, 0.07, 0.07]]);
  });
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) for (const z of [0.3, 0.05]) {
    const p = new THREE.Group(); p.position.set(side * 0.1, 0.1, z); p.scale.x = side;
    p.add(wingMesh(0.7, 0.28, 0xcff6ff, 0.45, 0.2));
    g.add(p); wings.push(p);
  }
  const ph = rng() * 6;
  return { ...base(), mood: 'friendly', head, yawOnly: false,
    name: 'buzzer', group: g, speed: 3.5, flying: true, hover: 1.5 + rng() * 3, heading: 0, turn: 0, turnBias: 0,
    tick(t) { wings.forEach((w, i) => { w.rotation.z = Math.sin(t * 45 + i) * 0.7 * (i % 2 ? 1 : -1); });
      return Math.sin(t * 2 + ph) * 0.25; } };
}

/** Round, tusked grunter with glowing bulb tusks and a spiky mohawk. */
function bulbhog(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.85, 14, 10), main, { p: [0, 0.95, 0], s: [1.15, 0.95, 1.5] })
   .add(S(0.6, 10, 8), belly, { p: [0, 0.7, 0.1], s: [1.1, 0.6, 1.3] });
  for (let i = 0; i < 7; i++) b.add(K(0.12, 0.5 - Math.abs(i - 3) * 0.06, 5), acc, { p: [0, 1.78 - Math.abs(i - 3) * 0.1, -0.9 + i * 0.3], r: [(i - 3) * 0.08, 0, 0] });
  b.add(T(0.16, 0.045), main, { p: [0, 1.0, -1.4], r: [0, Math.PI / 2, 0] });
  b.into(g);
  const legs = [[-0.5, 0.7], [0.5, -0.7], [0.5, 0.7], [-0.5, -0.7]].map(([x, z]) => limb(g, [x, 0.62, z], lb => legBuild(lb, main, acc, 0.62, 0.14, 0.18)));
  const head = limb(g, [0, 0.95, 1.1], hb => {
    hb.add(S(0.5, 12, 9), main, { s: [1, 0.9, 1.1] }).add(S(0.28, 10, 8), belly, { p: [0, -0.12, 0.4], s: [1.2, 0.8, 1] })
      .add(S(0.05, 6, 5), 0x1a0a10, { p: [-0.1, -0.1, 0.66] }).add(S(0.05, 6, 5), 0x1a0a10, { p: [0.1, -0.1, 0.66] });
    for (const x of [-0.25, 0.25]) hb.add(K(0.07, 0.5, 5), 0xfff0b0, { p: [x, -0.15, 0.5], r: [-0.9, 0, x > 0 ? -0.3 : 0.3], glow: true });
    eyes(hb, [[-0.28, 0.2, 0.35, 0.07], [0.28, 0.2, 0.35, 0.07]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'defensive', head, yawOnly: false, name: 'bulbhog', group: g, speed: 1.2, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 5 + (i % 2 ? Math.PI : 0) + ph) * 0.6; }); return Math.abs(Math.sin(t * 5 + ph)) * 0.05; } };
}

/** A huge slow tortoise with a little garden growing on its shell. */
function shellwalker(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(new THREE.SphereGeometry(1.9, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), main, { p: [0, 1.4, 0], s: [1.15, 0.85, 1.5] })
   .add(S(1.5, 12, 8), belly, { p: [0, 1.3, 0], s: [1.2, 0.35, 1.6] });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, e = 0.45 + (i % 3) * 0.28;
    b.add(S(0.42, 7, 5), acc, { p: [Math.cos(a) * Math.cos(e) * 2.0, 1.4 + Math.sin(e) * 1.45, Math.sin(a) * Math.cos(e) * 2.8], s: [1, 0.35, 1] });
  }
  // a tiny garden on top: two pines and a mushroom
  b.add(C(0.07, 0.09, 0.6, 5), 0x7a5a3a, { p: [0.4, 3.0, 0.2] }).add(K(0.45, 0.8, 6), 0x38c9a0, { p: [0.4, 3.6, 0.2] }).add(K(0.32, 0.6, 6), 0x38c9a0, { p: [0.4, 4.05, 0.2] });
  b.add(C(0.06, 0.08, 0.5, 5), 0x7a5a3a, { p: [-0.6, 2.9, -0.5] }).add(K(0.4, 0.7, 6), 0x9a6bff, { p: [-0.6, 3.4, -0.5] });
  b.add(C(0.05, 0.07, 0.3, 5), 0xf0e6ff, { p: [-0.2, 3.1, 0.9] }).add(S(0.22, 8, 5), 0xff5ad0, { p: [-0.2, 3.3, 0.9], s: [1, 0.6, 1] });
  b.add(K(0.3, 0.9, 6), main, { p: [0, 1.3, -2.6], r: [-Math.PI / 2.2, 0, 0] });
  b.into(g);
  const legs = [[-1.2, 1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, -1.2]].map(([x, z]) => limb(g, [x, 1.3, z], lb => legBuild(lb, main, acc, 1.3, 0.34, 0.4)));
  const head = limb(g, [0, 1.3, 2.4], hb => {
    hb.add(C(0.3, 0.26, 1.0, 8), main, { p: [0, 0.1, 0.4], r: [Math.PI / 2 - 0.25, 0, 0] })
      .add(S(0.5, 12, 9), main, { p: [0, 0.25, 1.0], s: [1, 0.9, 1.15] })
      .add(K(0.1, 0.4, 5), acc, { p: [-0.25, 0.7, 0.85], r: [-0.2, 0, 0.3] }).add(K(0.1, 0.4, 5), acc, { p: [0.25, 0.7, 0.85], r: [-0.2, 0, -0.3] });
    eyes(hb, [[-0.28, 0.4, 1.2, 0.1], [0.28, 0.4, 1.2, 0.1]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'wary', head, yawOnly: false, name: 'shellwalker', group: g, speed: 0.4, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 1.8 + (i % 2 ? Math.PI : 0) + ph) * 0.35; }); } };
}

/** An armadillo-ball that rolls away when startled. */
function spinner(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const roll = new THREE.Group(); roll.position.y = 0.5; g.add(roll);
  const b = new Builder();
  b.add(S(0.5, 12, 9), main);
  for (let i = 0; i < 5; i++) b.add(T(0.5 * Math.sqrt(1 - Math.pow((i - 2) * 0.22, 2)), 0.045), acc, { p: [0, (i - 2) * 0.11, 0], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.add(K(0.07, 0.22, 4), belly, { p: [Math.cos(a) * 0.45, 0.2 + (i % 3) * 0.12, Math.sin(a) * 0.45], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] }); }
  b.into(roll);
  const head = limb(g, [0, 0.5, 0.45], hb => {
    hb.add(S(0.22, 9, 7), belly, { p: [0, 0, 0.1], s: [1, 0.9, 1.2] }).add(K(0.06, 0.18, 4), acc, { p: [-0.12, 0.2, 0], r: [0, 0, 0.3] }).add(K(0.06, 0.18, 4), acc, { p: [0.12, 0.2, 0], r: [0, 0, -0.3] });
    eyes(hb, [[-0.1, 0.06, 0.24, 0.05], [0.1, 0.06, 0.24, 0.05]]);
  });
  const feet = [-0.22, 0.22].map(x => limb(g, [x, 0.22, 0.1], fb => fb.add(S(0.1, 6, 5), acc, { s: [1, 0.6, 1.4] })));
  return { ...base(), mood: 'skittish', head, yawOnly: false, name: 'spinner', group: g, speed: 1.6, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { roll.rotation.x = t * 4; feet.forEach((f, i) => { f.position.z = 0.1 + Math.sin(t * 8 + i * Math.PI) * 0.12; }); return 0; } };
}

/** Slender deer-like animal with glowing antlers. Lives in herds. */
function antlerback(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.55, 12, 9), main, { p: [0, 1.55, 0], s: [0.8, 0.85, 1.55] }).add(S(0.4, 10, 7), belly, { p: [0, 1.38, 0.1], s: [0.85, 0.6, 1.4] });
  for (let i = 0; i < 4; i++) b.add(S(0.1, 6, 5), acc, { p: [(i % 2 ? 1 : -1) * 0.38, 1.6 + (i % 3) * 0.1, -0.4 + i * 0.3], s: [0.4, 1, 1] });
  b.add(K(0.14, 0.5, 5), 0xffffff, { p: [0, 1.7, -1.1], r: [-1.3, 0, 0], glow: true });
  b.into(g);
  const legs = [[-0.3, 0.6], [0.3, -0.6], [0.3, 0.6], [-0.3, -0.6]].map(([x, z]) => limb(g, [x, 1.55, z], lb => legBuild(lb, main, acc, 1.55, 0.07, 0.1)));
  const head = limb(g, [0, 1.85, 0.85], hb => {
    hb.add(C(0.13, 0.17, 0.9, 7), main, { p: [0, 0.35, 0.1], r: [-0.35, 0, 0] })
      .add(S(0.2, 10, 8), main, { p: [0, 0.8, 0.28], s: [1, 0.9, 1.35] }).add(S(0.08, 7, 5), belly, { p: [0, 0.74, 0.55] });
    for (const sd of [-1, 1]) { // branching glowing antlers
      hb.add(C(0.025, 0.035, 0.7, 5), 0xbff8ff, { p: [sd * 0.16, 1.2, 0.2], r: [-0.2, 0, -sd * 0.45], glow: true });
      for (let k = 0; k < 3; k++) hb.add(K(0.02, 0.28, 4), 0xbff8ff, { p: [sd * (0.22 + k * 0.06), 1.15 + k * 0.17, 0.12 - k * 0.04], r: [-0.3, 0, -sd * 1.0], glow: true });
    }
    eyes(hb, [[-0.13, 0.86, 0.38, 0.045], [0.13, 0.86, 0.38, 0.045]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'skittish', head, yawOnly: false, name: 'antlerback', group: g, speed: 2.2, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 4 + (i % 2 ? Math.PI : 0) + ph) * 0.45; }); return Math.abs(Math.sin(t * 4 + ph)) * 0.06; } };
}

/** Big glowing moth, drawn to campfires and lamps. */
function moth(rng: Rng): Animal {
  const [main, acc] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.13, 8, 6), main, { s: [1, 1, 2.4] }).add(S(0.1, 8, 6), acc, { p: [0, 0.02, 0.35] });
  for (const sd of [-1, 1]) b.add(C(0.01, 0.015, 0.35, 4), acc, { p: [sd * 0.06, 0.2, 0.45], r: [-0.5, 0, -sd * 0.3] }).add(K(0.06, 0.14, 4), acc, { p: [sd * 0.12, 0.35, 0.55], r: [-0.4, 0, -sd * 0.6] });
  eyes(b, [[-0.05, 0.05, 0.43, 0.035], [0.05, 0.05, 0.43, 0.035]]);
  b.into(g);
  const mk = (side: number) => {
    const p = new THREE.Group(); p.position.set(side * 0.08, 0.03, 0.05); p.scale.x = side;
    p.add(wingMesh(0.95, 0.7, main, 0.9, 0.4));
    const hind = wingMesh(0.6, 0.5, acc, 0.85, 0.3); hind.position.z = -0.35; p.add(hind);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2a0, toneMapped: false, side: THREE.DoubleSide }));
    spot.position.set(0.5, 0.01, 0.0); p.add(spot);
    g.add(p); return p;
  };
  const wl = mk(-1), wr = mk(1), ph = rng() * 6;
  return { ...base(), mood: 'wary', head: null, yawOnly: false, moth: true, name: 'moth', group: g, speed: 1.4, flying: true, hover: 3 + rng() * 4, heading: 0, turn: 0, turnBias: 0,
    tick(t) { const f = Math.sin(t * 9 + ph) * 0.9; wr.rotation.z = f; wl.rotation.z = -f; return Math.sin(t * 2 + ph) * 0.3; } };
}

/** A will-o'-the-wisp: a drifting ball of light that only comes out at night. */
function wisp(rng: Rng): Animal {
  const [main] = pick(rng, SCHEMES), g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: main, transparent: true, opacity: 0.28, toneMapped: false, depthWrite: false }));
  g.add(core, halo);
  const trail = Array.from({ length: 6 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.012, 8, 6), new THREE.MeshBasicMaterial({ color: main, transparent: true, opacity: 0.5 - i * 0.07, toneMapped: false, depthWrite: false }));
    g.add(m); return m;
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'curious', head: null, yawOnly: false, nocturnal: true, name: 'wisp', group: g, speed: 0.9, flying: true, hover: 1 + rng() * 2.5, heading: 0, turn: 0, turnBias: 0,
    tick(t) {
      trail.forEach((m, i) => { m.position.set(Math.sin(t * 2 - i * 0.5 + ph) * 0.12, Math.sin(t * 3 - i * 0.7) * 0.08, -0.25 - i * 0.22); });
      halo.scale.setScalar(1 + Math.sin(t * 3 + ph) * 0.15); return Math.sin(t * 1.5 + ph) * 0.4;
    } };
}

/** A small glowing fish. Swims in schools under the water, and sometimes leaps. */
function glowfish(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.2, 9, 7), main, { s: [0.9, 0.75, 2.4] }).add(S(0.15, 8, 6), belly, { p: [0, -0.06, 0.05], s: [0.8, 0.6, 2.0] })
   .add(K(0.09, 0.3, 4), acc, { p: [0, 0.18, -0.05], r: [-0.4, 0, 0], s: [0.5, 1, 1] }).add(S(0.04, 6, 5), 0xfff2a0, { p: [0, 0.05, 0.1], s: [1.4, 0.4, 3], glow: true });
  eyes(b, [[-0.1, 0.05, 0.33, 0.035], [0.1, 0.05, 0.33, 0.035]]);
  b.into(g);
  const tail = limb(g, [0, 0, -0.45], tb => tb.add(K(0.18, 0.4, 4), acc, { p: [0, 0, -0.18], r: [-Math.PI / 2, 0, 0], s: [0.3, 1, 1] }));
  const ph = rng() * 6;
  return { ...base(), mood: 'skittish', head: null, yawOnly: false, water: true, leaps: true, name: 'glowfish', group: g, speed: 1.8, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    roar: { timer: 0, next: 1e9, noticed: true },
    tick(t) { tail.rotation.y = Math.sin(t * 10 + ph) * 0.5; g.rotation.z = Math.sin(t * 5 + ph) * 0.08; } };
}

/** A sea serpent: humps rising and sinking as it swims. Rare, huge, and it roars. */
function serpent(rng: Rng): Animal {
  const [main, acc, belly] = pick(rng, SCHEMES), g = new THREE.Group();
  const segs: THREE.Group[] = [];
  for (let i = 0; i < 16; i++) {
    const r = 0.62 - i * 0.025;
    segs.push(limb(g, [0, 0, -i * 0.95], sb => {
      sb.add(S(r, 12, 9), i % 2 ? main : belly, { s: [1, 1, 1.25] });
      if (i % 2 === 0) sb.add(K(0.14, 0.55 - i * 0.02, 4), acc, { p: [0, r * 0.95, 0], s: [0.4, 1, 1] });
    }));
  }
  const head = limb(segs[0], [0, 0.1, 0.8], hb => {
    hb.add(S(0.7, 12, 9), main, { s: [1, 0.85, 1.3] }).add(S(0.45, 10, 8), belly, { p: [0, -0.25, 0.45], s: [1, 0.6, 1.2] })
      .add(K(0.12, 0.7, 5), acc, { p: [-0.35, 0.55, -0.1], r: [-0.5, 0, 0.3] }).add(K(0.12, 0.7, 5), acc, { p: [0.35, 0.55, -0.1], r: [-0.5, 0, -0.3] });
    eyes(hb, [[-0.38, 0.22, 0.5, 0.12], [0.38, 0.22, 0.5, 0.12]]);
  });
  g.scale.setScalar(1.4);
  const ph = rng() * 6;
  return { ...base(), mood: 'wary', head, yawOnly: false, water: true, name: 'serpent', group: g, speed: 2.2, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { segs.forEach((s, i) => { s.position.y = Math.sin(t * 1.6 - i * 0.75 + ph) * 0.95 - 0.1; s.position.x = Math.sin(t * 1.0 - i * 0.5 + ph) * 0.35; }); } };
}

/** The puffhog: a round, gentle grazer with a big fluffy tail. The common wildlife of the open fields, harmless and easy to handle. */
function puffhog(rng: Rng): Animal {
  const tones: [number, number, number][] = [[0xe8b8c8, 0xfff0f6, 0x8a5a6a], [0xc8d8a8, 0xf4ffe0, 0x5a7a4a], [0xd8c0f0, 0xf6eeff, 0x6a5a8a], [0xf0d098, 0xfff6dc, 0x8a6a3a]];
  const [main, tail, dark] = pick(rng, tones), g = new THREE.Group();
  const b = new Builder();
  b.add(S(0.62, 12, 9), main, { p: [0, 0.62, 0], s: [1.0, 0.9, 1.3] })
   .add(S(0.4, 10, 8), tail, { p: [0, 0.38, 0.05], s: [1.1, 0.6, 1.2] });                        // pale belly
  // the fluffy tail: a ball of fluff with little tufts
  b.add(S(0.34, 12, 9), tail, { p: [0, 0.78, -0.88] });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(S(0.14, 6, 5), tail, { p: [Math.cos(a) * 0.3, 0.78 + Math.sin(a) * 0.3, -0.92] }); }
  b.into(g);
  const legs = [[-0.32, 0.4], [0.32, -0.4], [0.32, 0.4], [-0.32, -0.4]].map(([x, z]) => limb(g, [x, 0.34, z], lb => legBuild(lb, main, dark, 0.34, 0.1, 0.12)));
  const head = limb(g, [0, 0.75, 0.78], hb => {
    hb.add(S(0.38, 12, 9), main, { s: [1, 0.95, 1] })
      .add(S(0.2, 10, 8), tail, { p: [0, -0.1, 0.3], s: [1.2, 0.8, 1] })                       // snout
      .add(S(0.045, 6, 5), dark, { p: [-0.07, -0.08, 0.48] }).add(S(0.045, 6, 5), dark, { p: [0.07, -0.08, 0.48] })
      .add(S(0.12, 6, 5), main, { p: [-0.26, 0.32, -0.02], s: [0.8, 1.1, 0.5] }).add(S(0.12, 6, 5), main, { p: [0.26, 0.32, -0.02], s: [0.8, 1.1, 0.5] });
    eyes(hb, [[-0.17, 0.1, 0.3, 0.06], [0.17, 0.1, 0.3, 0.06]]);
  });
  const ph = rng() * 6;
  return { ...base(), mood: 'friendly', head, yawOnly: false, name: 'puffhog', group: g, speed: 0.9, flying: false, hover: 0, heading: 0, turn: 0, turnBias: 0,
    tick(t) { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 4.5 + (i % 2 ? Math.PI : 0) + ph) * 0.5; }); head.rotation.x = Math.sin(t * 0.8 + ph) * 0.08; return Math.abs(Math.sin(t * 4.5 + ph)) * 0.04; } };
}

export const makePuffhog = (rng: Rng): Animal => puffhog(rng);
export const GROUND = [longneck, stilter, worm, hopper, crawler, bulbhog, shellwalker, spinner, antlerback];
export const FLYING = [floater, manta, bird, buzzer, moth, wisp];
export const WATERFOLK = [glowfish, serpent];
export const makeGround = (i: number, rng: Rng): Animal => GROUND[i % GROUND.length](rng);
export const makeFlyer = (i: number, rng: Rng): Animal => FLYING[i % FLYING.length](rng);
export const makeWater = (i: number, rng: Rng): Animal => WATERFOLK[i % WATERFOLK.length](rng);
