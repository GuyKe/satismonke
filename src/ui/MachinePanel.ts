import * as THREE from 'three';
import { Screen } from './Screen';
import { Factory, Machine, MACHINE_NAME, ITEM_NAME, ItemType, STORAGE_CAP } from '../game/Factory';

const W = 640, H = 400;
export type MachineAction = 'fuel' | 'take' | 'remove';

/** Status card for the machine you are aiming at, with its buttons. */
export class MachinePanel extends Screen {
  private id: number | null = null;
  private hovered = new Map<number, number>();
  private btns: { label: string; action: MachineAction; x: number; w: number }[] = [];
  private acc = 0;

  constructor(private factory: Factory, private onAction: (a: MachineAction, id: number) => void) {
    super(1.2, 1.2 * H / W, W, H);
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
    if (py < 318 || py > 384) return -1;
    return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w);
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.hit(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.acc = 1; }
    return i >= 0;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0 || this.id === null) return false;
    this.onAction(this.btns[i].action, this.id);
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
    const f = this.factory, { ctx } = this;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 40px monospace'; ctx.fillText(MACHINE_NAME[m.kind], 24, 54);
    const bad = /power|fuel|ore/i.test(m.status) && !/Low/.test(m.status), warn = /blocked|Waiting|Low|Night|Standby/.test(m.status);
    ctx.fillStyle = bad ? '#ff6a6a' : warn ? '#ffc050' : '#6fe39a'; ctx.font = 'bold 30px monospace'; ctx.fillText(m.status, 24, 98);
    ctx.fillStyle = '#d8e8f0'; ctx.font = '24px monospace';
    const lines: string[] = [];
    const list = (b: Partial<Record<ItemType, number>>) => (Object.keys(b) as ItemType[]).filter(k => (b[k] ?? 0) > 0).map(k => `${b[k]} ${ITEM_NAME[k]}`).join(', ') || '-';
    if (m.kind === 'burner') lines.push(`Fuel: ${m.fuel.toFixed(1)} wood  (1 wood = 20 s)`, `Makes 1.0 MW`);
    else if (m.kind === 'solar') lines.push(`Makes up to 0.6 MW, by day`);
    else if (m.kind === 'storage') lines.push(`Holds: ${list(m.stored)}`, `Capacity ${STORAGE_CAP}`);
    else {
      lines.push(`Rate: ${f.perMin(m).toFixed(0)} per minute`, `In: ${list(m.input)}`, `Out: ${list(m.output)}`);
    }
    lines.push(`Grid: ${f.power.supply.toFixed(1)} / ${f.power.demand.toFixed(1)} MW  (${Math.round(f.power.ratio * 100)}%)`);
    lines.forEach((l, i) => ctx.fillText(l, 24, 142 + i * 34));
    this.btns = [];
    if (m.kind === 'burner') this.btns.push({ label: '+5 WOOD', action: 'fuel', x: 24, w: 200 });
    if (m.kind === 'storage') this.btns.push({ label: 'TAKE ALL', action: 'take', x: 24, w: 200 });
    this.btns.push({ label: 'REMOVE', action: 'remove', x: m.kind === 'burner' || m.kind === 'storage' ? 244 : 24, w: 200 });
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      const danger = b.action === 'remove';
      ctx.fillStyle = hov.has(i) ? '#ffb347' : danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, 322, b.w, 58);
      ctx.strokeStyle = danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, 322, b.w, 58);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, 362); ctx.textAlign = 'left';
    });
    this.refresh();
  }
}
