import { Screen } from './Screen';
import type { Progress } from '../game/Progress';

/** Left wrist: how much wood, stone and steel you carry. */
export class ResourceHud extends Screen {
  private key = '';
  constructor() { super(0.14, 0.1, 256, 183); }

  set(p: Progress): void {
    const k = `${p.items.wood}/${p.items.stone}/${p.items.steel}`;
    if (k === this.key) return;
    this.key = k;
    const { ctx } = this;
    ctx.fillStyle = '#12100c'; ctx.fillRect(0, 0, 256, 183);
    ctx.strokeStyle = '#c98a4a'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 177);
    ctx.font = 'bold 36px monospace'; ctx.textAlign = 'left';
    const rows: [string, number, string][] = [['WOOD', p.items.wood, '#e8b27a'], ['STONE', p.items.stone, '#c0c4d0'], ['STEEL', p.items.steel, '#8fc3ff']];
    rows.forEach(([n, v, c], i) => {
      ctx.fillStyle = c; ctx.fillText(n, 16, 52 + i * 52);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(String(v), 240, 52 + i * 52); ctx.textAlign = 'left';
    });
    this.refresh();
  }
}

/** Right wrist: what to do next, in two short lines. */
export class ObjectiveHud extends Screen {
  private key = '';
  constructor() { super(0.2, 0.1, 512, 256); }

  set(lines: [string, string]): void {
    const k = lines.join('|');
    if (k === this.key) return;
    this.key = k;
    const { ctx } = this;
    ctx.fillStyle = '#08141a'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#2ee6a6'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 506, 250);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2ee6a6'; ctx.font = 'bold 30px monospace'; ctx.fillText('OBJECTIVE', 20, 46);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; this.fit(lines[0], 20, 118, 470);
    ctx.fillStyle = '#ffd9a0'; ctx.font = 'bold 32px monospace'; this.fit(lines[1], 20, 190, 470);
    this.refresh();
  }

  /** Draw text, shrinking the font until it fits the width. */
  private fit(text: string, x: number, y: number, maxW: number): void {
    const { ctx } = this;
    let size = parseInt(ctx.font.match(/(\d+)px/)![1], 10);
    while (ctx.measureText(text).width > maxW && size > 16) { size -= 2; ctx.font = ctx.font.replace(/\d+px/, `${size}px`); }
    ctx.fillText(text, x, y);
  }
}
