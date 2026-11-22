import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { Cost } from '../game/Progress';
import { heightAt } from './Terrain';

export type PieceType = 'foundation' | 'wall' | 'catwalk';
export const CELL = 4;       // metres per grid cell
export const LEVEL_H = 3;    // metres between floors
export const BUILD_OWNER = 600000;
export const PALETTE = [0x8f95a3, 0xc0553a, 0x3f78c8, 0x4fa86a, 0xe2b84a, 0xe8e4f0];
export const PALETTE_NAMES = ['Steel', 'Rust', 'Ocean', 'Moss', 'Gold', 'Pearl'];
export const COLOR_COST = 5; // tokens per cosmetic colour
export const COST: Record<PieceType, Cost> = { foundation: { stone: 6 }, wall: { plate: 2 }, catwalk: { plate: 2, iron: 1 } };

/**
 * One building piece. Foundations and catwalks live in a cell (cx, cz) at a floor `level` (floor height = level * 3 m).
 * Walls stand on a cell edge: edge 0 = the east edge of the cell, edge 1 = the south edge.
 * Catwalks run along x (axis 0) or z (axis 1).
 */
export interface Piece { id: number; type: PieceType; cx: number; cz: number; level: number; edge: number; axis: number; color: number }
export interface BuildState { next: number; pieces: Piece[] }

export interface Plan { ok: boolean; reason: string; type: PieceType; cx: number; cz: number; level: number; edge: number; axis: number }

const same = (a: Piece | Plan, b: Piece | Plan) => a.type === b.type && a.cx === b.cx && a.cz === b.cz && a.level === b.level
  && (a.type === 'wall' ? a.edge === b.edge : a.type === 'catwalk' ? a.axis === b.axis : true);

export const cellOf = (x: number, z: number): [number, number] => [Math.floor(x / CELL), Math.floor(z / CELL)];
/** Lowest floor level whose top is above `h`. */
export const levelAbove = (h: number) => Math.ceil((h + 0.15) / LEVEL_H);

/** World-space box for a piece (centre and size). */
export function geometry(p: { type: PieceType; cx: number; cz: number; level: number; edge: number; axis: number }): { center: THREE.Vector3; size: THREE.Vector3 } {
  const y = p.level * LEVEL_H;
  switch (p.type) {
    case 'foundation': return { center: new THREE.Vector3((p.cx + 0.5) * CELL, y - 0.3, (p.cz + 0.5) * CELL), size: new THREE.Vector3(CELL, 0.6, CELL) };
    case 'wall': return p.edge === 0
      ? { center: new THREE.Vector3((p.cx + 1) * CELL, y + LEVEL_H / 2, (p.cz + 0.5) * CELL), size: new THREE.Vector3(0.3, LEVEL_H, CELL) }
      : { center: new THREE.Vector3((p.cx + 0.5) * CELL, y + LEVEL_H / 2, (p.cz + 1) * CELL), size: new THREE.Vector3(CELL, LEVEL_H, 0.3) };
    case 'catwalk': return p.axis === 0
      ? { center: new THREE.Vector3((p.cx + 0.5) * CELL, y - 0.1, (p.cz + 0.5) * CELL), size: new THREE.Vector3(CELL, 0.2, 1.6) }
      : { center: new THREE.Vector3((p.cx + 0.5) * CELL, y - 0.1, (p.cz + 0.5) * CELL), size: new THREE.Vector3(1.6, 0.2, CELL) };
  }
}

/** Highest ground in a cell (so the first floor clears it). */
export function cellGround(cx: number, cz: number): { hi: number; lo: number } {
  let hi = -Infinity, lo = Infinity;
  for (const [u, v] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) { const h = heightAt((cx + u) * CELL, (cz + v) * CELL); hi = Math.max(hi, h); lo = Math.min(lo, h); }
  return { hi, lo };
}

const CAP = 700;

/** Foundations, walls and catwalks on a grid: drawn with instancing, solid for the player, saved with the game. */
export class BuildSystem {
  readonly group = new THREE.Group();
  pieces: Piece[] = [];
  private next = 1;
  private meshes: Record<'foundation' | 'wall' | 'deck' | 'rail' | 'pillar', THREE.InstancedMesh>;
  private order: Record<'foundation' | 'wall' | 'deck', number[]> = { foundation: [], wall: [], deck: [] };

  constructor(private world: CollisionWorld) {
    const mat = (rough: number, metal: number) => new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal });
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n = CAP) => { const im = new THREE.InstancedMesh(g, m, n); im.count = 0; im.frustumCulled = false; this.group.add(im); return im; };
    this.meshes = {
      foundation: mk(new THREE.BoxGeometry(1, 1, 1), mat(0.85, 0.15)),
      wall: mk(new THREE.BoxGeometry(1, 1, 1), mat(0.55, 0.45)),
      deck: mk(new THREE.BoxGeometry(1, 1, 1), mat(0.6, 0.4)),
      rail: mk(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 }), CAP * 2),
      pillar: mk(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x59606e, roughness: 0.9 })),
    };
  }

  has(p: Plan | Piece): boolean { return this.pieces.some(q => same(q, p)); }
  get(id: number): Piece | undefined { return this.pieces.find(p => p.id === id); }

  /** Work out what a placement at this aim point would be. `hit` is the piece under the aim (if any). */
  plan(type: PieceType, point: THREE.Vector3, hit: Piece | null, facing: THREE.Vector3): Plan {
    const bad = (reason: string): Plan => ({ ok: false, reason, type, cx: 0, cz: 0, level: 0, edge: 0, axis: 0 });
    let [cx, cz] = cellOf(point.x, point.z), level = 0;
    const axis = Math.abs(facing.x) > Math.abs(facing.z) ? 0 : 1;
    if (type === 'wall') {
      if (!hit) return bad('Aim at the edge of a foundation');
      if (hit.type === 'wall') { const p: Plan = { ok: true, reason: '', type, cx: hit.cx, cz: hit.cz, level: hit.level + 1, edge: hit.edge, axis: 0 }; return this.has(p) ? bad('A wall is already there') : p; }
      cx = hit.cx; cz = hit.cz; level = hit.level;
      const dx = point.x - (cx + 0.5) * CELL, dz = point.z - (cz + 0.5) * CELL;
      let ecx = cx, ecz = cz, edge: number;
      if (Math.abs(dx) > Math.abs(dz)) { edge = 0; if (dx < 0) ecx = cx - 1; } else { edge = 1; if (dz < 0) ecz = cz - 1; }
      const p: Plan = { ok: true, reason: '', type, cx: ecx, cz: ecz, level, edge, axis: 0 };
      return this.has(p) ? bad('A wall is already there') : p;
    }
    // foundation / catwalk
    if (hit) {
      if (hit.type === 'wall') level = hit.level + 1;
      else {
        level = hit.level;
        const dx = point.x - (hit.cx + 0.5) * CELL, dz = point.z - (hit.cz + 0.5) * CELL;
        cx = hit.cx; cz = hit.cz;
        if (Math.abs(dx) > Math.abs(dz)) cx += dx < 0 ? -1 : 1; else cz += dz < 0 ? -1 : 1;
      }
    } else {
      const g = cellGround(cx, cz);
      if (g.lo < -3.5) return bad('Too close to water');
      level = levelAbove(g.hi);
    }
    if (level > 14) return bad('Too high');
    const p: Plan = { ok: true, reason: '', type, cx, cz, level, edge: 0, axis: type === 'catwalk' ? axis : 0 };
    return this.has(p) ? bad('Already built') : p;
  }

  add(p: Omit<Piece, 'id'>): Piece | null {
    if (this.has(p as Piece) || this.pieces.length >= CAP) return null;
    const piece: Piece = { ...p, id: this.next++ };
    this.pieces.push(piece);
    const g = geometry(piece);
    this.world.addBox(g.center, g.size, 0.15, 0, BUILD_OWNER + piece.id);
    this.rebuild();
    return piece;
  }

  remove(id: number): boolean {
    const i = this.pieces.findIndex(p => p.id === id);
    if (i < 0) return false;
    this.pieces.splice(i, 1);
    this.world.removeOwner(BUILD_OWNER + id);
    this.rebuild();
    return true;
  }

  /** Piece under a ray (nearest), with the hit point. */
  pick(ray: THREE.Raycaster): { piece: Piece; point: THREE.Vector3; distance: number } | null {
    const hits = ray.intersectObjects([this.meshes.foundation, this.meshes.wall, this.meshes.deck], false);
    const h = hits[0];
    if (!h || h.instanceId === undefined) return null;
    const key = h.object === this.meshes.foundation ? 'foundation' : h.object === this.meshes.wall ? 'wall' : 'deck';
    const piece = this.get(this.order[key][h.instanceId]);
    return piece ? { piece, point: h.point.clone(), distance: h.distance } : null;
  }

  private rebuild(): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const n = { foundation: 0, wall: 0, deck: 0, rail: 0, pillar: 0 };
    this.order = { foundation: [], wall: [], deck: [] };
    const set = (k: keyof typeof n, p: THREE.Vector3, s: THREE.Vector3, color: number) => {
      const im = this.meshes[k]; im.setMatrixAt(n[k], m.compose(p, q, s)); im.setColorAt(n[k], col.set(color)); n[k]++;
    };
    for (const p of this.pieces) {
      const g = geometry(p);
      if (p.type === 'foundation') {
        set('foundation', g.center, g.size, p.color); this.order.foundation.push(p.id);
        const ground = cellGround(p.cx, p.cz).lo - 1, top = g.center.y - 0.3;
        if (top - ground > 0.4) set('pillar', new THREE.Vector3(g.center.x, (top + ground) / 2, g.center.z), sc.set(1.0, top - ground, 1.0).clone(), 0x59606e);
      } else if (p.type === 'wall') { set('wall', g.center, g.size, p.color); this.order.wall.push(p.id); }
      else {
        set('deck', g.center, g.size, p.color); this.order.deck.push(p.id);
        for (const side of [-1, 1]) {
          const off = 0.78 * side;
          set('rail', new THREE.Vector3(g.center.x + (p.axis === 1 ? off : 0), g.center.y + 1.0, g.center.z + (p.axis === 0 ? off : 0)),
            p.axis === 0 ? new THREE.Vector3(CELL, 0.07, 0.07) : new THREE.Vector3(0.07, 0.07, CELL), 0xf2c230);
          set('rail', new THREE.Vector3(g.center.x + (p.axis === 1 ? off : 0), g.center.y + 0.5, g.center.z + (p.axis === 0 ? off : 0)),
            p.axis === 0 ? new THREE.Vector3(CELL, 0.05, 0.05) : new THREE.Vector3(0.05, 0.05, CELL), 0xf2c230);
        }
      }
    }
    (Object.keys(n) as (keyof typeof n)[]).forEach(k => {
      const im = this.meshes[k]; im.count = n[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  toJSON(): BuildState { return { next: this.next, pieces: this.pieces.map(p => ({ ...p })) }; }

  load(s: BuildState): void {
    for (const p of this.pieces) this.world.removeOwner(BUILD_OWNER + p.id);
    this.pieces = []; this.next = s.next;
    for (const p of s.pieces) { this.pieces.push({ ...p }); const g = geometry(p); this.world.addBox(g.center, g.size, 0.15, 0, BUILD_OWNER + p.id); }
    this.rebuild();
  }
}
