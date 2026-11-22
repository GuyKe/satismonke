import * as THREE from 'three';

export interface BoxCollider {
  center: THREE.Vector3;
  half: THREE.Vector3;
}

/**
 * Collision field for the capsule interior.
 *
 * `distance(p)` returns the distance from p to the nearest solid surface
 * (positive in free space, negative inside solids). Solids are:
 *  - everything outside the capsule hull (a cylinder along Z with rounded ends)
 *  - axis-aligned boxes (floor, console, crates, bars)
 */
export class CollisionWorld {
  readonly radius = 3;
  readonly halfSegment = 3; // hull is a segment of 2*3 m capped by r=3 spheres => 12 m long
  readonly boxes: BoxCollider[] = [];

  addBox(center: THREE.Vector3, size: THREE.Vector3): BoxCollider {
    const b = { center: center.clone(), half: size.clone().multiplyScalar(0.5) };
    this.boxes.push(b);
    return b;
  }

  distance(p: THREE.Vector3): number {
    const z = THREE.MathUtils.clamp(p.z, -this.halfSegment, this.halfSegment);
    let d = this.radius - Math.hypot(p.x, p.y, p.z - z);
    for (const b of this.boxes) {
      const qx = Math.abs(p.x - b.center.x) - b.half.x;
      const qy = Math.abs(p.y - b.center.y) - b.half.y;
      const qz = Math.abs(p.z - b.center.z) - b.half.z;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      const bd = outside + inside;
      if (bd < d) d = bd;
    }
    return d;
  }

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

  /**
   * Move a sphere from `from` to `to` in small steps so fast motion cannot
   * tunnel through thin bars. Writes the resolved position to `out`.
   */
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
