import * as THREE from 'three';

export const WATER_Y = -4.0;

import { MapDef, MapId, MAPS, setCurrent } from './MapDef';

/** Winding rivers. x(z) is the centre line; they start near a lake and run across the plains. */
interface River { z0: number; z1: number; x: (z: number) => number; dx: (z: number) => number; width: number; depth: number }
const makeRivers = (m: MapDef): River[] => m.rivers.map(r => ({
  z0: r.z0, z1: r.z1, width: r.width, depth: r.depth,
  x: z => r.a + r.b * z + r.amp * Math.sin(z / r.wl + r.phase), dx: z => r.b + (r.amp / r.wl) * Math.cos(z / r.wl + r.phase),
}));

// The land you are standing on: set once per world with applyMap() (before the planet is built).
let M: MapDef = MAPS.plains;
/** The big lake out in front of the landing site (toward -z) with mesas and spires rising from it. */
export let LAKE = M.lakes[0];
/** More lakes scattered around the world. */
export let LAKES = M.lakes;
export let PONDS = M.ponds;
export let RIVERS: River[] = makeRivers(M);

/** Choose the map the next planet is built from (and everything that reads heights). */
export function setMap(id: MapId): void { setCurrent(MAPS[id]); applyMap(MAPS[id]); }

/** Switch the terrain to a map. Everything that reads heights afterwards sees that map. */
export function applyMap(def: MapDef): void {
  M = def; LAKES = def.lakes; LAKE = def.lakes[0]; PONDS = def.ponds; RIVERS = makeRivers(def);
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Directional sine waves: amplitude, wavelength (m), direction (rad), phase. Gentle: wide open plains.
const WAVES = [
  { a: 1.0, wl: 300, d: 0.3, p: 1.1 }, { a: 0.6, wl: 170, d: 1.4, p: 2.3 }, { a: 0.3, wl: 100, d: 2.6, p: 0.4 },
  { a: 0.15, wl: 60, d: 3.7, p: 5.1 }, { a: 0.07, wl: 38, d: 4.9, p: 3.3 },
].map(w => ({ ...w, k: (Math.PI * 2) / w.wl, cx: Math.cos(w.d), sz: Math.sin(w.d) }));

/** Plains only (no lake or ponds). */
function plains(x: number, z: number): number {
  const fade = smooth(8, 50, Math.hypot(x, z));
  if (fade === 0) return 0;
  let n = 0;
  for (const w of WAVES) n += w.a * Math.sin((x * w.cx + z * w.sz) * w.k + w.p);
  return (n * 4.4 * M.hills + 1.4 + M.base) * fade;
}

// Sharp ridges that rise toward the edge of the world, so it ends in foothills and mountains
const RIDGES = [
  { a: 1.0, wl: 230, d: 0.8, p: 0.3 }, { a: 0.7, wl: 150, d: 2.0, p: 1.7 }, { a: 0.4, wl: 95, d: 3.3, p: 4.0 },
].map(w => ({ ...w, k: (Math.PI * 2) / w.wl, cx: Math.cos(w.d), sz: Math.sin(w.d) }));

function ridge(x: number, z: number): number {
  let n = 0;
  for (const w of RIDGES) { const t = 1 - Math.abs(Math.sin((x * w.cx + z * w.sz) * w.k + w.p)); n += w.a * t * t; }
  return n;
}

/** Narrow valleys that wind through the jungle: deep trenches with gentle walls, kept away from the landing site. */
function canyon(x: number, z: number): number {
  const away = smooth(70, 150, Math.hypot(x, z));
  if (away === 0) return 0;
  const qx = x * 0.006 + 1.3 * Math.sin(z * 0.0045 + 0.7), qz = z * 0.006 + 1.3 * Math.sin(x * 0.0049 + 2.1);
  const a = Math.abs(Math.sin(qx * 2.2 + Math.sin(qz * 3.1) * 0.9));
  const comes = smooth(-0.1, 0.5, Math.sin(x * 0.011 - z * 0.009 + 1.2));    // canyons come and go
  return M.canyons * (1 - smooth(0.04, 0.32, a)) * comes * away;
}

/** Terrain height: flat at the landing spot, rolling plains, foothills, lakes, rivers and ponds. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = plains(x, z);
  const outer = smooth(200, 560, r);
  if (outer > 0) h += outer * M.ridge * ridge(x, z);
  if (M.canyons > 0) h -= canyon(x, z);
  if (M.voidZ !== undefined) h -= 420 * smooth(M.voidZ, M.voidZ + 30, z);   // the cliff and the endless drop behind it
  for (const l of LAKES) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < l.r) h -= l.depth * (1 - smooth(l.r * 0.55, l.r, d));
  }
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) h -= p.depth * (1 - smooth(p.r * 0.35, p.r, d));
  }
  for (const rv of RIVERS) {
    if (z < rv.z0 - 5 || z > rv.z1 + 5) continue;
    const d = Math.abs(x - rv.x(z)) / Math.sqrt(1 + rv.dx(z) ** 2);
    if (d < rv.width) h -= rv.depth * smooth(rv.z0, rv.z0 + 60, z) * (1 - smooth(rv.z1 - 80, rv.z1, z)) * (1 - smooth(rv.width * 0.3, rv.width, d));
  }
  return h;
}

/** Water surface height for each pond: just under the surrounding plain. */
export const pondY = (p: { x: number; z: number }) => plains(p.x, p.z) - 0.7;

/** Winding sandy veins and dirt patches. 0..1. MUST match the GLSL version below. */
export function pathMask(x: number, z: number): number {
  const qx = x * 0.0042 + 1.7 * Math.sin(z * 0.0063 + 1.3);
  const qz = z * 0.0042 + 1.7 * Math.sin(x * 0.0057 + 0.4);
  const a = Math.abs(Math.sin(qx * 3 + Math.sin(qz * 5) * 1.2));
  const b = Math.abs(Math.sin(qz * 2.6 + Math.sin(qx * 4 + 2) * 1.4));
  const v = Math.min(a, b);
  const fade = smooth(-0.2, 0.4, Math.sin(x * 0.013 + z * 0.007 + 0.5)); // veins come and go
  const vein = (1 - smooth(0, 0.04, v)) * fade;
  const blob = smooth(0.82, 0.93, Math.sin(x * 0.012 + 1) * Math.sin(z * 0.01 + 2));
  return Math.max(vein, blob * 0.9);
}

const GLSL_PATH = /* glsl */ `
float sm(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float pathMask(vec2 p){
  float qx = p.x * 0.0042 + 1.7 * sin(p.y * 0.0063 + 1.3);
  float qz = p.y * 0.0042 + 1.7 * sin(p.x * 0.0057 + 0.4);
  float a = abs(sin(qx * 3.0 + sin(qz * 5.0) * 1.2));
  float b = abs(sin(qz * 2.6 + sin(qx * 4.0 + 2.0) * 1.4));
  float v = min(a, b);
  float fade = sm(-0.2, 0.4, sin(p.x * 0.013 + p.y * 0.007 + 0.5));
  float vein = (1.0 - sm(0.0, 0.04, v)) * fade;
  float blob = sm(0.82, 0.93, sin(p.x * 0.012 + 1.0) * sin(p.y * 0.01 + 2.0));
  return max(vein, blob * 0.9);
}`;

/** Polar grid whose rings get wider with distance: fine detail near you, huge reach far away. */
export function buildTerrainMesh(map: THREE.Texture, quality: 'low' | 'medium' | 'high' = 'medium'): THREE.Mesh {
  // Fine, evenly spaced rings out to 520 m (that is where the playable world is), then wide rings to the horizon.
  const nearRings = quality === 'low' ? 80 : quality === 'medium' ? 120 : 150, SEGS = quality === 'low' ? 240 : 340;
  const NEAR_R = 520, R_MIN = 2, R_MAX = 2400, farRings = 26;
  const RINGS = nearRings + farRings;
  const pos: number[] = [0, heightAt(0, 0), 0], uv: number[] = [0, 0], col: number[] = [];
  const idx: number[] = [];
  const VOID = new THREE.Color(0x07040f), pink = new THREE.Color(M.groundA), violet = new THREE.Color(M.groundB), sand = new THREE.Color(M.sand), c = new THREE.Color(), dirt = M.dirt;
  const tint = (x: number, y: number, z: number) => {
    const n = 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.013) * 2) * Math.sin(z * 0.009 + 1);
    c.copy(pink).lerp(violet, n * 0.8 + THREE.MathUtils.clamp(y / 30, 0, 0.3));
    c.lerp(sand, 0.85 * (1 - smooth(WATER_Y + 0.4, WATER_Y + 2.6, y)));
    if (y < -30) c.lerp(VOID, 1 - smooth(-140, -30, y));   // the walls of the void go dark
    col.push(c.r, c.g, c.b);
  };
  tint(0, 0, 0);
  for (let i = 0; i < RINGS; i++) {
    const r = i < nearRings ? R_MIN + (NEAR_R - R_MIN) * (i / (nearRings - 1)) : NEAR_R * Math.pow(R_MAX / NEAR_R, (i - nearRings + 1) / farRings);
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
      pos.push(x, y, z); uv.push(x / 6, z / 6); tint(x, y, z);
    }
  }
  for (let s = 0; s < SEGS; s++) idx.push(0, 1 + ((s + 1) % SEGS), 1 + s);
  for (let i = 0; i < RINGS - 1; i++) {
    for (let s = 0; s < SEGS; s++) {
      const a = 1 + i * SEGS + s, b = 1 + i * SEGS + ((s + 1) % SEGS), d = a + SEGS, e = b + SEGS;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1 });
  // Sandy paths are painted per pixel from the same function the scatter code uses, so grass avoids them.
  mat.onBeforeCompile = shader => {
    shader.uniforms.uDirt = { value: new THREE.Vector3(dirt[0], dirt[1], dirt[2]) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\nuniform vec3 uDirt;\n' + GLSL_PATH)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pm = pathMask(vWXZ) * (1.0 - sm(150.0, 700.0, length(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDirt, pm * 0.92);`);
  };
  return new THREE.Mesh(g, mat);
}
