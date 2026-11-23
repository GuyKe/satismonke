import * as THREE from 'three';
import { Screen } from './Screen';
import { Factory, Machine, MACHINE_NAME, ITEM_NAME, ItemType, STORAGE_CAP, SLOT_NAMES, MAX_CLOCK, ITEM_VALUE, POLE_PORTS } from '../game/Factory';

const W = 640, H = 470;
export type MachineAction = 'fuel' | 'take' | 'remove' | 'overclock' | 'reset' | 'tokens' | 'filter' | 'unwire' | 'fuelbio';

interface Btn { label: string; action: MachineAction; x: number; y: number; w: number; h: number; arg?: number; danger?: boolean }

/** Status card for the machine you are aiming at, with its buttons. */
export class MachinePanel extends Screen {
  private id: number | null = null;
  private hovered = new Map<number, number>();
  private btns: Btn[] = [];
  private acc = 0;

  constructor(
    private factory: Factory,
    private onAction: (a: MachineAction, id: number, arg?: number) => void,
    /** Is the Overclock Station built and a core in the bag? */
    private canOverclock: () => boolean = () => false,
  ) {
    super(1.25, 1.25 * H / W, W, H);
    (this.mesh.material as THREE.MeshBasicMaterial).transparent = true;
  }

  show(id: number | null): void {
    if (id !== this.id) { this.id = id; this.hovered.clear(); this.acc = 1; }
    this.mesh.visible = id !== null;
  }
  get shown(): number | null { return this.id; }

  private hit(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.hit(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.acc = 1; }
    return i >= 0;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0 || this.id === null || !this.btns[i]) return false;
    const b = this.btns[i];
    this.onAction(b.action, this.id, b.arg);
    this.acc = 1;
    return true;
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.id === null || this.acc < 0.2) return;
    this.acc = 0;
    const m = this.factory.get(this.id);
    if (!m) { this.show(null); return; }
    this.draw(m);
  }

  private draw(m: Machine): void {
    const f = this.factory, { ctx } = this, net = f.netFor(m.id), lines0 = f.wireCount(m.id);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = net.tripped ? '#ff4040' : '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 38px monospace'; ctx.fillText(MACHINE_NAME[m.kind], 24, 52);
    if (m.ore) { ctx.textAlign = 'right'; ctx.fillStyle = m.ore.purity >= 2 ? '#6fe39a' : m.ore.purity < 1 ? '#ff9a6a' : '#cfd8e8'; ctx.font = 'bold 22px monospace'; ctx.fillText(`${m.ore.purity >= 2 ? 'PURE' : m.ore.purity < 1 ? 'IMPURE' : 'NORMAL'} ${m.ore.type} node x${m.ore.purity}`, W - 24, 48); ctx.textAlign = 'left'; }
    const bad = /power|fuel|not on|tripped/i.test(m.status) && !/Low/.test(m.status), warn = /blocked|Waiting|Low|Night|Standby/.test(m.status);
    ctx.fillStyle = bad ? '#ff6a6a' : warn ? '#ffc050' : '#6fe39a'; ctx.font = 'bold 30px monospace'; ctx.fillText(m.status, 24, 92);
    ctx.fillStyle = '#d8e8f0'; ctx.font = '22px monospace';
    const lines: string[] = [];
    const list = (b: Partial<Record<ItemType, number>>) => (Object.keys(b) as ItemType[]).filter(k => (b[k] ?? 0) > 0).map(k => `${b[k]} ${ITEM_NAME[k]}`).join(', ') || '-';
    this.btns = [];
    const row2 = 396;
    if (m.kind === 'burner') lines.push(`Fuel: ${m.fuel.toFixed(1)} wood  (1 wood = 20 s, 10 biomass = 80 s)`, `Makes 1.0 MW`);
    else if (m.kind === 'solar') lines.push(`Makes up to 0.6 MW, by day`);
    else if (m.kind === 'pole') lines.push(`Power lines: ${lines0} / ${POLE_PORTS}`, `Wire it to a burner and to machines`);
    else if (m.kind === 'storage') lines.push(`Holds: ${list(m.stored)}`, `Capacity ${STORAGE_CAP}`);
    else if (m.kind === 'sink') lines.push(`Shredding: ${list(m.input)}`, `Tokens ready: ${f.tokens}  (plate ${ITEM_VALUE.plate}, wire ${ITEM_VALUE.wire}, ingot ${ITEM_VALUE.ironIngot}, ore ${ITEM_VALUE.ironOre})`);
    else if (m.kind === 'splitter') {
      lines.push(`Holding: ${list(m.input)}`);
      m.slots.forEach((s, i) => {
        const to = s.link === null ? 'not linked' : this.factory.get(this.factory.links.find(l => l.id === s.link)?.to ?? -1)?.kind ?? '?';
        this.btns.push({ label: s.filter === 'overflow' ? 'OVERFLOW' : s.filter === 'any' ? 'ANY' : ITEM_NAME[s.filter as ItemType].toUpperCase(), action: 'filter', arg: i, x: 150, y: 150 + i * 62, w: 250, h: 52 });
        ctx.fillStyle = '#9ab'; ctx.font = 'bold 22px monospace'; ctx.fillText(SLOT_NAMES[i], 24, 184 + i * 62);
        ctx.fillStyle = '#7a8aa0'; ctx.font = '18px monospace'; ctx.fillText(`-> ${to}`, 416, 184 + i * 62);
      });
    } else lines.push(`Rate: ${f.perMin(m).toFixed(0)} per minute`, `In: ${list(m.input)}`, `Out: ${list(m.output)}`);
    if (['miner', 'smelter', 'constructor', 'sink'].includes(m.kind)) lines.push(`Clock: ${Math.round(m.clock * 100)}%  (max ${MAX_CLOCK * 100}%)`);
    lines.push(f.legacyGrid || lines0 > 0 || m.kind === 'burner' || m.kind === 'solar' ? `Grid: ${net.supply.toFixed(1)} / ${net.demand.toFixed(1)} MW  (${Math.round(net.ratio * 100)}%)` : 'Not on a power line yet');
    const y0 = m.kind === 'splitter' ? 150 + 3 * 62 : 134;
    ctx.fillStyle = '#d8e8f0'; ctx.font = '22px monospace';
    if (m.kind !== 'splitter') lines.forEach((l, i) => ctx.fillText(l, 24, y0 + i * 32));
    else { ctx.fillText(lines[0], 24, 126); ctx.fillText(lines[lines.length - 1], 24, y0 + 22); }

    // buttons: laid out in one row, shrinking (and shortening the labels) when there are too many to fit
    const specs: { label: string; short: string; action: MachineAction; w: number; danger: boolean }[] = [];
    const add = (label: string, action: MachineAction, w = 180, danger = false, short = label) => { specs.push({ label, short, action, w, danger }); };
    if (net.tripped) add('RESET BREAKER', 'reset', 250, false, 'RESET');
    if (lines0 > 0 && !f.legacyGrid) add('CUT LINES', 'unwire', 170, false, 'CUT');
    if (m.kind === 'burner') { add('+5 WOOD', 'fuel', 180, false, '+WOOD'); add('+10 BIOMASS', 'fuelbio', 200, false, '+BIO'); }
    if (m.kind === 'storage') add('TAKE ALL', 'take');
    if (m.kind === 'sink') add(`TOKENS ${f.tokens}`, 'tokens');
    if (['miner', 'smelter', 'constructor', 'sink'].includes(m.kind) && this.canOverclock() && m.clock < MAX_CLOCK) add('+CORE', 'overclock', 130);
    add('REMOVE', 'remove', 150, true);
    const avail = W - 48, gap = 14;
    let total = specs.reduce((n, sp) => n + sp.w, 0) + gap * (specs.length - 1);
    if (total > avail) { specs.forEach(sp => { sp.label = sp.short; sp.w = Math.max(100, Math.round(sp.w * 0.62)); }); total = specs.reduce((n, sp) => n + sp.w, 0) + gap * (specs.length - 1); }
    if (total > avail) { const k = (avail - gap * (specs.length - 1)) / (total - gap * (specs.length - 1)); specs.forEach(sp => { sp.w = Math.floor(sp.w * k); }); }
    let x = 24;
    for (const sp of specs) { this.btns.push({ label: sp.label, action: sp.action, x, y: row2, w: sp.w, h: 58, danger: sp.danger }); x += sp.w + gap; }

    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      ctx.fillStyle = hov.has(i) ? '#ffb347' : b.danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; ctx.font = `bold ${b.w < 160 ? 24 : 26}px monospace`; ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 9); ctx.textAlign = 'left';
    });
    this.refresh();
  }
}
