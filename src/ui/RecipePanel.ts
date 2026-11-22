import * as THREE from 'three';
import { Screen } from './Screen';
import { Progress, Recipe, Res } from '../game/Progress';

const W = 640;
const ROW_H = 98, TOP = 64, NAV_H = 56;
const PREV = -2, NEXT = -3;

/**
 * A list of recipes with Craft buttons. Used for the X menu and the Hub's crafting bench.
 * Long lists are split into pages of `perPage` recipes with Prev/Next buttons.
 */
export class RecipePanel extends Screen {
  private hovered = new Map<number, number>();
  private key = '';
  private page = 0;
  private pages: number;

  constructor(
    private title: string, private recipes: Recipe[], private progress: Progress,
    private onCraft: (id: Recipe['id']) => void, private footer = '',
    width = 0.9, private perPage = 6,
  ) {
    super(width, width * (TOP + Math.min(perPage, recipes.length) * ROW_H + (recipes.length > perPage ? NAV_H : 0) + 48) / W, W,
      TOP + Math.min(perPage, recipes.length) * ROW_H + (recipes.length > perPage ? NAV_H : 0) + 48);
    this.pages = Math.ceil(recipes.length / perPage);
  }

  private get visibleRows(): number { return Math.min(this.perPage, this.recipes.length - this.page * this.perPage); }
  private get rowsAreaH(): number { return Math.min(this.perPage, this.recipes.length) * ROW_H; }

  /** Row index on this page, PREV, NEXT, or -1. */
  private hit(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * this.canvas.height;
    const navY = TOP + this.rowsAreaH;
    if (this.pages > 1 && py >= navY && py <= navY + NAV_H) return px < W / 2 ? PREV : NEXT;
    if (px < 440 || px > 620) return -1; // only the button column counts
    const i = Math.floor((py - TOP) / ROW_H);
    return i >= 0 && i < this.visibleRows ? i : -1;
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.hit(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.key = ''; }
    return i !== -1;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i === -1) return false;
    if (i === PREV) this.page = (this.page + this.pages - 1) % this.pages;
    else if (i === NEXT) this.page = (this.page + 1) % this.pages;
    else this.onCraft(this.recipes[this.page * this.perPage + i].id);
    this.key = '';
    return true;
  }

  /** Redraw when something it shows changes. */
  update(): void {
    const p = this.progress, it = p.items;
    const key = [Object.values(it).join(','), p.totalWood, p.totalCrystal, p.treesFelled, p.bouldersBroken, JSON.stringify(p.mined), JSON.stringify(p.made), [...p.crafted].join(','), [...this.hovered.values()].join(','), this.page].join('|');
    if (key === this.key) return;
    this.key = key;
    const { ctx } = this, H = this.canvas.height;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 38px monospace'; ctx.fillText(this.title, 24, 52);
    if (this.pages > 1) { ctx.textAlign = 'right'; ctx.font = '22px monospace'; ctx.fillStyle = '#9ab'; ctx.fillText(`page ${this.page + 1}/${this.pages}`, W - 24, 50); ctx.textAlign = 'left'; }
    const hov = new Set(this.hovered.values());
    for (let i = 0; i < this.visibleRows; i++) {
      const r = this.recipes[this.page * this.perPage + i];
      const y = TOP + i * ROW_H;
      const done = !r.repeatable && p.has(r.id), open = r.unlocked(p), can = open && !done && p.canAfford(r.cost);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(14, y + 4, W - 28, ROW_H - 8);
      ctx.fillStyle = open ? '#fff' : '#778'; ctx.font = 'bold 28px monospace';
      ctx.fillText(r.name + (r.repeatable && p.count(r.id) ? ` x${p.count(r.id)}` : ''), 26, y + 34);
      ctx.font = '17px monospace'; ctx.fillStyle = '#9ab'; ctx.fillText(open ? r.desc : r.lockedHint(p), 26, y + 58);
      // cost, each resource green when you have enough
      let x = 26;
      for (const res of Object.keys(r.cost) as Res[]) {
        const need = r.cost[res] ?? 0, ok = it[res] >= need;
        const t = `${res} ${it[res]}/${need}`;
        ctx.font = '17px monospace'; ctx.fillStyle = done || ok ? '#6fe39a' : '#ff7a7a'; ctx.fillText(t, x, y + 82);
        x += ctx.measureText(t).width + 18;
      }
      const label = done ? 'BUILT' : !open ? 'LOCKED' : 'CRAFT';
      ctx.fillStyle = done ? '#1f3a2a' : !open ? '#2a2a36' : can ? (hov.has(i) ? '#ffb347' : '#2f7a4a') : '#4a2a2a';
      ctx.fillRect(450, y + 16, 160, 60);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(450, y + 16, 160, 60);
      ctx.fillStyle = hov.has(i) && can ? '#10131f' : '#fff'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, 530, y + 56); ctx.textAlign = 'left';
    }
    if (this.pages > 1) {
      const navY = TOP + this.rowsAreaH;
      for (const [id, label, x] of [[PREV, '< PREV', 40], [NEXT, 'NEXT >', 400]] as const) {
        ctx.fillStyle = hov.has(id) ? '#ffb347' : '#1c2a4a'; ctx.fillRect(x, navY + 6, 200, 44);
        ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(x, navY + 6, 200, 44);
        ctx.fillStyle = hov.has(id) ? '#10131f' : '#fff'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'; ctx.fillText(label, x + 100, navY + 37);
      }
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#7fe3c1'; ctx.font = '20px monospace'; ctx.fillText(this.footer, 24, H - 16);
    this.refresh();
  }
}
