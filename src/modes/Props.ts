import * as THREE from 'three';

export interface PropDef { id: string; name: string; /** Radius of its collider and its rough height. */ r: number; h: number }
export const PROPS: PropDef[] = [
  { id: 'crate', name: 'CRATE', r: 0.55, h: 1.0 }, { id: 'barrel', name: 'BARREL', r: 0.42, h: 1.0 }, { id: 'bush', name: 'BUSH', r: 0.7, h: 0.9 },
  { id: 'rock', name: 'ROCK', r: 0.8, h: 0.9 }, { id: 'mushroom', name: 'MUSHROOM', r: 0.5, h: 1.3 }, { id: 'lamp', name: 'LAMP POST', r: 0.15, h: 2.6 },
  { id: 'tree', name: 'SMALL TREE', r: 0.7, h: 3.2 }, { id: 'pillar', name: 'PILLAR', r: 0.45, h: 1.9 },
];

const m = (c: number, rough = 0.85, emissive = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, emissive, emissiveIntensity: emissive ? 1.2 : 0, flatShading: true });

/** A prop model, standing on y = 0. Every player builds the same ones, so they match across the network. */
export function makeProp(id: string, seed = 0): THREE.Group {
  const g = new THREE.Group(), tint = (seed % 4);
  const add = (o: THREE.Mesh, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); g.add(o); return o; };
  switch (id) {
    case 'crate': {
      add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m(0xb08a50)), 0, 0.5, 0);
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.02, 0.08), m(0x6a4a28)), x, 0.5, z);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 1.02), m(0x6a4a28)), 0, 1.0, 0); break;
    }
    case 'barrel': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1, 12), m([0x3f78c8, 0xc0553a, 0x4fa86a, 0xe2b84a][tint])), 0, 0.5, 0);
      for (const y of [0.18, 0.82]) add(new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.03, 5, 14).rotateX(Math.PI / 2), m(0x3a4252)), 0, y, 0); break;
    }
    case 'bush': add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), m([0xd04fb8, 0x9a5fe0, 0x3fc7b4, 0xe86aa0][tint])), 0, 0.45, 0).scale.set(1.2, 0.85, 1.1); break;
    case 'rock': add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), m(0x6a6478)), 0, 0.4, 0).scale.set(1, 0.75, 0.9); break;
    case 'mushroom': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.9, 8), m(0xf0e6ff)), 0, 0.45, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), m([0xff5ad0, 0x5af0ff, 0xb08cff, 0xffd45a][tint], 0.6)), 0, 0.85, 0); break;
    }
    case 'lamp': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 2.4, 8), m(0x3a4252)), 0, 1.2, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m(0xffe9a0, 0.4, 0xffd060)), 0, 2.5, 0); break;
    }
    case 'tree': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 7), m(0x9a8fb8)), 0, 0.9, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), m([0x2fd1c1, 0xff6fb5, 0xffa940, 0x7d6bff][tint], 0.7)), 0, 2.4, 0); break;
    }
    case 'pillar': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 1.8, 8), m(0xb8a8c8)), 0, 0.9, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 1.0), m(0x8a7a9a)), 0, 1.88, 0); break;
    }
  }
  return g;
}

export const propDef = (id: string): PropDef => PROPS.find(p => p.id === id) ?? PROPS[0];
