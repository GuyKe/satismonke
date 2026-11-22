import * as THREE from 'three';

export interface BoxCollider { center: THREE.Vector3; half: THREE.Vector3; slip: number; }
export interface SphereCollider { center: THREE.Vector3; radius: number; slip: number; }
/** Vertical capsule: a trunk from y0 to y1 with radius r. */
/** Flat-topped cylinder: mesas and rock spires. */
export interface PillarCollider { x: number; z: number; y0: number; y1: number; radius: number; slip: number; }
export interface CylinderCollider { x: number; z: number; y0: number; y1: number; radius: number; slip: number; }

const EMPTY_S: SphereCollider[] = [], EMPTY_C: CylinderCollider[] = [], EMPTY_P: PillarCollider[] = [];

/**
 * Collision field. `distance(p)` is the distance to the nearest solid surface (positive in free
 * space, negative inside). Slip (0 = sticky, 1 = ice) is looked up per collider.
 * Solids: the outside of the capsule hull (optional), a ground plane (optional), boxes,
 * spheres and vertical cylinders.
 */
export class CollisionWorld {
  readonly radius = 3;
  readonly halfSegment = 3; // hull is a segment of 2*3 m capped by r=3 spheres => 12 m long
  hull = true;
  hullSlip = 0.35;
  groundY: number | null = null;
  groundSlip = 0.1;
  /** Optional terrain: height of the ground at (x, z). Slopes are handled by dividing by the gradient length. */
  heightFn: ((x: number, z: number) => number) | null = null;
  readonly boxes: BoxCollider[] = [];
  readonly spheres: SphereCollider[] = [];
  readonly cylinders: CylinderCollider[] = [];
  readonly pillars: PillarCollider[] = [];
  /** Spatial hash for spheres/cylinders/pillars; built by finalize() once a big world is populated. */
  private grid: Map<number, { s: SphereCollider[]; c: CylinderCollider[]; p: PillarCollider[] }> | null = null;
  private static readonly CELL = 32;
  private static readonly MARGIN = 3;
  private slipOut = 0;

  addBox(center: THREE.Vector3, size: THREE.Vector3, slip = 0.3): BoxCollider {
    const b = { center: center.clone(), half: size.clone().multiplyScalar(0.5), slip };
    this.boxes.push(b);
    return b;
  }
  addSphere(center: THREE.Vector3, radius: number, slip = 0.3): void {
    this.spheres.push({ center: center.clone(), radius, slip });
  }
  addCylinder(x: number, z: number, y0: number, y1: number, radius: number, slip = 0): void {
    this.cylinders.push({ x, z, y0, y1, radius, slip });
  }

  addPillar(x: number, z: number, y0: number, y1: number, radius: number, slip = 0.3): void {
    this.pillars.push({ x, z, y0, y1, radius, slip });
  }

  /** Build the spatial hash. Call after adding all colliders of a large world. */
  finalize(): void {
    const CELL = CollisionWorld.CELL, M = CollisionWorld.MARGIN;
    const grid = new Map<number, { s: SphereCollider[]; c: CylinderCollider[]; p: PillarCollider[] }>();
    const key = (i: number, j: number) => i * 65536 + j;
    const put = (x: number, z: number, r: number, kind: 's' | 'c' | 'p', item: SphereCollider | CylinderCollider | PillarCollider) => {
      for (let i = Math.floor((x - r - M) / CELL); i <= Math.floor((x + r + M) / CELL); i++)
        for (let j = Math.floor((z - r - M) / CELL); j <= Math.floor((z + r + M) / CELL); j++) {
          let cell = grid.get(key(i, j));
          if (!cell) { cell = { s: [], c: [], p: [] }; grid.set(key(i, j), cell); }
          (cell[kind] as unknown[]).push(item);
        }
    };
    for (const s of this.spheres) put(s.center.x, s.center.z, s.radius, 's', s);
    for (const c of this.cylinders) put(c.x, c.z, c.radius, 'c', c);
    for (const p of this.pillars) put(p.x, p.z, p.radius, 'p', p);
    this.grid = grid;
  }

  /** Evaluates the field and records the slip of the nearest surface in `slipOut`. */
  private evaluate(p: THREE.Vector3): number {
    let d = Infinity, slip = 0;
    if (this.hull) {
      const z = THREE.MathUtils.clamp(p.z, -this.halfSegment, this.halfSegment);
      d = this.radius - Math.hypot(p.x, p.y, p.z - z);
      slip = this.hullSlip;
    }
    if (this.groundY !== null) {
      const g = p.y - this.groundY;
      if (g < d) { d = g; slip = this.groundSlip; }
    }
    if (this.heightFn) {
      const f = this.heightFn, e = 0.4;
      const gx = (f(p.x + e, p.z) - f(p.x - e, p.z)) / (2 * e);
      const gz = (f(p.x, p.z + e) - f(p.x, p.z - e)) / (2 * e);
      const g = (p.y - f(p.x, p.z)) / Math.sqrt(1 + gx * gx + gz * gz);
      if (g < d) { d = g; slip = this.groundSlip; }
    }
    for (const b of this.boxes) {
      const qx = Math.abs(p.x - b.center.x) - b.half.x;
      const qy = Math.abs(p.y - b.center.y) - b.half.y;
      const qz = Math.abs(p.z - b.center.z) - b.half.z;
      const bd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      if (bd < d) { d = bd; slip = b.slip; }
    }
    let spheres = this.spheres, cylinders = this.cylinders, pillars = this.pillars;
    if (this.grid) {
      const cell = this.grid.get(Math.floor(p.x / CollisionWorld.CELL) * 65536 + Math.floor(p.z / CollisionWorld.CELL));
      spheres = cell?.s ?? EMPTY_S; cylinders = cell?.c ?? EMPTY_C; pillars = cell?.p ?? EMPTY_P;
    }
    for (const s of spheres) {
      const sd = Math.hypot(p.x - s.center.x, p.y - s.center.y, p.z - s.center.z) - s.radius;
      if (sd < d) { d = sd; slip = s.slip; }
    }
    for (const c of cylinders) {
      const cd = Math.hypot(p.x - c.x, p.y - THREE.MathUtils.clamp(p.y, c.y0, c.y1), p.z - c.z) - c.radius;
      if (cd < d) { d = cd; slip = c.slip; }
    }
    for (const q of pillars) {
      const dr = Math.hypot(p.x - q.x, p.z - q.z) - q.radius;
      const dy = Math.abs(p.y - (q.y0 + q.y1) / 2) - (q.y1 - q.y0) / 2;
      const pd = Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
      if (pd < d) { d = pd; slip = q.slip; }
    }
    this.slipOut = slip;
    return d;
  }

  distance(p: THREE.Vector3): number { return this.evaluate(p); }

  /** Slip (0..1) of the surface nearest to p. */
  slipAt(p: THREE.Vector3): number { this.evaluate(p); return this.slipOut; }

  /** Gradient of the distance field: points from solid into free space. */
  normal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const e = 1e-3;
    const q = p.clone();
    q.x = p.x + e; const xp = this.distance(q); q.x = p.x - e; const xn = this.distance(q); q.x = p.x;
    q.y = p.y + e; const yp = this.distance(q); q.y = p.y - e; const yn = this.distance(q); q.y = p.y;
    q.z = p.z + e; const zp = this.distance(q); q.z = p.z - e; const zn = this.distance(q);
    out.set(xp - xn, yp - yn, zp - zn);
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
    return out.normalize();
  }

  /** Push a sphere out of geometry. Mutates p. Returns true if it was touching. */
  pushOut(p: THREE.Vector3, r: number, nOut: THREE.Vector3): boolean {
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const d = this.distance(p);
      if (d >= r) break;
      this.normal(p, nOut);
      p.addScaledVector(nOut, r - d);
      hit = true;
    }
    return hit;
  }

  /** Move a sphere in small steps so fast motion cannot tunnel through thin bars. */
  sweep(from: THREE.Vector3, to: THREE.Vector3, r: number, out: THREE.Vector3, nOut: THREE.Vector3): boolean {
    const steps = Math.max(1, Math.ceil(from.distanceTo(to) / (r * 0.5)));
    const delta = to.clone().sub(from).divideScalar(steps);
    out.copy(from);
    let hit = false;
    const n = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      out.add(delta);
      if (this.pushOut(out, r, n)) { hit = true; nOut.copy(n); }
    }
    return hit;
  }
}
