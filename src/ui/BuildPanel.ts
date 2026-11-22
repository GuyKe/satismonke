import * as THREE from 'three';
import { Screen } from './Screen';
import { PALETTE, PALETTE_NAMES, COLOR_COST, COST, PieceType } from '../world/BuildSystem';

const W = 640, H = 460;
export type BuildMode = PieceType | 'demolish';

/** The building tool's palette: what to place, its colour, and a way out. */
export class BuildPanel extends Screen {
  private hovered = new Map<number, number>();
  private btns: { label: string; x: number; y: number; w: number; h: number; act: () => void; swatch?: number }[] = [];
  private key = '';
  mode: BuildMode = 'foundation';
  color = 0;

  constructor(
    private owned: () => number[], private tokens: () => number,
    private onBuyColor: (i: number) => boolean, private onExit: () => void,
  ) {
    super(1.1, 1.1 * H / W, W, H);
    const modes: [string, BuildMode][] = [['FOUNDATION', 'foundation'], ['WALL', 'wall'], ['CATWALK', 'catwalk'], ['DEMOLISH', 'demolish']];
    modes.forEach(([label, m], i) => this.btns.push({ label, x: 20 + i * 152, y: 70, w: 144, h: 66, act: () => { this.mode = m; } }));
    PALETTE.forEach((c, i) => this.btns.push({ label: '', swatch: i, x: 20 + i * 100, y: 250, w: 90, h: 80, act: () => { if (i === 0 || this.owned().includes(i) || this.onBuyColor(i)) this.color = i; } }));
    this.btns.push({ label: 'DONE', x: 220, y: 380, w: 200, h: 60, act: () => this.onExit() });
  }

  private idx(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }
  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.idx(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.key = ''; }
    return i >= 0;
  }
  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0) return false;
    this.btns[i].act(); this.key = '';
    return true;
  }

  update(): void {
    const key = [this.mode, this.color, this.owned().join(), this.tokens(), [...this.hovered.values()].join()].join('|');
    if (key === this.key) return;
    this.key = key;
    const { ctx } = this;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 34px monospace'; ctx.fillText('BUILD', 24, 50);
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      const on = b.swatch === undefined && b.label.toLowerCase() === this.mode;
      ctx.fillStyle = b.swatch !== undefined ? '#12182a' : on ? '#2f7a4a' : hov.has(i) ? '#ffb347' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = on || (b.swatch !== undefined && b.swatch === this.color) ? '#6fe39a' : '#ffb347'; ctx.lineWidth = on || b.swatch === this.color ? 6 : 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.swatch !== undefined) {
        const owned = b.swatch === 0 || this.owned().includes(b.swatch);
        ctx.fillStyle = '#' + PALETTE[b.swatch].toString(16).padStart(6, '0'); ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, 40);
        ctx.fillStyle = owned ? '#fff' : this.tokens() >= COLOR_COST ? '#ffd9a0' : '#ff7a7a'; ctx.font = '17px monospace'; ctx.textAlign = 'center';
        ctx.fillText(owned ? PALETTE_NAMES[b.swatch] : `${COLOR_COST} tokens`, b.x + b.w / 2, b.y + 68); ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = hov.has(i) && !on ? '#10131f' : '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 8); ctx.textAlign = 'left';
      }
    });
    ctx.fillStyle = '#9ab'; ctx.font = '20px monospace';
    const cost = this.mode === 'demolish' ? 'Aim at a piece, trigger: half the cost back' : `Cost: ${Object.entries(COST[this.mode]).map(([k, v]) => `${v} ${k}`).join(', ')}`;
    ctx.fillText(cost, 24, 175);
    ctx.fillText('Aim at the ground, or at a piece to extend it. Walls go on foundation edges.', 24, 205);
    ctx.fillStyle = '#d8e8f0'; ctx.font = 'bold 22px monospace'; ctx.fillText(`Colour  (tokens: ${this.tokens()})`, 24, 242);
    this.refresh();
  }
}
