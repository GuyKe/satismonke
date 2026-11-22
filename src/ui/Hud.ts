import { Screen } from './Screen';
import type { Progress } from '../game/Progress';

/** Left wrist: how much of each resource you carry (two columns). */
export class ResourceHud extends Screen {
  private key = '';
  constructor() { super(0.2, 0.1, 512, 256); }

  set(p: Progress): void {
    const it = p.items, k = `${it.wood}/${it.stone}/${it.steel}/${it.crystal}/${it.copper}/${it.iron}/${it.gold}/${it.plasma}`;
    if (k === this.key) return;
    this.key = k;
    const { ctx } = this;
    ctx.fillStyle = '#12100c'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#c98a4a'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 506, 250);
    const cells: [string, number, string][] = [
      ['WOOD', it.wood, '#e8b27a'], ['COPPER', it.copper, '#e08a3c'], ['STONE', it.stone, '#c0c4d0'], ['IRON', it.iron, '#8fa6c8'],
      ['STEEL', it.steel, '#8fc3ff'], ['GOLD', it.gold, '#ffd23a'], ['CRYSTAL', it.crystal, '#6fe8ff'], ['PLASMA', it.plasma, '#d27aff'],
    ];
    ctx.font = 'bold 26px monospace';
    cells.forEach(([n, v, c], i) => {
      const col = i % 2, row = Math.floor(i / 2), x = 18 + col * 250, y = 52 + row * 58;
      ctx.textAlign = 'left'; ctx.fillStyle = c; ctx.fillText(n, x, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(String(v), x + 220, y);
    });
    ctx.textAlign = 'left';
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
