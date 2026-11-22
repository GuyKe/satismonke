import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';

/** Everything in the Hub is laid out in local space: x = long axis, z = depth, y = up from the highest ground point. */
export const HUB_RADIUS = 7;            // footprint check radius
const FLOOR = 0.9;                      // floor height above the ground
const WALL_H = 2.4;                     // short: walls only 2.4 m
const ROOF_Y = FLOOR + WALL_H;          // underside of the roof

interface Part { c: [number, number, number]; s: [number, number, number]; mat: 'steel' | 'dark' | 'concrete' | 'hazard' | 'wood'; solid?: boolean }

/** Structural pieces: each becomes a mesh and (unless `solid === false`) a box collider. */
function parts(): Part[] {
  const p: Part[] = [
    { c: [0, FLOOR - 2.5, 0], s: [8.4, 5, 5.4], mat: 'concrete' },                       // foundation block (hides slopes)
    { c: [0, FLOOR - 0.03, 0], s: [8.4, 0.06, 5.4], mat: 'dark', solid: false },          // deck plate
    { c: [0, FLOOR + WALL_H / 2, -2.55], s: [8.4, WALL_H, 0.2], mat: 'steel' },                 // back wall
    { c: [0, FLOOR + WALL_H / 2, 2.55], s: [8.4, WALL_H, 0.2], mat: 'steel' },              // front wall
    { c: [0, ROOF_Y + 0.12, 0], s: [9.2, 0.25, 6.2], mat: 'dark' },                        // roof
    { c: [0, ROOF_Y + 0.32, 0], s: [8.0, 0.16, 0.5], mat: 'steel', solid: false },         // roof ridge rib
    { c: [-1.9, FLOOR + 0.45, -1.95], s: [2.4, 0.9, 0.8], mat: 'wood' },                   // crafting bench
    { c: [2.0, FLOOR + 0.375, -1.95], s: [1.8, 0.75, 0.8], mat: 'steel' },                 // computer desk
    { c: [2.0, FLOOR + 0.22, -0.9], s: [0.5, 0.44, 0.5], mat: 'dark' },                    // stool
  ];
  // wall base hazard stripes + posts
  for (const z of [-2.43, 2.43]) p.push({ c: [0, FLOOR + 0.12, z], s: [8.4, 0.24, 0.26], mat: 'hazard', solid: false });
  for (const x of [-4.1, 4.1]) for (const z of [-2.55, 2.55]) p.push({ c: [x, FLOOR + WALL_H / 2, z], s: [0.3, WALL_H + 0.05, 0.3], mat: 'dark' });
  // stairs on both open ends: 3 steps down to the ground
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) {
    const top = FLOOR - 0.225 * (k + 1), h = top + 3;
    p.push({ c: [e * (4.2 + 0.275 + 0.55 * k), top - h / 2, 0], s: [0.55, h, 3.2], mat: k % 2 ? 'steel' : 'dark' });
    p.push({ c: [e * (4.2 + 0.275 + 0.55 * k), top - 0.01, 0], s: [0.55, 0.03, 3.2], mat: 'hazard', solid: false });
  }
  return p;
}

let hazardTex: THREE.CanvasTexture | null = null;
function hazard(): THREE.CanvasTexture {
  if (hazardTex) return hazardTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = '#f2c230'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#1a1a1a';
  for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 16, 64); g.lineTo(i + 80, 0); g.lineTo(i + 64, 0); g.fill(); }
  hazardTex = new THREE.CanvasTexture(c); hazardTex.wrapS = hazardTex.wrapT = THREE.RepeatWrapping; hazardTex.colorSpace = THREE.SRGBColorSpace;
  hazardTex.repeat.set(6, 1);
  return hazardTex;
}

/** World placement: where the hub's origin, yaw and height are. */
export interface HubPose { x: number; y: number; z: number; yaw: number }

/** Local position -> world position for a given pose. */
export function toWorld(l: THREE.Vector3 | [number, number, number], pose: HubPose): THREE.Vector3 {
  const [lx, ly, lz] = Array.isArray(l) ? l : [l.x, l.y, l.z];
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return new THREE.Vector3(pose.x + lx * c + lz * s, pose.y + ly, pose.z - lx * s + lz * c);
}

/** Add the Hub's solid boxes to the collision world. */
export function addHubColliders(world: CollisionWorld, pose: HubPose): void {
  for (const p of parts()) {
    if (p.solid === false) continue;
    world.addBox(toWorld(p.c, pose), new THREE.Vector3(...p.s), 0.1, pose.yaw);
  }
}

export interface HubMesh {
  group: THREE.Group;
  /** Mount points for the interactive screens (local space). */
  benchScreenAt: THREE.Vector3;
  computerScreenAt: THREE.Vector3;
}

/** Build the steel Hub: low house, roof, two long walls, open stair ends, bench and computer desk. */
export function buildHubMesh(ghost = false): HubMesh {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xaab6c8, metalness: 0.4, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5b6679, metalness: 0.3, roughness: 0.55 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6a6072, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.85 });
  const haz = new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.6 });
  const mats = { steel, dark, concrete, hazard: haz, wood };

  for (const p of parts()) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...p.s), mats[p.mat]);
    m.position.set(...p.c); group.add(m);
  }

  // glowing window slits and ceiling light strips
  const glow = new THREE.MeshBasicMaterial({ color: 0x6fe8ff, toneMapped: false });
  for (const z of [-2.66, 2.66]) for (const x of [-2.4, 0, 2.4]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.04), glow); w.position.set(x, FLOOR + 1.7, z); group.add(w);
  }
  for (const z of [-1.4, 1.4]) { const s = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 0.25), glow); s.position.set(0, ROOF_Y - 0.02, z); group.add(s); }

  // roof extras: antenna with a blinking-red beacon, and a HUB sign on the front wall
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.4, 6), dark); mast.position.set(3.2, ROOF_Y + 1.1, -1.5); group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false })); beacon.position.set(3.2, ROOF_Y + 1.85, -1.5); group.add(beacon);
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 64;
  const g = sc.getContext('2d')!; g.fillStyle = '#12202a'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#6fe8ff'; g.font = 'bold 48px monospace'; g.textAlign = 'center'; g.fillText('HUB', 128, 50);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), toneMapped: false }));
  sign.position.set(0, ROOF_Y - 0.4, 2.67); group.add(sign);

  // bench tools and a keyboard
  const toolMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd6, metalness: 0.8, roughness: 0.3 });
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.25), toolMat); anvil.position.set(-2.7, FLOOR + 0.99, -1.95); group.add(anvil);
  const vice = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), dark); vice.position.set(-1.2, FLOOR + 1.0, -1.95); group.add(vice);
  const hammer = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6).rotateZ(Math.PI / 2), wood); hammer.position.set(-1.9, FLOOR + 0.93, -1.7); group.add(hammer);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), toolMat); head.position.set(-1.7, FLOOR + 0.95, -1.7); group.add(head);
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.2), dark); kb.position.set(2.0, FLOOR + 0.77, -1.7); group.add(kb);
  const pc = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.08), dark); pc.position.set(2.0, FLOOR + 1.1, -2.22); group.add(pc); // monitor housing

  if (ghost) { // translucent preview: one shared material, tinted by the caller
    const gm = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.4, depthWrite: false });
    group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = gm; });
    group.userData.ghostMaterial = gm;
  }
  return { group, benchScreenAt: new THREE.Vector3(-1.9, FLOOR + 1.62, -2.43), computerScreenAt: new THREE.Vector3(2.0, FLOOR + 1.1, -2.15) };
}
