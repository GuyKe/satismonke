import * as THREE from 'three';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { GorillaPlayer } from '../src/player/GorillaPlayer';
import { addPlatformColliders } from '../src/world/MenuRoom';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const settings = { gravityG: 0.3, jumpMult: 1.25, maxSpeed: 8, laserAlways: false, armSpan: 0 };
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const THIN = process.argv[2] === 'thin';
let worst = Infinity, falls = 0, through = 0, left = 0; const examples: string[] = [];
for (let run = 0; run < 200; run++) {
  const w = new CollisionWorld(); w.hull = false; if (THIN) w.addBox(V(0, -0.3, 0), V(400, 0.6, 400), 0.15); else addPlatformColliders(w);
  const p = new GorillaPlayer(w, settings); p.teleport(V(0, 0, 2.4));
  const head = V((rnd() - 0.5) * 0.6, 1.3 + rnd() * 0.5, (rnd() - 0.5) * 0.6);
  const hands = [V(-0.3, 0.7 + rnd() * 0.5, -0.3), V(0.3, 0.7 + rnd() * 0.5, -0.3)];
  const vel = [V(0, 0, 0), V(0, 0, 0)];
  const dt = 1 / (72 + Math.floor(rnd() * 3) * 18);
  let minBody = Infinity;
  for (let i = 0; i < 1500; i++) {
    for (let h = 0; h < 2; h++) {
      if (rnd() < 0.05) vel[h].set((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6);
      hands[h].addScaledVector(vel[h], dt);
      hands[h].x = THREE.MathUtils.clamp(hands[h].x, -0.9, 0.9); hands[h].y = THREE.MathUtils.clamp(hands[h].y, process.argv[3] === 'handsup' ? 0.5 : -0.2, 1.7); hands[h].z = THREE.MathUtils.clamp(hands[h].z, -0.9, 0.5);
    }
    head.x += (rnd() - 0.5) * 0.01; head.y = THREE.MathUtils.clamp(head.y + (rnd() - 0.5) * 0.01, 0.9, 1.9);
    if (rnd() < 0.004) head.y = 0.9 + rnd() * 1.0; // sudden crouch / stand up
    p.update(dt, head, [hands[0], hands[1]]);
    const bodyY = p.position.y + head.y - 0.45;
    minBody = Math.min(minBody, bodyY);
    const outside = !THIN && (Math.abs(p.position.x + head.x) > 9.2 || Math.abs(p.position.z + head.z) > 9.2);
    if (outside) { left++; falls++; break; }
    if (p.position.y + head.y < -0.2) { through++; falls++; if (examples.length < 3) examples.push(`run ${run} i=${i} dt=${dt.toFixed(4)} rigY=${p.position.y.toFixed(2)} bodyY=${bodyY.toFixed(2)} hands=${hands.map(h => h.toArray().map(v => v.toFixed(2)).join(',')).join(' | ')} vel=${p.velocity.toArray().map(v => v.toFixed(1))}`); break; }
  }
  worst = Math.min(worst, minBody);
}
console.log('through floor:', through, 'left platform:', left); examples.forEach(e => console.log(e));
console.log('lowest body centre (floor top is 0, resting is ~0.25):', worst.toFixed(3), '| runs that fell or left the platform:', falls, '/ 200');
