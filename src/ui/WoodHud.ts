import { Screen } from './Screen';

/** Tiny wrist display showing how much wood you have. */
export class WoodHud extends Screen {
  private shown = -1;
  constructor() { super(0.14, 0.07, 256, 128); this.set(0); }

  set(n: number): void {
    if (n === this.shown) return;
    this.shown = n;
    const { ctx } = this;
    ctx.fillStyle = '#1a0f08'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#c98a4a'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 122);
    ctx.fillStyle = '#e8b27a'; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center';
    ctx.fillText('WOOD', 128, 48);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 56px monospace';
    ctx.fillText(String(n), 128, 104);
    this.refresh();
  }
}
