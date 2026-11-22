/**
 * Factory simulation: machines, conveyor links and a power grid. Pure logic (no rendering) so it can be tested in node.
 *
 * Machines pass items along links. A link carries at most 60 items/min. Every machine works at a fixed rate, and
 * all of them slow down together when the grid cannot supply enough power. A machine with several outgoing links
 * alternates between them (a splitter); one with several incoming links is a merger.
 */
export type ItemType = 'ironOre' | 'copperOre' | 'ironIngot' | 'copperIngot' | 'plate' | 'wire';
export type MachineKind = 'miner' | 'smelter' | 'constructor' | 'storage' | 'burner' | 'solar';

export const ITEM_COLOR: Record<ItemType, number> = { ironOre: 0x8fa6c8, copperOre: 0xe08a3c, ironIngot: 0xc8d4e8, copperIngot: 0xffb070, plate: 0xe0e6f0, wire: 0xff9040 };
export const ITEM_NAME: Record<ItemType, string> = { ironOre: 'iron ore', copperOre: 'copper ore', ironIngot: 'iron ingot', copperIngot: 'copper ingot', plate: 'plate', wire: 'wire' };

/** MW consumed (positive) or produced (negative). */
export const MACHINE_POWER: Record<MachineKind, number> = { miner: 0.3, smelter: 0.3, constructor: 0.4, storage: 0, burner: -1, solar: -0.6 };
export const MACHINE_NAME: Record<MachineKind, string> = { miner: 'Miner', smelter: 'Smelter', constructor: 'Constructor', storage: 'Storage Box', burner: 'Biomass Burner', solar: 'Solar Panel' };

export const CYCLE = 2;            // seconds per item at full power = 30 per minute
export const BUFFER = 10;          // input / output buffer size
export const STORAGE_CAP = 400;
export const BELT_SPEED = 1.5;     // m/s
export const BELT_GAP = 1.5;       // m between items => 60 items per minute
export const WOOD_SECONDS = 20;    // one wood keeps a burner going this long

type Buf = Partial<Record<ItemType, number>>;
const total = (b: Buf) => Object.values(b).reduce((a, n) => a + (n ?? 0), 0);

export interface Machine {
  id: number; kind: MachineKind; x: number; y: number; z: number; yaw: number;
  /** Miners sit on an ore deposit (index into the planet's ore list). */
  ore: { index: number; type: 'copper' | 'iron' } | null;
  input: Buf; output: Buf; stored: Buf;
  fuel: number;                    // wood in a burner
  job: { from: ItemType; to: ItemType; n: number } | null;
  prog: number;
  status: string;
  rr: number;                      // round-robin pointer over outgoing links
  made: number[];                  // timestamps of recent products (for items/min)
  active: boolean;
}

export interface Link { id: number; from: number; to: number; length: number; items: { t: number; type: ItemType }[] }

export interface FactoryState {
  nextId: number;
  machines: { id: number; kind: MachineKind; x: number; y: number; z: number; yaw: number; ore: Machine['ore']; input: Buf; output: Buf; stored: Buf; fuel: number }[];
  links: { id: number; from: number; to: number; length: number }[];
}

export class Factory {
  machines: Machine[] = [];
  links: Link[] = [];
  clock = 0;
  /** Miner speed multiplier (for upgrades). */
  minerMult = 1;
  power = { supply: 0, demand: 0, ratio: 1 };
  private nextId = 1;

  reset(): void { this.machines = []; this.links = []; this.nextId = 1; this.clock = 0; this.minerMult = 1; this.power = { supply: 0, demand: 0, ratio: 1 }; }

  get(id: number): Machine | undefined { return this.machines.find(m => m.id === id); }

  addMachine(kind: MachineKind, x: number, y: number, z: number, yaw = 0, ore: Machine['ore'] = null): Machine {
    const m: Machine = { id: this.nextId++, kind, x, y, z, yaw, ore, input: {}, output: {}, stored: {}, fuel: 0, job: null, prog: 0, status: 'Idle', rr: 0, made: [], active: false };
    this.machines.push(m);
    return m;
  }

  /** Remove a machine and every link attached to it. Returns the removed link ids. */
  removeMachine(id: number): number[] {
    const gone = this.links.filter(l => l.from === id || l.to === id).map(l => l.id);
    this.links = this.links.filter(l => !gone.includes(l.id));
    this.machines = this.machines.filter(m => m.id !== id);
    return gone;
  }

  static canSend(k: MachineKind): boolean { return k === 'miner' || k === 'smelter' || k === 'constructor'; }
  static canReceive(k: MachineKind): boolean { return k === 'smelter' || k === 'constructor' || k === 'storage'; }

  /** Join two machines. Returns the link, or a reason it was refused. */
  link(from: number, to: number, length: number): Link | string {
    const a = this.get(from), b = this.get(to);
    if (!a || !b || from === to) return 'Pick two different machines';
    if (!Factory.canSend(a.kind)) return `${MACHINE_NAME[a.kind]} has no output`;
    if (!Factory.canReceive(b.kind)) return `${MACHINE_NAME[b.kind]} has no input`;
    if (this.links.some(l => l.from === from && l.to === to)) return 'Already linked';
    const l: Link = { id: this.nextId++, from, to, length: Math.max(2, length), items: [] };
    this.links.push(l);
    return l;
  }

  private accepts(m: Machine, type: ItemType): boolean {
    switch (m.kind) {
      case 'smelter': return (type === 'ironOre' || type === 'copperOre') && total(m.input) < BUFFER;
      case 'constructor': return (type === 'ironIngot' || type === 'copperIngot') && total(m.input) < BUFFER;
      case 'storage': return total(m.stored) < STORAGE_CAP;
      default: return false;
    }
  }

  private produce(m: Machine, type: ItemType, n = 1): void {
    m.output[type] = (m.output[type] ?? 0) + n;
    m.made.push(this.clock);
    if (m.made.length > 40) m.made.shift();
  }

  /** Items per minute this machine has actually produced over the last minute. */
  perMin(m: Machine): number { return m.made.filter(t => this.clock - t <= 60).length * (this.clock < 60 ? 60 / Math.max(this.clock, 5) : 1); }

  /** Advance the simulation. `daylight` is 0..1 (solar panels). */
  update(dt: number, daylight = 1): void {
    this.clock += dt;

    // ---- power ----
    let supply = 0, demand = 0;
    for (const m of this.machines) {
      if (m.kind === 'burner') { if (m.fuel > 0) supply += -MACHINE_POWER.burner; }
      else if (m.kind === 'solar') supply += -MACHINE_POWER.solar * daylight;
      else if (m.active) demand += MACHINE_POWER[m.kind];
    }
    const ratio = demand > 0 ? Math.min(1, supply / demand) : 1;
    this.power = { supply, demand, ratio };
    if (demand > 0) for (const m of this.machines) if (m.kind === 'burner' && m.fuel > 0) m.fuel = Math.max(0, m.fuel - dt / WOOD_SECONDS);
    const speed = ratio;

    // ---- machines ----
    for (const m of this.machines) {
      m.active = false;
      switch (m.kind) {
        case 'miner': {
          if (!m.ore) { m.status = 'Not on ore'; break; }
          if (total(m.output) >= BUFFER) { m.status = 'Output blocked'; break; }
          m.active = true;
          if (speed <= 0) { m.status = 'No power'; break; }
          m.status = speed < 1 ? 'Low power' : 'Running';
          m.prog += dt * speed * this.minerMult;
          if (m.prog >= CYCLE) { m.prog -= CYCLE; this.produce(m, m.ore.type === 'iron' ? 'ironOre' : 'copperOre'); }
          break;
        }
        case 'smelter': case 'constructor': {
          const recipes: [ItemType, ItemType, number][] = m.kind === 'smelter'
            ? [['ironOre', 'ironIngot', 1], ['copperOre', 'copperIngot', 1]]
            : [['ironIngot', 'plate', 1], ['copperIngot', 'wire', 2]];
          if (!m.job) {
            const r = recipes.find(([from]) => (m.input[from] ?? 0) > 0);
            if (!r) { m.status = 'Waiting for input'; break; }
            m.input[r[0]]! -= 1; m.job = { from: r[0], to: r[1], n: r[2] }; m.prog = 0;
          }
          if (total(m.output) >= BUFFER) { m.status = 'Output blocked'; break; }
          m.active = true;
          if (speed <= 0) { m.status = 'No power'; break; }
          m.status = speed < 1 ? 'Low power' : 'Running';
          m.prog += dt * speed;
          if (m.prog >= CYCLE) { m.prog -= CYCLE; this.produce(m, m.job.to, m.job.n); m.job = null; }
          break;
        }
        case 'burner': m.status = m.fuel > 0 ? (demand > 0 ? 'Burning' : 'Standby') : 'Out of fuel'; break;
        case 'solar': m.status = daylight > 0.05 ? `Generating ${Math.round(daylight * 100)}%` : 'Night'; break;
        case 'storage': m.status = `${total(m.stored)}/${STORAGE_CAP} items`; break;
      }
    }

    // ---- machines put finished items on their outgoing links ----
    const gapT = (l: Link) => BELT_GAP / l.length;
    for (const m of this.machines) {
      if (total(m.output) === 0) continue;
      const out = this.links.filter(l => l.from === m.id);
      if (!out.length) continue;
      for (let k = 0; k < out.length; k++) {
        const l = out[(m.rr + k) % out.length];
        const last = l.items[l.items.length - 1];
        if (last && last.t < gapT(l)) continue; // no room at the start of this belt
        const type = (Object.keys(m.output) as ItemType[]).find(t => (m.output[t] ?? 0) > 0)!;
        m.output[type]! -= 1;
        l.items.push({ t: 0, type });
        m.rr = (m.rr + k + 1) % out.length;      // next time start with the following belt (splitter)
        break;
      }
    }

    // ---- items travel along the links and are handed to the machine at the end ----
    for (const l of this.links) {
      const to = this.get(l.to);
      for (let i = 0; i < l.items.length; i++) {
        const it = l.items[i];
        const limit = i === 0 ? 1 : l.items[i - 1].t - gapT(l);
        it.t = Math.min(limit, it.t + (BELT_SPEED / l.length) * dt);
      }
      const head = l.items[0];
      if (head && head.t >= 1 && to && this.accepts(to, head.type)) {
        if (to.kind === 'storage') to.stored[head.type] = (to.stored[head.type] ?? 0) + 1;
        else to.input[head.type] = (to.input[head.type] ?? 0) + 1;
        l.items.shift();
      }
    }
  }

  addFuel(id: number, wood: number): boolean { const m = this.get(id); if (!m || m.kind !== 'burner') return false; m.fuel += wood; return true; }

  /** Empty a storage box. */
  takeAll(id: number): Buf {
    const m = this.get(id);
    if (!m || m.kind !== 'storage') return {};
    const out = { ...m.stored }; m.stored = {};
    return out;
  }

  toJSON(): FactoryState {
    return {
      nextId: this.nextId,
      machines: this.machines.map(m => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, z: m.z, yaw: m.yaw, ore: m.ore, input: { ...m.input }, output: { ...m.output }, stored: { ...m.stored }, fuel: m.fuel })),
      links: this.links.map(l => ({ id: l.id, from: l.from, to: l.to, length: l.length })),
    };
  }

  load(s: FactoryState): void {
    this.machines = []; this.links = []; this.nextId = s.nextId; this.clock = 0;
    for (const d of s.machines) {
      const m = this.addMachine(d.kind, d.x, d.y, d.z, d.yaw, d.ore);
      m.id = d.id; m.input = { ...d.input }; m.output = { ...d.output }; m.stored = { ...d.stored }; m.fuel = d.fuel;
    }
    this.nextId = s.nextId;
    for (const l of s.links) this.links.push({ id: l.id, from: l.from, to: l.to, length: l.length, items: [] });
  }
}
