import type { SaveData } from './Save';

/**
 * A realm is a multiplayer world the host saved, like a Minecraft realm: it keeps its lobby code and its list of
 * members (everyone who was in the lobby at a save). Only members can join it when the host hosts it again, and each
 * member gets their own inventory and progress back.
 */
export interface RealmSave {
  version: 1;
  code: string;
  savedAt: number;
  hostName: string;
  maxPlayers: number;
  /** Player id -> name/colour, for everyone who may join. */
  members: Record<string, { name: string; color: number }>;
  /** Saved progress and position per member (not the host: theirs is in `world`). */
  progressOf: Record<string, { progress: unknown; pos: number[] | null }>;
  /** The host's own save: the planet, factory and buildings plus the host's progress. */
  world: SaveData;
}

/** A realm someone else hosts that you are a member of (you can jump straight back in with its code). */
export interface JoinedRealm { code: string; host: string; savedAt: number }

const key = (code: string) => `satismonke.realm.${code}`;
const JOINED = 'satismonke.joined';

export function listRealms(): RealmSave[] {
  const out: RealmSave[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('satismonke.realm.')) continue;
      const r = JSON.parse(localStorage.getItem(k) ?? 'null') as RealmSave | null;
      if (r && r.version === 1) out.push(r);
    }
  } catch { /* ignore */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function readRealm(code: string): RealmSave | null {
  try { const r = JSON.parse(localStorage.getItem(key(code)) ?? 'null') as RealmSave | null; return r && r.version === 1 ? r : null; } catch { return null; }
}
export function writeRealm(r: RealmSave): boolean { try { localStorage.setItem(key(r.code), JSON.stringify(r)); return true; } catch { return false; } }
export function deleteRealm(code: string): void { try { localStorage.removeItem(key(code)); } catch { /* ignore */ } }

export function listJoined(): JoinedRealm[] {
  try { const a = JSON.parse(localStorage.getItem(JOINED) ?? '[]') as JoinedRealm[]; return a.sort((x, y) => y.savedAt - x.savedAt); } catch { return []; }
}
export function rememberJoined(code: string, host: string): void {
  const all = listJoined().filter(j => j.code !== code); all.push({ code, host, savedAt: Date.now() });
  try { localStorage.setItem(JOINED, JSON.stringify(all.slice(-8))); } catch { /* ignore */ }
}
export function forgetJoined(code: string): void {
  try { localStorage.setItem(JOINED, JSON.stringify(listJoined().filter(j => j.code !== code))); } catch { /* ignore */ }
}
