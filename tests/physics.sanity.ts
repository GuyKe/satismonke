import * as THREE from 'three';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { GorillaPlayer } from '../src/player/GorillaPlayer';
const w = new CollisionWorld();
w.addBox(new THREE.Vector3(0,-2,0), new THREE.Vector3(5.2,0.4,11));
const s = { gravityG: 0.3, jumpMult: 1.25, maxSpeed: 8, laserAlways: false };
const p = new GorillaPlayer(w, s);
p.teleport(new THREE.Vector3(0,-1.8,0));
const head = new THREE.Vector3(0,1.6,0), dt = 1/72;
// settle: hands hovering above floor
const hands = [new THREE.Vector3(-0.3,0.3,-0.3), new THREE.Vector3(0.3,0.3,-0.3)];
for (let i=0;i<20;i++) p.update(dt, head, hands);
console.log('after settle y=', p.position.y.toFixed(3), '(no hands touching -> falls only until head hits nothing)');
// reset to standing, then push down with both hands for 15 frames then lift
p.teleport(new THREE.Vector3(0,-1.8,0));
const h2 = [new THREE.Vector3(-0.3,0.1,0), new THREE.Vector3(0.3,0.1,0)];
p.update(dt, head, h2);
for (let i=0;i<12;i++){ h2.forEach(h=>h.y-=0.02); p.update(dt, head, h2); }
console.log('touching', p.anyTouching, 'y', p.position.y.toFixed(3));
for (let i=0;i<8;i++){ h2.forEach(h=>h.y+=0.05); p.update(dt, head, h2); }
console.log('after release: vel', p.velocity.toArray().map(v=>v.toFixed(2)), 'y', p.position.y.toFixed(3));
for (let i=0;i<30;i++) p.update(dt, head, h2);
console.log('airborne later: y', p.position.y.toFixed(3));
// tunnelling: fast hand through thin bar
const w2 = new CollisionWorld(); w2.addBox(new THREE.Vector3(0,0,0), new THREE.Vector3(2,0.02,2));
const out=new THREE.Vector3(), n=new THREE.Vector3();
console.log('tunnel hit', w2.sweep(new THREE.Vector3(0,0.5,0), new THREE.Vector3(0,-0.5,0), 0.07, out, n), 'y', out.y.toFixed(3));
