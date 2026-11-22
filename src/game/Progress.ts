export type Res = 'wood' | 'stone' | 'steel' | 'crystal';
export type Cost = Partial<Record<Res, number>>;
export type RecipeId = 'hub' | 'campfire' | 'pickaxe' | 'axe' | 'lantern' | 'gloves' | 'sticky' | 'floatcore' | 'crystalgloves' | 'lamp';

export interface Recipe {
  id: RecipeId;
  name: string;
  desc: string;
  where: 'x' | 'bench';
  cost: Cost;
  /** Placeable things can be made again and again. */
  repeatable?: boolean;
  /** Locked recipes show `lockedHint` instead of a Craft button. */
  unlocked(p: Progress): boolean;
  lockedHint(p: Progress): string;
}

export const POD_HITS = 5;
export const BOULDER_HITS = 3;
export const TREE_HITS = 2;
export const CRYSTAL_HITS = 2;
export const POD_STEEL = 8;
export const MAX_PLACED = 4; // campfires / lamps

const always = () => true, noHint = () => '';

export const RECIPES: Recipe[] = [
  // ---- X menu: things you can make with just your hands ----
  { id: 'hub', name: 'Hub', desc: 'Steel base with a bench and a computer', where: 'x',
    cost: { wood: 10, stone: 8, steel: 8 }, unlocked: always, lockedHint: noHint },
  { id: 'campfire', name: 'Campfire', desc: 'A warm light you can place', where: 'x', repeatable: true,
    cost: { wood: 5, stone: 3 }, unlocked: always, lockedHint: noHint },
  { id: 'pickaxe', name: 'Stone Pickaxe', desc: 'Boulders and crystals break in 1 hit, +1 stone', where: 'x',
    cost: { wood: 3, stone: 4 }, unlocked: always, lockedHint: noHint },
  // ---- Hub bench: unlock these as you explore ----
  { id: 'axe', name: 'Stone Axe', desc: 'Trees fall in 1 hit, +1 wood', where: 'bench',
    cost: { wood: 3, stone: 3 }, unlocked: always, lockedHint: noHint },
  { id: 'lantern', name: 'Lantern', desc: 'A light that follows your head', where: 'bench',
    cost: { wood: 4, steel: 1 }, unlocked: p => p.totalWood >= 20, lockedHint: p => `Collect 20 wood (${Math.min(p.totalWood, 20)}/20)` },
  { id: 'gloves', name: 'Power Gloves', desc: 'Launch harder and faster', where: 'bench',
    cost: { stone: 6, steel: 2 }, unlocked: p => p.bouldersBroken >= 5, lockedHint: p => `Break 5 boulders (${Math.min(p.bouldersBroken, 5)}/5)` },
  { id: 'sticky', name: 'Sticky Gloves', desc: 'Grip even ice', where: 'bench',
    cost: { wood: 4, stone: 4 }, unlocked: p => p.treesFelled >= 10, lockedHint: p => `Fell 10 trees (${Math.min(p.treesFelled, 10)}/10)` },
  { id: 'floatcore', name: 'Float Core', desc: 'Lower gravity: floaty jumps', where: 'bench',
    cost: { crystal: 4, steel: 2 }, unlocked: p => p.totalCrystal >= 4, lockedHint: p => `Collect 4 crystals (${Math.min(p.totalCrystal, 4)}/4)` },
  { id: 'crystalgloves', name: 'Crystal Gloves', desc: 'Even stronger launches', where: 'bench',
    cost: { crystal: 5, steel: 3 }, unlocked: p => p.has('gloves') && p.totalCrystal >= 8,
    lockedHint: p => p.has('gloves') ? `Collect 8 crystals (${Math.min(p.totalCrystal, 8)}/8)` : 'Craft Power Gloves first' },
  { id: 'lamp', name: 'Crystal Lamp', desc: 'A tall glowing lamp post you can place', where: 'bench', repeatable: true,
    cost: { crystal: 2, wood: 2, steel: 1 }, unlocked: p => p.totalCrystal >= 3, lockedHint: p => `Collect 3 crystals (${Math.min(p.totalCrystal, 3)}/3)` },
];

const label: Record<Res, string> = { wood: 'wood', stone: 'stone', steel: 'steel', crystal: 'crystal' };

/** Inventory, unlock counters and the objective text. In-memory only (not saved yet). */
export class Progress {
  items: Record<Res, number> = { wood: 0, stone: 0, steel: 0, crystal: 0 };
  totalWood = 0;
  totalCrystal = 0;
  treesFelled = 0;
  bouldersBroken = 0;
  made: Partial<Record<RecipeId, number>> = {};
  podHits = 0;
  podDestroyed = false;
  hubPlaced = false;
  benchOpened = false;
  gamePlayed = false;
  crafted = new Set<string>();

  add(r: Res, n: number): void { this.items[r] += n; if (r === 'wood') this.totalWood += n; if (r === 'crystal') this.totalCrystal += n; }
  canAfford(c: Cost): boolean { return (Object.keys(c) as Res[]).every(r => this.items[r] >= (c[r] ?? 0)); }
  spend(c: Cost): void { for (const r of Object.keys(c) as Res[]) this.items[r] -= c[r] ?? 0; }
  /** How many of each resource are still missing. */
  missing(c: Cost): Cost {
    const m: Cost = {};
    for (const r of Object.keys(c) as Res[]) { const d = (c[r] ?? 0) - this.items[r]; if (d > 0) m[r] = d; }
    return m;
  }
  describeMissing(c: Cost): string {
    const m = this.missing(c);
    const parts = (Object.keys(m) as Res[]).map(r => `${m[r]} ${label[r]}`);
    return parts.length ? `Need ${parts.join(', ')}` : '';
  }
  /** Campfires/lamps made so far (placed or waiting to be placed). */
  propsPlacedOrPending(id: RecipeId): number { return this.count(id); }
  count(id: RecipeId): number { return this.made[id] ?? 0; }
  recipe(id: string): Recipe { return RECIPES.find(r => r.id === id)!; }
  has(id: string): boolean { return this.crafted.has(id); }

  /** Two short lines for the wrist objective display. */
  objective(): [string, string] {
    const hub = this.recipe('hub'), axe = this.recipe('axe'), lantern = this.recipe('lantern'), gloves = this.recipe('gloves');
    if (!this.podDestroyed) return ['Destroy your crashed pod', `Grip + punch it: ${POD_HITS - this.podHits} hits left`];
    if (!this.has('hub')) {
      const need = this.describeMissing(hub.cost);
      return need ? ['Gather for the Hub', need] : ['Craft the Hub', 'Press X'];
    }
    if (!this.hubPlaced) return ['Place the Hub', 'Aim and pull the trigger'];
    if (!this.benchOpened) return ['Visit the Crafting Bench', 'Inside the Hub'];
    if (!this.has('axe')) return ['Craft a Stone Axe', this.describeMissing(axe.cost) || 'Use the bench'];
    if (!this.gamePlayed) return ['Try the Hub computer', 'Play any game'];
    if (!this.has('lantern')) return lantern.unlocked(this)
      ? ['Craft the Lantern', this.describeMissing(lantern.cost) || 'Use the bench']
      : ['Unlock the Lantern', lantern.lockedHint(this)];
    if (!this.has('gloves')) return gloves.unlocked(this)
      ? ['Craft Power Gloves', this.describeMissing(gloves.cost) || 'Use the bench']
      : ['Unlock Power Gloves', gloves.lockedHint(this)];
    const core = this.recipe('floatcore');
    if (!this.has('floatcore')) return core.unlocked(this)
      ? ['Craft the Float Core', this.describeMissing(core.cost) || 'Use the bench']
      : ['Unlock the Float Core', 'Grip + punch crystals: ' + core.lockedHint(this).replace('Collect 4 crystals ', '')];
    const fire = this.recipe('campfire');
    if (this.count('campfire') === 0) return ['Build a Campfire', this.describeMissing(fire.cost) || 'Press X'];
    return ['All objectives done', 'Explore!'];
  }
}
