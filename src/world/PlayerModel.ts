import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * "The Monke Pioneer": an original space-ape explorer in an astronaut suit. Fur in the player's colour, a pale muzzle,
 * big ears and eyes inside a glass helmet with a glowing antenna bulb; a white suit with a chest panel, a life-support
 * pack with a thruster and an accent stripe in the player's colour; and long stretchy arms ending in gloved fists. Everything is built from primitives, no assets.
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
    const suit = new THREE.MeshStandardMaterial({ color: 0xe9edf5, roughness: 0.65, metalness: 0.05 });     // white suit fabric
    const grey = new THREE.MeshStandardMaterial({ color: 0x8b95a8, roughness: 0.5, metalness: 0.4 });      // joints, rings, pack
    const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });                              // stripe: the player's colour
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.05, transparent: true, opacity: 0.22, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
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
    // helmet: glass bubble, neck ring, comms pods and a glowing antenna
    h.add(sph(0.225, glass, 0, -0.005, 0.01));
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24), grey); neck.rotation.x = Math.PI / 2; neck.position.set(0, -0.17, 0.02); h.add(neck);
    for (const sd of [-1, 1]) h.add(sph(0.05, grey, sd * 0.215, -0.01, 0.02, 0.6, 1, 1));              // comms pods on the sides
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), grey); stalk.position.set(0.1, 0.235, 0.03); stalk.rotation.z = -0.35; h.add(stalk);
    this.bulb = sph(0.018, new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1.2 }), 0.125, 0.285, 0.03);
    h.add(this.bulb);
    h.visible = opts.head !== false;

    // ---- body (follows the head's yaw, hangs under it) ----
    const b = this.bodyG;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.22, 4, 12), suit); torso.position.y = -0.34; b.add(torso);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14), grey); belt.position.y = -0.5; b.add(belt);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 14), accent); stripe.position.y = -0.43; b.add(stripe);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.02), grey); panel.position.set(0, -0.3, -0.125); b.add(panel);
    const lamps = [0xff5a5a, 0x5aff8a, 0x5ab4ff];
    lamps.forEach((c, i) => b.add(sph(0.011, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1 }), -0.033 + i * 0.033, -0.3, -0.138)));
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), grey); pack.position.set(0, -0.31, 0.16); b.add(pack);
    for (const sd of [-1, 1]) { const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 8), suit); tank.position.set(sd * 0.055, -0.31, 0.23); b.add(tank); }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.05, 10), dark); nozzle.position.set(0, -0.49, 0.16); b.add(nozzle);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff9b3a, emissive: 0xff7a1a, emissiveIntensity: 1.5 }));
    this.glow.position.set(0, -0.53, 0.16); b.add(this.glow);

    // ---- arms and fists ----
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1, 10), suit); this.arms.push(arm);
      const fist = new THREE.Group();
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 8, 16), accent); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.045; fist.add(cuff);
      fist.add(sph(0.062, grey, 0, 0, 0, 1, 0.85, 1));                    // glove palm / knuckles
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 3, 6), suit);
        finger.position.set((f - 1.5) * 0.026, 0.055, -0.012); finger.rotation.x = -0.5; fist.add(finger);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.04, 3, 6), suit); thumb.position.set((i ? -1 : 1) * 0.06, 0.02, -0.03); thumb.rotation.z = (i ? 1 : -1) * 0.9; fist.add(thumb);
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
