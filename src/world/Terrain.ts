import * as THREE from 'three';

export const WATER_Y = -6;

/** One big lake out in front of the landing site (toward -z) with mesas and spires rising from it. */
export const LAKE = { x: 0, z: -560, r: 360, depth: 20 };
export const PONDS = [
  { x: -95, z: -70, r: 17, depth: 3.4 },
  { x: 140, z: 55, r: 13, depth: 2.8 },
  { x: -60, z: 120, r: 11, depth: 2.4 },
];

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
  return (n * 4.4 + 1.4) * fade;
}

/** Terrain height: flat at the landing spot, gentle rolling plains, ponds, and a big lake ahead. */
export function heightAt(x: number, z: number): number {
  let h = plains(x, z);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r) h -= LAKE.depth * (1 - smooth(LAKE.r * 0.55, LAKE.r, dl));
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) h -= p.depth * (1 - smooth(p.r * 0.35, p.r, d));
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
export function buildTerrainMesh(map: THREE.Texture): THREE.Mesh {
  const RINGS = 90, SEGS = 160, R_MIN = 2, R_MAX = 2400;
  const pos: number[] = [0, heightAt(0, 0), 0], uv: number[] = [0, 0], col: number[] = [];
  const idx: number[] = [];
  const pink = new THREE.Color(0xc650b4), violet = new THREE.Color(0x8a4acc), sand = new THREE.Color(0xe6b4d8), c = new THREE.Color();
  const tint = (x: number, y: number, z: number) => {
    const n = 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.013) * 2) * Math.sin(z * 0.009 + 1);
    c.copy(pink).lerp(violet, n * 0.8 + THREE.MathUtils.clamp(y / 30, 0, 0.3));
    c.lerp(sand, 0.85 * (1 - smooth(WATER_Y + 0.4, WATER_Y + 2.6, y)));
    col.push(c.r, c.g, c.b);
  };
  tint(0, 0, 0);
  for (let i = 0; i < RINGS; i++) {
    const r = R_MIN * Math.pow(R_MAX / R_MIN, i / (RINGS - 1));
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
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\n' + GLSL_PATH)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pm = pathMask(vWXZ) * (1.0 - sm(150.0, 700.0, length(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.44, 0.32), pm * 0.92);`);
  };
  return new THREE.Mesh(g, mat);
}
