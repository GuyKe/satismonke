import * as THREE from 'three';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { GorillaPlayer } from '../src/player/GorillaPlayer';
import { ArmCalibration, REF_SPAN } from '../src/player/ArmCalibration';

let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failed++; };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const dt = 1 / 72, head = V(0, 1.6, 0);
const settings = () => ({ gravityG: 0.3, jumpMult: 1.25, maxSpeed: 8, laserAlways: false, armSpan: 0 });
const FLOOR_TOP = -1.8;

function floorWorld(slip: number) {
  const w = new CollisionWorld();
  w.addBox(V(0, -2, 0), V(5.2, 0.4, 11), slip);
  return w;
}

// 1. Hand push lifts the body; release launches it upward.
{
  const p = new GorillaPlayer(floorWorld(0.05), settings());
  p.teleport(V(0, FLOOR_TOP, 0));
  const h = [V(-0.3, 0.1, 0), V(0.3, 0.1, 0)];
  p.update(dt, head, h);
  for (let i = 0; i < 12; i++) { h.forEach(x => (x.y -= 0.02)); p.update(dt, head, h); }
  check('pushing down on the floor lifts the body', p.position.y > FLOOR_TOP + 0.1, `y=${p.position.y.toFixed(2)}`);
  for (let i = 0; i < 8; i++) { h.forEach(x => (x.y += 0.05)); p.update(dt, head, h); }
  check('releasing launches upward', p.velocity.y > 0.5, `vy=${p.velocity.y.toFixed(2)}`);
}

// 2. No legs: with hands in the air you never move horizontally and you sink to a torso rest.
{
  const p = new GorillaPlayer(floorWorld(0.05), settings());
  p.teleport(V(0.5, FLOOR_TOP, 0.5));
  const h = [V(-0.3, 1.2, -0.3), V(0.3, 1.2, -0.3)];
  for (let i = 0; i < 400; i++) p.update(dt, head, h);
  const headY = p.position.y + head.y;
  check('no horizontal movement without hand contact', Math.hypot(p.position.x - 0.5, p.position.z - 0.5) < 1e-6);
  check('legless: torso rests on floor, head is low', headY < FLOOR_TOP + 1.0 && headY > FLOOR_TOP + 0.5, `head ${(headY - FLOOR_TOP).toFixed(2)}m above floor`);
}

// 3. Surface slip: same swipe moves you far on sticky surfaces and barely on ice.
function swipe(slip: number): number {
  const p = new GorillaPlayer(floorWorld(slip), settings());
  p.teleport(V(0, FLOOR_TOP, 0));
  // hands pressed lightly into the floor, then dragged backwards (+z) along it
  const h = [V(-0.3, 0, -0.4), V(0.3, 0, -0.4)];
  const press = () => h.forEach(x => (x.y = FLOOR_TOP - 0.02 - p.position.y));
  for (let i = 0; i < 3; i++) { press(); p.update(dt, head, h); }
  const z0 = p.position.z;
  for (let i = 0; i < 15; i++) { h.forEach(x => (x.z += 0.03)); press(); p.update(dt, head, h); }
  return z0 - p.position.z; // body moves forward (-z) when the hands drag back
}
{
  const grippy = swipe(0), ice = swipe(0.95);
  check('swiping a sticky surface moves you', grippy > 0.15, `moved ${grippy.toFixed(2)}m`);
  check('ice gives far less traction than bark', ice < grippy * 0.2, `ice ${ice.toFixed(2)}m vs bark ${grippy.toFixed(2)}m`);
}

// 4. Per-collider slip lookup
{
  const w = new CollisionWorld();
  w.addBox(V(0, 0, 0), V(1, 1, 1), 0.95);
  w.addBox(V(0, -1.5, 0), V(1, 1, 1), 0.0);
  check('slipAt picks the nearest collider', w.slipAt(V(0, 0.55, 0)) === 0.95 && w.slipAt(V(0, -2.05, 0)) === 0);
}

// 5. Arm-span scaling
{
  const s = settings();
  const cal = new ArmCalibration(s);
  check('uncalibrated scale is 1', Math.abs(cal.scale - 1) < 1e-9);
  cal.start();
  const L = V(-0.6, 1.4, 0), R = V(0.6, 1.4, 0); // 1.2 m span: a small player
  for (let i = 0; i < 72 * 6; i++) cal.update(dt, L, R);
  check('calibration stores the measured span', Math.abs(s.armSpan - 1.2) < 1e-6, `span=${s.armSpan}`);
  check('short arms are scaled up to reference reach', Math.abs(cal.scale - REF_SPAN / 1.2) < 1e-6 || cal.scale === 1.6, `scale=${cal.scale.toFixed(2)}`);
  const out = cal.apply(V(0, 1.6, 0), V(0.5, 1.35, 0), V(0, 0, 0)); // hand 0.5m right of shoulders
  check('hand offset from shoulders is scaled', out.x > 0.5 && Math.abs(out.y - 1.35) < 1e-9, `x=${out.x.toFixed(2)}`);
}

// 6. Thin-bar tunnelling
{
  const w = new CollisionWorld(); w.addBox(V(0, 0, 0), V(2, 0.02, 2));
  const out = V(0, 0, 0), n = V(0, 0, 0);
  check('fast hand cannot tunnel through a thin bar', w.sweep(V(0, 0.5, 0), V(0, -0.5, 0), 0.07, out, n) && out.y > 0);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
