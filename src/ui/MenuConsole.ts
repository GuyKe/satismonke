import * as THREE from 'three';
import { Screen } from './Screen';

const W = 640, H = 400;
const BTN = { x: 90, y: 110, w: 460, h: 180 };

/** Console panel: a single "Play" button, later replaced by an emergency message. */
export class MenuConsole extends Screen {
  private hovered = new Set<number>();
  private message: string[] | null = null;
  private dirty = true;
  private lastFlash = -1;

  constructor(private onPlay: () => void) {
    super(1.6, 1.0, W, H);
    this.redraw(0);
  }

  private inButton(uv: THREE.Vector2 | null): boolean {
    if (!uv) return false;
    const px = uv.x * W, py = (1 - uv.y) * H;
    return px >= BTN.x && px <= BTN.x + BTN.w && py >= BTN.y && py <= BTN.y + BTN.h;
  }

  /** Update hover state for a pointer. Returns true if the button is hovered. */
  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const on = !this.message && this.inButton(uv);
    if (on !== this.hovered.has(pointer)) {
      if (on) this.hovered.add(pointer); else this.hovered.delete(pointer);
      this.dirty = true;
    }
    return on;
  }

  /** Press with a pointer. Returns true if Play was pressed. */
  click(pointer: number): boolean {
    if (this.message || !this.hovered.has(pointer)) return false;
    this.onPlay();
    return true;
  }

  /** Back to the single Play button. */
  reset(): void { this.message = null; this.hovered.clear(); this.dirty = true; }

  showMessage(lines: string[]): void { this.message = lines; this.hovered.clear(); this.dirty = true; }

  /** Call every frame with elapsed seconds; the message flashes. */
  update(time: number): void {
    const flash = this.message ? Math.floor(time * 4) : -1;
    if (this.dirty || (this.message && flash !== this.lastFlash)) this.redraw(time);
    this.lastFlash = flash;
  }

  private redraw(time: number): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.textAlign = 'center';
    if (this.message) {
      const on = Math.floor(time * 4) % 2 === 0;
      ctx.fillStyle = on ? '#3a0508' : '#16070a'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, W - 16, H - 16);
      ctx.fillStyle = on ? '#ff4040' : '#aa2222';
      ctx.font = 'bold 46px monospace';
      const lh = 62, y0 = H / 2 - ((this.message.length - 1) * lh) / 2 + 14;
      this.message.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    } else {
      const hot = this.hovered.size > 0;
      ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(6, 6, W - 12, H - 12);
      ctx.fillStyle = hot ? '#ffb347' : '#1c2a4a'; ctx.fillRect(BTN.x, BTN.y, BTN.w, BTN.h);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4; ctx.strokeRect(BTN.x, BTN.y, BTN.w, BTN.h);
      ctx.fillStyle = hot ? '#10131f' : '#fff'; ctx.font = 'bold 90px monospace';
      ctx.fillText('Play', W / 2, BTN.y + BTN.h / 2 + 30);
    }
    ctx.textAlign = 'start';
    this.refresh();
  }
}
