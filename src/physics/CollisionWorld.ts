import * as THREE from 'three';

export interface BoxCollider { center: THREE.Vector3; half: THREE.Vector3; slip: number; }
export interface SphereCollider { center: THREE.Vector3; radius: number; slip: number; }
/** Vertical capsule: a trunk from y0 to y1 with radius r. */
export interface CylinderCollider { x: number; z: number; y0: number; y1: number; radius: number; slip: number; }

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
  readonly boxes: BoxCollider[] = [];
  readonly spheres: SphereCollider[] = [];
  readonly cylinders: CylinderCollider[] = [];
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
    for (const b of this.boxes) {
      const qx = Math.abs(p.x - b.center.x) - b.half.x;
      const qy = Math.abs(p.y - b.center.y) - b.half.y;
      const qz = Math.abs(p.z - b.center.z) - b.half.z;
      const bd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      if (bd < d) { d = bd; slip = b.slip; }
    }
    for (const s of this.spheres) {
      const dx = p.x - s.center.x;
      if (dx > d + s.radius + 1 || dx < -(d + s.radius + 1)) continue; // cheap reject
      const sd = Math.hypot(dx, p.y - s.center.y, p.z - s.center.z) - s.radius;
      if (sd < d) { d = sd; slip = s.slip; }
    }
    for (const c of this.cylinders) {
      const dx = p.x - c.x;
      if (dx > d + c.radius + 1 || dx < -(d + c.radius + 1)) continue;
      const cd = Math.hypot(dx, p.y - THREE.MathUtils.clamp(p.y, c.y0, c.y1), p.z - c.z) - c.radius;
      if (cd < d) { d = cd; slip = c.slip; }
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
