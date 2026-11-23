import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Animal, makeGround, makeFlyer } from './Animals';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildHubMesh, addHubColliders, HUB_RADIUS, HubMesh, HubPose } from './Hub';
import { buildCampfire, buildLamp, PropKind, PropMesh } from './Props';
import type { PlanetState } from '../game/Save';
import type { Ore } from '../game/Progress';
import type { Quality } from '../settings';
import { Zone, exposure } from '../game/Hazards';
import { heightAt, buildTerrainMesh, pathMask, PONDS, LAKE, pondY, WATER_Y } from './Terrain';
import { getMap, MapDef } from './MapDef';
import { makeWater } from './Animals';

export interface TreeRec {
  pine: boolean; x: number; y: number; z: number; h: number;
  color: number; trunkIdx: number; foliageIdx: number; felled: boolean;
  trunkLocal: THREE.Matrix4; foliageLocal: THREE.Matrix4;
  /** Puts the tree's colliders back when it regrows. */
  addColliders?: () => void;
  hits: number; lastHit: number;
}

/** Collider owner ids: trees use their index; these are bases for other things. */
export const POD_OWNER = 100000;
export const BOULDER_OWNER = 200000;
export const CRYSTAL_OWNER = 300000;
export const ORE_OWNER = 400000;
export const MACHINE_OWNER = 500000;
export const CRASH_OWNER = 700000;
export const BUSH_OWNER = 800000;

/** Ore deposits: colour, punches to break by hand, and how much they give. */
export const ORE_DEF: Record<Ore, { color: number; rock: number; hits: number; yield: [number, number]; glow: number }> = {
  copper: { color: 0xe08a3c, rock: 0x5a4a44, hits: 2, yield: [2, 3], glow: 0.1 },
  iron: { color: 0x8fa6c8, rock: 0x464c58, hits: 3, yield: [2, 3], glow: 0 },
  gold: { color: 0xffd23a, rock: 0x5c554a, hits: 3, yield: [1, 2], glow: 0.3 },
  plasma: { color: 0xc04dff, rock: 0x362b48, hits: 4, yield: [1, 1], glow: 1.4 },
  uranium: { color: 0x7dff5a, rock: 0x233323, hits: 4, yield: [1, 2], glow: 1.5 },
};
interface OreRec { type: Ore; x: number; y: number; z: number; r: number; hits: number; broken: boolean; slot: number; purity: number; matrix: THREE.Matrix4; /** Slot of the gold marker above a pure node (-1 = none). */ mark: number }
/** Trees and rocks (boulders and ore deposits) grow back this long after they are used up. */
export const RESPAWN_SECONDS = 300;
export type Loot = Partial<Record<'steel' | 'plate' | 'wire' | 'crystal' | 'core' | 'drive' | 'artifact', number>>;
interface SiteRec { x: number; y: number; z: number; hits: number; looted: boolean; discovered: boolean; loot: Loot }

interface CrystalRec { x: number; y: number; z: number; h: number; r: number; color: number; hits: number; broken: boolean }

interface BoulderRec { x: number; y: number; z: number; r: number; hits: number; broken: boolean; matrix: THREE.Matrix4 }

export const DAY_SECONDS = 7 * 60;
export const NIGHT_SECONDS = 5 * 60;
const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
const SKY_R = 1500;
const ABOVE_WATER = WATER_Y + 1.2;
/** Radius of the playable world in metres (terrain, trees, ores and creatures are spread out to here). */
export const WORLD_R = 440;

/** Detail multipliers per graphics setting (they decide how many things the planet is generated with). */
const QUALITY: Record<Quality, { grass: number; animals: number; fish: number; trees: number; boulders: number; ores: number; mush: number; crystals: number; rocks: number; mountains: number; cull: number }> = {
  low: { grass: 0.45, animals: 0.45, fish: 0.5, trees: 0.55, boulders: 0.55, ores: 0.6, mush: 0.5, crystals: 0.6, rocks: 0.6, mountains: 0.6, cull: 110 },
  medium: { grass: 1, animals: 0.8, fish: 0.8, trees: 1, boulders: 1, ores: 1, mush: 1, crystals: 1, rocks: 1, mountains: 1, cull: 160 },
  high: { grass: 1.3, animals: 1, fish: 1, trees: 1.2, boulders: 1.2, ores: 1.2, mush: 1.3, crystals: 1.2, rocks: 1.2, mountains: 1, cull: 220 },
};

function rngFrom(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function groundTexture(rng: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 256); // multiplied with the terrain's vertex colours
  for (let i = 0; i < 2600; i++) {
    const l = 70 + rng() * 40;
    g.fillStyle = `hsl(0 0% ${l}%)`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function saturnTextures(): { body: THREE.CanvasTexture; ring: THREE.CanvasTexture } {
  const b = document.createElement('canvas'); b.width = 16; b.height = 256;
  const g = b.getContext('2d')!;
  const bands = ['#f4e3b0', '#e8c987', '#d9a85f', '#f0d8a0', '#c99a5a', '#ebd09a', '#dcb877', '#f6e6bb'];
  for (let y = 0; y < 256; y++) {
    const k = Math.floor((y / 256) * bands.length * 3) % bands.length;
    g.fillStyle = bands[(k + Math.floor(Math.sin(y * 0.21) * 1.2 + 1)) % bands.length];
    g.fillRect(0, y, 16, 1);
  }
  const r = document.createElement('canvas'); r.width = r.height = 512;
  const rg = r.getContext('2d')!;
  rg.translate(256, 256);
  for (let rad = 256; rad > 130; rad -= 2) {
    const a = rad > 215 && rad < 225 ? 0 : 0.35 + 0.55 * Math.abs(Math.sin(rad * 0.37));
    rg.strokeStyle = `rgba(${210 + (rad % 30)},${180 + (rad % 25)},${130},${a})`;
    rg.lineWidth = 2.2; rg.beginPath(); rg.arc(0, 0, rad, 0, Math.PI * 2); rg.stroke();
  }
  const body = new THREE.CanvasTexture(b), ring = new THREE.CanvasTexture(r);
  body.colorSpace = ring.colorSpace = THREE.SRGBColorSpace;
  return { body, ring };
}

function rngFromSeed(seed: number) { return rngFrom(seed); }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSun, uHorizon, uZenith, uSunCol;
  uniform float uDay, uNight, uDusk, uTime;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h < 0.0 ? uHorizon : mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    float sd = max(dot(d, uSun), 0.0);
    col += uSunCol * (pow(sd, 5.0) * 0.35 + pow(sd, 40.0) * 0.6) * (0.25 + 0.75 * uDay);
    // sunset and sunrise: warm bands that hug the horizon on the side of the sun
    vec3 hz = normalize(vec3(d.x, 0.0001, d.z)), sz = normalize(vec3(uSun.x, 0.0001, uSun.z));
    float toward = pow(max(dot(hz, sz), 0.0), 2.5);
    float band = exp(-abs(h) * 9.0) * toward * uDusk;
    col += mix(vec3(1.0, 0.32, 0.38), vec3(1.0, 0.68, 0.25), smoothstep(0.0, 0.35, h) * 2.0) * band * 1.15;
    col += vec3(0.8, 0.3, 0.7) * exp(-pow((h - 0.22) * 5.0, 2.0)) * toward * uDusk * 0.35;
    // drifting clouds, lit from the sun's side
    if (h > 0.015) {
      vec2 p = d.xz / (h + 0.18) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
      float n = fbm(p) + 0.35 * fbm(p * 3.1 - uTime * 0.02);
      float c = smoothstep(0.62, 0.95, n) * smoothstep(0.015, 0.25, h);
      vec3 lit = mix(vec3(0.95, 0.9, 1.0), uSunCol * 1.2, 0.35 + 0.45 * uDusk);
      vec3 shade = mix(uZenith * 1.2 + 0.15, vec3(0.5, 0.3, 0.55), uDusk);
      vec3 cc = mix(shade, lit, clamp(0.4 + 0.6 * pow(sd, 1.5) + 0.3 * uDay, 0.0, 1.0));
      cc *= mix(0.25, 1.0, clamp(uDay + uDusk * 0.5, 0.0, 1.0));
      col = mix(col, cc, c * 0.85);
    }
    // aurora curtains in the north on clear nights
    if (uNight > 0.05 && h > 0.05) {
      float az = atan(d.x, -d.z);
      float curtain = noise(vec2(az * 3.0 + uTime * 0.08, h * 2.0 - uTime * 0.05));
      float b2 = smoothstep(0.35, 0.55, curtain) * smoothstep(0.05, 0.2, h) * smoothstep(0.7, 0.25, h);
      float flick = 0.6 + 0.4 * sin(uTime * 0.7 + az * 5.0);
      vec3 ac = mix(vec3(0.2, 1.0, 0.6), vec3(0.8, 0.3, 1.0), smoothstep(0.1, 0.5, h));
      col += ac * b2 * flick * uNight * 0.55 * smoothstep(-1.2, 0.2, -abs(az) + 1.3);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

/** The alien planet: rolling hills, lakes, spaced trees, crystals, floating rocks, strange animals, Saturn as the sun. */
/** Things that can be used up and are shared between players in a lobby. */
export type Harvest = 'tree' | 'boulder' | 'crystal' | 'ore' | 'site' | 'bush';
interface BushRec { x: number; y: number; z: number; r: number; picked: boolean; matrix: THREE.Matrix4 }

export class Planet {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  /** Seconds since landing plus the starting offset (so you arrive mid-morning). */
  clock = 40;

  private celestial = new THREE.Group();   // follows the player so the sky is infinitely far
  private saturn = new THREE.Group();
  private moon: THREE.Mesh;
  private stars: THREE.Points;
  private fireflies: THREE.Points;
  private ffSeeds: Float32Array;
  private water: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffe2a8, 2);
  private hemi = new THREE.HemisphereLight(0xc9a8ff, 0x7a3a8a, 0.8);
  private animals: Animal[] = [];
  private treeRecs: TreeRec[] = [];
  private trunkMesh!: THREE.InstancedMesh;
  private canopyMesh!: THREE.InstancedMesh;
  private pineMesh!: THREE.InstancedMesh;
  /** What is waiting to grow back, oldest first. */
  private respawnQ: { kind: 'tree' | 'boulder' | 'ore' | 'bush'; i: number; at: number }[] = [];
  private respawnClock = 0;
  /** A tree or rock grew back (multiplayer forgets it was used up). */
  onRespawn: ((kind: Harvest, index: number) => void) | null = null;
  private falling: { rec: TreeRec; group: THREE.Group; t: number; axis: THREE.Vector3; landed: boolean }[] = [];
  /** Landmarks for the map. */
  readonly marks = { mesas: [] as [number, number, number][], buttes: [] as [number, number, number][], spires: [] as [number, number, number][], crystals: [] as [number, number][] };
  /** A tree has finished falling and vanished: here is the wood it gave. */
  onWood: ((amount: number, pos: THREE.Vector3) => void) | null = null;
  /** A felled tree hit the ground. */
  onTreeLanded: ((pos: THREE.Vector3) => void) | null = null;
  private oreRecs: OreRec[] = [];
  private oreOccupied = new Set<number>();
  readonly zones: Zone[] = [];
  private zoneFound = new Set<number>();
  private zoneMats: THREE.MeshBasicMaterial[] = [];
  private siteRecs: SiteRec[] = [];
  private siteMesh!: THREE.InstancedMesh;
  private siteLights!: THREE.InstancedMesh;
  /** Loot from a crashed pod you just opened. */
  onLoot: ((index: number, loot: Loot, pos: THREE.Vector3) => void) | null = null;
  private hubBeam: THREE.Mesh | null = null;
  private beaconOn = false;
  private skyDome!: THREE.Mesh;
  private dayF = 1;
  private bushRecs: BushRec[] = [];
  private bushMesh!: THREE.InstancedMesh;
  private pureMarks!: THREE.InstancedMesh;
  private oreMeshes = {} as Record<Ore, { rock: THREE.InstancedMesh; specks: THREE.InstancedMesh }>;
  private mesaTops: number[] = [];
  /** Where the pod was placed (kept so a save can put it back). */
  private podHead = new THREE.Vector3();
  private podForward = new THREE.Vector3(0, 0, -1);
  /** An ore deposit broke. */
  onOre: ((type: Ore, amount: number, pos: THREE.Vector3, purity: number) => void) | null = null;
  private crystalRecs: CrystalRec[] = [];
  private crystalMesh!: THREE.InstancedMesh;
  private wobbling: { rec: TreeRec; t: number; axis: THREE.Vector3 }[] = [];
  private propList: { kind: PropKind; x: number; z: number; mesh: PropMesh }[] = [];
  /** Crystal broke: here is the amount. */
  onCrystal: ((amount: number, pos: THREE.Vector3) => void) | null = null;
  /** Picked a bush: biomass for the burners. */
  onBiomass: ((amount: number, pos: THREE.Vector3) => void) | null = null;
  private boulderRecs: BoulderRec[] = [];
  private boulderMesh!: THREE.InstancedMesh;
  private debris: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; t: number; life: number }[] = [];
  private podHull: THREE.Group | null = null;
  private podAlive = true;
  private podShake = 0;
  private podBaseY = 0;
  private podHits = 0;
  hub: { pose: HubPose; mesh: HubMesh; group: THREE.Group } | null = null;
  /** Stone gained from a boulder that just broke. */
  onStone: ((amount: number, pos: THREE.Vector3) => void) | null = null;
  /** The crashed pod was destroyed. */
  onPodDestroyed: ((pos: THREE.Vector3) => void) | null = null;
  /** A resource was used up by a local hit (so multiplayer can tell your friends). */
  onHarvest: ((kind: Harvest, index: number) => void) | null = null;
  private clocks = new Map<Animal, number>();
  private probe = new THREE.Vector3();
  private smoke: THREE.Sprite[] = [];
  private pod: THREE.Group | null = null;
  private podLight: THREE.PointLight | null = null;
  /** Called when a creature roars, with its position and species. */
  onRoar: ((pos: THREE.Vector3, kind: string) => void) | null = null;
  private animalTime = 0;
  private tmpCol = new THREE.Color();
  private skyDay = new THREE.Color(0xb79af0);
  private skyDusk = new THREE.Color(0xff8a6a);
  private skyNight = new THREE.Color(0x070618);
  private tmpCol2 = new THREE.Color();
  private zenDay = new THREE.Color(0x6a58c8); private zenDusk = new THREE.Color(0x44307a); private zenNight = new THREE.Color(0x03020c);
  private sunDay = new THREE.Color(0xffe2a8); private sunDusk = new THREE.Color(0xff6a30);
  private hemiDay = new THREE.Color(0xc9a8ff); private hemiDusk = new THREE.Color(0xff9a90); private hemiNight = new THREE.Color(0x5a60c0);

  private q: (typeof QUALITY)['medium'];
  private nightF = 0;
  private grassMesh!: THREE.InstancedMesh;
  private grassCenter = new THREE.Vector2(1e9, 1e9);
  private leapState = new Map<Animal, { t: number; next: number }>();

  /** The map this planet is (set before it is built with Terrain.setMap). */
  readonly map: MapDef = getMap();

  constructor(seed = getMap().seed, readonly quality: Quality = 'medium') {
    this.q = QUALITY[quality];
    const rng = rngFrom(seed);
    this.world.hull = false; this.world.heightFn = heightAt; this.world.groundSlip = 0.1;

    this.group.add(buildTerrainMesh(groundTexture(rng), quality));
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3fd6e6, emissive: 0x0a6a78, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2 });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2), waterMat);
    this.water.position.y = WATER_Y;
    this.group.add(this.water);
    for (const pd of PONDS) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(pd.r * 1.1, 28).rotateX(-Math.PI / 2), waterMat);
      w.position.set(pd.x, pondY(pd), pd.z);
      this.group.add(w);
    }

    this.buildGrass();
    this.buildTrees(rng);
    this.buildBoulders(rng);
    this.buildMesas(rng);
    this.buildCrystals(rng);
    this.buildHazards(rng);
    this.buildOres(rng);
    this.buildCrashSites(rng);
    this.buildFloatingRocks(rng);
    this.buildMushrooms(rng);
    this.buildBushes(rngFrom(seed ^ 0x5bd1e995));   // its own random stream: the rest of the world stays as it was
    this.buildMountains(rng);
    this.buildAnimals(rng);
    this.world.finalize();

    // Fireflies (visible at night)
    this.ffSeeds = new Float32Array(260 * 3).map(() => rng() * 100);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(260 * 3), 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff2a0, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);

    // Sky objects
    const { body, ring } = saturnTextures();
    const R = 95;
    this.saturn.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), new THREE.MeshBasicMaterial({ map: body, toneMapped: false, fog: false })));
    const rm = new THREE.Mesh(new THREE.RingGeometry(R * 1.35, R * 2.35, 72),
      new THREE.MeshBasicMaterial({ map: ring, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false, depthWrite: false }));
    rm.rotation.x = -Math.PI / 2 + 0.38;
    this.saturn.add(rm);
    this.celestial.add(this.saturn);
    // The sky itself: a dome shader with sunsets, clouds and aurora
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(2300, 40, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
          uDay: { value: 1 }, uNight: { value: 0 }, uDusk: { value: 0 }, uTime: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: SKY_FRAG,
      }));
    this.skyDome.renderOrder = -10; this.skyDome.frustumCulled = false;
    this.celestial.add(this.skyDome);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xcfe9ff, toneMapped: false, fog: false }));
    this.celestial.add(this.moon);

    const sp: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp.push(Math.cos(a) * s * SKY_R * 1.2, Math.abs(u) * SKY_R * 1.2, Math.sin(a) * s * SKY_R * 1.2);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.celestial.add(this.stars);

    this.group.add(this.celestial, this.sun, this.sun.target, this.hemi);
  }

  /** In the crowded jungle: is there a tree trunk within r of (x, z)? Set once the trees are built, so rocks and ores stay reachable. */
  private treeNear: ((x: number, z: number, r: number) => boolean) | null = null;

  /** Random spot on dry land within [rMin, rMax] of the landing site. */
  private dryPoint(rng: () => number, rMin: number, rMax: number, minH = ABOVE_WATER): { x: number; z: number; h: number } {
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
      if (h > minH && pathMask(x, z) < 0.5 && !(this.treeNear && this.treeNear(x, z, 2.8))) return { x, z, h };
    }
    return { x: rMin, z: 0, h: 0 };
  }

  /** Short grass that follows you: blades are placed from a hash of the world cell, so they stay put as you move. */
  private buildGrass(): void {
    const N = Math.max(200, Math.round(11000 * this.q.grass * this.map.grass));
    const geo = new THREE.ConeGeometry(0.045, 0.4, 3, 1).translate(0, 0.2, 0);
    this.grassMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    this.grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grassMesh.frustumCulled = false;
    this.group.add(this.grassMesh);
    this.regrowGrass(0, 0);
  }

  private regrowGrass(cx: number, cz: number): void {
    this.grassCenter.set(cx, cz);
    const mesh = this.grassMesh, N = mesh.instanceMatrix.count, R = 95, CELL = 4, half = Math.ceil(R / CELL);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const gx0 = Math.floor(cx / CELL), gz0 = Math.floor(cz / CELL);
    let n = 0;
    for (let i = -half; i <= half && n < N; i++) {
      for (let j = -half; j <= half && n < N; j++) {
        const gx = gx0 + i, gz = gz0 + j;
        for (let k = 0; k < 4 && n < N; k++) {
          const h1 = hash3(gx, gz, k), h2 = hash3(gz, k, gx), h3 = hash3(k, gx, gz);
          const x = (gx + h1) * CELL, z = (gz + h2) * CELL, d = Math.hypot(x - cx, z - cz);
          if (d > R || h3 > 1 - Math.pow(d / R, 1.4) || Math.hypot(x, z) < 1.2) continue; // thinner toward the edge, clear at the landing spot
          const y = heightAt(x, z);
          if (y < ABOVE_WATER - 0.4 || pathMask(x, z) > 0.3) continue;
          e.set((h1 - 0.5) * 0.4, h2 * 6.28, (h3 - 0.5) * 0.4);
          const s = 0.55 + h3 * 0.6;
          m.compose(pos.set(x, y, z), q.setFromEuler(e), sc.set(s, s * (0.8 + h1 * 0.5), s));
          mesh.setMatrixAt(n, m);
          const gh = this.map.grassHsl; mesh.setColorAt(n, col.setHSL(gh[0] + h2 * gh[1], gh[2] + h3 * 0.3, gh[3] + h1 * 0.22));
          n++;
        }
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Clusters of alien trees across the plains, plus a few loners. Trees stay at least 9 m apart. */
  private buildTrees(rng: () => number): void {
    type Spot = { x: number; z: number; y: number; h: number; cr: number; c: number; pine: boolean };
    const spots: Spot[] = [];
    const GAP = this.map.treeGap, crowded = this.map.id === 'jungle';
    // open fields cut out of the forest: a big one around the landing site (the Hub needs room) and a few more
    const clearings: { x: number; z: number; r: number }[] = [];
    if (crowded) {
      clearings.push({ x: 0, z: 0, r: 30 });
      for (let k = 0, tries = 0; k < (this.map.clearings ?? 0) && tries < 80; tries++) {
        const c = this.dryPoint(rng, 70, WORLD_R - 50, ABOVE_WATER + 3), r = 20 + rng() * 22;
        if (clearings.some(o => Math.hypot(o.x - c.x, o.z - c.z) < o.r + r + 50)) continue;
        clearings.push({ x: c.x, z: c.z, r }); k++;
      }
    }
    // spatial grid so thousands of trees can be placed quickly (same answer as checking every tree)
    const CELL = Math.ceil(GAP * 1.5) + 1, grid = new Map<number, Spot[]>(), gk = (i: number, j: number) => i * 4096 + j;
    const tooClose = (x: number, z: number, gap: number): boolean => {
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const t of grid.get(gk(i, j)) ?? []) if (Math.hypot(t.x - x, t.z - z) < gap) return true;
      return false;
    };
    const tryAdd = (x: number, z: number, gap = GAP): boolean => {
      const y = heightAt(x, z);
      if (y < ABOVE_WATER + 0.5 || Math.hypot(x, z) < 14 || pathMask(x, z) > 0.4) return false;
      if (clearings.some(c => Math.hypot(c.x - x, c.z - z) < c.r)) return false;
      if (tooClose(x, z, gap)) return false;
      const big = this.map.id === 'jungle' ? 1.35 : 1;   // jungle trees tower
      const sp = { x, z, y, h: (6 + rng() * 6) * big, cr: (2.2 + rng() * 1.4) * (big > 1 ? 1.2 : 1), c: Math.floor(rng() * 4), pine: rng() < 0.45 };
      spots.push(sp);
      const key = gk(Math.floor(x / CELL), Math.floor(z / CELL)); const cell = grid.get(key); if (cell) cell.push(sp); else grid.set(key, [sp]);
      return true;
    };
    const maxTrees = Math.round(230 * this.q.trees * this.map.trees);
    for (let k = 0; k < Math.round(40 * this.q.trees * this.map.clusters); k++) {
      const c = this.dryPoint(rng, 35, WORLD_R, ABOVE_WATER + 0.5);
      const n = 3 + Math.floor(rng() * 6);
      for (let t = 0, added = 0; t < 40 && added < n; t++) {
        const a = rng() * Math.PI * 2, d = rng() * 28;
        if (tryAdd(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d)) added++;
      }
    }
    for (let k = 0; k < Math.round(90 * this.map.trees) && spots.length < maxTrees; k++) { const p = this.dryPoint(rng, 18, WORLD_R); tryAdd(p.x, p.z, Math.round(GAP * 1.5)); }

    // the crowded jungle: keep packing trees in until the world is thick with them, leaving just narrow ways through
    if (crowded) for (let k = 0; k < maxTrees * 7 && spots.length < maxTrees; k++) {
      const a = rng() * Math.PI * 2, r = 14 + Math.sqrt(rng()) * (WORLD_R - 14);
      tryAdd(Math.cos(a) * r, Math.sin(a) * r);
    }
    if (crowded) this.treeNear = (x, z, r) => tooClose(x, z, r + 0.6);

    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(1.0, 0.5, crowded ? 6 : 8).translate(0, 0.25, 0),
      new THREE.ConeGeometry(0.75, 0.45, crowded ? 6 : 8).translate(0, 0.55, 0),
      new THREE.ConeGeometry(0.5, 0.4, crowded ? 6 : 8).translate(0, 0.82, 0),
    ].map(g => g.toNonIndexed()))!;
    const trunkMat = new THREE.MeshStandardMaterial({ color: this.map.trunk, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.46, 1, crowded ? 6 : 8).translate(0, 0.5, 0), trunkMat, spots.length);
    const nPine = spots.filter(s => s.pine).length;
    const canopies = new THREE.InstancedMesh(crowded ? new THREE.SphereGeometry(1, 8, 6) : new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.7 }), spots.length - nPine);
    const pines = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), nPine);
    const palette = this.map.treePalette, pinePal = this.map.pinePalette;
    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    let ci = 0, pi = 0;
    this.trunkMesh = trunks; this.canopyMesh = canopies; this.pineMesh = pines;
    spots.forEach((t, i) => {
      const rec: TreeRec = { pine: t.pine, x: t.x, y: t.y, z: t.z, h: t.h, color: t.pine ? pinePal[t.c] : palette[t.c], trunkIdx: i, foliageIdx: t.pine ? pi : ci, felled: false, trunkLocal: new THREE.Matrix4(), foliageLocal: new THREE.Matrix4(), hits: 0, lastHit: -99 };
      this.treeRecs.push(rec);
      if (!t.pine) {
        const w = t.h * 0.1 + 0.6;
        m.compose(new THREE.Vector3(t.x, t.y - 1.5, t.z), q, new THREE.Vector3(w, t.h + 1.5, w)); trunks.setMatrixAt(i, m);
        rec.trunkLocal.compose(new THREE.Vector3(0, -1.5, 0), q, new THREE.Vector3(w, t.h + 1.5, w));
        const cy = t.y + t.h + t.cr * 0.35;
        m.compose(new THREE.Vector3(t.x, cy, t.z), q, new THREE.Vector3(t.cr, t.cr * 0.8, t.cr));
        rec.foliageLocal.compose(new THREE.Vector3(0, cy - t.y, 0), q, new THREE.Vector3(t.cr, t.cr * 0.8, t.cr));
        canopies.setMatrixAt(ci, m); canopies.setColorAt(ci++, col.set(palette[t.c]));
        rec.addColliders = () => {
          this.world.addCylinder(t.x, t.z, t.y - 1.5, t.y + t.h, w * 0.38, 0, i);        // bark: grippy
          this.world.addSphere(new THREE.Vector3(t.x, cy, t.z), t.cr * 0.85, 0.2, i);     // leafy canopy
        };
        rec.addColliders();
      } else {
        const th = t.h * 0.55, w = 0.8, fh = t.h * 1.0, rad = t.cr * 0.95;
        m.compose(new THREE.Vector3(t.x, t.y - 1.5, t.z), q, new THREE.Vector3(w, th + 1.5, w)); trunks.setMatrixAt(i, m);
        rec.trunkLocal.compose(new THREE.Vector3(0, -1.5, 0), q, new THREE.Vector3(w, th + 1.5, w));
        m.compose(new THREE.Vector3(t.x, t.y + th * 0.45, t.z), q, new THREE.Vector3(rad, fh, rad));
        rec.foliageLocal.compose(new THREE.Vector3(0, th * 0.45, 0), q, new THREE.Vector3(rad, fh, rad));
        pines.setMatrixAt(pi, m); pines.setColorAt(pi++, col.set(pinePal[t.c]));
        rec.addColliders = () => {
          this.world.addCylinder(t.x, t.z, t.y - 1.5, t.y + th + 1, w * 0.38, 0, i);
          this.world.addSphere(new THREE.Vector3(t.x, t.y + th * 0.45 + fh * 0.3, t.z), rad * 0.5, 0.2, i);
          this.world.addSphere(new THREE.Vector3(t.x, t.y + th * 0.45 + fh * 0.62, t.z), rad * 0.3, 0.2, i);
        };
        rec.addColliders();
      }
    });
    this.group.add(trunks, canopies, pines);
  }

  /** Round boulders dotted over the plains: solid and grippy-ish. */
  private buildBoulders(rng: () => number): void {
    const N = Math.round(150 * this.q.boulders * this.map.boulders);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 10, WORLD_R), r = 0.9 + Math.pow(rng(), 2) * 4.5;
      m.compose(new THREE.Vector3(p.x, p.h + r * 0.25, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(r, r * 0.7, r * (0.8 + rng() * 0.4)));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHSL(this.map.rock[0] + rng() * 0.08, this.map.rock[1], 0.36 + rng() * 0.2));
      this.world.addSphere(new THREE.Vector3(p.x, p.h + r * 0.3, p.z), r * 0.78, 0.3, BOULDER_OWNER + i);
      this.boulderRecs.push({ x: p.x, y: p.h, z: p.z, r, hits: 0, broken: false, matrix: m.clone() });
    }
    this.boulderMesh = mesh;
    this.group.add(mesh);
  }

  /** Flat-topped mesas and tall mushroom-capped spires standing in the lake. */
  private buildMesas(rng: () => number): void {
    const band = this.map.mesa.map(c => new THREE.Color(c));
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const grassMat = new THREE.MeshStandardMaterial({ color: this.map.mesaCap, roughness: 1 });
    const BASE = -32;
    const rock = (rTop: number, rBot: number, base: number, top: number, seg = 22): THREE.Mesh => {
      const H = top - base;
      const g = new THREE.CylinderGeometry(rTop, rBot, H, seg, Math.max(6, Math.round(H / 5)), true).translate(0, base + H / 2, 0);
      const p = g.attributes.position, col: number[] = [], c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), j = 1 + (hash3(x, y, z) - 0.5) * 0.12;
        p.setXYZ(i, x * j, y, z * j);
        const k = Math.max(0, Math.floor((y - base) / 3.2));
        c.copy(band[k % 4]).lerp(band[(k + 1) % 4], 0.25).multiplyScalar(0.9 + hash3(k, 1, 2) * 0.2);
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, rockMat);
    };
    // x, z, radius, top height
    for (const [x, z, r, top] of [[-110, -430, 38, 9], [90, -500, 52, 12], [-30, -610, 44, 8], [170, -640, 36, 10], [-190, -650, 48, 14], [40, -450, 26, 6]]) {
      const m = rock(r * 0.9, r * 1.1, BASE, top); m.position.set(x, 0, z); this.group.add(m);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 24).rotateX(-Math.PI / 2), grassMat);
      cap.position.set(x, top + 0.05, z); this.group.add(cap);
      this.world.addPillar(x, z, BASE, top, r * 0.95, 0.15);
      this.marks.mesas.push([x, z, r]); this.mesaTops.push(top);
    }
    // spires like a giant stone mushroom: x, z, radius, height above the water
    for (const [x, z, r, hgt] of [[-45, -520, 7, 70], [120, -560, 9, 90], [-140, -300, 6, 55], [60, -235, 6, 48]]) {
      const base = Math.min(BASE, heightAt(x, z) - 2), top = Math.max(heightAt(x, z), WATER_Y) + hgt;
      const m = rock(r * 0.8, r * 1.15, base, top, 12); m.position.set(x, 0, z); this.group.add(m);
      const cap = rock(r * 1.8, r * 1.5, top - 6, top, 14); cap.position.set(x, 0, z); this.group.add(cap);
      const lid = new THREE.Mesh(new THREE.CircleGeometry(r * 1.8, 14).rotateX(-Math.PI / 2), grassMat);
      lid.position.set(x, top + 0.05, z); this.group.add(lid);
      this.marks.spires.push([x, z, r * 1.8]);
      this.world.addPillar(x, z, base, top, r * 0.9, 0.15);
      this.world.addPillar(x, z, top - 6, top, r * 1.7, 0.15);
    }
    // flat-topped buttes standing on the plains: climb them with good gloves
    for (let i = 0; i < Math.round(12 * this.q.rocks); i++) {
      const c = this.dryPoint(rng, 60, WORLD_R - 40, ABOVE_WATER + 3), r = 13 + rng() * 14, top = c.h + 9 + rng() * 14, base = c.h - 14;
      const m = rock(r * 0.9, r * 1.1, base, top); m.position.set(c.x, 0, c.z); this.group.add(m);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 20).rotateX(-Math.PI / 2), grassMat);
      cap.position.set(c.x, top + 0.05, c.z); this.group.add(cap);
      this.world.addPillar(c.x, c.z, base, top, r * 0.95, 0.15);
      this.marks.buttes.push([c.x, c.z, r]);
    }
  }

  /** Glowing crystal spires you can climb. */
  private buildCrystals(rng: () => number): void {
    const items: { x: number; y: number; z: number; r: number; h: number; c: number }[] = [];
    for (let k = 0; k < Math.round(20 * this.q.crystals * this.map.crystals); k++) {
      const c = this.dryPoint(rng, 30, WORLD_R - 30, ABOVE_WATER + 1);
      const n = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = 1 + rng() * 4;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        items.push({ x, z, y: heightAt(x, z), r: 0.6 + rng() * 0.9, h: 4 + rng() * 9, c: k % 3 });
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ emissive: 0x552288, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, flatShading: true }), items.length);
    const palette = [0x66f0ff, 0xff7adf, 0xb89cff], m = new THREE.Matrix4(), col = new THREE.Color();
    items.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, s.y - 0.5, s.z), new THREE.Quaternion(), new THREE.Vector3(s.r, s.h, s.r));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.set(palette[s.c]));
      this.world.addCylinder(s.x, s.z, s.y - 0.5, s.y + s.h * 0.8, s.r * 0.5, 0.05, CRYSTAL_OWNER + i);
      this.crystalRecs.push({ x: s.x, y: s.y, z: s.z, h: s.h, r: s.r, color: palette[s.c], hits: 0, broken: false });
      if (i % 3 === 0) this.marks.crystals.push([s.x, s.z]);
    });
    this.crystalMesh = mesh;
    this.group.add(mesh);
  }

  /** Ore deposits to mine: copper and iron in veins on the plains, gold on high ground, plasma on the lake mesas. */
  private buildOres(rng: () => number): void {
    const spots: { type: Ore; x: number; y: number; z: number; r: number }[] = [];
    const vein = (type: Ore, veins: number, per: number, rMin: number, rMax: number) => {
      for (let v = 0; v < veins; v++) {
        const c = this.dryPoint(rng, 20, WORLD_R, ABOVE_WATER + 0.5);
        for (let k = 0; k < per; k++) {
          const a = rng() * Math.PI * 2, d = 1.5 + rng() * 7, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = heightAt(x, z);
          if (y > ABOVE_WATER && pathMask(x, z) < 0.5 && !(this.treeNear && this.treeNear(x, z, 2.4))) spots.push({ type, x, y, z, r: rMin + rng() * (rMax - rMin) });
        }
      }
    };
    const om = this.q.ores * this.map.ores;
    vein('copper', Math.max(2, Math.round(16 * om)), 3, 0.9, 1.6);
    vein('iron', Math.max(2, Math.round(14 * om)), 3, 0.9, 1.6);
    // gold: the highest ground within reach
    const high: { x: number; z: number; y: number }[] = [];
    for (let i = 0; i < 900; i++) { const a = rng() * Math.PI * 2, r = 70 + rng() * (WORLD_R - 70), x = Math.cos(a) * r, z = Math.sin(a) * r; high.push({ x, z, y: heightAt(x, z) }); }
    high.sort((a, b) => b.y - a.y);
    for (const h of high) { if (spots.filter(s => s.type === 'gold').length >= Math.max(2, Math.round(18 * om))) break; if (spots.some(s => s.type === 'gold' && Math.hypot(s.x - h.x, s.z - h.z) < 28)) continue; spots.push({ type: 'gold', x: h.x, y: h.y, z: h.z, r: 0.8 + rng() * 0.5 }); }
    // plasma: on top of the mesas out in the lake
    this.marks.mesas.forEach(([mx, mz, mr], i) => {
      for (let k = 0; k < (mr > 40 ? 2 : 1); k++) { const a = rng() * Math.PI * 2, d = rng() * mr * 0.6; spots.push({ type: 'plasma', x: mx + Math.cos(a) * d, y: this.mesaTops[i], z: mz + Math.sin(a) * d, r: 1.1 + rng() * 0.5 }); }
    });

    // uranium: only inside the radiation zones
    for (const z of this.zones) if (z.kind === 'radiation') for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2, d = rng() * z.r * 0.6, x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d;
      spots.push({ type: 'uranium', x, y: heightAt(x, zz), z: zz, r: 1.0 + rng() * 0.5 });
    }

    // one rock mesh + one glowing-specks mesh per ore type, sharing instance matrices
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const speckParts: THREE.BufferGeometry[] = [];
    const sr = rngFromSeed(5);
    for (let i = 0; i < 11; i++) {
      const g = new THREE.OctahedronGeometry(0.3 + sr() * 0.2, 0);
      const a = sr() * Math.PI * 2, e = 0.1 + sr() * 1.1;
      g.scale(0.7, 1.9, 0.7); g.rotateX((sr() - 0.5) * 0.9); g.rotateZ((sr() - 0.5) * 0.9);
      g.translate(Math.cos(a) * Math.cos(e) * 0.88, Math.sin(e) * 0.7 + 0.1, Math.sin(a) * Math.cos(e) * 0.88);
      speckParts.push(g);
    }
    const speckGeo = mergeGeometries(speckParts)!;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const type of Object.keys(ORE_DEF) as Ore[]) {
      const def = ORE_DEF[type], mine = spots.filter(s => s.type === type);
      const rock = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: def.rock, roughness: 1, flatShading: true }), mine.length);
      const specks = new THREE.InstancedMesh(speckGeo, new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: def.glow, metalness: type === 'gold' || type === 'copper' ? 0.5 : 0.2, roughness: 0.3, flatShading: true }), mine.length);
      mine.forEach((s, k) => {
        const slot = this.oreRecs.length;
        q.setFromEuler(new THREE.Euler(0, rng() * 6.28, 0));
        m.compose(new THREE.Vector3(s.x, s.y + s.r * 0.3, s.z), q, new THREE.Vector3(s.r, s.r * 0.75, s.r));
        rock.setMatrixAt(k, m); specks.setMatrixAt(k, m);
        this.world.addSphere(new THREE.Vector3(s.x, s.y + s.r * 0.35, s.z), s.r * 0.85, 0.3, ORE_OWNER + slot);
        const pr = rng();
        this.oreRecs.push({ type, x: s.x, y: s.y, z: s.z, r: s.r, hits: 0, broken: false, slot: k, purity: pr < this.map.purity[0] ? 0.5 : pr < this.map.purity[1] ? 1 : 2, matrix: m.clone(), mark: -1 });
      });
      this.oreMeshes[type] = { rock, specks };
      this.group.add(rock, specks);
    }
    // a floating gold gem over every pure node, so you can spot the good ones
    const pures = this.oreRecs.filter(o => o.purity >= 2);
    this.pureMarks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28, 0).scale(1, 1.7, 1), new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }), Math.max(1, pures.length));
    this.pureMarks.count = pures.length; this.pureMarks.frustumCulled = false;
    pures.forEach((o, k) => { o.mark = k; this.pureMarks.setMatrixAt(k, this.markMatrix(o)); });
    this.group.add(this.pureMarks);
  }

  /** 0..1 how much daylight there is (solar panels). */
  get daylight(): number { return this.dayF; }

  /** Nearest unmined, unoccupied copper or iron deposit within `maxD` of (x, z): where a Miner can go. */
  findFreeOre(x: number, z: number, maxD: number): { index: number; type: 'copper' | 'iron'; x: number; y: number; z: number; purity: number } | null {
    let best: { index: number; type: 'copper' | 'iron'; x: number; y: number; z: number; purity: number } | null = null, bd = maxD;
    this.oreRecs.forEach((o, i) => {
      if (o.broken || this.oreOccupied.has(i) || (o.type !== 'copper' && o.type !== 'iron')) return;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bd) { bd = d; best = { index: i, type: o.type, x: o.x, y: o.y + o.r * 0.55, z: o.z, purity: o.purity }; }
    });
    return best;
  }
  isOreFree(index: number): boolean { const o = this.oreRecs[index]; return !!o && !o.broken && !this.oreOccupied.has(index); }
  setOreOccupied(index: number, on: boolean): void { if (on) this.oreOccupied.add(index); else this.oreOccupied.delete(index); }

  /** Is this open, level, dry ground for a machine? */
  canPlaceMachine(x: number, z: number): { ok: boolean; y: number; reason: string } {
    const y = heightAt(x, z);
    if (y < WATER_Y + 0.4) return { ok: false, y, reason: 'Too close to water' };
    let lo = y, hi = y;
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) { const h = heightAt(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 0.9) return { ok: false, y: hi, reason: 'Ground too steep' };
    if (this.world.distance(new THREE.Vector3(x, y + 1.7, z)) < 1.3) return { ok: false, y: hi, reason: 'Something is in the way' };
    return { ok: true, y: hi, reason: '' };
  }

  addMachineCollider(id: number, x: number, y: number, z: number): void {
    this.world.addCylinder(x, z, y - 0.3, y + 2.2, 0.95, 0.3, MACHINE_OWNER + id);
    this.world.finalize();
  }
  removeMachineCollider(id: number): void { this.world.removeOwner(MACHINE_OWNER + id); }

  /** Poison clouds and radiation zones out toward the edges of the world. */
  private buildHazards(rng: () => number): void {
    const nPoison = Math.max(3, Math.round(8 * this.q.crystals)), nRad = Math.max(2, Math.round(4 * this.q.crystals));
    const place = (kind: Zone['kind'], r: number) => {
      for (let t = 0; t < 40; t++) {
        const c = this.dryPoint(rng, 150, WORLD_R - 40, ABOVE_WATER + 1);
        if (this.zones.some(z => Math.hypot(z.x - c.x, z.z - c.z) < z.r + r + 50)) continue;
        this.zones.push({ kind, x: c.x, z: c.z, r }); return;
      }
    };
    for (let i = 0; i < nRad; i++) place('radiation', 28 + rng() * 8);
    for (let i = 0; i < nPoison; i++) place('poison', 24 + rng() * 10);
    const poisonMat = new THREE.MeshBasicMaterial({ color: 0x9fd020, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const radMat = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    const groundP = new THREE.MeshBasicMaterial({ color: 0x9ab020, transparent: true, opacity: 0.35, depthWrite: false });
    const groundR = new THREE.MeshBasicMaterial({ color: 0x20a040, transparent: true, opacity: 0.35, depthWrite: false });
    this.zoneMats = [poisonMat, radMat];
    const rock = new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 1, flatShading: true });
    for (const z of this.zones) {
      const y = heightAt(z.x, z.z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 28).rotateX(-Math.PI / 2), z.kind === 'poison' ? groundP : groundR);
      disc.position.set(z.x, y + 0.25, z.z); disc.renderOrder = 2; this.group.add(disc);
      if (z.kind === 'poison') { // tall vents venting a toxic plume
        for (let k = 0; k < 4; k++) {
          const a = rng() * Math.PI * 2, d = rng() * z.r * 0.6, x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d, gy = heightAt(x, zz);
          const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 5, 7), rock); vent.position.set(x, gy + 2.2, zz); this.group.add(vent);
          this.world.addCylinder(x, zz, gy - 1, gy + 5, 1.0, 0.3);
          const plume = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 1.2, 38, 10, 1, true), poisonMat); plume.position.set(x, gy + 21, zz); this.group.add(plume);
        }
      } else { // a glowing dome over the zone
        const dome = new THREE.Mesh(new THREE.SphereGeometry(z.r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), radMat);
        dome.position.set(z.x, y, z.z); this.group.add(dome);
      }
    }
  }

  /** Hazards at a point (poison cloud and/or radiation). */
  hazardAt(x: number, z: number): { poison: boolean; radiation: boolean } { return exposure(this.zones, x, z); }

  /** Zones the player has been near (shown on the map). */
  get zoneMarks(): Zone[] { return this.zones.filter((_, i) => this.zoneFound.has(i)); }
  /** Distance to the edge of the nearest hazard (negative = inside) and its kind. */
  nearestHazard(x: number, z: number): { kind: Zone['kind']; dist: number } | null {
    let best: { kind: Zone['kind']; dist: number } | null = null;
    for (const zn of this.zones) { const d = Math.hypot(x - zn.x, z - zn.z) - zn.r; if (!best || d < best.dist) best = { kind: zn.kind, dist: d }; }
    return best;
  }

  /** Other crashed pods scattered around the world. Punch the hatch three times to open one. */
  private buildCrashSites(rng: () => number): void {
    const N = Math.max(3, Math.round(16 * this.q.rocks * this.map.sites));
    const hull = new THREE.CapsuleGeometry(0.62, 0.9, 5, 14).rotateX(Math.PI / 2);
    const parts: THREE.BufferGeometry[] = [];
    const tint = (g: THREE.BufferGeometry, c: number, k = 1) => {
      const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r * k; a[i * 3 + 1] = col.g * k; a[i * 3 + 2] = col.b * k; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
    };
    const plain = (g: THREE.BufferGeometry) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k); return x; };
    parts.push(plain(tint(hull.clone().translate(0, 0.55, 0).rotateX(-0.25), 0x8a96aa)));
    parts.push(plain(tint(new THREE.BoxGeometry(0.7, 0.07, 0.5).translate(0.2, 1.05, 0.2).rotateZ(-0.3), 0x3a4252)));      // blown hatch panel
    parts.push(plain(tint(new THREE.CircleGeometry(2.0, 18).rotateX(-Math.PI / 2).translate(0, 0.04, 0), 0x2a1c24)));       // scorched ground
    parts.push(plain(tint(new THREE.CylinderGeometry(0.03, 0.04, 2.2, 6).translate(0.9, 1.1, -0.6), 0x59606e)));           // beacon pole
    const geo = mergeGeometries(parts)!;
    this.siteMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.55 }), N);
    this.siteLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let made = 0;
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 90, WORLD_R - 30, ABOVE_WATER + 1);
      if (this.siteRecs.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 60)) continue;
      const yaw = rng() * Math.PI * 2;
      m.compose(pos.set(p.x, p.h, p.z), q.setFromEuler(new THREE.Euler(0, yaw, 0)), one);
      this.siteMesh.setMatrixAt(made, m);
      const bx = p.x + Math.cos(yaw) * 0.9 + Math.sin(yaw) * -0.6, bz = p.z - Math.sin(yaw) * 0.9 + Math.cos(yaw) * -0.6;
      this.siteLights.setMatrixAt(made, new THREE.Matrix4().makeTranslation(bx, p.h + 2.25, bz));
      this.siteLights.setColorAt(made, new THREE.Color(0xff3030));
      const loot: Loot = { steel: 3 + Math.floor(rng() * 6), plate: Math.floor(rng() * 6), wire: Math.floor(rng() * 5), crystal: Math.floor(rng() * 4) };
      if (rng() < 0.35) loot.core = 1;
      if (rng() < 0.4) loot.drive = 1;
      if (rng() < 0.18) loot.artifact = 1;
      this.world.addSphere(new THREE.Vector3(p.x, p.h + 0.7, p.z), 0.95, 0.3, CRASH_OWNER + made);
      this.siteRecs.push({ x: p.x, y: p.h, z: p.z, hits: 0, looted: false, discovered: false, loot });
      made++;
    }
    this.siteMesh.count = this.siteLights.count = made;
    this.siteMesh.frustumCulled = this.siteLights.frustumCulled = false;
    this.group.add(this.siteMesh, this.siteLights);
  }

  /** Crashed pods you have found and not yet looted (for the map). */
  get siteMarks(): { x: number; z: number }[] { return this.siteRecs.filter(s => s.discovered && !s.looted); }

  /** Punch a crashed pod's hatch. Returns punches left (0 = opened). */
  hitSite(i: number): number {
    const s = this.siteRecs[i];
    if (!s || s.looted) return 0;
    s.hits++;
    const at = new THREE.Vector3(s.x, s.y + 1.0, s.z);
    if (s.hits < 3) { this.burst(at, 3, 0x8a96aa, 0.12, 3); return 3 - s.hits; }
    s.looted = true;
    this.world.removeOwner(CRASH_OWNER + i);
    this.burst(at, 12, 0x8a96aa, 0.22, 6);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.siteMesh.setMatrixAt(i, zero); this.siteLights.setMatrixAt(i, zero);
    this.siteMesh.instanceMatrix.needsUpdate = this.siteLights.instanceMatrix.needsUpdate = true;
    this.onLoot?.(i, s.loot, at);
    this.onHarvest?.('site', i);
    return 0;
  }

  /** The Hub's beacon: a tall beam you can see from far away. `strong` is the upgraded version. */
  setBeacon(strong: boolean): void {
    this.beaconOn = strong;
    if (!this.hubBeam || !this.hub) return;
    const h = strong ? 700 : 70, r = strong ? 1.6 : 0.5;
    this.hubBeam.geometry.dispose();
    this.hubBeam.geometry = new THREE.CylinderGeometry(r, r, h, 12, 1, true);
    this.hubBeam.position.set(this.hub.pose.x, this.hub.pose.y + h / 2, this.hub.pose.z);
  }

  /** Unmined ore deposits (for the Ore Scanner on the map). */
  get oreMarks(): { type: Ore; x: number; z: number; purity: number }[] { return this.oreRecs.filter(o => !o.broken); }

  /** Hit an ore deposit. `tool` decides how many punches it takes. Returns punches left (0 = mined). */
  hitOre(i: number, tool: 'hand' | 'pick' | 'iron'): number {
    const o = this.oreRecs[i];
    if (!o || o.broken) return 0;
    if (this.oreOccupied.has(i)) return 1; // a Miner is sitting on it
    const def = ORE_DEF[o.type];
    const needed = tool === 'iron' ? 1 : tool === 'pick' ? Math.max(1, def.hits - 1) : def.hits;
    o.hits++;
    const at = new THREE.Vector3(o.x, o.y + o.r * 0.6, o.z);
    if (o.hits < needed) { this.burst(at, 3, def.color, 0.12, 3); return needed - o.hits; }
    o.broken = true;
    this.world.removeOwner(ORE_OWNER + i);
    this.hideOre(o);
    this.burst(at, 10, def.color, 0.2, 5);
    // impure nodes give 2 of the ore, normal 3, pure 4
    const amt = o.purity >= 2 ? 4 : o.purity >= 1 ? 3 : 2;
    this.onOre?.(o.type, amt, at, o.purity);
    this.onHarvest?.('ore', i); this.scheduleRespawn('ore', i);
    return 0;
  }

  private markMatrix(o: OreRec): THREE.Matrix4 { return new THREE.Matrix4().makeTranslation(o.x, o.y + o.r * 1.5 + 0.9, o.z); }
  private setMark(o: OreRec, on: boolean): void {
    if (o.mark < 0 || !this.pureMarks) return;
    this.pureMarks.setMatrixAt(o.mark, on ? this.markMatrix(o) : new THREE.Matrix4().makeScale(0, 0, 0)); this.pureMarks.instanceMatrix.needsUpdate = true;
  }

  private hideOre(o: OreRec): void {
    this.setMark(o, false);
    const z = new THREE.Matrix4().makeScale(0, 0, 0), mm = this.oreMeshes[o.type];
    mm.rock.setMatrixAt(o.slot, z); mm.specks.setMatrixAt(o.slot, z);
    mm.rock.instanceMatrix.needsUpdate = mm.specks.instanceMatrix.needsUpdate = true;
  }

  // ---------------- saving ----------------

  /** Everything that changes during play, as plain data. */
  exportState(): PlanetState {
    const ids = <T extends { felled?: boolean; broken?: boolean }>(a: readonly T[]) => a.flatMap((r, i) => (r.felled || r.broken ? [i] : []));
    return {
      quality: this.quality, clock: this.clock, map: this.map.id,
      felledTrees: ids(this.treeRecs), brokenBoulders: ids(this.boulderRecs), brokenCrystals: ids(this.crystalRecs), brokenOres: ids(this.oreRecs),
      podAlive: this.podAlive,
      podHead: [this.podHead.x, this.podHead.y, this.podHead.z], podForward: [this.podForward.x, this.podForward.y, this.podForward.z],
      hub: this.hub ? { ...this.hub.pose } : null,
      props: this.propList.map(p => ({ kind: p.kind, x: p.x, z: p.z })),
      discoveredZones: [...this.zoneFound],
      pickedBushes: this.bushRecs.flatMap((b, i) => (b.picked ? [i] : [])),
      lootedSites: ids(this.siteRecs.map(s => ({ broken: s.looted }))), discoveredSites: this.siteRecs.flatMap((s, i) => (s.discovered ? [i] : [])),
    };
  }

  /** Put the world back the way a save left it (silently: no falling trees, no loot). Call before placePod. */
  importState(s: PlanetState): void {
    this.clock = s.clock;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), owners = new Set<number>();
    for (const i of s.felledTrees) {
      const r = this.treeRecs[i]; if (!r) continue;
      r.felled = true; owners.add(i); this.scheduleRespawn('tree', i);
      this.trunkMesh.setMatrixAt(r.trunkIdx, zero); (r.pine ? this.pineMesh : this.canopyMesh).setMatrixAt(r.foliageIdx, zero);
    }
    this.trunkMesh.instanceMatrix.needsUpdate = this.canopyMesh.instanceMatrix.needsUpdate = this.pineMesh.instanceMatrix.needsUpdate = true;
    for (const i of s.brokenBoulders) { const b = this.boulderRecs[i]; if (!b) continue; b.broken = true; owners.add(BOULDER_OWNER + i); this.boulderMesh.setMatrixAt(i, zero); this.scheduleRespawn('boulder', i); }
    this.boulderMesh.instanceMatrix.needsUpdate = true;
    for (const i of s.brokenCrystals) { const c = this.crystalRecs[i]; if (!c) continue; c.broken = true; owners.add(CRYSTAL_OWNER + i); this.crystalMesh.setMatrixAt(i, zero); }
    this.crystalMesh.instanceMatrix.needsUpdate = true;
    for (const i of s.brokenOres) { const o = this.oreRecs[i]; if (!o) continue; o.broken = true; owners.add(ORE_OWNER + i); this.hideOre(o); this.scheduleRespawn('ore', i); }
    for (const i of s.pickedBushes ?? []) { const b = this.bushRecs[i]; if (!b) continue; b.picked = true; owners.add(BUSH_OWNER + i); this.bushMesh.setMatrixAt(i, zero); this.scheduleRespawn('bush', i); }
    this.bushMesh.instanceMatrix.needsUpdate = true;
    for (const i of s.lootedSites ?? []) { const t = this.siteRecs[i]; if (!t) continue; t.looted = true; owners.add(CRASH_OWNER + i); this.siteMesh.setMatrixAt(i, zero); this.siteLights.setMatrixAt(i, zero); }
    for (const i of s.discoveredZones ?? []) this.zoneFound.add(i);
    for (const i of s.discoveredSites ?? []) { const t = this.siteRecs[i]; if (t) t.discovered = true; }
    this.siteMesh.instanceMatrix.needsUpdate = this.siteLights.instanceMatrix.needsUpdate = true;
    this.world.removeOwners(owners);
    this.podAlive = s.podAlive;
    if (s.hub) this.placeHub(s.hub.x, s.hub.z, s.hub.yaw, s.hub.y);
    for (const pr of s.props) this.placeProp(pr.kind, pr.x, pr.z);
  }

  /** Rocks floating in the air: reachable by chaining launches off tall trees. */
  private buildFloatingRocks(rng: () => number): void {
    const NR = Math.round(16 * this.q.rocks);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), NR);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < NR; i++) {
      const p = this.dryPoint(rng, 25, WORLD_R - 40, ABOVE_WATER), r = 3 + rng() * 4, y = p.h + 14 + rng() * 22;
      m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)), new THREE.Vector3(r, r * 0.8, r));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHSL(0.72 + rng() * 0.12, 0.25, 0.35 + rng() * 0.15));
      this.world.addSphere(new THREE.Vector3(p.x, y, p.z), r * 0.85, 0.15);
      // glowing moss cap on top
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3),
        new THREE.MeshStandardMaterial({ color: 0xff7adf, emissive: 0x802060, emissiveIntensity: 0.6 }));
      cap.position.set(p.x, y + r * 0.35, p.z); this.group.add(cap);
    }
    this.group.add(mesh);
  }

  private buildMushrooms(rng: () => number): void {
    const N = Math.round(900 * this.q.mush * this.map.mush);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xf0e6ff }), N);
    const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ toneMapped: false }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    const palette = [0xff5ad0, 0x5af0ff, 0xb08cff, 0xffd45a];
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 4, WORLD_R), h = 0.25 + rng() * 0.6, w = 0.25 + rng() * 0.4;
      m.compose(new THREE.Vector3(p.x, p.h, p.z), q, new THREE.Vector3(1, h, 1)); stems.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, p.h + h, p.z), q, new THREE.Vector3(w, w * 0.9, w)); caps.setMatrixAt(i, m);
      caps.setColorAt(i, col.set(palette[i % 4]));
    }
    this.group.add(stems, caps);
  }

  /** Low bushes scattered about: punch one for biomass (leaves) to burn. They grow back. */
  private buildBushes(rng: () => number): void {
    const N = Math.max(40, Math.round(520 * this.q.trees * this.map.bushes));
    this.bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion(), pal = this.map.bushPalette;
    for (let i = 0; i < N; i++) {
      const p = this.dryPoint(rng, 9, WORLD_R, ABOVE_WATER + 0.3), r = 0.55 + rng() * 0.55;
      m.compose(new THREE.Vector3(p.x, p.h + r * 0.35, p.z), q.setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(r * 1.25, r * 0.8, r * 1.15));
      this.bushMesh.setMatrixAt(i, m); this.bushMesh.setColorAt(i, col.set(pal[i % pal.length]).offsetHSL(0, 0, (rng() - 0.5) * 0.12));
      this.world.addSphere(new THREE.Vector3(p.x, p.h + r * 0.4, p.z), r * 0.8, 0.5, BUSH_OWNER + i);
      this.bushRecs.push({ x: p.x, y: p.h, z: p.z, r, picked: false, matrix: m.clone() });
    }
    this.group.add(this.bushMesh);
  }

  /** Pick a bush: biomass for the burners. Returns false if it was already picked. */
  hitBush(i: number): boolean {
    const b = this.bushRecs[i];
    if (!b || b.picked) return false;
    b.picked = true; this.world.removeOwner(BUSH_OWNER + i);
    this.bushMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.bushMesh.instanceMatrix.needsUpdate = true;
    const at = new THREE.Vector3(b.x, b.y + b.r * 0.6, b.z);
    this.burst(at, 7, 0x7fe05a, 0.14, 3);
    this.onBiomass?.(3, at);
    this.onHarvest?.('bush', i); this.scheduleRespawn('bush', i);
    return true;
  }

  /** Rugged snow-capped peaks on the horizon. */
  private buildMountains(rng: () => number): void {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const low = new THREE.Color(this.map.mountain[0]), mid = new THREE.Color(this.map.mountain[1]), snow = new THREE.Color(0xf4eeff), c = new THREE.Color();
    const make = (radius: number, height: number): THREE.BufferGeometry => {
      const g = new THREE.ConeGeometry(radius, height, 11, 9, true).translate(0, height / 2, 0);
      const p = g.attributes.position, col: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / height;
        if (t > 0.02) { // jitter by position hash so seam vertices stay joined
          const j = (hash3(x, y, z) - 0.5) * radius * 0.35 * (1 - t * 0.5), j2 = (hash3(z, x, y) - 0.5) * height * 0.06;
          p.setXYZ(i, x + j, y + j2, z + (hash3(y, z, x) - 0.5) * radius * 0.35 * (1 - t * 0.5));
        }
        c.copy(low).lerp(mid, smoothstep(0, 0.7, t)).lerp(snow, smoothstep(0.62, 0.8, t + (hash3(x, y, z) - 0.5) * 0.12));
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    };
    const NM = Math.round(34 * this.q.mountains);
    for (let i = 0; i < NM; i++) {
      const a = (i / NM) * Math.PI * 2 + rng() * 0.15, r = 1500 + rng() * 800, h = 260 + rng() * 520;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const m = new THREE.Mesh(make(h * (0.55 + rng() * 0.35), h), mat);
      m.position.set(x, heightAt(x, z) - 25, z); m.rotation.y = rng() * 6;
      this.group.add(m);
      if (rng() > 0.4) { // shoulder peak
        const s = new THREE.Mesh(make(h * 0.35, h * 0.55), mat);
        s.position.set(x + (rng() - 0.5) * h * 0.7, heightAt(x, z) - 25, z + (rng() - 0.5) * h * 0.7); this.group.add(s);
      }
    }
  }

  private buildAnimals(rng: () => number): void {
    const q = this.q;
    const add = (an: Animal, x: number, y: number, z: number) => {
      an.group.position.set(x, y, z); an.heading = rng() * Math.PI * 2;
      this.animals.push(an); this.group.add(an.group);
      return an;
    };
    const place = (an: Animal, rMin: number, rMax: number) => { const p = this.dryPoint(rng, rMin, rMax, ABOVE_WATER + 0.5); return add(an, p.x, p.h, p.z); };
    const nGround = Math.round(40 * q.animals * this.map.animals), nFly = Math.round(30 * q.animals * this.map.animals);
    for (let i = 0; i < nGround; i++) place(makeGround(i, rng), 14, WORLD_R - 30);
    for (let i = 0; i < nFly; i++) place(makeFlyer(i, rng), 10, WORLD_R - 20);

    // herds of antlerbacks: the first is the leader, the rest follow it
    for (let h = 0; h < Math.max(1, Math.round(3 * q.animals)); h++) {
      const c = this.dryPoint(rng, 40, WORLD_R - 60, ABOVE_WATER + 1);
      let lead: Animal | null = null;
      for (let k = 0; k < 5; k++) {
        const an = makeGround(8, rng), x = c.x + (rng() - 0.5) * 12, z = c.z + (rng() - 0.5) * 12;
        add(an, x, heightAt(x, z), z);
        if (lead) { an.leader = lead; an.heading = lead.heading; } else lead = an;
      }
    }

    // water life: schools of glowfish and a couple of sea serpents
    const waterPoint = (rMax: number, minDepth: number, cx = 0, cz = 0): { x: number; z: number } | null => {
      for (let i = 0; i < 200; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * rMax, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (heightAt(x, z) < WATER_Y - minDepth) return { x, z };
      }
      return null;
    };
    for (let sc = 0; sc < Math.round(9 * q.fish); sc++) {
      const c = waterPoint(WORLD_R, 1.5);
      if (!c) continue;
      let lead: Animal | null = null;
      for (let k = 0; k < 6; k++) {
        const x = c.x + (rng() - 0.5) * 8, z = c.z + (rng() - 0.5) * 8;
        if (heightAt(x, z) > WATER_Y - 0.8) continue;
        const an = add(makeWater(0, rng), x, WATER_Y - 0.55, z);
        if (lead) { an.leader = lead; an.heading = lead.heading; } else lead = an;
      }
    }
    for (let i = 0; i < Math.max(1, Math.round(2 * q.fish)); i++) {
      const c = waterPoint(190, 4, LAKE.x, LAKE.z);
      if (c) add(makeWater(1, rng), c.x, WATER_Y, c.z);
    }
  }

  /** Nearest campfire or lamp within `range` (for moths). */
  private nearestProp(x: number, z: number, range: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null, bd = range;
    for (const pr of this.propList) { const d = Math.hypot(pr.x - x, pr.z - z); if (d < bd) { bd = d; best = pr; } }
    return best;
  }

  /** 0..CYCLE seconds into the day/night cycle. */
  get cycleTime(): number { return this.clock % CYCLE; }
  get isDay(): boolean { return this.cycleTime < DAY_SECONDS; }

  private scheduleRespawn(kind: 'tree' | 'boulder' | 'ore' | 'bush', i: number): void { this.respawnQ.push({ kind, i, at: this.respawnClock + RESPAWN_SECONDS }); }

  /** Grow one used-up tree or rock back, unless the player is standing right there. Returns false to try again later. */
  private respawn(e: { kind: 'tree' | 'boulder' | 'ore' | 'bush'; i: number }, head: THREE.Vector3): boolean {
    if (e.kind === 'bush') {
      const b = this.bushRecs[e.i]; if (!b || !b.picked) return true;
      if (Math.hypot(head.x - b.x, head.z - b.z) < b.r + 3) return false;
      b.picked = false; this.bushMesh.setMatrixAt(e.i, b.matrix); this.bushMesh.instanceMatrix.needsUpdate = true;
      this.world.addSphere(new THREE.Vector3(b.x, b.y + b.r * 0.4, b.z), b.r * 0.8, 0.5, BUSH_OWNER + e.i);
      this.burst(new THREE.Vector3(b.x, b.y + b.r * 0.5, b.z), 4, 0x7fe05a, 0.1, 2);
    } else if (e.kind === 'tree') {
      const r = this.treeRecs[e.i]; if (!r || !r.felled) return true;
      if (Math.hypot(head.x - r.x, head.z - r.z) < 6) return false;
      r.felled = false; r.hits = 0; r.lastHit = -99;
      const w = new THREE.Matrix4().makeTranslation(r.x, r.y, r.z);
      this.trunkMesh.setMatrixAt(r.trunkIdx, w.clone().multiply(r.trunkLocal)); this.trunkMesh.instanceMatrix.needsUpdate = true;
      const fol = r.pine ? this.pineMesh : this.canopyMesh; fol.setMatrixAt(r.foliageIdx, w.clone().multiply(r.foliageLocal)); fol.instanceMatrix.needsUpdate = true;
      r.addColliders?.();
      this.burst(new THREE.Vector3(r.x, r.y + 2, r.z), 5, r.color, 0.18, 3);
    } else if (e.kind === 'boulder') {
      const b = this.boulderRecs[e.i]; if (!b || !b.broken) return true;
      if (Math.hypot(head.x - b.x, head.z - b.z) < b.r + 4) return false;
      b.broken = false; b.hits = 0;
      this.boulderMesh.setMatrixAt(e.i, b.matrix); this.boulderMesh.instanceMatrix.needsUpdate = true;
      this.world.addSphere(new THREE.Vector3(b.x, b.y + b.r * 0.3, b.z), b.r * 0.78, 0.3, BOULDER_OWNER + e.i);
      this.burst(new THREE.Vector3(b.x, b.y + b.r * 0.5, b.z), 5, 0x9a90a8, 0.2 * b.r, 3);
    } else {
      const o = this.oreRecs[e.i]; if (!o || !o.broken) return true;
      if (Math.hypot(head.x - o.x, head.z - o.z) < o.r + 4) return false;
      o.broken = false; o.hits = 0;
      const mm = this.oreMeshes[o.type]; mm.rock.setMatrixAt(o.slot, o.matrix); mm.specks.setMatrixAt(o.slot, o.matrix); this.setMark(o, true);
      mm.rock.instanceMatrix.needsUpdate = mm.specks.instanceMatrix.needsUpdate = true;
      this.world.addSphere(new THREE.Vector3(o.x, o.y + o.r * 0.35, o.z), o.r * 0.85, 0.3, ORE_OWNER + e.i);
      this.burst(new THREE.Vector3(o.x, o.y + o.r * 0.6, o.z), 5, ORE_DEF[o.type].color, 0.16, 3);
    }
    this.world.finalize();   // new colliders are only seen once the spatial hash is rebuilt
    return true;
  }

  update(dt: number, scene: THREE.Scene, follow: THREE.Vector3, head: THREE.Vector3): void {
    this.clock += dt;
    // grow things back, one per frame so a big batch does not stall
    this.respawnClock += dt;
    const next = this.respawnQ[0];
    if (next && this.respawnClock >= next.at) {
      this.respawnQ.shift();
      if (this.respawn(next, head)) this.onRespawn?.(next.kind, next.i);
      else this.respawnQ.push({ ...next, at: this.respawnClock + 10 });
    }
    this.animalTime += dt;

    // Saturn's arc: DAY_SECONDS above the horizon, NIGHT_SECONDS below it.
    const ct = this.cycleTime;
    const theta = ct < DAY_SECONDS ? Math.PI * (ct / DAY_SECONDS) : Math.PI + Math.PI * ((ct - DAY_SECONDS) / NIGHT_SECONDS);
    const dir = new THREE.Vector3(Math.cos(theta), Math.sin(theta), -0.35).normalize();
    const elev = dir.y;
    const day = smoothstep(-0.08, 0.22, elev);
    const dusk = 1 - smoothstep(0.0, 0.3, Math.abs(elev)); // warm near the horizon

    this.celestial.position.copy(follow);
    this.saturn.position.copy(dir).multiplyScalar(SKY_R);
    this.saturn.rotation.y += 0.0002;
    this.moon.position.set(-dir.x, -dir.y * 0.9, 0.4).multiplyScalar(SKY_R * 0.9);
    this.moon.visible = this.moon.position.y > -50;
    const night = Math.pow(1 - day, 1.5);
    this.nightF = night; this.dayF = day;
    if (Math.hypot(follow.x - this.grassCenter.x, follow.z - this.grassCenter.y) > 35) this.regrowGrass(follow.x, follow.z);
    (this.stars.material as THREE.PointsMaterial).opacity = night;

    const sky = this.tmpCol.copy(this.skyNight).lerp(this.skyDay, day).lerp(this.skyDusk, dusk * 0.55 * (day > 0.02 ? 1 : 0.5));
    scene.background = sky.clone();
    if (!scene.fog) scene.fog = new THREE.FogExp2(sky.getHex(), 0.0016);
    (scene.fog as THREE.FogExp2).color.copy(sky);

    this.sun.position.copy(follow).addScaledVector(dir, 300);
    this.sun.target.position.copy(follow);
    this.sun.intensity = 2.3 * day;
    this.hemi.intensity = 0.3 + 0.9 * day + 0.55 * dusk * (elev > -0.15 ? 1 : 0); // warm ambient glow keeps the land lit at sunset

    // sky dome, light colour and water tint follow the time of day (warm and pink near the horizon)
    const duskAmt = dusk * (elev > -0.15 ? 1 : 0);
    const u = (this.skyDome.material as THREE.ShaderMaterial).uniforms;
    u.uSun.value.copy(dir); u.uHorizon.value.copy(sky);
    u.uZenith.value.copy(this.zenNight).lerp(this.zenDay, day).lerp(this.zenDusk, duskAmt * 0.6);
    u.uSunCol.value.copy(this.sunDay).lerp(this.sunDusk, Math.min(1, duskAmt * 1.4));
    u.uDay.value = day; u.uNight.value = night; u.uDusk.value = duskAmt; u.uTime.value = this.clock;
    this.sun.color.copy(this.sunDay).lerp(this.sunDusk, Math.min(1, duskAmt * 1.3));
    this.hemi.color.copy(this.hemiDay).lerp(this.hemiDusk, duskAmt).lerp(this.hemiNight, night);
    this.hemi.groundColor.setHex(0x7a3a8a).lerp(this.tmpCol2.setHex(0xb0506a), duskAmt);
    const wm = this.water.material as THREE.MeshStandardMaterial;
    wm.color.setHex(0x3fd6e6).lerp(this.tmpCol2.setHex(0xff9a7a), duskAmt * 0.55).lerp(this.tmpCol2.setHex(0x0b3a6a), night);
    wm.emissive.setHex(0x0a6a78).lerp(this.tmpCol2.setHex(0x6a2a40), duskAmt * 0.5).lerp(this.tmpCol2.setHex(0x0a3a6a), night);
    wm.emissiveIntensity = 0.35 + 0.5 * night + 0.25 * duskAmt;

    for (const s of this.siteRecs) if (!s.discovered && Math.hypot(s.x - head.x, s.z - head.z) < 120) s.discovered = true;
    this.zones.forEach((zn, i) => { if (Math.hypot(zn.x - head.x, zn.z - head.z) < zn.r + 150) this.zoneFound.add(i); });
    if (this.zoneMats.length) { this.zoneMats[0].opacity = 0.3 + 0.08 * Math.sin(this.animalTime * 1.7); this.zoneMats[1].opacity = 0.14 + 0.05 * Math.sin(this.animalTime * 2.3); }
    if (this.siteLights && this.siteRecs.length) { const on = Math.sin(this.animalTime * 4) > 0.2; const c = new THREE.Color(on ? 0xff3030 : 0x401010); for (let i = 0; i < this.siteRecs.length; i++) this.siteLights.setColorAt(i, c); if (this.siteLights.instanceColor) this.siteLights.instanceColor.needsUpdate = true; }
    if (this.hubBeam) (this.hubBeam.material as THREE.MeshBasicMaterial).opacity = (this.beaconOn ? 0.2 : 0.14) + 0.07 * Math.sin(this.animalTime * 2);
    this.updateFireflies(night, follow);
    this.updateAnimals(dt, follow, head);
    this.updatePod(dt, night);
    this.updateFalling(dt);
  }

  private updateFireflies(night: number, follow: THREE.Vector3): void {
    (this.fireflies.material as THREE.PointsMaterial).opacity = night * 0.9;
    this.fireflies.visible = night > 0.02;
    if (!this.fireflies.visible) return;
    const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute, t = this.animalTime;
    for (let i = 0; i < pos.count; i++) {
      const sx = this.ffSeeds[i * 3], sy = this.ffSeeds[i * 3 + 1], sz = this.ffSeeds[i * 3 + 2];
      // wrap each firefly inside a 80 m box centred on the player, drifting gently
      const x = follow.x + ((sx * 7.3 + t * 0.6 + Math.sin(t * 0.4 + sy) * 3) % 80 + 80) % 80 - 40;
      const z = follow.z + ((sz * 5.1 + t * 0.4 + Math.cos(t * 0.3 + sx) * 3) % 80 + 80) % 80 - 40;
      pos.setXYZ(i, x, Math.max(heightAt(x, z), WATER_Y) + 0.5 + (sy % 5) + Math.sin(t + sx) * 0.5, z);
    }
    pos.needsUpdate = true;
  }

  /** Is there open space (no rock, tree or water edge) around this ground point? */
  private clearAt(x: number, z: number): number {
    return this.world.distance(this.probe.set(x, heightAt(x, z) + 2.2, z));
  }

  private updateAnimals(dt: number, follow: THREE.Vector3, head: THREE.Vector3): void {
    for (const an of this.animals) {
      const p = an.group.position;
      const dx = head.x - p.x, dz = head.z - p.z, d = Math.hypot(dx, dz);
      const far = d > this.q.cull;
      an.group.visible = !far && (!an.nocturnal || this.nightF > 0.1); // wisps only glow at night
      if (far && (!an.flying || an.water)) continue; // freeze distant ground and water animals

      // ---- attention span: it studies you for a while, then looks away for a while ----
      const lk = an.look;
      lk.timer -= dt;
      if (d >= 45) { lk.away = false; lk.timer = Math.max(lk.timer, 2); }
      else if (lk.timer <= 0) {
        lk.away = !lk.away;
        if (lk.away) { lk.timer = 3 + Math.random() * 5; lk.ay = (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.7); lk.ap = (Math.random() - 0.7) * 0.5; }
        else lk.timer = 4 + Math.random() * 6;
      }
      const attentive = !lk.away;

      // ---- how it reacts to you ----
      const want = Math.atan2(dx, dz);            // heading that points at you
      const delta = wrap(want - an.heading);      // >0: you're on its +heading side
      let steer: number | null = null, speedMul = 1;
      switch (an.mood) {
        case 'curious':
          if (!attentive && d > 6) break;                                // lost interest: carries on
          if (an.flying) { if (d < 45 && d > 10) { steer = want; speedMul = 0.6; } else if (d <= 10) { steer = want; speedMul = 0; } }
          else if (d < 22 && d > 6) { steer = want; speedMul = 0; }       // stops to study you
          else if (d <= 6) { steer = want + Math.PI; speedMul = 0.8; }    // too close: backs away
          break;
        case 'shy': if (d < 28) { steer = want + Math.PI; speedMul = 1.6; } break;
        case 'skittish': if (d < (an.flying ? 25 : 14)) { steer = want + Math.PI; speedMul = 2; } break;
        case 'defensive': if (d < 18 && (attentive || d < 8)) { steer = want; speedMul = 0; } break;
        case 'friendly': if (d < 40 && attentive) { steer = want + (d < 5 ? 1.5 : 0); speedMul = d < 3 ? 0.3 : 1.2; } break;
        default: break;
      }
      // Walk into its path and it goes around you.
      if (steer === null && d < 15 && Math.abs(delta) < 0.6 && !an.water) steer = an.heading - Math.sign(delta || 1) * 1.0;
      // Herd and school animals stay with their leader
      if (steer === null && an.leader) {
        const L = an.leader.group.position, ld = Math.hypot(L.x - p.x, L.z - p.z);
        if (ld > 8) { steer = Math.atan2(L.x - p.x, L.z - p.z); speedMul = 1.3; } else steer = an.leader.heading;
      }
      // Moths circle campfires and lamps
      if (steer === null && an.moth) {
        const pr = this.nearestProp(p.x, p.z, 90);
        if (pr) { const pd = Math.hypot(pr.x - p.x, pr.z - p.z); steer = Math.atan2(pr.x - p.x, pr.z - p.z) + (pd < 7 ? 1.3 : 0); speedMul = pd < 7 ? 0.9 : 1.6; }
      }

      if (steer !== null) {
        an.turn = THREE.MathUtils.clamp(wrap(steer - an.heading) * 2, -1.6, 1.6);
      } else if (an.turnBias) {
        an.turn = an.turnBias + (Math.random() - 0.5) * 0.1;
      } else {
        an.turn += (Math.random() - 0.5) * 1.5 * dt;
        an.turn = THREE.MathUtils.clamp(an.turn, -0.6, 0.6) * (1 - 0.5 * dt);
        if (Math.hypot(p.x, p.z) > WORLD_R - 20) an.turn = THREE.MathUtils.clamp(wrap(Math.atan2(-p.x, -p.z) - an.heading), -1, 1);
      }
      if (an.water) { // stay in the water
        const wet = (a: number) => heightAt(p.x + Math.sin(a) * 6, p.z + Math.cos(a) * 6);
        if (wet(an.heading) > WATER_Y - 0.9) an.turn = wet(an.heading + 0.8) < wet(an.heading - 0.8) ? 1.5 : -1.5;
      } else if (!an.flying) { // steer around rocks, trunks and lakes
        const ahead = (a: number) => this.clearAt(p.x + Math.sin(a) * 4, p.z + Math.cos(a) * 4);
        if (ahead(an.heading) < 1.2 || heightAt(p.x + Math.sin(an.heading) * 5, p.z + Math.cos(an.heading) * 5) < ABOVE_WATER)
          an.turn = ahead(an.heading + 0.7) > ahead(an.heading - 0.7) ? 1.4 : -1.4;
      }

      an.heading += an.turn * dt;
      const sp = an.speed * speedMul;
      p.x += Math.sin(an.heading) * sp * dt;
      p.z += Math.cos(an.heading) * sp * dt;
      const clk = (this.clocks.get(an) ?? 0) + dt * (0.15 + 0.85 * Math.min(speedMul, 1.6)); // legs slow when it stops
      this.clocks.set(an, clk);
      const lift = an.tick(clk) || 0;
      const ground = heightAt(p.x, p.z);
      if (an.water) {
        let y = an.name === 'serpent' ? WATER_Y : WATER_Y - 0.55 + Math.sin(this.animalTime * 1.3 + p.x) * 0.08;
        if (an.leaps) { // glowfish jump out of the water now and then
          const st = this.leapState.get(an) ?? { t: -1, next: 3 + Math.random() * 12 }; this.leapState.set(an, st);
          st.next -= dt;
          if (st.t < 0 && st.next <= 0) { st.t = 0; st.next = 6 + Math.random() * 16; }
          if (st.t >= 0) { st.t += dt; const k = st.t / 0.9; y += Math.sin(Math.PI * Math.min(k, 1)) * 1.7; an.group.rotation.x = -0.6 * Math.cos(Math.PI * Math.min(k, 1)); if (k >= 1) { st.t = -1; an.group.rotation.x = 0; } }
        }
        p.y = y;
      } else p.y = an.flying ? Math.max(ground, WATER_Y) + an.hover + Math.sin(this.animalTime * 0.6 + an.hover) * 0.8 + lift : ground + lift;
      an.group.rotation.y = an.heading;

      // ---- roars ----
      const r = an.roar;
      if (d > 60) r.noticed = false;
      else if (d < 30 && !r.noticed) { r.noticed = true; r.next = Math.min(r.next, 0.4 + Math.random()); } // roars when it first sees you
      r.next -= dt;
      if (r.next <= 0) {
        r.next = 14 + Math.random() * 28;
        if (d < 160) { r.timer = 1.4; this.onRoar?.(this.probe.set(p.x, p.y + (an.flying ? 0 : 2), p.z), an.name); }
      }
      const env = r.timer > 0 ? Math.sin(Math.PI * (1 - r.timer / 1.4)) : 0;
      if (r.timer > 0) r.timer -= dt;
      an.group.scale.setScalar((an.nocturnal ? Math.max(0.001, this.nightF) : an.name === 'serpent' ? 1.4 : 1) * (1 + 0.07 * env));

      // ---- head follows you ----
      if (an.head) {
        const near = d < 45;
        let ty = near ? THREE.MathUtils.clamp(delta, -1.3, 1.3) : 0;
        let tp = near ? THREE.MathUtils.clamp(Math.atan2(head.y - (p.y + (an.flying ? 0 : 1.8)), d), -0.6, 0.6) : 0;
        if (near && !attentive) { ty = lk.ay; tp = lk.ap; }                 // looks away
        const k = Math.min(1, dt * 4);
        an.look.yaw += (ty - an.look.yaw) * k; an.look.pitch += (tp - an.look.pitch) * k;
        an.head.rotation.y = an.look.yaw;
        if (an.yawOnly) an.head.rotation.x += -0.4 * env;   // neck rears back to roar
        else an.head.rotation.x = -an.look.pitch * 0.8 - 0.5 * env;
      }
    }
  }

  /** Live data for the map. */
  get trees(): readonly TreeRec[] { return this.treeRecs; }
  get creatures(): readonly Animal[] { return this.animals; }
  get podPosition(): THREE.Vector3 | null { return this.pod && this.podAlive ? this.pod.position : null; }

  /** Matrix for a tree tilted by `angle` about `axis` at its base (used for the hit wobble). */
  private setTreeTilt(rec: TreeRec, angle: number, axis: THREE.Vector3): void {
    const base = new THREE.Matrix4().compose(new THREE.Vector3(rec.x, rec.y, rec.z), new THREE.Quaternion().setFromAxisAngle(axis, angle), new THREE.Vector3(1, 1, 1));
    const fol = rec.pine ? this.pineMesh : this.canopyMesh;
    this.trunkMesh.setMatrixAt(rec.trunkIdx, base.clone().multiply(rec.trunkLocal)); this.trunkMesh.instanceMatrix.needsUpdate = true;
    fol.setMatrixAt(rec.foliageIdx, base.clone().multiply(rec.foliageLocal)); fol.instanceMatrix.needsUpdate = true;
  }

  /**
   * One punch on a tree. The tree shakes and drops leaves; after `needed` punches (2, or 1 with an axe)
   * it falls. Returns punches left (0 = felled). Punches are forgotten after 8 s.
   */
  hitTree(id: number, from: THREE.Vector3, needed: number): number {
    const rec = this.treeRecs[id];
    if (!rec || rec.felled) return 0;
    if (this.clock - rec.lastHit > 8) rec.hits = 0;
    rec.lastHit = this.clock; rec.hits++;
    if (rec.hits >= needed) { this.fellTree(id, from); return 0; }
    const dir = new THREE.Vector3(rec.x - from.x, 0, rec.z - from.z); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.wobbling = this.wobbling.filter(w => w.rec !== rec);
    this.wobbling.push({ rec, t: 0, axis: new THREE.Vector3(dir.z, 0, -dir.x) });
    this.burst(new THREE.Vector3(rec.x, rec.y + rec.h * 0.9, rec.z), 5, rec.color, 0.25, 3);
    return needed - rec.hits;
  }

  private updateWobble(dt: number): void {
    for (let i = this.wobbling.length - 1; i >= 0; i--) {
      const w = this.wobbling[i]; w.t += dt;
      if (w.rec.felled) { this.wobbling.splice(i, 1); continue; }
      const k = Math.max(0, 1 - w.t / 0.5);
      this.setTreeTilt(w.rec, Math.sin(w.t * 38) * 0.07 * k, w.axis);
      if (w.t >= 0.5) { this.setTreeTilt(w.rec, 0, w.axis); this.wobbling.splice(i, 1); }
    }
  }

  /** Hit a crystal spire. Breaks after `needed` punches. Returns punches left (0 = broke). */
  hitCrystal(i: number, needed: number): number {
    const c = this.crystalRecs[i];
    if (!c || c.broken) return 0;
    c.hits++;
    const at = new THREE.Vector3(c.x, c.y + Math.min(c.h * 0.4, 3), c.z);
    if (c.hits < needed) { this.burst(at, 4, c.color, 0.14, 3); return needed - c.hits; }
    c.broken = true;
    this.world.removeOwner(CRYSTAL_OWNER + i);
    this.crystalMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.crystalMesh.instanceMatrix.needsUpdate = true;
    this.burst(at, 10, c.color, 0.25, 5);
    this.onCrystal?.(c.h > 8 ? 2 : 1, at);
    this.onHarvest?.('crystal', i);
    return 0;
  }

  // ---------------- placeable props ----------------

  get props(): readonly { kind: PropKind; x: number; z: number }[] { return this.propList; }
  propCount(kind: PropKind): number { return this.propList.filter(p => p.kind === kind).length; }

  /** Open, level, dry ground with nothing solid in the way? */
  canPlaceProp(x: number, z: number): { ok: boolean; y: number; reason: string } {
    const y = heightAt(x, z);
    if (y < WATER_Y + 0.4) return { ok: false, y, reason: 'Too close to water' };
    let lo = y, hi = y;
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { const h = heightAt(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 0.7) return { ok: false, y, reason: 'Ground too steep' };
    if (this.world.distance(new THREE.Vector3(x, y + 0.9, z)) < 0.8) return { ok: false, y, reason: 'Something is in the way' };
    return { ok: true, y, reason: '' };
  }

  placeProp(kind: PropKind, x: number, z: number): void {
    const y = heightAt(x, z);
    const mesh = kind === 'campfire' ? buildCampfire() : buildLamp();
    mesh.group.position.set(x, y, z);
    this.group.add(mesh.group);
    if (kind === 'campfire') this.world.addSphere(new THREE.Vector3(x, y + 0.2, z), 0.5, 0.3);
    else this.world.addCylinder(x, z, y, y + 3, 0.2, 0.2);
    this.world.finalize();
    this.propList.push({ kind, x, z, mesh });
  }

  /**
   * Knock a tree down, away from `from`. It tips over in a second, lies there, and after 3 s
   * vanishes and `onWood` fires. Returns false if it was already felled.
   */
  fellTree(id: number, from: THREE.Vector3): boolean {
    const rec = this.treeRecs[id];
    if (!rec || rec.felled) return false;
    rec.felled = true;
    this.world.removeOwner(id);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.trunkMesh.setMatrixAt(rec.trunkIdx, zero); this.trunkMesh.instanceMatrix.needsUpdate = true;
    const fol = rec.pine ? this.pineMesh : this.canopyMesh;
    fol.setMatrixAt(rec.foliageIdx, zero); fol.instanceMatrix.needsUpdate = true;

    const group = new THREE.Group(); group.position.set(rec.x, rec.y, rec.z);
    const trunk = new THREE.Mesh(this.trunkMesh.geometry, this.trunkMesh.material);
    trunk.matrixAutoUpdate = false; trunk.matrix.copy(rec.trunkLocal);
    const leaves = new THREE.Mesh(fol.geometry, new THREE.MeshStandardMaterial({ color: rec.color, roughness: 0.75, flatShading: rec.pine }));
    leaves.matrixAutoUpdate = false; leaves.matrix.copy(rec.foliageLocal);
    group.add(trunk, leaves);
    this.group.add(group);

    const f = new THREE.Vector3(rec.x - from.x, 0, rec.z - from.z);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    // rotating about (f.z, 0, -f.x) tips the tree's up-vector toward f
    this.falling.push({ rec, group, t: 0, axis: new THREE.Vector3(f.z, 0, -f.x), landed: false });
    this.onHarvest?.('tree', id); this.scheduleRespawn('tree', id);
    return true;
  }

  /**
   * A friend used up a resource: remove it here too, quietly (a puff of dust, no loot and no callbacks).
   * Safe to call twice and for things you already used up yourself.
   */
  applyRemote(kind: Harvest, i: number): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    if (kind === 'tree') {
      const r = this.treeRecs[i]; if (!r || r.felled) return;
      r.felled = true; this.world.removeOwner(i);
      this.trunkMesh.setMatrixAt(r.trunkIdx, zero); this.trunkMesh.instanceMatrix.needsUpdate = true;
      const fol = r.pine ? this.pineMesh : this.canopyMesh; fol.setMatrixAt(r.foliageIdx, zero); fol.instanceMatrix.needsUpdate = true;
      this.burst(new THREE.Vector3(r.x, r.y + 2, r.z), 6, r.color, 0.2, 4); this.scheduleRespawn('tree', i);
    } else if (kind === 'bush') {
      const b = this.bushRecs[i]; if (!b || b.picked) return;
      b.picked = true; this.world.removeOwner(BUSH_OWNER + i); this.bushMesh.setMatrixAt(i, zero); this.bushMesh.instanceMatrix.needsUpdate = true;
      this.burst(new THREE.Vector3(b.x, b.y + b.r * 0.6, b.z), 5, 0x7fe05a, 0.12, 3); this.scheduleRespawn('bush', i);
    } else if (kind === 'boulder') {
      const b = this.boulderRecs[i]; if (!b || b.broken) return;
      b.broken = true; this.world.removeOwner(BOULDER_OWNER + i);
      this.boulderMesh.setMatrixAt(i, zero); this.boulderMesh.instanceMatrix.needsUpdate = true;
      this.burst(new THREE.Vector3(b.x, b.y + b.r * 0.5, b.z), 8, 0x9a90a8, 0.28 * b.r, 5); this.scheduleRespawn('boulder', i);
    } else if (kind === 'crystal') {
      const c = this.crystalRecs[i]; if (!c || c.broken) return;
      c.broken = true; this.world.removeOwner(CRYSTAL_OWNER + i);
      this.crystalMesh.setMatrixAt(i, zero); this.crystalMesh.instanceMatrix.needsUpdate = true;
      this.burst(new THREE.Vector3(c.x, c.y + Math.min(c.h * 0.4, 3), c.z), 8, c.color, 0.25, 5);
    } else if (kind === 'ore') {
      const o = this.oreRecs[i]; if (!o || o.broken) return;
      o.broken = true; this.world.removeOwner(ORE_OWNER + i); this.hideOre(o);
      this.burst(new THREE.Vector3(o.x, o.y + o.r * 0.6, o.z), 8, ORE_DEF[o.type].color, 0.2, 5); this.scheduleRespawn('ore', i);
    } else {
      const s = this.siteRecs[i]; if (!s || s.looted) return;
      s.looted = true; s.discovered = true; this.world.removeOwner(CRASH_OWNER + i);
      this.siteMesh.setMatrixAt(i, zero); this.siteLights.setMatrixAt(i, zero);
      this.siteMesh.instanceMatrix.needsUpdate = this.siteLights.instanceMatrix.needsUpdate = true;
      this.burst(new THREE.Vector3(s.x, s.y + 1, s.z), 10, 0x8a96aa, 0.22, 6);
    }
  }

  // ---------------- stone, pod and hub ----------------

  /** Spawn flying chunks that shrink away. */
  private burst(pos: THREE.Vector3, n: number, color: number, size: number, speed = 4): void {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: color === 0x8a96aa ? 0.7 : 0, flatShading: true });
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size * (0.5 + Math.random() * 0.7), 0), mat);
      mesh.position.copy(pos);
      this.group.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * speed, 1 + Math.random() * speed, (Math.random() - 0.5) * speed), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0), t: 0, life: 1.1 + Math.random() * 0.5 });
    }
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt; d.vel.y -= 9 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      const g = heightAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < g + 0.05) { d.mesh.position.y = g + 0.05; d.vel.multiplyScalar(0.3); d.vel.y = Math.abs(d.vel.y) * 0.2; }
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.scale.setScalar(Math.max(0, 1 - Math.max(0, d.t - d.life * 0.5) / (d.life * 0.5)));
      if (d.t >= d.life) { this.group.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }

  /** Hit a boulder. 3 hits break it into stone. Returns hits left (0 = broke). */
  hitBoulder(i: number, needed = 3): number {
    const b = this.boulderRecs[i];
    if (!b || b.broken) return 0;
    b.hits++;
    const at = new THREE.Vector3(b.x, b.y + b.r * 0.5, b.z);
    if (b.hits < needed) { this.burst(at, 3, 0x9a90a8, 0.15 * b.r, 2.5); return needed - b.hits; }
    b.broken = true;
    this.world.removeOwner(BOULDER_OWNER + i);
    this.boulderMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.boulderMesh.instanceMatrix.needsUpdate = true;
    this.burst(at, 9, 0x9a90a8, 0.28 * b.r, 5);
    this.onStone?.(Math.max(2, Math.round(b.r * 1.4)), at);
    this.onHarvest?.('boulder', i); this.scheduleRespawn('boulder', i);
    return 0;
  }

  /** Hit the crashed pod. Returns hits left (0 = destroyed). */
  hitPod(needed: number): number {
    if (!this.podAlive || !this.pod) return 0;
    this.podHits++;
    this.podShake = 0.3;
    const at = this.pod.position.clone(); at.y += 0.9;
    if (this.podHits < needed) { this.burst(at, 3, 0x8a96aa, 0.12, 3); return needed - this.podHits; }
    this.podAlive = false;
    this.world.removeOwner(POD_OWNER);
    if (this.podHull) { this.pod.remove(this.podHull); this.podHull = null; }
    for (const s of this.smoke) this.pod.remove(s);
    this.smoke.length = 0;
    if (this.podLight) { this.pod.remove(this.podLight); this.podLight = null; }
    this.burst(at, 18, 0x8a96aa, 0.3, 6);
    this.onPodDestroyed?.(at);
    return 0;
  }

  /** Can the Hub go here? Checks water, slope, trees and boulders. Returns the base height too. */
  canPlaceHub(x: number, z: number, yaw: number): { ok: boolean; y: number; reason: string } {
    const pose: HubPose = { x, y: 0, z, yaw };
    let lo = Infinity, hi = -Infinity;
    for (let lx = -6.2; lx <= 6.2; lx += 2.07) for (let lz = -2.8; lz <= 2.8; lz += 1.4) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const h = heightAt(x + lx * c + lz * s, z - lx * s + lz * c);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (lo < WATER_Y + 0.6) return { ok: false, y: hi, reason: 'Too close to water' };
    if (hi - lo > 3.2) return { ok: false, y: hi, reason: 'Ground too steep' };
    for (const t of this.treeRecs) if (!t.felled && Math.hypot(t.x - x, t.z - z) < HUB_RADIUS + 1.5) return { ok: false, y: hi, reason: 'A tree is in the way' };
    for (const b of this.boulderRecs) if (!b.broken && Math.hypot(b.x - x, b.z - z) < HUB_RADIUS + b.r) return { ok: false, y: hi, reason: 'A boulder is in the way' };
    return { ok: true, y: hi, reason: '' };
  }

  /** Build the Hub for real. */
  placeHub(x: number, z: number, yaw: number, y: number): { pose: HubPose; mesh: HubMesh; group: THREE.Group } {
    const pose: HubPose = { x, y, z, yaw };
    const mesh = buildHubMesh(false);
    mesh.group.position.set(x, y, z); mesh.group.rotation.y = yaw;
    const light = new THREE.PointLight(0xcfeaff, 6, 9, 2); light.position.set(0, 2.9, 0); mesh.group.add(light);
    this.group.add(mesh.group);
    addHubColliders(this.world, pose);
    this.hub = { pose, mesh, group: mesh.group };
    this.hubBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x2ab8ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    this.group.add(this.hubBeam);
    this.setBeacon(this.beaconOn);
    return this.hub;
  }

  private updateFalling(dt: number): void {
    this.updateDebris(dt);
    this.updateWobble(dt);
    for (const pr of this.propList) pr.mesh.tick(this.animalTime);
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const k = Math.min(f.t / 1.0, 1);
      const bounce = f.t > 1 ? 0.07 * Math.max(0, 1 - (f.t - 1) * 4) * Math.abs(Math.sin((f.t - 1) * 18)) : 0;
      f.group.quaternion.setFromAxisAngle(f.axis, (Math.PI / 2) * k * k - bounce);
      f.group.position.y = f.rec.y + 0.35 * k * k;
      if (f.t >= 1 && !f.landed) { f.landed = true; this.onTreeLanded?.(new THREE.Vector3(f.rec.x, f.rec.y, f.rec.z)); }
      if (f.t >= 3) { // gone after 3 s: hand over the wood
        this.group.remove(f.group);
        ((f.group.children[1] as THREE.Mesh).material as THREE.Material).dispose();
        this.falling.splice(i, 1);
        this.onWood?.(Math.max(2, Math.round(f.rec.h / 3)) + (f.rec.pine ? 1 : 0), new THREE.Vector3(f.rec.x, f.rec.y + 2, f.rec.z));
      }
    }
  }

  /** Your escape pod, wedged in the ground a few metres behind where you landed. */
  placePod(head: THREE.Vector3, forward: THREE.Vector3): void {
    this.podHead.copy(head); this.podForward.copy(forward);
    const back = new THREE.Vector3(-forward.x, 0, -forward.z).normalize();
    const x = head.x + back.x * 4.6, z = head.z + back.z * 4.6, y = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(back.x, back.z);

    // scorched crater and churned-up rim
    const crater = new THREE.Mesh(new THREE.CircleGeometry(2.4, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x241822, roughness: 1 }));
    crater.position.y = 0.05; g.add(crater);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 8, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a4a58, roughness: 1 }));
    rim.position.y = 0.12; rim.scale.y = 0.6; g.add(rim);

    // hull: capsule ~2.6 m long, 1.7 m wide (a bit bigger than a person), nose-down and half buried
    const hullGeo = new THREE.CapsuleGeometry(0.85, 0.9, 6, 20).rotateX(Math.PI / 2);
    const pp = hullGeo.attributes.position, hc: number[] = [], base = new THREE.Color(0xaab2c6), char = new THREE.Color(0x2e2528), c = new THREE.Color();
    for (let i = 0; i < pp.count; i++) { // soot toward the tail (toward you)
      c.copy(base).lerp(char, smoothstep(0.2, -1.1, pp.getZ(i)) * 0.9);
      hc.push(c.r, c.g, c.b);
    }
    hullGeo.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
    const hull = new THREE.Group(); hull.position.y = 0.6; hull.rotation.x = 0.32; g.add(hull);
    this.podHull = hull;
    hull.add(new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 })));
    const metal = new THREE.MeshStandardMaterial({ color: 0x6f778c, metalness: 0.7, roughness: 0.4 });
    for (const z of [-0.7, 0, 0.7]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.035, 6, 24), metal); t.position.z = z; hull.add(t); }
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10).scale(1, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0x40e0ff, emissive: 0x30c8ff, emissiveIntensity: 1.3 }));
    win.position.set(0, 0.7, 0.3); hull.add(win);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a3a46, metalness: 0.6, roughness: 0.5 }));
    hatch.position.set(0.95, 0.35, 0.2); hatch.rotation.z = -0.9; hull.add(hatch);        // blown-open hatch
    for (const a of [0, 2.1, 4.2]) { // tail fins
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.55), metal);
      f.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, -1.25); f.rotation.z = a; hull.add(f);
    }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.3, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2428, metalness: 0.5, roughness: 0.6 }));
    nozzle.position.z = -1.45; hull.add(nozzle);
    const ember = new THREE.Mesh(new THREE.CircleGeometry(0.2, 14).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: 0xff7020, toneMapped: false }));
    ember.position.z = -1.61; hull.add(ember);

    // debris scattered around the impact
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4a4a58, metalness: 0.6, roughness: 0.5 }), 16);
    const m = new THREE.Matrix4(), rr = rngFrom(99);
    for (let i = 0; i < 16; i++) {
      const a = rr() * Math.PI * 2, r = 1.8 + rr() * 5, sz = 0.1 + rr() * 0.35;
      m.compose(new THREE.Vector3(Math.cos(a) * r, sz * 0.3, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr() * 3, rr() * 3, rr() * 3)), new THREE.Vector3(sz, sz * 0.5, sz * (1 + rr())));
      debris.setMatrixAt(i, m);
    }
    g.add(debris);

    // smoke plume
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sg = sc.getContext('2d')!, grad = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(90,80,95,0.9)'); grad.addColorStop(1, 'rgba(90,80,95,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(sc);
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.phase = i / 14; sp.position.set(0, 1, -1.2); g.add(sp); this.smoke.push(sp);
    }
    this.podLight = new THREE.PointLight(0xff8a40, 3, 12, 2); this.podLight.position.set(0, 0.8, -1.6); g.add(this.podLight);

    // solid enough to push off
    const axis = new THREE.Vector3(back.x * Math.cos(0.32), -Math.sin(0.32), back.z * Math.cos(0.32));
    for (const t of [-0.8, 0, 0.8]) this.world.addSphere(new THREE.Vector3(x, y + 0.6, z).addScaledVector(axis, t), 0.8, 0.3, POD_OWNER);
    this.world.finalize();
    this.pod = g; this.podBaseY = y;
    this.group.add(g);
  }

  private updatePod(dt: number, night: number): void {
    if (!this.pod) return;
    const t = this.animalTime;
    if (this.podShake > 0) { this.podShake -= dt; this.pod.position.x += (Math.random() - 0.5) * 0.04; this.pod.position.y = this.podBaseY + (Math.random() - 0.5) * 0.04; }
    for (const sp of this.smoke) {
      const ph = (sp.userData.phase + t * 0.12) % 1; // 0..1 along its life
      sp.position.set(Math.sin(ph * 6 + sp.userData.phase * 9) * 0.3 + ph * 1.8, 1 + ph * 7, -1.2 + ph * 1.2);
      const sc = 0.7 + ph * 3.2; sp.scale.set(sc, sc, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.45;
    }
    if (this.podLight) this.podLight.intensity = (2 + night * 3) * (0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 5.3));
    void dt;
  }
}
