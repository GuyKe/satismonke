import type { ProgressData } from './Progress';
import type { FactoryState } from './Factory';

export const SLOTS = 3;
const key = (i: number) => `satismonke.save.${i}`;

/** Everything about the world that changes while you play (see Planet.exportState). */
export interface PlanetState {
  /** The detail level the world was generated with: indices in this save only match that exact world. */
  quality: 'low' | 'medium' | 'high';
  clock: number;
  felledTrees: number[]; brokenBoulders: number[]; brokenCrystals: number[]; brokenOres: number[];
  podAlive: boolean; podHead: [number, number, number]; podForward: [number, number, number];
  hub: { x: number; y: number; z: number; yaw: number } | null;
  props: { kind: 'campfire' | 'lamp'; x: number; z: number }[];
  /** Machines and belts (optional: older saves have none). */
  factory?: FactoryState;
}

export interface SaveData {
  version: 2;
  savedAt: number;
  playSeconds: number;
  /** 'capsule' = still in the pod sequence (a fresh start); 'planet' = landed. */
  phase: 'capsule' | 'planet';
  objective: string;
  progress: ProgressData;
  player: { x: number; y: number; z: number };
  planet: PlanetState | null;
}

export function readSlot(i: number): SaveData | null {
  try {
    const raw = localStorage.getItem(key(i));
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.version === 2 ? d : null; // saves from before the bigger world (version 1) no longer match the map
  } catch { return null; }
}

export function writeSlot(i: number, d: SaveData): boolean {
  try { localStorage.setItem(key(i), JSON.stringify(d)); return true; } catch { return false; }
}

export function deleteSlot(i: number): void {
  try { localStorage.removeItem(key(i)); } catch { /* ignore */ }
}

export function listSlots(): (SaveData | null)[] { return Array.from({ length: SLOTS }, (_, i) => readSlot(i)); }

export function formatPlaytime(sec: number): string {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
