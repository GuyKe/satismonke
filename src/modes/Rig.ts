import * as THREE from 'three';

export type PartId = 'head' | 'torsoU' | 'torsoL' | 'armL' | 'armR' | 'legL' | 'legR';
export type RigKind = 'dummy' | 'brute' | 'lurker';

/** Pieces that were torn off: they tumble, bounce and then fade away. */
export class DebrisSystem {
  private items: { obj: THREE.Object3D; vel: THREE.Vector3; ang: THREE.Vector3; t: number; life: number; r: number }[] = [];
  constructor(private scene: THREE.Object3D, private ground: (x: number, z: number) => number) {}
  add(obj: THREE.Object3D, vel: THREE.Vector3, r = 0.3, life = 22): void {
    this.scene.attach(obj);
    this.items.push({ obj, vel: vel.clone(), ang: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9), t: 0, life, r });
  }
  get count(): number { return this.items.length; }
  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i]; d.t += dt;
      d.vel.y -= 9.8 * dt; d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.ang.x * dt; d.obj.rotation.y += d.ang.y * dt; d.obj.rotation.z += d.ang.z * dt;
      const g = this.ground(d.obj.position.x, d.obj.position.z) + d.r;
      if (d.obj.position.y < g) { d.obj.position.y = g; if (d.vel.y < 0) d.vel.y *= -0.32; d.vel.x *= 0.7; d.vel.z *= 0.7; d.ang.multiplyScalar(0.7); }
      if (d.t > d.life - 1.5) { const k = Math.max(0.001, (d.life - d.t) / 1.5); d.obj.scale.setScalar(k); }
      if (d.t > d.life) { this.scene.remove(d.obj); this.items.splice(i, 1); }
    }
  }
  clear(): void { for (const d of this.items) this.scene.remove(d.obj); this.items = []; }
}

interface Palette { skin: number; body: number; limb: number; accent: number }
const mat = (c: number, rough = 0.7, emissive = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, emissive, emissiveIntensity: emissive ? 1.2 : 0 });
const sph = (r: number, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o; };
const cap = (r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 8), m); o.position.set(x, y, z); return o; };

/**
 * A character made of separate pieces (head, chest, hips, arms, legs) that can be torn off one by one. Three builds:
 * a plain pioneer dummy, a hulking brute and a tall thin lurker. Cartoon pieces and puffs of stuffing: no gore.
 * Hierarchy: hips -> { legs, chest -> { head, arms } }, so tearing the chest splits the character in half.
 */
export class Rig {
  readonly group = new THREE.Group();
  readonly kind: RigKind;
  private p = {} as Record<PartId, THREE.Group>;
  private centers = {} as Record<PartId, THREE.Vector3>;
  readonly size: number;
  private ph = Math.random() * 6;
  private armLen: number;

  constructor(kind: RigKind, pal?: Partial<Palette>) {
    this.kind = kind;
    const defaults: Record<RigKind, Palette> = {
      dummy: { skin: 0xe8c9a0, body: 0xe9edf5, limb: 0xc8d0e0, accent: 0x3f78c8 },
      brute: { skin: 0x8a5ac8, body: 0x6a3fa8, limb: 0x7a4cb8, accent: 0xffd23a },
      lurker: { skin: 0xd8d4c8, body: 0x1c1a22, limb: 0x2a2630, accent: 0x15131a },
    };
    const c = { ...defaults[kind], ...pal };
    const skin = mat(c.skin, 0.85), body = mat(c.body), limb = mat(c.limb), acc = mat(c.accent, 0.5, kind === 'brute' ? 0x553300 : 0);
    const brute = kind === 'brute', lurker = kind === 'lurker';
    const legLen = lurker ? 1.5 : brute ? 1.5 : 0.8, armLen = lurker ? 1.5 : brute ? 1.2 : 0.7, hipY = legLen + 0.05;
    const legR = brute ? 0.14 : lurker ? 0.04 : 0.085, chestW = brute ? 0.4 : lurker ? 0.1 : 0.2, chestH = lurker ? 0.9 : brute ? 0.7 : 0.38;
    const mk = (id: PartId) => { const g = new THREE.Group(); this.p[id] = g; return g; };
    const L = mk('torsoL'), U = mk('torsoU'), H = mk('head'), aL = mk('armL'), aR = mk('armR'), lL = mk('legL'), lR = mk('legR');
    L.position.set(0, hipY, 0);
    L.add(lurker ? cap(0.07, 0.1, limb) : sph(chestW * 0.95, body, 0, 0, 0, 1, 0.7, 0.85)); this.centers.torsoL = new THREE.Vector3(0, 0, 0);
    const hx = chestW * (lurker ? 0.7 : 0.55);
    for (const [leg, side] of [[lL, -1], [lR, 1]] as [THREE.Group, number][]) {
      leg.position.set(side * hx, 0, 0);
      leg.add(cap(legR, legLen - legR * 2, limb, 0, -legLen / 2, 0), sph(legR * 1.5, acc, 0, -legLen + 0.02, 0.04, 1, 0.55, 1.5));
      L.add(leg);
    }
    this.centers.legL = new THREE.Vector3(0, -legLen / 2, 0); this.centers.legR = this.centers.legL.clone();
    U.position.set(0, lurker ? 0.1 : 0.12, 0); L.add(U);
    U.add(cap(chestW, chestH - chestW * 2, body, 0, chestH / 2, 0));
    if (kind === 'dummy') U.add(sph(0.045, acc, 0.07, 0.3, -0.19));
    if (brute) for (let i = -1; i <= 1; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), acc); sp.position.set(i * 0.22, chestH + 0.1, 0.18); U.add(sp); }
    this.centers.torsoU = new THREE.Vector3(0, chestH / 2, 0);
    const neck = chestH + (lurker ? 0.1 : 0.12);
    H.position.set(0, neck, 0); U.add(H);
    if (kind === 'dummy') {
      H.add(sph(0.14, skin, 0, 0.14, 0));
      const glass = sph(0.17, mat(0x9fd8ff, 0.1), 0, 0.14, 0); glass.material = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, roughness: 0.1 }); H.add(glass);
      H.add(sph(0.025, mat(0x111111), -0.05, 0.16, -0.12), sph(0.025, mat(0x111111), 0.05, 0.16, -0.12));
    } else if (brute) {
      H.add(sph(0.3, skin, 0, 0.22, 0, 1.15, 0.95, 1.05));
      for (const x of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), mat(0xf0e6c8)); horn.position.set(x * 0.3, 0.5, 0); horn.rotation.z = -x * 0.5; H.add(horn); }
      H.add(sph(0.075, mat(0xffe040, 0.3, 0xffb000), -0.12, 0.28, -0.26), sph(0.075, mat(0xffe040, 0.3, 0xffb000), 0.12, 0.28, -0.26));
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), mat(0x22001a)); mouth.position.set(0, 0.08, -0.28); H.add(mouth);
    } else {
      H.add(sph(0.13, skin, 0, 0.2, 0, 0.9, 1.35, 0.95));
      H.add(sph(0.04, mat(0x000000), -0.05, 0.24, -0.11, 1, 1.8, 0.5), sph(0.04, mat(0x000000), 0.05, 0.24, -0.11, 1, 1.8, 0.5));
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 5, 12, Math.PI), mat(0x000000)); smile.position.set(0, 0.13, -0.12); smile.rotation.z = Math.PI; H.add(smile);
    }
    this.centers.head = new THREE.Vector3(0, lurker ? 0.2 : brute ? 0.22 : 0.14, 0);
    const sx = lurker ? 0.14 : chestW + 0.08, sy = chestH - 0.06, ar = brute ? 0.13 : lurker ? 0.03 : 0.06;
    for (const [arm, side] of [[aL, -1], [aR, 1]] as [THREE.Group, number][]) {
      arm.position.set(side * sx, sy, 0); U.add(arm);
      arm.add(cap(ar, armLen - ar * 2, limb, 0, -armLen / 2, 0), sph(ar * (brute ? 1.8 : 1.5), lurker ? skin : acc, 0, -armLen, 0, 1, lurker ? 2.6 : 1, 1));
      if (brute) for (let i = -1; i <= 1; i++) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 5), mat(0xf0e6c8)); claw.position.set(i * 0.08, -armLen - 0.2, -0.04); claw.rotation.x = Math.PI; arm.add(claw); }
    }
    this.centers.armL = new THREE.Vector3(0, -armLen / 2, 0); this.centers.armR = this.centers.armL.clone();
    this.group.add(L);
    this.size = hipY + chestH + 0.45; this.armLen = armLen;
  }

  /** Is the piece still part of this character? */
  has(id: PartId): boolean {
    if (id === 'torsoL') return true;
    let o: THREE.Object3D | null = this.p[id];
    while (o && o !== this.group) o = o.parent;
    return o === this.group;
  }
  get dead(): boolean { return !this.has('head') || !this.has('torsoU'); }
  get remaining(): PartId[] { return (['head', 'armL', 'armR', 'legL', 'legR', 'torsoU'] as PartId[]).filter(i => this.has(i)); }
  get reach(): number { return this.armLen; }

  /** Swing the limbs while it moves, sway a little while it stands; `flail` makes it wave its arms about. */
  update(t: number, moving: boolean, flail = 0): void {
    const w = t * (moving ? 7 : 1.4) + this.ph, a = moving ? 0.7 : 0.05;
    if (this.has('legL')) this.p.legL.rotation.x = Math.sin(w) * a;
    if (this.has('legR')) this.p.legR.rotation.x = -Math.sin(w) * a;
    const lean = this.kind === 'lurker' ? 0.15 : 0;
    if (this.has('armL')) { this.p.armL.rotation.x = -Math.sin(w) * a * 0.8 + lean; this.p.armL.rotation.z = 0.08 + flail * Math.sin(t * 14) * 0.9; }
    if (this.has('armR')) { this.p.armR.rotation.x = Math.sin(w) * a * 0.8 + lean; this.p.armR.rotation.z = -0.08 - flail * Math.sin(t * 14 + 1) * 0.9; }
    if (this.has('head')) this.p.head.rotation.z = flail * Math.sin(t * 9) * 0.3;
  }

  /**
   * Wear this character as the player's body: the head sits at the player's head, the body hangs below it and the
   * arms stretch out to the player's hands. `hideHead` hides the head you are looking out of.
   */
  followPlayer(head: THREE.Vector3, yaw: number, left: THREE.Vector3, right: THREE.Vector3, hideHead: boolean): void {
    const headLocal = this.p.head.position, shoulderY = this.p.armL.position.y;
    this.group.rotation.set(0, yaw, 0);
    // put the group so that the head (neck + a little) lands on the player's head
    const drop = this.p.torsoL.position.y + this.p.torsoU.position.y + headLocal.y + this.centers.head.y;
    this.group.position.set(head.x, head.y - drop, head.z);
    this.p.head.visible = !hideHead;
    this.group.updateMatrixWorld(true);
    const aim = (arm: THREE.Group, hand: THREE.Vector3) => {
      if (!this.has(arm === this.p.armL ? 'armL' : 'armR')) return;
      const sw = arm.getWorldPosition(new THREE.Vector3()), dir = hand.clone().sub(sw), len = Math.max(0.2, dir.length());
      const parentQ = arm.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      dir.normalize().applyQuaternion(parentQ);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir); arm.scale.set(1, len / this.armLen, 1);
    };
    aim(this.p.armL, left); aim(this.p.armR, right);
    void shoulderY;
  }

  centerOf(id: PartId, out = new THREE.Vector3()): THREE.Vector3 { this.group.updateMatrixWorld(true); return this.p[id].localToWorld(out.copy(this.centers[id])); }

  /** The piece nearest to a point (a fist), if one is within `reach`. */
  nearest(point: THREE.Vector3, reach: number): { id: PartId; d: number } | null {
    let best: { id: PartId; d: number } | null = null; const tmp = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    for (const id of ['head', 'armL', 'armR', 'legL', 'legR', 'torsoU', 'torsoL'] as PartId[]) {
      if (!this.has(id)) continue;
      const fat = id === 'torsoU' ? 0.2 : id === 'torsoL' ? 0.15 : id === 'head' ? 0.05 : 0;
      const d = this.centerOf(id, tmp).distanceTo(point) - fat * (this.kind === 'brute' ? 1.8 : 1);
      if (d < reach && (!best || d < best.d)) best = { id, d };
    }
    return best;
  }

  /** Tear a piece off and send it flying. Tearing the chest takes the head and arms with it (split in half). Returns what came off. */
  tear(id: PartId, impulse: THREE.Vector3, debris: DebrisSystem): PartId[] {
    if (id === 'torsoL' || !this.has(id)) return [];
    const gone: PartId[] = [id];
    if (id === 'torsoU') for (const k of ['head', 'armL', 'armR'] as PartId[]) if (this.has(k)) gone.push(k);
    debris.add(this.p[id], impulse.clone().add(new THREE.Vector3(0, 2.5, 0)), id === 'head' ? 0.18 : id === 'torsoU' ? 0.4 : 0.25);
    return gone;
  }
}
