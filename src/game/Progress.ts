export type Ore = 'copper' | 'iron' | 'gold' | 'plasma';
export const ORES: Ore[] = ['copper', 'iron', 'gold', 'plasma'];
export type Res = 'wood' | 'stone' | 'steel' | 'crystal' | Ore | 'plate' | 'wire';
export type Cost = Partial<Record<Res, number>>;
export type RecipeId = 'hub' | 'campfire' | 'pickaxe' | 'axe' | 'lantern' | 'gloves' | 'sticky' | 'floatcore' | 'crystalgloves' | 'lamp' | 'ironpick' | 'copperlantern' | 'scanner' | 'plasmacore'
  | 'burner' | 'miner' | 'smelter' | 'constructor' | 'storage' | 'solar' | 'conveyor';

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
export const MAX_MACHINES = 60;

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
  // ---- ore gear ----
  { id: 'ironpick', name: 'Iron Pickaxe', desc: 'Every ore breaks in 1 hit, +2 stone', where: 'bench',
    cost: { iron: 6, wood: 3 }, unlocked: p => p.mined.iron >= 4, lockedHint: p => `Mine 4 iron (${Math.min(p.mined.iron, 4)}/4)` },
  { id: 'copperlantern', name: 'Copper Lantern', desc: 'A brighter, longer-reaching lantern', where: 'bench',
    cost: { copper: 4, crystal: 1 }, unlocked: p => p.has('lantern') && p.mined.copper >= 4,
    lockedHint: p => p.has('lantern') ? `Mine 4 copper (${Math.min(p.mined.copper, 4)}/4)` : 'Craft the Lantern first' },
  { id: 'scanner', name: 'Ore Scanner', desc: 'Shows ore deposits on your map', where: 'bench',
    cost: { copper: 4, iron: 4, gold: 2 }, unlocked: p => p.mined.gold >= 2, lockedHint: p => `Mine 2 gold (${Math.min(p.mined.gold, 2)}/2)` },
  { id: 'plasmacore', name: 'Plasma Core', desc: 'Gravity drops to 0.2g', where: 'bench',
    cost: { plasma: 3, gold: 2 }, unlocked: p => p.has('floatcore') && p.mined.plasma >= 3,
    lockedHint: p => p.has('floatcore') ? `Mine 3 plasma (${Math.min(p.mined.plasma, 3)}/3)` : 'Craft the Float Core first' },
  // ---- factory machines (all placeable and repeatable) ----
  { id: 'burner', name: 'Biomass Burner', desc: 'Burns wood into 1 MW of power', where: 'bench', repeatable: true,
    cost: { wood: 8, iron: 4 }, unlocked: always, lockedHint: noHint },
  { id: 'miner', name: 'Miner', desc: 'Sits on iron or copper ore: 30 ore/min', where: 'bench', repeatable: true,
    cost: { iron: 10, stone: 8, copper: 3 }, unlocked: p => p.made.burner! > 0, lockedHint: () => 'Build a Biomass Burner first' },
  { id: 'smelter', name: 'Smelter', desc: 'Ore into ingots: 30/min', where: 'bench', repeatable: true,
    cost: { iron: 8, stone: 12, copper: 4 }, unlocked: p => p.made.miner! > 0, lockedHint: () => 'Build a Miner first' },
  { id: 'constructor', name: 'Constructor', desc: 'Ingots into plates and wire', where: 'bench', repeatable: true,
    cost: { iron: 12, copper: 10, steel: 2 }, unlocked: p => p.made.smelter! > 0, lockedHint: () => 'Build a Smelter first' },
  { id: 'storage', name: 'Storage Box', desc: 'Collects what your belts deliver', where: 'bench', repeatable: true,
    cost: { iron: 6, wood: 6 }, unlocked: p => p.made.miner! > 0, lockedHint: () => 'Build a Miner first' },
  { id: 'conveyor', name: 'Conveyor Link', desc: 'Joins two machines (1 iron per 5 m). B to stop', where: 'bench', repeatable: true,
    cost: {}, unlocked: p => p.made.miner! > 0, lockedHint: () => 'Build a Miner first' },
  { id: 'solar', name: 'Solar Panel', desc: 'Free power, but only in daylight', where: 'bench', repeatable: true,
    cost: { plate: 6, wire: 6, crystal: 2 }, unlocked: p => p.platesCollected >= 6, lockedHint: p => `Collect 6 plates (${Math.min(p.platesCollected, 6)}/6)` },
];

const label: Record<Res, string> = { wood: 'wood', stone: 'stone', steel: 'steel', crystal: 'crystal', copper: 'copper', iron: 'iron', gold: 'gold', plasma: 'plasma', plate: 'plate', wire: 'wire' };

export interface ProgressData {
  items: Record<Res, number>; mined: Record<Ore, number>; totalWood: number; totalCrystal: number; treesFelled: number; bouldersBroken: number;
  made: Partial<Record<RecipeId, number>>; links?: number; fueled?: boolean; platesCollected?: number; podHits: number; podDestroyed: boolean; hubPlaced: boolean; benchOpened: boolean; gamePlayed: boolean; crafted: string[];
}

/** Inventory, unlock counters and the objective text. In-memory only (not saved yet). */
export class Progress {
  items: Record<Res, number> = { wood: 0, stone: 0, steel: 0, crystal: 0, copper: 0, iron: 0, gold: 0, plasma: 0, plate: 0, wire: 0 };
  /** Factory progress */
  links = 0;
  fueled = false;
  platesCollected = 0;
  mined: Record<Ore, number> = { copper: 0, iron: 0, gold: 0, plasma: 0 };
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

  get oresMined(): number { return ORES.reduce((n, o) => n + this.mined[o], 0); }

  /** Back to a fresh game (keeps the same object so panels holding it stay valid). */
  reset(): void {
    const f = new Progress();
    Object.assign(this, { items: f.items, mined: f.mined, links: 0, fueled: false, platesCollected: 0, totalWood: 0, totalCrystal: 0, treesFelled: 0, bouldersBroken: 0, made: {}, podHits: 0, podDestroyed: false, hubPlaced: false, benchOpened: false, gamePlayed: false, crafted: new Set<string>() });
  }

  toJSON(): ProgressData {
    return { items: { ...this.items }, mined: { ...this.mined }, totalWood: this.totalWood, totalCrystal: this.totalCrystal, treesFelled: this.treesFelled,
      bouldersBroken: this.bouldersBroken, made: { ...this.made }, podHits: this.podHits, podDestroyed: this.podDestroyed, hubPlaced: this.hubPlaced,
      benchOpened: this.benchOpened, gamePlayed: this.gamePlayed, crafted: [...this.crafted], links: this.links, fueled: this.fueled, platesCollected: this.platesCollected };
  }

  load(d: ProgressData): void {
    this.reset();
    Object.assign(this.items, d.items); Object.assign(this.mined, d.mined); Object.assign(this.made, d.made);
    this.totalWood = d.totalWood; this.totalCrystal = d.totalCrystal; this.treesFelled = d.treesFelled; this.bouldersBroken = d.bouldersBroken;
    this.podHits = d.podHits; this.podDestroyed = d.podDestroyed; this.hubPlaced = d.hubPlaced; this.benchOpened = d.benchOpened; this.gamePlayed = d.gamePlayed;
    this.crafted = new Set(d.crafted);
    this.links = d.links ?? 0; this.fueled = d.fueled ?? false; this.platesCollected = d.platesCollected ?? 0;
  }

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
    // ---- factory chain ----
    const burner = this.recipe('burner'), miner = this.recipe('miner'), smelter = this.recipe('smelter'), cons = this.recipe('constructor');
    if (this.count('burner') === 0) return ['Build a Biomass Burner', this.describeMissing(burner.cost) || 'At the bench'];
    if (!this.fueled) return ['Fuel the Burner', 'Aim at it, press trigger: +5 wood'];
    if (this.count('miner') === 0) return ['Build a Miner on ore', this.describeMissing(miner.cost) || 'Place it on iron or copper'];
    if (this.count('smelter') === 0) return ['Build a Smelter', this.describeMissing(smelter.cost) || 'At the bench'];
    if (this.links < 1) return ['Join them with a Conveyor', 'Link: aim at one, trigger, aim at the other'];
    if (this.count('constructor') === 0) return ['Build a Constructor', this.describeMissing(cons.cost) || 'At the bench'];
    if (this.links < 2) return ['Link Smelter to Constructor', 'Conveyor Link, then aim and trigger'];
    if (this.count('storage') === 0) return ['Build a Storage Box', 'Link the Constructor to it'];
    if (this.platesCollected < 6) return ['Collect 6 plates', 'Aim at the Storage Box: TAKE ALL'];
    if (this.oresMined === 0) return ['Find some ore', 'Grip + punch an ore rock'];
    const iron = this.recipe('ironpick');
    if (!this.has('ironpick')) return iron.unlocked(this) ? ['Craft the Iron Pickaxe', this.describeMissing(iron.cost) || 'Use the bench'] : ['Unlock the Iron Pickaxe', iron.lockedHint(this)];
    const scan = this.recipe('scanner');
    if (!this.has('scanner')) return scan.unlocked(this) ? ['Craft the Ore Scanner', this.describeMissing(scan.cost) || 'Use the bench'] : ['Unlock the Ore Scanner', scan.lockedHint(this)];
    const plasma = this.recipe('plasmacore');
    if (!this.has('plasmacore')) return plasma.unlocked(this) ? ['Craft the Plasma Core', this.describeMissing(plasma.cost) || 'Use the bench'] : ['Find plasma ore', plasma.lockedHint(this) + ' on the lake mesas'];
    return ['All objectives done', 'Explore!'];
  }
}
