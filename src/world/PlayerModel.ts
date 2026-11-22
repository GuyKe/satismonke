import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * "The Monke Pioneer": an original space-ape explorer. Fur in the player's colour, a pale muzzle, big ears and eyes, a
 * teal headband with a glowing antenna bulb, a chest patch, a backpack with a thruster, and long stretchy arms ending
 * in knuckle-walking fists. Everything is built from primitives, no assets.
 *
 * Forward is -Z. `head` is the point between the eyes; the body hangs below it (there are no legs: the pioneer
 * floats on its arms, gorilla-tag style).
 */
export class PlayerModel {
  readonly group = new THREE.Group();
  readonly headG = new THREE.Group();
  private bodyG = new THREE.Group();
  private arms: THREE.Mesh[] = [];
  private fists: THREE.Group[] = [];
  private glow: THREE.Mesh;
  private bulb: THREE.Mesh;
  private t = Math.random() * 10;
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private q = new THREE.Quaternion();

  constructor(color: number, opts: { head?: boolean } = {}) {
    const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.95 });
    const pale = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xf0dcc0), 0.7), roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.2 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1fb5a8, roughness: 0.5 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7, metalness: 0.2 });
    const sph = (r: number, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o;
    };

    // ---- head ----
    const h = this.headG;
    h.add(sph(0.125, fur, 0, 0, 0.02));
    h.add(sph(0.07, pale, 0, -0.045, -0.085, 1.15, 0.8, 0.85));          // muzzle
    h.add(sph(0.016, black, 0, -0.02, -0.15, 1.4, 1, 0.8));              // nose
    for (const s of [-1, 1]) {
      h.add(sph(0.03, white, s * 0.052, 0.025, -0.095));                  // eyes
      h.add(sph(0.015, black, s * 0.052, 0.025, -0.122));
      h.add(sph(0.05, fur, s * 0.13, 0.005, 0.03, 1, 1, 0.5));            // ears
      h.add(sph(0.032, pale, s * 0.135, 0.005, 0.017, 1, 1, 0.4));
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.014, 8, 24), teal);
    band.rotation.x = Math.PI / 2; band.position.set(0, 0.07, 0.02); h.add(band);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6), dark); stalk.position.set(0.05, 0.19, 0.03); stalk.rotation.z = -0.25; h.add(stalk);
    this.bulb = sph(0.018, new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1.2 }), 0.065, 0.245, 0.03);
    h.add(this.bulb);
    h.visible = opts.head !== false;

    // ---- body (follows the head's yaw, hangs under it) ----
    const b = this.bodyG;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.22, 4, 12), fur); torso.position.y = -0.34; b.add(torso);
    b.add(sph(0.085, pale, 0, -0.33, -0.065, 1, 1.5, 0.6));              // belly patch
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.118, 0.06, 14), suit); vest.position.y = -0.21; b.add(vest);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.22, 0.08), suit); pack.position.set(0, -0.32, 0.14); b.add(pack);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.05, 10), dark); nozzle.position.set(0, -0.46, 0.14); b.add(nozzle);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff9b3a, emissive: 0xff7a1a, emissiveIntensity: 1.5 }));
    this.glow.position.set(0, -0.5, 0.14); b.add(this.glow);

    // ---- arms and fists ----
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 1, 8), fur); this.arms.push(arm);
      const fist = new THREE.Group();
      fist.add(sph(0.062, dark, 0, 0, 0, 1, 0.85, 1));                    // palm / knuckles
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 3, 6), dark);
        finger.position.set((f - 1.5) * 0.026, 0.055, -0.012); finger.rotation.x = -0.5; fist.add(finger);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.04, 3, 6), dark); thumb.position.set((i ? -1 : 1) * 0.06, 0.02, -0.03); thumb.rotation.z = (i ? 1 : -1) * 0.9; fist.add(thumb);
      this.fists.push(fist);
      this.group.add(arm, fist);
    }
    this.group.add(h, b);
  }

  /** Put the model where the player is. `head` is eye position, `yaw` the head's heading; hands are world positions. */
  setPose(head: THREE.Vector3, yaw: number, pitch: number, roll: number, left: THREE.Vector3, right: THREE.Vector3, dt: number): void {
    this.t += dt;
    this.headG.position.copy(head);
    this.headG.rotation.set(pitch, yaw, roll, 'YXZ');
    this.bodyG.position.copy(head); this.bodyG.rotation.set(0, yaw, 0);
    (this.glow.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(this.t * 9) * 0.5;
    (this.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + Math.sin(this.t * 3) * 0.5;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    [left, right].forEach((hand, i) => {
      const side = i === 0 ? -1 : 1;
      // shoulder: beside the chest, in the body's frame
      const sh = this.tmp.set(head.x + c * side * 0.17, head.y - 0.22, head.z - s * side * 0.17);
      const d = this.tmp2.copy(hand).sub(sh); const len = Math.max(0.05, d.length());
      this.q.setFromUnitVectors(UP, d.normalize());
      const arm = this.arms[i];
      arm.position.copy(sh).addScaledVector(d, len / 2); arm.quaternion.copy(this.q); arm.scale.set(1, len, 1);
      this.fists[i].position.copy(hand); this.fists[i].quaternion.copy(this.q);
    });
  }

  set visible(v: boolean) { this.group.visible = v; }
}
