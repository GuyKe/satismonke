import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a3142'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#3d4863'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#323b52'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Builds the hull, props and matching colliders. Returns a group to add to the scene. */
export function buildCapsule(world: CollisionWorld): THREE.Group {
  const root = new THREE.Group();
  const R = world.radius, hs = world.halfSegment;

  const grid = gridTexture();
  grid.repeat.set(8, 4);
  const hullMat = new THREE.MeshStandardMaterial({ map: grid, side: THREE.BackSide, roughness: 0.8, metalness: 0.3 });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, hs * 2, 48, 1, true).rotateX(Math.PI / 2), hullMat);
  root.add(cyl);
  for (const s of [-1, 1]) {
    // Hemisphere only: a full sphere would put a back-face wall across the interior.
    const geo = new THREE.SphereGeometry(R, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(s * Math.PI / 2);
    const cap = new THREE.Mesh(geo, hullMat);
    cap.position.z = s * hs;
    root.add(cap);
  }

  // Ribs along the hull
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x59627a, roughness: 0.5, metalness: 0.6 });
  for (let z = -4.5; z <= 4.5; z += 1.5) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.06, 8, 48), ribMat);
    rib.position.z = z;
    root.add(rib);
  }

  // Solid props: each box is both a collider and a mesh
  const propMat = new THREE.MeshStandardMaterial({ color: 0x8a93a8, roughness: 0.6, metalness: 0.4 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.5, metalness: 0.3 });
  const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat = propMat) => {
    const size = new THREE.Vector3(sx, sy, sz);
    world.addBox(new THREE.Vector3(cx, cy, cz), size);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    root.add(m);
    return m;
  };

  addBox(0, -2.0, 0, 5.2, 0.4, 11, new THREE.MeshStandardMaterial({ map: grid, roughness: 0.9 })); // floor, top at y=-1.8
  addBox(0, -1.05, -3.6, 1.9, 1.5, 0.4);       // menu console pedestal (front face z=-3.4)
  addBox(-1.6, -1.45, 1.0, 0.8, 0.7, 0.8, accentMat); // crates
  addBox(1.7, -1.35, -0.5, 0.9, 0.9, 0.9, accentMat);
  addBox(0.8, -1.55, 3.4, 0.6, 0.5, 0.6, accentMat);
  addBox(0, 0.4, 0.5, 5.4, 0.1, 0.1, ribMat);  // monkey bars to push off
  addBox(0, 0.9, -1.8, 5.4, 0.1, 0.1, ribMat);
  addBox(0, 0.2, 3.0, 5.4, 0.1, 0.1, ribMat);

  // Lights
  root.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242e, 1.1));
  for (const z of [-3, 0, 3]) {
    const l = new THREE.PointLight(0xfff0d8, 12, 9, 1.6);
    l.position.set(0, 2.2, z);
    root.add(l);
  }
  return root;
}
