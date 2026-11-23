import * as THREE from 'three';
import { PlayerModel } from '../world/PlayerModel';
import { Rig } from './Rig';
import type { Look } from '../game/Cosmetics';
import type { ModeId } from './Mode';

const stone = () => new THREE.MeshStandardMaterial({ color: 0x9a9fa8, roughness: 0.95, flatShading: true });

/** Prop Hunt: a statue of your pioneer searching with binoculars, and a grey cube with a smile beside it. */
function propHunt(look: Look): THREE.Group {
  const g = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.3, 14), stone()); ped.position.set(-0.55, 0.15, 0); g.add(ped);
  const model = new PlayerModel(look.fur, { suit: look.suit, hat: look.hat, badge: look.badge });
  // both fists up to the face, holding binoculars
  model.setPose(new THREE.Vector3(0, 1.55, 0), 0, 0.05, 0, new THREE.Vector3(-0.11, 1.5, -0.26), new THREE.Vector3(0.11, 1.5, -0.26), 0);
  const bin = new THREE.Group();
  for (const x of [-0.07, 0.07]) { const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5 })); tube.position.set(x, 0, 0); bin.add(tube); const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), new THREE.MeshBasicMaterial({ color: 0x4f7ac8, toneMapped: false })); lens.position.set(x, 0, -0.101); lens.rotation.y = Math.PI; bin.add(lens); }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2f3a })); bin.add(bridge);
  bin.position.set(0, 1.56, -0.2); model.group.add(bin);
  model.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m !== undefined && !bin.children.includes(m) && !bin.getObjectById(m.id)) m.material = stone(); });
  model.group.position.set(-0.55, 0.3 - 0.0, 0); model.group.rotation.y = 0.5; g.add(model.group);
  // the grey cube
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  x.fillStyle = '#8d929c'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#1c1f26'; x.beginPath(); x.arc(40, 52, 9, 0, 7); x.arc(88, 52, 9, 0, 7); x.fill();
  x.lineWidth = 7; x.lineCap = 'round'; x.strokeStyle = '#1c1f26'; x.beginPath(); x.arc(64, 70, 30, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const grey = new THREE.MeshStandardMaterial({ color: 0x8d929c, roughness: 0.8 }), face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), [grey, grey, grey, grey, face, grey]);   // +z is the smiling face
  cube.position.set(0.7, 0.45, 0.1); cube.rotation.y = -0.45; cube.userData.bob = true; g.add(cube);
  g.userData.cube = cube;
  return g;
}

/** Backrooms: a slab of yellow wall, a humming light, a bottle of almond water on a table, and something tall behind the corner. */
function backrooms(): THREE.Group {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xc9b45a, roughness: 0.95 }), carpet = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.8), carpet); floor.position.set(0, 0.05, 0); g.add(floor);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 0.12), wall); back.position.set(0, 1.0, -0.9); g.add(back);
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 1.2), wall); side.position.set(-1.2, 1.0, -0.3); g.add(side);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.125), new THREE.MeshStandardMaterial({ color: 0xbba74d })); s.position.set(-1.0 + i * 0.4, 1.0, -0.9); g.add(s); }
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0xfffbe0, toneMapped: false })); light.position.set(0, 1.9, -0.3); g.add(light);
  const lamp = new THREE.PointLight(0xfff0b8, 1.4, 6); lamp.position.set(0, 1.7, -0.2); g.add(lamp);
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x6a4a28 })); table.position.set(0.5, 0.7, 0.1); g.add(table);
  for (const [x, z] of [[0.25, -0.05], [0.75, -0.05], [0.25, 0.25], [0.75, 0.25]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.05), new THREE.MeshStandardMaterial({ color: 0x6a4a28 })); leg.position.set(x, 0.37, z); g.add(leg); }
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.26, 10), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, emissive: 0x204a6a })); bottle.position.set(0.5, 0.86, 0.1); g.add(bottle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), new THREE.MeshStandardMaterial({ color: 0xffffff })); cap.position.set(0.5, 1.0, 0.1); g.add(cap);
  const rig = new Rig('lurker'); rig.group.scale.setScalar(0.55); rig.group.position.set(-0.85, 0.1, -0.6); rig.group.rotation.y = 0.5; g.add(rig.group); g.userData.rig = rig;
  return g;
}

/** Sandbox: a brute, and a dummy that has lost its head and an arm. */
function sandbox(): THREE.Group {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0x6a4a78, roughness: 1 })); ground.position.y = 0.06; g.add(ground);
  const brute = new Rig('brute', { body: 0x4a8a3a, limb: 0x5a9a48, skin: 0x7ac85a }); brute.group.scale.setScalar(0.5); brute.group.position.set(-0.45, 0.12, 0); brute.group.rotation.y = 0.5; g.add(brute.group);
  const dummy = new Rig('dummy'); dummy.group.scale.setScalar(0.62); dummy.group.position.set(0.6, 0.12, 0.05); dummy.group.rotation.y = -0.5; g.add(dummy.group);
  const gone = new THREE.Group(); gone.position.set(0.95, 0.4, 0.6);   // the head that came off, mid-flight
  dummy.tear('head', new THREE.Vector3(0, 0, 0), { add: (obj: THREE.Object3D) => { g.attach(obj); obj.position.set(0.95, 0.65, 0.5); obj.scale.setScalar(0.62); } } as never);
  dummy.tear('armR', new THREE.Vector3(0, 0, 0), { add: (obj: THREE.Object3D) => { g.attach(obj); obj.position.set(1.15, 0.2, 0.2); obj.rotation.set(0.4, 0, 1.3); obj.scale.setScalar(0.62); } } as never);
  g.userData.brute = brute;
  return g;
}

export function makeDiorama(id: ModeId, look: Look): THREE.Group {
  const g = id === 'propHunt' ? propHunt(look) : id === 'backrooms' ? backrooms() : sandbox();
  g.userData.t = 0; return g;
}

/** A little life for a diorama: the cube bobs, the lurker sways, the brute breathes. */
export function animateDiorama(g: THREE.Group, dt: number): void {
  g.userData.t += dt; const t = g.userData.t as number;
  const cube = g.userData.cube as THREE.Object3D | undefined; if (cube) { cube.position.y = 0.45 + Math.sin(t * 2) * 0.04; cube.rotation.z = Math.sin(t * 1.3) * 0.05; }
  (g.userData.rig as Rig | undefined)?.update(t, false); (g.userData.brute as Rig | undefined)?.update(t, false);
}
