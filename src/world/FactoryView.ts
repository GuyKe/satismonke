import * as THREE from 'three';
import { Factory, Machine, MachineKind, Link, ITEM_COLOR, ItemType } from '../game/Factory';
import { heightAt, WATER_Y } from './Terrain';

const steel = new THREE.MeshStandardMaterial({ color: 0x8c97a8, metalness: 0.4, roughness: 0.5 });
const dark = new THREE.MeshStandardMaterial({ color: 0x3a4252, metalness: 0.3, roughness: 0.6 });
const orange = new THREE.MeshStandardMaterial({ color: 0xe08a3c, metalness: 0.3, roughness: 0.55 });
const blue = new THREE.MeshStandardMaterial({ color: 0x3f78c8, metalness: 0.3, roughness: 0.5 });
const brick = new THREE.MeshStandardMaterial({ color: 0x8a5a48, roughness: 0.85 });
const crate = new THREE.MeshStandardMaterial({ color: 0xb08a50, roughness: 0.8 });

export interface MachineMesh { group: THREE.Group; spin: THREE.Object3D[]; flame: THREE.Mesh | null; light: THREE.Mesh }

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r1: number, r2: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); o.position.set(x, y, z); return o; };

/** A simple low-poly model for each machine. Front is +z. */
export function buildMachineMesh(kind: MachineKind): MachineMesh {
  const group = new THREE.Group(), spin: THREE.Object3D[] = [];
  let flame: THREE.Mesh | null = null;
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x40ff70, toneMapped: false });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lightMat);
  switch (kind) {
    case 'miner': {
      group.add(box(1.7, 0.4, 1.7, dark, 0, 0.2, 0), cyl(0.38, 0.5, 1.8, orange, 0, 1.3, 0), box(0.9, 0.5, 0.5, steel, 0, 2.3, 0.3));
      const drill = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 8).rotateX(Math.PI), steel); drill.position.set(0, 0.3, 0); group.add(drill); spin.push(drill);
      light.position.set(0, 2.5, 0.65); break;
    }
    case 'smelter': {
      group.add(box(2.1, 1.7, 1.7, brick, 0, 0.85, 0), cyl(0.28, 0.34, 1.4, dark, 0.6, 2.3, -0.3), box(0.9, 0.7, 0.1, new THREE.MeshBasicMaterial({ color: 0xff8a30, toneMapped: false }), -0.2, 0.7, 0.88));
      light.position.set(0.8, 1.55, 0.88); break;
    }
    case 'constructor': {
      group.add(box(2.3, 1.3, 1.9, blue, 0, 0.65, 0), box(0.5, 1.2, 0.5, dark, -0.6, 1.9, 0));
      const arm = new THREE.Group(); arm.position.set(-0.6, 2.45, 0); arm.add(box(1.5, 0.22, 0.22, steel, 0.65, 0, 0), box(0.25, 0.7, 0.25, dark, 1.4, -0.35, 0)); group.add(arm); spin.push(arm);
      light.position.set(0.9, 1.1, 0.97); break;
    }
    case 'storage': {
      group.add(box(1.7, 1.0, 1.3, crate, 0, 0.5, 0), box(1.8, 0.14, 1.4, dark, 0, 1.07, 0), box(1.72, 0.12, 0.05, new THREE.MeshStandardMaterial({ color: 0xf2c230 }), 0, 0.6, 0.66));
      light.position.set(0.7, 1.2, 0.5); break;
    }
    case 'burner': {
      group.add(cyl(0.85, 0.95, 1.4, dark, 0, 0.7, 0), cyl(0.2, 0.26, 1.2, steel, 0.4, 1.9, 0));
      flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.9, toneMapped: false })); flame.position.set(0, 1.55, 0); group.add(flame);
      light.position.set(0, 1.35, 0.9); break;
    }
    case 'splitter': {
      group.add(box(1.4, 0.9, 1.4, steel, 0, 0.45, 0), box(0.4, 0.5, 0.4, dark, 0, 1.15, 0));
      for (const [dx, col] of [[-0.55, 0x6fe8ff], [0, 0xffd45a], [0.55, 0xff7a5a]] as [number, number][]) group.add(box(0.28, 0.12, 0.5, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }), dx, 0.96, 0.75));
      light.position.set(0, 1.5, 0); break;
    }
    case 'sink': {
      group.add(box(1.8, 0.7, 1.8, dark, 0, 0.35, 0), cyl(0.7, 0.8, 0.8, steel, 0, 1.0, 0));
      const blades = new THREE.Group(); blades.position.y = 1.42;
      for (let i = 0; i < 4; i++) { const bl = box(1.3, 0.06, 0.18, new THREE.MeshStandardMaterial({ color: 0xc8d0e0, metalness: 0.8, roughness: 0.3 }), 0, 0, 0); bl.rotation.y = (i * Math.PI) / 4; blades.add(bl); }
      group.add(blades); spin.push(blades);
      light.position.set(0.7, 0.8, 0.9); break;
    }
    case 'solar': {
      group.add(cyl(0.1, 0.14, 1.4, steel, 0, 0.7, 0));
      const panel = box(2.6, 0.08, 1.7, new THREE.MeshStandardMaterial({ color: 0x1a2a52, metalness: 0.6, roughness: 0.25, emissive: 0x0a1a40, emissiveIntensity: 0.6 }), 0, 1.6, 0);
      panel.rotation.x = -0.45; group.add(panel);
      light.position.set(0, 0.5, 0.2); break;
    }
  }
  group.add(light);
  return { group, spin, flame, light };
}

/** Moving-belt texture: chevrons that scroll (the offset is shared by every belt). */
function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = '#2a2f3a'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#586074'; g.lineWidth = 6; g.beginPath(); g.moveTo(8, 50); g.lineTo(32, 18); g.lineTo(56, 50); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Belt { link: number; mesh: THREE.Mesh; pts: THREE.Vector3[]; cum: number[]; len: number }

/** Draws the machines, belts and the items riding on them. */
export class FactoryView {
  readonly group = new THREE.Group();
  private machines = new Map<number, MachineMesh & { id: number }>();
  private belts = new Map<number, Belt>();
  private items: THREE.InstancedMesh;
  private tex = beltTexture();
  private t = 0;
  /** Where the player is; machines far from here skip their animation. */
  readonly focus = new THREE.Vector3();
  private static MAX_ITEMS = 700;

  constructor() {
    this.items = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), FactoryView.MAX_ITEMS);
    this.items.frustumCulled = false; this.items.count = 0;
    this.items.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.items);
  }

  addMachine(m: Machine): void {
    const mm = buildMachineMesh(m.kind);
    mm.group.position.set(m.x, m.y, m.z); mm.group.rotation.y = m.yaw;
    mm.group.traverse(o => { o.userData.machineId = m.id; });
    this.group.add(mm.group);
    this.machines.set(m.id, { ...mm, id: m.id });
  }

  removeMachine(id: number): void {
    const mm = this.machines.get(id); if (!mm) return;
    this.group.remove(mm.group); this.machines.delete(id);
  }

  /** Route a belt from one machine to another along the ground. Returns its length in metres. */
  static path(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 2)), pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
      pts.push(new THREE.Vector3(x, Math.max(heightAt(x, z), WATER_Y + 0.1) + 0.35, z));
    }
    return pts;
  }

  static pathLength(pts: THREE.Vector3[]): number { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }

  addLink(l: Link, a: THREE.Vector3, b: THREE.Vector3): void {
    const pts = FactoryView.path(a, b), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], W = 0.28;
    pts.forEach((p, i) => {
      const dir = (pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)])).setY(0).normalize();
      const nx = -dir.z * W, nz = dir.x * W;
      pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
      uv.push(0, cum[i] / 1.5, 1, cum[i] / 1.5);
      if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.tex, side: THREE.DoubleSide, roughness: 0.8 }));
    this.group.add(mesh);
    this.belts.set(l.id, { link: l.id, mesh, pts, cum, len: cum[cum.length - 1] });
  }

  removeLink(id: number): void {
    const b = this.belts.get(id); if (!b) return;
    this.group.remove(b.mesh); b.mesh.geometry.dispose(); this.belts.delete(id);
  }

  /** Machine under a ray, if any (nearest). */
  pick(ray: THREE.Raycaster): { id: number; distance: number } | null {
    const objs: THREE.Object3D[] = [];
    this.machines.forEach(m => objs.push(m.group));
    const hit = ray.intersectObjects(objs, true)[0];
    if (!hit) return null;
    const id = hit.object.userData.machineId as number | undefined;
    return id === undefined ? null : { id, distance: hit.distance };
  }

  position(id: number): THREE.Vector3 | null { return this.machines.get(id)?.group.position ?? null; }

  update(dt: number, f: Factory): void {
    this.t += dt;
    this.tex.offset.y -= dt * 1.5 / 1.5; // belts scroll at belt speed
    const tmp = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (const l of f.links) {
      const b = this.belts.get(l.id); if (!b) continue;
      for (const it of l.items) {
        if (n >= FactoryView.MAX_ITEMS) break;
        const d = it.t * b.len;
        let i = 1; while (i < b.cum.length - 1 && b.cum[i] < d) i++;
        const k = (d - b.cum[i - 1]) / Math.max(1e-4, b.cum[i] - b.cum[i - 1]);
        const p = b.pts[i - 1].clone().lerp(b.pts[i], Math.min(Math.max(k, 0), 1));
        tmp.makeTranslation(p.x, p.y + 0.16, p.z);
        this.items.setMatrixAt(n, tmp); this.items.setColorAt(n, col.set(ITEM_COLOR[it.type as ItemType])); n++;
      }
    }
    this.items.count = n;
    this.items.instanceMatrix.needsUpdate = true;
    if (this.items.instanceColor) this.items.instanceColor.needsUpdate = true;

    for (const m of f.machines) {
      const mm = this.machines.get(m.id); if (!mm) continue;
      const on = m.active && f.power.ratio > 0;
      if (mm.group.position.distanceToSquared(this.focus) < 70 * 70) for (const s of mm.spin) s.rotation.y += dt * (on ? 4 * f.power.ratio : 0); // far machines are just maths
      if (mm.flame) { const lit = m.fuel > 0; mm.flame.visible = lit; mm.flame.scale.set(1, 0.8 + 0.3 * Math.sin(this.t * 14), 1); }
      const bad = m.status === 'No power' || m.status === 'Out of fuel' || m.status === 'Not on ore' || m.status === 'Breaker tripped';
      const warn = m.status === 'Output blocked' || m.status === 'Waiting for input' || m.status === 'Low power' || m.status === 'Night' || m.status === 'Standby';
      (mm.light.material as THREE.MeshBasicMaterial).color.set(bad ? 0xff3030 : warn ? 0xffb030 : 0x40ff70);
    }
  }
}
