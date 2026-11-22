import * as THREE from 'three';

export type PropKind = 'campfire' | 'lamp';

export interface PropMesh {
  group: THREE.Group;
  /** Called every frame for flicker. */
  tick(t: number): void;
  light: THREE.PointLight | null;
}

const rock = new THREE.MeshStandardMaterial({ color: 0x8a8394, roughness: 0.95, flatShading: true });
const logMat = new THREE.MeshStandardMaterial({ color: 0x7a4f2a, roughness: 0.9 });

/** Ring of stones, crossed logs and a flickering flame. */
export function buildCampfire(withLight = true): PropMesh {
  const group = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + (i % 3) * 0.03, 0), rock);
    s.position.set(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6); s.scale.y = 0.7; group.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6), logMat);
    l.position.y = 0.16; l.rotation.set(Math.PI / 2 - 0.3, (i / 3) * Math.PI * 2, 0); l.rotateX(0); group.add(l);
  }
  const flames: THREE.Mesh[] = [];
  const cols = [0xff5a1a, 0xff9a2a, 0xffd860];
  cols.forEach((c, i) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 - i * 0.07, 0.9 - i * 0.2, 8).translate(0, (0.9 - i * 0.2) / 2, 0),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    f.position.y = 0.2; group.add(f); flames.push(f);
  });
  let light: THREE.PointLight | null = null;
  if (withLight) { light = new THREE.PointLight(0xff8a40, 5, 14, 2); light.position.y = 0.9; group.add(light); }
  return {
    group, light,
    tick(t) {
      flames.forEach((f, i) => { const k = 1 + 0.18 * Math.sin(t * (9 + i * 4) + i) + 0.08 * Math.sin(t * 23 + i * 2); f.scale.set(1 - (k - 1) * 0.4, k, 1 - (k - 1) * 0.4); });
      if (light) light.intensity = 4 + Math.sin(t * 13) * 0.8 + Math.sin(t * 29) * 0.5;
    },
  };
}

/** Tall steel post topped with a glowing crystal. */
export function buildLamp(withLight = true): PropMesh {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xaab6c8, metalness: 0.4, roughness: 0.45 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.25, 10), steel); base.position.y = 0.12; group.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3, 8), steel); pole.position.y = 1.7; group.add(pole);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0).scale(0.8, 1.4, 0.8),
    new THREE.MeshBasicMaterial({ color: 0x6fe8ff, toneMapped: false }));
  crystal.position.y = 3.4; group.add(crystal);
  let light: THREE.PointLight | null = null;
  if (withLight) { light = new THREE.PointLight(0x7ff0ff, 7, 22, 2); light.position.y = 3.4; group.add(light); }
  return {
    group, light,
    tick(t) { crystal.rotation.y = t * 1.2; crystal.position.y = 3.4 + Math.sin(t * 2) * 0.06; if (light) light.intensity = 6.5 + Math.sin(t * 3) * 0.5; },
  };
}

/** One translucent material for placement previews. */
export function makeGhost(group: THREE.Group): THREE.MeshBasicMaterial {
  const gm = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.45, depthWrite: false });
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = gm; });
  group.userData.ghostMaterial = gm;
  return gm;
}
