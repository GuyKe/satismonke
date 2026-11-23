import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * "The Monke Pioneer": an original space-ape explorer in an astronaut suit. Fur in the player's colour, a pale muzzle,
 * big ears and eyes inside a glass helmet with a glowing antenna bulb; a white suit with a chest panel, a life-support
 * pack with hoses, vents and a thruster, a shoulder-pad patch and stripe in the player's colour, a swaying monkey tail; and long stretchy
 * arms with elbow joints and wrist lights ending in gloved fists. The face blinks and smiles. Everything is built from primitives, no assets.
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
  private lids: THREE.Mesh[] = [];
  private smile!: THREE.Mesh; private maw!: THREE.Mesh; private tongue!: THREE.Mesh;
  private mouthOpen = 0; private mouthGoal = 0;
  private tail: THREE.Group[] = [];
  private torsoMesh: THREE.Mesh;
  private elbows: THREE.Mesh[] = []; private bands: THREE.Mesh[] = []; private wristLights: THREE.Mesh[] = [];
  private blinkT = 2 + Math.random() * 3;
  private shoulders: THREE.Mesh[] = [];
  private lastYaw = 0; private swayV = 0;
  private t = Math.random() * 10;
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private q = new THREE.Quaternion();

  private spinners: THREE.Object3D[] = [];

  constructor(color: number, opts: { head?: boolean; suit?: number; hat?: string; badge?: string } = {}) {
    const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.95 });
    const pale = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xf0dcc0), 0.7), roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.2 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1fb5a8, roughness: 0.5 });
    const suit = new THREE.MeshStandardMaterial({ color: opts.suit ?? 0xe9edf5, roughness: 0.65, metalness: 0.05 });     // white suit fabric
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
    const brow = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.35), roughness: 1 });
    for (const sd of [-1, 1]) {
      const eb = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 3, 6), brow); eb.position.set(sd * 0.055, 0.067, -0.1); eb.rotation.z = Math.PI / 2 - sd * 0.22; h.add(eb);   // eyebrows
      const lid = sph(0.032, fur, sd * 0.052, 0.025, -0.097, 1, 0.02, 1); lid.userData.base = 1; this.lids.push(lid); h.add(lid);                                              // eyelids (blink)
      h.add(sph(0.007, white, sd * 0.045, 0.034, -0.14));                                                                                                                       // eye sparkle
      h.add(sph(0.034, pale, sd * 0.085, -0.045, -0.075, 1, 0.8, 0.8));                                                                                                        // cheeks
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 14, Math.PI), black); mouth.position.set(0, -0.075, -0.135); mouth.rotation.z = Math.PI; h.add(mouth); this.smile = mouth;   // smile (closed mouth)
    // open mouth: a dark oval that grows taller the louder you talk, with a tongue inside
    this.maw = sph(0.03, new THREE.MeshStandardMaterial({ color: 0x1a0508, roughness: 0.6 }), 0, -0.082, -0.134, 1.15, 0.4, 0.45); this.maw.visible = false; h.add(this.maw);
    this.tongue = sph(0.02, new THREE.MeshStandardMaterial({ color: 0xe0707e, roughness: 0.7 }), 0, -0.098, -0.138, 1, 0.2, 0.4); this.tongue.visible = false; h.add(this.tongue);
    for (let i = 0; i < 3; i++) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), fur); tuft.position.set((i - 1) * 0.035, 0.125, -0.02); tuft.rotation.z = (1 - i) * 0.35; tuft.rotation.x = -0.25; h.add(tuft); }   // hair tuft
    for (const sd of [-1, 1]) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 6), pale); tuft.position.set(sd * 0.11, -0.07, -0.02); tuft.rotation.z = sd * 2.2; h.add(tuft); }                              // cheek fluff
    // helmet: glass bubble, neck ring, comms pods and a glowing antenna
    h.add(sph(0.225, glass, 0, -0.005, 0.01));
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24), grey); neck.rotation.x = Math.PI / 2; neck.position.set(0, -0.17, 0.02); h.add(neck);
    for (const sd of [-1, 1]) {
      h.add(sph(0.05, grey, sd * 0.215, -0.01, 0.02, 0.6, 1, 1));              // comms pods on the sides
      h.add(sph(0.012, new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1.4 }), sd * 0.228, 0.02, 0.02));   // pod lights
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 10), grey); lamp.position.set(sd * 0.1, 0.19, -0.1); lamp.rotation.x = Math.PI / 2 - 0.3; h.add(lamp);    // helmet lamps
      h.add(sph(0.014, new THREE.MeshStandardMaterial({ color: 0xfff4c8, emissive: 0xfff0b0, emissiveIntensity: 1.6 }), sd * 0.1, 0.195, -0.118));
    }
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.009, 6, 28, Math.PI), accent); brim.rotation.set(0.35, 0, 0); brim.position.set(0, 0.075, -0.02); h.add(brim);   // thin accent ridge over the brow
    const shine = sph(0.05, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }), -0.09, 0.11, -0.185, 1.6, 0.5, 0.2); shine.rotation.z = 0.5; h.add(shine);   // glass glint
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), grey); stalk.position.set(0.1, 0.235, 0.03); stalk.rotation.z = -0.35; h.add(stalk);
    this.bulb = sph(0.018, new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1.2 }), 0.125, 0.285, 0.03);
    h.add(this.bulb);
    // hats sit on top of the helmet
    const hatMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    if (opts.hat === 'party') {
      const hat = new THREE.Group(); hat.position.set(0.03, 0.2, 0.02); hat.rotation.z = -0.18; h.add(hat);
      const cols = [0xff4fa0, 0xffd23a, 0x4fd0ff, 0xff4fa0, 0xffd23a];
      cols.forEach((c, i) => {
        const r0 = 0.115 * (1 - i / cols.length), r1 = 0.115 * (1 - (i + 1) / cols.length), seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.055, 18), hatMat(c));
        seg.position.y = 0.0275 + i * 0.055; hat.add(seg);
      });
      hat.add(sph(0.026, hatMat(0xffffff), 0, 0.29, 0));                       // pom-pom
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, d = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), hatMat(0xffffff)); d.position.set(Math.cos(a) * 0.1, 0.012, Math.sin(a) * 0.1); hat.add(d); }
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.113, 0.004, 4, 24), hatMat(0xffffff)); strap.rotation.x = Math.PI / 2; strap.position.y = 0.005; hat.add(strap);
    } else if (opts.hat === 'beanie') {
      const hat = new THREE.Group(); hat.position.set(0, 0.16, 0.02); h.add(hat);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(0x3f78c8)); cap.position.y = 0.0; hat.add(cap);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.148, 0.026, 8, 24), hatMat(0xf2c230)); cuff.rotation.x = Math.PI / 2; cuff.position.y = 0.004; hat.add(cuff);
      hat.add(sph(0.04, hatMat(0xffffff), 0, 0.15, 0));
    } else if (opts.hat === 'propeller') {
      const hat = new THREE.Group(); hat.position.set(0, 0.17, 0.02); h.add(hat);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(0xe0453a)); hat.add(dome);
      for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8, i * Math.PI / 2, Math.PI / 3), new THREE.MeshStandardMaterial({ color: [0xffd23a, 0x4fd0ff][i % 2], side: THREE.DoubleSide })); p.rotation.x = -Math.PI / 2; p.position.y = 0.095; hat.add(p); }
      const rotor = new THREE.Group(); rotor.position.y = 0.105;
      for (let i = 0; i < 2; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.006, 0.04), hatMat(i ? 0xffd23a : 0x4fd0ff)); blade.rotation.y = i * Math.PI / 2; rotor.add(blade); }
      rotor.add(sph(0.014, hatMat(0xffffff), 0, 0.005, 0)); hat.add(rotor); this.spinners.push(rotor);
    }
    h.visible = opts.head !== false;

    // ---- body (follows the head's yaw, hangs under it) ----
    const b = this.bodyG;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.22, 4, 12), suit); torso.position.y = -0.34; b.add(torso); this.torsoMesh = torso;
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

    // badge on the chest
    if (opts.badge === 'og' || opts.badge === 'star') {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
      if (opts.badge === 'og') {
        g.fillStyle = '#e8b830'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill();
        g.fillStyle = '#1c1200'; g.font = 'bold 66px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('OG', 64, 70);
      } else {
        g.fillStyle = '#e8b830'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 26 : 60, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); } g.closePath(); g.fill();
      }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.042, 24), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.3 }));
      badge.position.set(-0.062, -0.238, -0.1315); badge.rotation.y = Math.PI; b.add(badge);
    }
    // chest emblem, collar, shoulder pads, belt gear
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), accent); emblem.position.set(0.055, -0.235, -0.1295); emblem.rotation.y = Math.PI; b.add(emblem);
    b.add(sph(0.012, pale, 0.055, -0.235, -0.131));
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.022, 8, 22), suit); collar.rotation.x = Math.PI / 2; collar.position.y = -0.14; b.add(collar);
    for (const sd of [-1, 1]) {
      b.add(sph(0.062, suit, sd * 0.165, -0.2, 0.0, 1, 0.8, 1));                                        // shoulder pad
      const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.02, 14), accent); patch.position.set(sd * 0.168, -0.205, 0.0); patch.rotation.z = sd * 0.25; b.add(patch);
      b.add(sph(0.017, new THREE.MeshStandardMaterial({ color: 0xffc94a, emissive: 0xffa800, emissiveIntensity: 0.9 }), sd * 0.19, -0.185, -0.04));   // shoulder beacon
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.04), grey); pouch.position.set(sd * 0.1, -0.5, -0.09); pouch.rotation.y = sd * 0.35; b.add(pouch);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.012, 0.043), accent); flap.position.set(sd * 0.1, -0.472, -0.09); flap.rotation.y = sd * 0.35; b.add(flap);
    }
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.012), new THREE.MeshStandardMaterial({ color: 0xd8c070, metalness: 0.8, roughness: 0.3 })); buckle.position.set(0, -0.5, -0.133); b.add(buckle);
    const wrench = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6), grey); wrench.position.set(-0.13, -0.56, -0.02); wrench.rotation.z = 0.12; b.add(wrench);
    b.add(sph(0.016, grey, -0.133, -0.5, -0.02, 1, 1, 0.6));
    // life-support hoses: pack -> chest, over each shoulder
    for (const sd of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sd * 0.07, -0.19, 0.15), new THREE.Vector3(sd * 0.1, -0.12, 0.07), new THREE.Vector3(sd * 0.115, -0.15, -0.04), new THREE.Vector3(sd * 0.085, -0.25, -0.12)]);
      b.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.011, 6), dark));
      b.add(sph(0.018, grey, sd * 0.085, -0.25, -0.12));
    }
    // pack details: vents, light strip, little dish
    for (let i = 0; i < 4; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.01), dark); v.position.set(0, -0.38 + i * 0.022, 0.212); b.add(v); }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1.2 })); strip.position.set(0, -0.2, 0.212); b.add(strip);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), grey); dish.position.set(0.06, -0.14, 0.17); dish.rotation.x = -0.9; b.add(dish);
    // a monkey tail: a chain of segments that sways and curls up behind the pack
    const tailRoot = new THREE.Group(); tailRoot.position.set(0, -0.5, 0.2); b.add(tailRoot);
    let parent: THREE.Object3D = tailRoot;
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group(); g.position.z = i ? 0.07 : 0; parent.add(g); this.tail.push(g);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.03 - i * 0.0028, 0.05, 3, 8), i === 6 ? pale : fur); seg.rotation.x = Math.PI / 2; seg.position.z = 0.035; g.add(seg);
      parent = g;
    }

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
      for (let f = 0; f < 4; f++) {
        const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, 0.016), grey); knuckle.position.set((f - 1.5) * 0.026, 0.035, -0.04); fist.add(knuckle);   // knuckle plates
        fist.add(sph(0.0155, dark, (f - 1.5) * 0.026, 0.103, -0.042));                                                                                              // fingertip pads
      }
      const wl = sph(0.014, new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x39d8ff, emissiveIntensity: 1 }), 0, -0.045, -0.057); this.wristLights.push(wl); fist.add(wl);   // wrist light
      const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.014, 8, 14), grey); this.elbows.push(elbow);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.01, 8, 14), accent); this.bands.push(band);
      this.fists.push(fist);
      this.group.add(arm, fist, elbow, band, sph(0.055, grey, 0, 0, 0)); this.shoulders.push(this.group.children[this.group.children.length - 1] as THREE.Mesh);
    }
    this.group.add(h, b);
  }

  /** How loud this player is talking right now, 0 (silent) to 1 (shouting): the mouth opens to match. */
  setMouth(loud: number): void { this.mouthGoal = THREE.MathUtils.clamp(loud, 0, 1); }

  /** Put the model where the player is. `head` is eye position, `yaw` the head's heading; hands are world positions. */
  setPose(head: THREE.Vector3, yaw: number, pitch: number, roll: number, left: THREE.Vector3, right: THREE.Vector3, dt: number): void {
    this.t += dt;
    for (const sp of this.spinners) sp.rotation.y += dt * 18;
    this.headG.position.copy(head);
    this.headG.rotation.set(pitch, yaw, roll, 'YXZ');
    this.bodyG.position.copy(head); this.bodyG.rotation.set(0, yaw, 0);
    (this.glow.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(this.t * 9) * 0.5;
    (this.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + Math.sin(this.t * 3) * 0.5;
    // lip sync: the mouth chases the loudness (opens fast, closes a little slower)
    this.mouthOpen += (this.mouthGoal - this.mouthOpen) * Math.min(1, dt * (this.mouthGoal > this.mouthOpen ? 28 : 14));
    const o = this.mouthOpen, talking = o > 0.04;
    this.smile.visible = !talking; this.maw.visible = this.tongue.visible = talking;
    if (talking) { this.maw.scale.set(1.15 * (1 + o * 0.3), 0.4 + o * 1.9, 0.45); this.maw.position.y = -0.078 - o * 0.02; this.tongue.scale.set(1, 0.2 + o * 0.8, 0.4); this.tongue.position.y = -0.09 - o * 0.034; }
    // blink every few seconds, breathe, and sway the tail with how fast you turn
    this.blinkT -= dt; const blink = this.blinkT < 0.12 ? 1 : 0.02; if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3.5;
    for (const lid of this.lids) lid.scale.y = blink * 0.95 + 0.02;
    this.torsoMesh.scale.set(1, 1 + Math.sin(this.t * 1.7) * 0.012, 1 + Math.sin(this.t * 1.7) * 0.02);
    let dy = yaw - this.lastYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    this.lastYaw = yaw; this.swayV += ((dt > 0 ? THREE.MathUtils.clamp(dy / dt, -4, 4) : 0) - this.swayV) * Math.min(1, dt * 6);
    this.tail.forEach((g, i) => { g.rotation.x = -0.32 - i * 0.04 + Math.sin(this.t * 2 - i * 0.5) * 0.05; g.rotation.y = Math.sin(this.t * 1.6 - i * 0.7) * 0.18 + this.swayV * 0.09; });
    for (const wl of this.wristLights) (wl.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(this.t * 4) * 0.4;
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
      this.shoulders[i].position.copy(sh);
      this.elbows[i].position.copy(sh).addScaledVector(d, len * 0.5); this.elbows[i].quaternion.copy(this.q); this.elbows[i].rotateX(Math.PI / 2);
      this.bands[i].position.copy(sh).addScaledVector(d, len * 0.82); this.bands[i].quaternion.copy(this.q); this.bands[i].rotateX(Math.PI / 2);
    });
  }

  set visible(v: boolean) { this.group.visible = v; }
}
