import * as THREE from 'three';

export const WATER_Y = -6;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Directional sine waves: amplitude, wavelength (m), direction (rad), phase
const WAVES = [
  { a: 1.0, wl: 260, d: 0.3, p: 1.1 }, { a: 0.6, wl: 140, d: 1.4, p: 2.3 }, { a: 0.45, wl: 80, d: 2.6, p: 0.4 },
  { a: 0.3, wl: 50, d: 3.7, p: 5.1 }, { a: 0.18, wl: 34, d: 4.9, p: 3.3 }, { a: 0.08, wl: 22, d: 0.9, p: 4.4 },
].map(w => ({ ...w, k: (Math.PI * 2) / w.wl, cx: Math.cos(w.d), sz: Math.sin(w.d) }));

/** Terrain height. Flat around the landing spot, then rolling hills and basins. */
export function heightAt(x: number, z: number): number {
  const fade = smooth(8, 50, Math.hypot(x, z));
  if (fade === 0) return 0;
  let n = 0;
  for (const w of WAVES) n += w.a * Math.sin((x * w.cx + z * w.sz) * w.k + w.p);
  return n * 7 * fade;
}

/** Polar grid whose rings get wider with distance: fine detail near you, huge reach far away. */
export function buildTerrainMesh(map: THREE.Texture): THREE.Mesh {
  const RINGS = 90, SEGS = 160, R_MIN = 2, R_MAX = 2400;
  const pos: number[] = [0, heightAt(0, 0), 0], uv: number[] = [0, 0], col: number[] = [];
  const idx: number[] = [];
  const pink = new THREE.Color(0xd04fb0), violet = new THREE.Color(0x7a42c8), sand = new THREE.Color(0xe6b4d8), c = new THREE.Color();
  const tint = (x: number, y: number, z: number) => {
    const n = 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.013) * 2) * Math.sin(z * 0.009 + 1);
    c.copy(pink).lerp(violet, n * 0.8 + THREE.MathUtils.clamp(y / 30, 0, 0.3));
    if (y < WATER_Y + 1.2) c.lerp(sand, 0.8);
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
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1 }));
}
