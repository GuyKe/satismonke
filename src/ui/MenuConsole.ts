import * as THREE from 'three';
import { Screen } from './Screen';
import { Settings, GRAVITY_STEPS, JUMP_STEPS, saveSettings } from '../settings';

interface Button {
  label: () => string;
  x: number; y: number; w: number; h: number; // canvas px
  onClick: () => void;
}

const W = 640, H = 400;

/** The main menu panel on the console. Buttons are hit-tested from a UV coordinate. */
export class MenuConsole extends Screen {
  private buttons: Button[] = [];
  private hovered = new Map<number, number>(); // pointer id -> button index
  private dirty = true;

  constructor(private settings: Settings, private actions: { resetPosition: () => void }) {
    super(1.6, 1.0, W, H);
    const cycle = (steps: number[], cur: number) => steps[(steps.indexOf(cur) + 1) % steps.length] ?? steps[0];
    const bw = 280, bh = 90, gx = 30, top = 110, gy = 20;
    const defs: [() => string, () => void][] = [
      [() => `Gravity: ${this.settings.gravityG}g`, () => { this.settings.gravityG = cycle(GRAVITY_STEPS, this.settings.gravityG); }],
      [() => `Jump power: ${this.settings.jumpMult.toFixed(2)}x`, () => { this.settings.jumpMult = cycle(JUMP_STEPS, this.settings.jumpMult); }],
      [() => `Laser: ${this.settings.laserAlways ? 'always' : 'auto'}`, () => { this.settings.laserAlways = !this.settings.laserAlways; }],
      [() => 'Reset position', () => this.actions.resetPosition()],
    ];
    defs.forEach(([label, onClick], i) => {
      this.buttons.push({
        label, onClick,
        x: gx + (i % 2) * (bw + gx), y: top + Math.floor(i / 2) * (bh + gy), w: bw, h: bh,
      });
    });
    this.redraw();
  }

  /** Returns the button index under a UV, or -1. */
  private pick(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.buttons.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  /** Update hover state for a pointer. Returns true if a button is hovered. */
  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const idx = this.pick(uv);
    const prev = this.hovered.get(pointer) ?? -1;
    if (idx !== prev) { this.hovered.set(pointer, idx); this.dirty = true; }
    return idx >= 0;
  }

  /** Activate the hovered button of a pointer. Returns true if something was pressed. */
  click(pointer: number): boolean {
    const idx = this.hovered.get(pointer) ?? -1;
    if (idx < 0) return false;
    this.buttons[idx].onClick();
    saveSettings(this.settings);
    this.dirty = true;
    return true;
  }

  update(): void { if (this.dirty) this.redraw(); }

  private redraw(): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 48px monospace';
    ctx.fillText('SATISMONKE', 30, 70);
    ctx.font = '20px monospace'; ctx.fillStyle = '#8aa';
    ctx.fillText('point + trigger to select', 34, 98);
    const hovered = new Set(this.hovered.values());
    this.buttons.forEach((b, i) => {
      ctx.fillStyle = hovered.has(i) ? '#ffb347' : '#1c2a4a';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hovered.has(i) ? '#10131f' : '#fff';
      ctx.font = 'bold 28px monospace';
      const text = b.label();
      ctx.fillText(text, b.x + (b.w - ctx.measureText(text).width) / 2, b.y + b.h / 2 + 10);
    });
    this.refresh();
  }
}
