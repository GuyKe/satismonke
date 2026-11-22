import * as THREE from 'three';
import { Screen } from './Screen';
import { Progress, Recipe, Res } from '../game/Progress';

const W = 640;
const ROW_H = 118, TOP = 70;

/** A list of recipes with Craft buttons. Used for the X menu and the Hub's crafting bench. */
export class RecipePanel extends Screen {
  private hovered = new Map<number, number>();
  private key = '';

  constructor(
    private title: string, private recipes: Recipe[], private progress: Progress,
    private onCraft: (id: Recipe['id']) => void, private footer = '',
    width = 0.9,
  ) {
    super(width, width * (TOP + recipes.length * ROW_H + 54) / W, W, TOP + recipes.length * ROW_H + 54);
  }

  private rowAt(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * this.canvas.height;
    if (px < 440 || px > 620) return -1; // only the button column counts
    const i = Math.floor((py - TOP) / ROW_H);
    return i >= 0 && i < this.recipes.length ? i : -1;
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.rowAt(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.key = ''; }
    return i >= 0;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0) return false;
    this.onCraft(this.recipes[i].id);
    this.key = '';
    return true;
  }

  /** Redraw when something it shows changes. */
  update(): void {
    const p = this.progress;
    const key = [p.items.wood, p.items.stone, p.items.steel, p.totalWood, p.bouldersBroken, [...p.crafted].join(','), [...this.hovered.values()].join(',')].join('|');
    if (key === this.key) return;
    this.key = key;
    const { ctx } = this, H = this.canvas.height;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 38px monospace'; ctx.fillText(this.title, 24, 52);
    const hov = new Set(this.hovered.values());
    this.recipes.forEach((r, i) => {
      const y = TOP + i * ROW_H;
      const done = p.has(r.id), open = r.unlocked(p), can = open && !done && p.canAfford(r.cost);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(14, y + 4, W - 28, ROW_H - 8);
      ctx.fillStyle = open ? '#fff' : '#778'; ctx.font = 'bold 32px monospace'; ctx.fillText(r.name, 26, y + 40);
      ctx.font = '20px monospace'; ctx.fillStyle = '#9ab'; ctx.fillText(open ? r.desc : r.lockedHint(p), 26, y + 68);
      // cost, each resource green when you have enough
      let x = 26;
      for (const res of Object.keys(r.cost) as Res[]) {
        const need = r.cost[res] ?? 0, ok = p.items[res] >= need;
        const t = `${res} ${p.items[res]}/${need}`;
        ctx.font = '20px monospace'; ctx.fillStyle = done || ok ? '#6fe39a' : '#ff7a7a'; ctx.fillText(t, x, y + 98);
        x += ctx.measureText(t).width + 18;
      }
      const label = done ? 'BUILT' : !open ? 'LOCKED' : 'CRAFT';
      ctx.fillStyle = done ? '#1f3a2a' : !open ? '#2a2a36' : can ? (hov.has(i) ? '#ffb347' : '#2f7a4a') : '#4a2a2a';
      ctx.fillRect(450, y + 24, 160, 66);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(450, y + 24, 160, 66);
      ctx.fillStyle = hov.has(i) && can ? '#10131f' : '#fff'; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, 530, y + 66); ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#7fe3c1'; ctx.font = '20px monospace'; ctx.fillText(this.footer, 24, H - 20);
    this.refresh();
  }
}
