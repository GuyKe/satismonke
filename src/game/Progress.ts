export type Res = 'wood' | 'stone' | 'steel';
export type Cost = Partial<Record<Res, number>>;

export interface Recipe {
  id: 'hub' | 'axe' | 'lantern' | 'gloves';
  name: string;
  desc: string;
  where: 'x' | 'bench';
  cost: Cost;
  /** Locked recipes show `lockedHint` instead of a Craft button. */
  unlocked(p: Progress): boolean;
  lockedHint(p: Progress): string;
}

export const POD_HITS = 5;
export const BOULDER_HITS = 3;
export const POD_STEEL = 8;

export const RECIPES: Recipe[] = [
  { id: 'hub', name: 'Hub', desc: 'Steel base with a bench and a computer', where: 'x',
    cost: { wood: 10, stone: 8, steel: 8 }, unlocked: () => true, lockedHint: () => '' },
  { id: 'axe', name: 'Stone Axe', desc: 'Fell trees with weaker punches, +1 wood', where: 'bench',
    cost: { wood: 3, stone: 3 }, unlocked: () => true, lockedHint: () => '' },
  { id: 'lantern', name: 'Lantern', desc: 'A light that follows your head', where: 'bench',
    cost: { wood: 4, steel: 1 }, unlocked: p => p.totalWood >= 20, lockedHint: p => `Collect 20 wood (${Math.min(p.totalWood, 20)}/20)` },
  { id: 'gloves', name: 'Power Gloves', desc: 'Launch harder and faster', where: 'bench',
    cost: { stone: 6, steel: 2 }, unlocked: p => p.bouldersBroken >= 5, lockedHint: p => `Break 5 boulders (${Math.min(p.bouldersBroken, 5)}/5)` },
];

const label: Record<Res, string> = { wood: 'wood', stone: 'stone', steel: 'steel' };

/** Inventory, unlock counters and the objective text. In-memory only (not saved yet). */
export class Progress {
  items: Record<Res, number> = { wood: 0, stone: 0, steel: 0 };
  totalWood = 0;
  bouldersBroken = 0;
  podHits = 0;
  podDestroyed = false;
  hubPlaced = false;
  benchOpened = false;
  gamePlayed = false;
  crafted = new Set<string>();

  add(r: Res, n: number): void { this.items[r] += n; if (r === 'wood') this.totalWood += n; }
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
    return ['All objectives done', 'Explore!'];
  }
}
