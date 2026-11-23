/**
 * The three planets you can land on. They share the same objectives, items and rules; what changes is the shape of the
 * land and how much there is of everything.
 */
export type MapId = 'plains' | 'jungle' | 'desert';
export const MAP_IDS: MapId[] = ['plains', 'jungle', 'desert'];

interface Lake { x: number; z: number; r: number; depth: number }
interface RiverDef { z0: number; z1: number; width: number; depth: number; a: number; b: number; amp: number; wl: number; phase: number }

export interface MapDef {
  id: MapId; name: string; blurb: string[]; seed: number;
  /** Star ratings, 1 to 5, shown when you choose a map. */
  ratings: { difficulty: number; space: number; resources: number };
  // ---- the shape of the land ----
  /** Multiplier on the rolling hills. */
  hills: number;
  /** Raises the whole land (so canyons stay dry). */
  base: number;
  /** Height of the foothills and mountains toward the edge. */
  ridge: number;
  /** Depth of canyons in metres (0 = none). */
  canyons: number;
  lakes: Lake[]; ponds: Lake[]; rivers: RiverDef[];
  // ---- how much of everything (1 = the grassy plains) ----
  /** Punches a tree takes (missing: the usual 2, or 1 with an axe). */
  treeHits?: number;
  /** Open fields cut out of the forest (jungle). */
  clearings?: number;
  trees: number; treeGap: number; clusters: number; boulders: number; ores: number; crystals: number; mush: number; grass: number; sites: number; animals: number;
  // ---- colours ----
  groundA: number; groundB: number; sand: number; dirt: [number, number, number];
  /** Grass blades: hue base, hue spread, saturation, lightness. */
  grassHsl: [number, number, number, number];
  treePalette: number[]; pinePalette: number[]; trunk: number;
  /** Boulder hue and saturation, mesa rock bands, mesa top colour, and the far mountains (low, mid). */
  rock: [number, number]; mesa: number[]; mesaCap: number; mountain: [number, number];
}

const PLAINS_LAKES: Lake[] = [
  { x: 0, z: -560, r: 360, depth: 20 }, { x: -430, z: 150, r: 175, depth: 15 }, { x: 440, z: -170, r: 190, depth: 16 },
  { x: 250, z: 480, r: 150, depth: 14 }, { x: -260, z: 540, r: 135, depth: 13 }, { x: -520, z: -330, r: 140, depth: 13 },
];
const PLAINS_PONDS: Lake[] = [
  { x: -95, z: -70, r: 17, depth: 3.4 }, { x: 140, z: 55, r: 13, depth: 2.8 }, { x: -60, z: 120, r: 11, depth: 2.4 },
  { x: 190, z: -210, r: 20, depth: 3.8 }, { x: -210, z: -150, r: 16, depth: 3.2 }, { x: 60, z: 230, r: 14, depth: 3.0 },
  { x: -300, z: 40, r: 19, depth: 3.6 }, { x: 330, z: 130, r: 15, depth: 3.0 }, { x: -140, z: 300, r: 18, depth: 3.4 },
  { x: 120, z: -330, r: 12, depth: 2.6 }, { x: -380, z: 290, r: 17, depth: 3.2 }, { x: 20, z: 380, r: 13, depth: 2.8 },
];
const PLAINS_RIVERS: RiverDef[] = [
  { z0: -270, z1: 540, width: 18, depth: 8.5, a: 70, b: 0.25, amp: 55, wl: 95, phase: 0 },
  { z0: -330, z1: 600, width: 20, depth: 9, a: -300, b: 0.1, amp: 70, wl: 130, phase: 1 },
  { z0: -200, z1: 560, width: 16, depth: 8, a: 330, b: -0.15, amp: 50, wl: 110, phase: 2 },
];

/** Deterministic scatter for the desert's oases. */
function oases(): Lake[] {
  let s = 99; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out: Lake[] = [{ x: 70, z: -95, r: 24, depth: 3.6 }];
  while (out.length < 22) {
    const a = r() * Math.PI * 2, d = 110 + r() * 340, x = Math.cos(a) * d, z = Math.sin(a) * d, rad = 18 + r() * 18;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < o.r + rad + 40)) continue;
    out.push({ x, z, r: rad, depth: 3 + r() * 1.6 });
  }
  return out;
}

export const MAPS: Record<MapId, MapDef> = {
  plains: {
    id: 'plains', name: 'GRASSY PLAINS', blurb: ['Rolling purple-pink fields,', 'lakes and a few forests.'], seed: 7,
    ratings: { difficulty: 2, space: 4, resources: 3 },
    hills: 1, base: 0, ridge: 17, canyons: 0, lakes: PLAINS_LAKES, ponds: PLAINS_PONDS, rivers: PLAINS_RIVERS,
    trees: 1, treeGap: 9, clusters: 1, boulders: 1, ores: 1, crystals: 1, mush: 1, grass: 1, sites: 1, animals: 1,
    groundA: 0xc650b4, groundB: 0x8a4acc, sand: 0xe6b4d8, dirt: [0.66, 0.44, 0.32],
    grassHsl: [0.76, 0.2, 0.55, 0.42],
    treePalette: [0x2fd1c1, 0xff6fb5, 0xffa940, 0x7d6bff], pinePalette: [0x38c9a0, 0x9a6bff, 0xff7ac0, 0x4aa8ff], trunk: 0x9a8fb8,
    rock: [0.74, 0.12], mesa: [0x8a6a9a, 0xb08ab8, 0x6a4f86, 0xc4a0b0], mesaCap: 0xb25ac8, mountain: [0x4f3585, 0x8566b8],
  },
  jungle: {
    id: 'jungle', name: 'CROWDED JUNGLE', blurb: ['Thick forest, steep hills and', 'canyons. Cramped but rich.'], seed: 21,
    ratings: { difficulty: 3, space: 1, resources: 5 },
    hills: 1.7, base: 7, ridge: 24, canyons: 8,
    lakes: [{ x: 0, z: -560, r: 250, depth: 20 }, { x: -430, z: 170, r: 110, depth: 15 }, { x: 420, z: 300, r: 100, depth: 14 }],
    ponds: PLAINS_PONDS.filter((_, i) => i % 2 === 0).map(p => ({ ...p, r: p.r * 0.7 })),
    rivers: PLAINS_RIVERS.map(r => ({ ...r, width: r.width * 0.65 })),
    treeHits: 6, clearings: 10,
    trees: 39, treeGap: 2.8, clusters: 6.5, boulders: 2, ores: 2.4, crystals: 2.2, mush: 1.6, grass: 1.2, sites: 1.5, animals: 1.2,
    groundA: 0x2fb870, groundB: 0x178a5a, sand: 0x6a8a52, dirt: [0.34, 0.26, 0.16],
    grassHsl: [0.36, 0.1, 0.65, 0.34],
    treePalette: [0x1fbf6a, 0x14935b, 0x7fe05a, 0x2fd1a0], pinePalette: [0x0f7a55, 0x1da07a, 0x58c46a, 0x2d8c6a], trunk: 0x6b4a2f,
    rock: [0.3, 0.14], mesa: [0x5a7a5a, 0x7a9a68, 0x486a52, 0x8aa070], mesaCap: 0x3f9a4a, mountain: [0x1f4a3a, 0x4a8a6a],
  },
  desert: {
    id: 'desert', name: 'SANDY DESERT', blurb: ['Endless dunes and oases.', 'Wide open, but little to find.'], seed: 33,
    ratings: { difficulty: 4, space: 5, resources: 2 },
    hills: 2.3, base: 2.5, ridge: 14, canyons: 0,
    lakes: PLAINS_LAKES.map(l => ({ ...l, r: l.r * 1.1 })), ponds: oases(),
    rivers: PLAINS_RIVERS.slice(0, 2).map(r => ({ ...r, width: r.width * 1.1 })),
    trees: 0.2, treeGap: 22, clusters: 0.3, boulders: 0.55, ores: 0.42, crystals: 0.5, mush: 0.25, grass: 0.12, sites: 0.7, animals: 0.7,
    groundA: 0xf2d08c, groundB: 0xdcaa5e, sand: 0xf3dca8, dirt: [0.82, 0.62, 0.38],
    grassHsl: [0.12, 0.05, 0.5, 0.5],
    treePalette: [0x9bbf5a, 0xd8b45a, 0x6fa05a, 0xc8a050], pinePalette: [0x7fa050, 0xb09040, 0x5f9050, 0x9a8a48], trunk: 0x8a6a40,
    rock: [0.08, 0.38], mesa: [0xc98a50, 0xe0a868, 0xa86a40, 0xd8b078], mesaCap: 0xe0b878, mountain: [0x8a5a38, 0xcaa070],
  },
};

let current: MapDef = MAPS.plains;
export const getMap = (): MapDef => current;
/** Used by Terrain.setMap (which also reshapes the land). */
export const setCurrent = (d: MapDef): void => { current = d; };
export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && (MAP_IDS as string[]).includes(v);
