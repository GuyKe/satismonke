import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Settings } from '../settings';

const G = 9.81;
const HAND_R = 0.07;
const HEAD_R = 0.14;
const SKIN = 0.003;
// The avatar is a floating head + torso + hands: no legs. The torso hangs under the head, so
// there is nothing to stand or walk on; you rest on the floor and only hands move you.
const BODY_R = 0.25;
const BODY_DROP = 0.45; // torso centre below the head
const HISTORY = 6;
const MAX_DT = 1 / 30;

class Hand {
  prev = new THREE.Vector3();      // last resolved world position
  prevLocal = new THREE.Vector3(); // last rig-local position
  world = new THREE.Vector3();     // resolved world position this frame
  touching = false;
  started = false;                 // true on the frame contact begins
  init = false;
}

/**
 * Gorilla-tag style locomotion, independent of WebXR so it can be unit tested.
 *
 * `position` is the origin of the play space (floor under the player).
 * Each frame, feed the head and hand positions in play-space coordinates.
 */
export class GorillaPlayer {
  readonly position = new THREE.Vector3(0, -1.8, 2);
  readonly velocity = new THREE.Vector3();
  readonly hands = [new Hand(), new Hand()];
  readonly handRadius = HAND_R;

  private history: THREE.Vector3[] = [];
  /** Slip of the surface most recently touched by a hand (for the HUD). */
  lastSlip = 0;
  private touchedLast = false;
  private n = new THREE.Vector3();

  constructor(private world: CollisionWorld, private settings: Settings) {}

  get anyTouching(): boolean { return this.hands[0].touching || this.hands[1].touching; }

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.history.length = 0;
    this.touchedLast = false;
    for (const h of this.hands) h.init = false;
  }

  update(dtRaw: number, headLocal: THREE.Vector3, handLocals: (THREE.Vector3 | null)[]): void {
    const dt = Math.min(dtRaw, MAX_DT);
    if (dt <= 0) return;
    const start = this.position.clone();

    // 1. Free flight: gravity and integration only while no hand held us last frame.
    if (!this.touchedLast) {
      this.velocity.y -= G * this.settings.gravityG * dt;
      this.velocity.multiplyScalar(1 - 0.05 * dt); // tiny drag keeps 0g from drifting forever
      this.position.addScaledVector(this.velocity, dt);
    }

    // 2. Hands: each touching hand stays on its surface and the body moves instead.
    const nOut = new THREE.Vector3();
    const resolved = new THREE.Vector3();
    const wanted = new THREE.Vector3();
    const handDelta = new THREE.Vector3();
    let touching = false;
    handLocals.forEach((local, i) => {
      const hand = this.hands[i];
      hand.started = false;
      if (!local) { hand.touching = false; hand.init = false; return; }
      wanted.copy(this.position).add(local);
      if (!hand.init) {
        hand.prev.copy(wanted); hand.prevLocal.copy(local); hand.init = true;
      }
      const hit = this.world.sweep(hand.prev, wanted, HAND_R + SKIN, resolved, nOut);
      if (hit) {
        // Normal push-out plus grip: tangential hand motion moves the body the other way.
        const shift = resolved.clone().sub(wanted);
        handDelta.copy(local).sub(hand.prevLocal);
        handDelta.addScaledVector(nOut, -handDelta.dot(nOut));
        const slip = this.world.slipAt(resolved);
        this.lastSlip = slip;
        shift.addScaledVector(handDelta, -(1 - slip)); // slip: how much of the swipe is lost
        this.position.add(shift);
        if (!hand.touching) hand.started = true;
        touching = true;
      }
      hand.touching = hit;
      hand.world.copy(this.position).add(local);
      hand.prev.copy(hand.world);
      hand.prevLocal.copy(local);
    });

    // 3. Head collider: never let the camera enter walls.
    const head = this.position.clone().add(headLocal);
    if (this.world.pushOut(head, HEAD_R, nOut)) {
      this.position.add(head.sub(this.position).sub(headLocal));
      const into = this.velocity.dot(nOut);
      if (into < 0) this.velocity.addScaledVector(nOut, -into);
    }

    // 3b. Legless torso hanging under the head: stops you sinking into floors/crates, but gives
    //     no way to stand up or walk, so only hand pushes can move you.
    const body = this.position.clone().add(headLocal);
    body.y -= BODY_DROP;
    if (this.world.pushOut(body, BODY_R, nOut)) {
      this.position.add(body.sub(this.position).sub(headLocal).add(new THREE.Vector3(0, BODY_DROP, 0)));
      const into = this.velocity.dot(nOut);
      if (into < 0) this.velocity.addScaledVector(nOut, -into);
    }

    // 4. Velocity bookkeeping and launch on release.
    const measured = this.position.clone().sub(start).divideScalar(dt);
    this.history.push(measured);
    if (this.history.length > HISTORY) this.history.shift();

    if (touching) {
      this.velocity.copy(measured);
    } else if (this.touchedLast) {
      const avg = new THREE.Vector3();
      for (const v of this.history) avg.add(v);
      avg.divideScalar(this.history.length).multiplyScalar(this.settings.jumpMult);
      if (avg.length() > this.settings.maxSpeed) avg.setLength(this.settings.maxSpeed);
      this.velocity.copy(avg);
    }
    this.touchedLast = touching;
  }
}
