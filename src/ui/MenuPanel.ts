import * as THREE from 'three';
import { Screen } from './Screen';
import { SaveData, SLOTS, listSlots, formatAgo, formatPlaytime } from '../game/Save';
import type { Settings, Quality } from '../settings';
import { CONTROLS_LINES, HOWTO_LINES } from './helpText';

const W = 800, H = 500;
type Page = 'main' | 'slots' | 'controls' | 'howto' | 'pause' | 'settings';

interface Btn { label: string; x: number; y: number; w: number; h: number; act: () => void; danger?: boolean; dim?: boolean }

export interface MenuHandlers {
  /** Start (mode 'new') or continue (mode 'load') the game in a slot. */
  onStart(slot: number, mode: 'new' | 'load'): void;
  onDelete(slot: number): void;
  onResume(): void;
  onSave(): void;
  onMainMenu(): void;
  /** A setting changed: persist and apply it. */
  onSettings(): void;
  onResetArms(): void;
}

/** The main menu (PLAY / CONTROLS / HOW TO PLAY, with save slots) and the in-game pause menu. */
export class MenuPanel extends Screen {
  private page: Page;
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private slots: (SaveData | null)[] = [];
  private armedDelete = -1;
  private armedAt = 0;
  private status = '';
  private statusT = 0;
  private dirty = true;

  constructor(private kind: 'main' | 'pause', private h: MenuHandlers, private settings: Settings, width = 2.0) {
    super(width, width * H / W, W, H);
    this.page = kind === 'main' ? 'main' : 'pause';
    this.build();
  }

  open(): void { this.page = this.kind === 'main' ? 'main' : 'pause'; this.hovered.clear(); this.build(); }
  flash(text: string): void { this.status = text; this.statusT = 2.5; this.dirty = true; }

  private go(p: Page): void { this.page = p; this.hovered.clear(); this.armedDelete = -1; this.build(); }

  private back(): Btn { return { label: 'BACK', x: 280, y: 410, w: 240, h: 60, act: () => this.go(this.kind === 'main' ? 'main' : 'pause') }; }

  private build(): void {
    this.dirty = true;
    const col = (labels: [string, () => void][], y0: number, bh = 76, gap = 16): Btn[] =>
      labels.map(([label, act], i) => ({ label, act, x: 190, y: y0 + i * (bh + gap), w: 420, h: bh }));
    switch (this.page) {
      case 'main':
        this.btns = col([['PLAY', () => { this.slots = listSlots(); this.go('slots'); }], ['CONTROLS', () => this.go('controls')], ['HOW TO PLAY', () => this.go('howto')], ['SETTINGS', () => this.go('settings')]], 140, 66, 14);
        break;
      case 'pause':
        this.btns = col([['RESUME', () => this.h.onResume()], ['SAVE GAME', () => this.h.onSave()], ['SETTINGS', () => this.go('settings')], ['CONTROLS', () => this.go('controls')], ['HOW TO PLAY', () => this.go('howto')], ['SAVE & MAIN MENU', () => this.h.onMainMenu()]], 88, 56, 10);
        break;
      case 'slots':
        this.slots = listSlots();
        this.btns = [];
        for (let i = 0; i < SLOTS; i++) {
          const y = 110 + i * 100, s = this.slots[i];
          this.btns.push({ label: s ? 'LOAD' : 'NEW', x: 520, y: y + 8, w: 150, h: 70, act: () => this.h.onStart(i, s ? 'load' : 'new') });
          if (s) this.btns.push({
            label: this.armedDelete === i ? 'SURE?' : 'DEL', x: 685, y: y + 8, w: 90, h: 70, danger: true,
            act: () => {
              if (this.armedDelete === i) { this.h.onDelete(i); this.armedDelete = -1; this.slots = listSlots(); this.build(); }
              else { this.armedDelete = i; this.armedAt = performance.now(); this.build(); }
            },
          });
        }
        this.btns.push(this.back());
        break;
      case 'controls': case 'howto':
        this.btns = [this.back()];
        break;
      case 'settings': {
        const s = this.settings, change = (fn: () => void) => () => { fn(); this.h.onSettings(); this.build(); };
        const qs: Quality[] = ['low', 'medium', 'high'];
        this.btns = [
          { label: '-', x: 470, y: 96, w: 70, h: 56, act: change(() => { s.volume = Math.max(0, Math.round((s.volume - 0.1) * 10) / 10); }) },
          { label: '+', x: 690, y: 96, w: 70, h: 56, act: change(() => { s.volume = Math.min(1, Math.round((s.volume + 0.1) * 10) / 10); }) },
          { label: s.laserAlways ? 'ALWAYS' : 'AUTO', x: 470, y: 166, w: 290, h: 56, act: change(() => { s.laserAlways = !s.laserAlways; }) },
          { label: s.graphics.toUpperCase(), x: 470, y: 236, w: 290, h: 56, act: change(() => { s.graphics = qs[(qs.indexOf(s.graphics) + 1) % 3]; }) },
          { label: 'RESET', x: 470, y: 306, w: 290, h: 56, act: () => { this.h.onResetArms(); this.flash('Arm span will be measured again'); } },
          this.back(),
        ];
        break;
      }
    }
  }

  private idx(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.btns.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.idx(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.dirty = true; }
    return i >= 0;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0 || !this.btns[i]) return false;
    this.btns[i].act();
    this.dirty = true;
    return true;
  }

  update(dt: number): void {
    if (this.statusT > 0 && (this.statusT -= dt) <= 0) { this.status = ''; this.dirty = true; }
    if (this.armedDelete >= 0 && performance.now() - this.armedAt > 3000) { this.armedDelete = -1; this.build(); }
    if (this.dirty) this.draw();
  }

  private draw(): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#ffb347';
    const titles: Record<Page, string> = { main: 'SATISMONKE', slots: 'CHOOSE A SLOT', controls: 'CONTROLS', howto: 'HOW TO PLAY', pause: 'PAUSED', settings: 'SETTINGS' };
    ctx.font = this.page === 'main' ? 'bold 72px monospace' : 'bold 48px monospace';
    ctx.fillText(titles[this.page], W / 2, this.page === 'main' ? 110 : 66);

    if (this.page === 'controls' || this.page === 'howto') {
      ctx.textAlign = 'left'; ctx.font = '22px monospace'; ctx.fillStyle = '#d8e8f0';
      (this.page === 'controls' ? CONTROLS_LINES : HOWTO_LINES).forEach((l, i) => ctx.fillText(l, 40, 112 + i * 30));
      ctx.textAlign = 'center';
    }
    if (this.page === 'settings') {
      ctx.textAlign = 'left'; ctx.fillStyle = '#d8e8f0'; ctx.font = 'bold 26px monospace';
      ['Volume', 'Laser pointer', 'Graphics', 'Arm span'].forEach((l, i) => ctx.fillText(l, 50, 134 + i * 70));
      ctx.font = '17px monospace'; ctx.fillStyle = '#7a8aa0';
      ['', 'AUTO shows it when aimed at a screen', 'Applies to the next planet you land on', 'Measured when you stretch your arms wide'].forEach((l, i) => ctx.fillText(l, 50, 156 + i * 70));
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 30px monospace';
      ctx.fillText(`${Math.round(this.settings.volume * 100)}%`, 615, 134);
    }
    if (this.page === 'slots') {
      for (let i = 0; i < SLOTS; i++) {
        const y = 110 + i * 100, s = this.slots[i];
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(30, y, 750, 86);
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 28px monospace'; ctx.fillText(`SLOT ${i + 1}`, 50, y + 36);
        ctx.font = '20px monospace'; ctx.fillStyle = '#9ab';
        ctx.fillText(s ? `${s.phase === 'planet' ? s.objective : 'In the pod, about to crash'}` : 'Empty - start a new game', 50, y + 62);
        if (s) { ctx.textAlign = 'right'; ctx.fillText(`${formatPlaytime(s.playSeconds)}   ${formatAgo(s.savedAt)}`, 500, y + 36); }
      }
      ctx.textAlign = 'center';
    }
    this.btns.forEach((b, i) => {
      const hot = [...this.hovered.values()].includes(i);
      ctx.fillStyle = hot ? '#ffb347' : b.danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hot ? '#10131f' : '#fff'; ctx.font = `bold ${b.h > 70 ? 36 : 28}px monospace`;
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 11);
    });
    if (this.status) { ctx.fillStyle = '#7fe3c1'; ctx.font = 'bold 24px monospace'; ctx.fillText(this.status, W / 2, H - 22); }
    ctx.textAlign = 'start';
    this.refresh();
  }
}
