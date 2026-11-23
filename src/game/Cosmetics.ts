/** How your pioneer looks, what you have unlocked, and the codes that unlock things. */
export interface Look { fur: number; suit: number; hat: string; badge: string }

export const FUR_PALETTE = [0xa8683a, 0x6b4a2f, 0xd9b06a, 0x7a7f8c, 0x2f2f38, 0xc0553a, 0x3f78c8, 0x4fa86a, 0x9a5fd0, 0xe8789a];
export const SUIT_PALETTE = [0xe9edf5, 0xf0dcc0, 0xbfe0f5, 0xc8ecd0, 0xf5c8d8, 0x8b95a8];
export const SUIT_NAMES = ['White', 'Sand', 'Sky', 'Mint', 'Rose', 'Slate'];

export interface Item { id: string; name: string; /** needs a code */ locked?: boolean }
export const HATS: Item[] = [
  { id: 'none', name: 'No hat' }, { id: 'beanie', name: 'Beanie' }, { id: 'propeller', name: 'Propeller cap' },
  { id: 'party', name: 'Party hat', locked: true },
];
export const BADGES: Item[] = [
  { id: 'none', name: 'No badge' }, { id: 'star', name: 'Gold star' },
  { id: 'og', name: 'OG badge', locked: true },
];

/** Redeemable codes (typed in from the main menu). */
export const CODES: Record<string, { unlock: string[]; message: string }> = {
  YOUMYDAYONE: { unlock: ['hat:party', 'badge:og'], message: 'Launch cosmetics unlocked: Party hat + OG badge!' },
};

const LOOK_KEY = 'satismonke.look', UNLOCK_KEY = 'satismonke.unlocked';

export function loadUnlocked(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(UNLOCK_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
export const isUnlocked = (kind: 'hat' | 'badge', it: Item, u = loadUnlocked()) => !it.locked || u.has(`${kind}:${it.id}`);

export function loadLook(defaultFur: number): Look {
  const base: Look = { fur: defaultFur, suit: SUIT_PALETTE[0], hat: 'none', badge: 'none' };
  try {
    const d = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as Partial<Look> | null;
    if (d) {
      const u = loadUnlocked();
      const ok = (kind: 'hat' | 'badge', list: Item[], id?: string) => { const it = list.find(i => i.id === id); return it && isUnlocked(kind, it, u) ? it.id : 'none'; };
      return { fur: typeof d.fur === 'number' ? d.fur : base.fur, suit: typeof d.suit === 'number' ? d.suit : base.suit, hat: ok('hat', HATS, d.hat), badge: ok('badge', BADGES, d.badge) };
    }
  } catch { /* ignore */ }
  return base;
}
export function saveLook(l: Look): void { try { localStorage.setItem(LOOK_KEY, JSON.stringify(l)); } catch { /* private mode */ } }

/** Step through an option list, skipping anything still locked. */
export function stepItem(kind: 'hat' | 'badge', list: Item[], current: string, dir: number): string {
  const u = loadUnlocked(), avail = list.filter(i => isUnlocked(kind, i, u));
  const at = Math.max(0, avail.findIndex(i => i.id === current));
  return avail[(at + dir + avail.length) % avail.length].id;
}
export function stepColor(palette: number[], current: number, dir: number): number {
  const at = palette.indexOf(current);
  return palette[at < 0 ? (dir > 0 ? 0 : palette.length - 1) : (at + dir + palette.length) % palette.length];
}

/** Try a code. Returns what to tell the player and what (if anything) to equip. */
export function redeem(raw: string): { ok: boolean; message: string; equip?: Partial<Look> } {
  const code = CODES[raw.trim().toUpperCase()];
  if (!code) return { ok: false, message: 'That code does not work' };
  const u = loadUnlocked(), fresh = code.unlock.filter(i => !u.has(i));
  for (const i of code.unlock) u.add(i);
  try { localStorage.setItem(UNLOCK_KEY, JSON.stringify([...u])); } catch { /* ignore */ }
  const equip: Partial<Look> = {};
  for (const i of code.unlock) { const [kind, id] = i.split(':'); if (kind === 'hat') equip.hat = id; if (kind === 'badge') equip.badge = id; }
  return { ok: true, message: fresh.length ? code.message : 'You already redeemed that code (items equipped)', equip };
}
