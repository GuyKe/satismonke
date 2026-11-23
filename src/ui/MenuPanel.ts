import * as THREE from 'three';
import { Screen } from './Screen';
import { SaveData, SLOTS, listSlots, formatAgo, formatPlaytime } from '../game/Save';
import type { Settings, Quality } from '../settings';
import { CODE_CHARS, CODE_LEN } from '../net/Multiplayer';
import { Look, FUR_PALETTE, SUIT_PALETTE, SUIT_NAMES, HATS, BADGES, stepColor, stepItem, redeem, loadUnlocked } from '../game/Cosmetics';
import { CONTROLS_LINES, HOWTO_LINES, RESOURCE_GUIDE } from './helpText';

const W = 800, H = 500;
type Page = 'main' | 'slots' | 'controls' | 'howto' | 'pause' | 'settings' | 'guide' | 'multi' | 'join' | 'lobby' | 'realms' | 'custom' | 'code';

/** A saved realm, either one you host or one you are a member of. */
export interface RealmEntry { code: string; kind: 'host' | 'member'; line1: string; line2: string }
export interface LobbyInfo { allowSaving: boolean; maxPlayers: number; realm: boolean; mic: string; code: string; isHost: boolean; status: 'connecting' | 'lobby' | 'game' | 'error'; error: string; players: { name: string; color: number }[] }
const GUIDE_PER_PAGE = 4;

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
  onHost(): void;
  onJoin(code: string): void;
  onLeaveLobby(): void;
  onStartLobby(): void;
  /** Your current look, and a way to change it (the preview and your avatar update). */
  getLook(): Look;
  onLook(l: Look): void;
  onToggleMic(): void;
  onToggleSaving(): void;
  onCycleMax(): void;
  realms(): RealmEntry[];
  onRealmHost(code: string): void;
  onRealmJoin(code: string): void;
  onRealmRemove(code: string, kind: 'host' | 'member'): void;
}

/** The main menu (PLAY / CONTROLS / HOW TO PLAY, with save slots) and the in-game pause menu. */
export class MenuPanel extends Screen {
  private page: Page;
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private slots: (SaveData | null)[] = [];
  private armedDelete = -1;
  private armedAt = 0;
  private armedRealm = '';
  private realmList: RealmEntry[] = [];
  private typed = '';
  private status = '';
  private statusT = 0;
  private dirty = true;
  private guidePage = 0;
  private lobby: LobbyInfo | null = null;
  private code = '';

  constructor(private kind: 'main' | 'pause', private h: MenuHandlers, private settings: Settings, width = 2.0) {
    super(width, width * H / W, W, H);
    this.page = kind === 'main' ? 'main' : 'pause';
    this.build();
  }

  open(): void { this.page = this.kind === 'main' ? 'main' : 'pause'; this.hovered.clear(); this.build(); }
  /** The lobby changed (or ended): show the right page. */
  setLobby(l: LobbyInfo | null): void {
    this.lobby = l;
    if (this.kind === 'main') {
      if (l && (this.page === 'multi' || this.page === 'join' || this.page === 'lobby')) this.go('lobby');
      else if (!l && this.page === 'lobby') this.go('multi');
    }
    this.dirty = true;
    this.build();
  }
  flash(text: string): void { this.status = text; this.statusT = 2.5; this.dirty = true; }

  private go(p: Page): void { this.page = p; this.hovered.clear(); this.armedDelete = -1; this.build(); }

  private back(): Btn { return { label: 'BACK', x: 280, y: 410, w: 240, h: 60, act: () => this.go(this.kind === 'main' ? 'main' : 'pause') }; }

  private build(): void {
    this.dirty = true;
    const col = (labels: [string, () => void][], y0: number, bh = 76, gap = 16): Btn[] =>
      labels.map(([label, act], i) => ({ label, act, x: 190, y: y0 + i * (bh + gap), w: 420, h: bh }));
    switch (this.page) {
      case 'main':
        this.btns = col([['PLAY', () => { this.slots = listSlots(); this.go('slots'); }], ['MULTIPLAYER', () => this.go('multi')], ['CUSTOMISE', () => this.go('custom')]], 118, 48, 8);
        const pairs: [[string, Page], [string, Page]][] = [[['CONTROLS', 'controls'], ['HOW TO PLAY', 'howto']], [['FIND RESOURCES', 'guide'], ['SETTINGS', 'settings']]];
        pairs.forEach(([l, r], i) => {
          this.btns.push({ label: l[0], x: 190, y: 118 + (3 + i) * 56, w: 206, h: 48, act: () => this.go(l[1]) }, { label: r[0], x: 404, y: 118 + (3 + i) * 56, w: 206, h: 48, act: () => this.go(r[1]) });
        });
        this.btns.push({ label: 'ENTER CODE', x: 190, y: 118 + 5 * 56, w: 420, h: 48, act: () => { this.typed = ''; this.go('code'); } });
        break;
      case 'pause':
        this.btns = col([['RESUME', () => this.h.onResume()], ['SAVE GAME', () => this.h.onSave()], ['SETTINGS', () => this.go('settings')], ['CONTROLS', () => this.go('controls')], ['HOW TO PLAY', () => this.go('howto')], ['FIND RESOURCES', () => this.go('guide')], ['SAVE & MAIN MENU', () => this.h.onMainMenu()]], 84, 50, 8);
        if (this.lobby && this.lobby.code) {
          this.btns.push({ label: this.micLabel(this.lobby.mic), x: 640, y: 48, w: 140, h: 36, dim: this.lobby.mic === 'nomic', act: () => this.h.onToggleMic() });
          if (this.lobby.isHost) this.btns.push({ label: this.lobby.allowSaving ? 'SAVE: ON' : 'SAVE: OFF', x: 490, y: 48, w: 140, h: 36, act: () => this.h.onToggleSaving() });
        }
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
      case 'multi':
        this.btns = col([['CREATE LOBBY', () => this.h.onHost()], ['JOIN WITH CODE', () => { this.code = ''; this.go('join'); }], ['MY REALMS', () => { this.armedRealm = ''; this.go('realms'); }]], 132, 62, 14);
        this.btns.push(this.back());
        break;
      case 'join': {
        this.btns = [];
        const per = 8;
        [...CODE_CHARS].forEach((c, i) => this.btns.push({ label: c, x: 28 + (i % per) * 94, y: 168 + Math.floor(i / per) * 58, w: 86, h: 50, act: () => { if (this.code.length < CODE_LEN) this.code += c; this.build(); } }));
        this.btns.push(
          { label: 'DEL', x: 28, y: 410, w: 170, h: 60, danger: true, act: () => { this.code = this.code.slice(0, -1); this.build(); } },
          { label: 'JOIN', x: 314, y: 410, w: 170, h: 60, dim: this.code.length < CODE_LEN, act: () => { if (this.code.length === CODE_LEN) this.h.onJoin(this.code); } },
          { label: 'BACK', x: 602, y: 410, w: 170, h: 60, act: () => this.go('multi') },
        );
        break;
      }
      case 'custom': {
        const l = this.h.getLook(), set = (p: Partial<Look>) => () => { this.h.onLook({ ...this.h.getLook(), ...p }); this.build(); };
        const row = (i: number, dec: () => void, inc: () => void) => {
          const y = 96 + i * 76;
          this.btns.push({ label: '<', x: 440, y, w: 70, h: 56, act: dec }, { label: '>', x: 700, y, w: 70, h: 56, act: inc });
        };
        this.btns = [];
        row(0, set({ fur: stepColor(FUR_PALETTE, l.fur, -1) }), set({ fur: stepColor(FUR_PALETTE, l.fur, 1) }));
        row(1, set({ suit: stepColor(SUIT_PALETTE, l.suit, -1) }), set({ suit: stepColor(SUIT_PALETTE, l.suit, 1) }));
        row(2, set({ hat: stepItem('hat', HATS, l.hat, -1) }), set({ hat: stepItem('hat', HATS, l.hat, 1) }));
        row(3, set({ badge: stepItem('badge', BADGES, l.badge, -1) }), set({ badge: stepItem('badge', BADGES, l.badge, 1) }));
        this.btns.push({ label: 'ENTER CODE', x: 40, y: 410, w: 300, h: 60, act: () => { this.typed = ''; this.go('code'); } }, { label: 'BACK', x: 460, y: 410, w: 300, h: 60, act: () => this.go('main') });
        break;
      }
      case 'code': {
        this.btns = [];
        const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], per = 12;
        keys.forEach((c, i) => this.btns.push({ label: c, x: 28 + (i % per) * 62, y: 176 + Math.floor(i / per) * 58, w: 56, h: 50, act: () => { if (this.typed.length < 16) this.typed += c; this.build(); } }));
        this.btns.push(
          { label: 'DEL', x: 28, y: 364, w: 170, h: 56, danger: true, act: () => { this.typed = this.typed.slice(0, -1); this.build(); } },
          { label: 'ENTER', x: 314, y: 364, w: 170, h: 56, dim: this.typed.length === 0, act: () => this.submitCode() },
          { label: 'BACK', x: 602, y: 364, w: 170, h: 56, act: () => this.go('custom') },
        );
        break;
      }
      case 'realms': {
        this.realmList = this.h.realms().slice(0, 4);
        this.btns = [];
        this.realmList.forEach((r, i) => {
          const y = 96 + i * 74;
          this.btns.push({ label: r.kind === 'host' ? 'HOST' : 'JOIN', x: 540, y: y + 6, w: 130, h: 54, act: () => (r.kind === 'host' ? this.h.onRealmHost(r.code) : this.h.onRealmJoin(r.code)) });
          const id = r.kind + r.code;
          this.btns.push({ label: this.armedRealm === id ? 'SURE?' : r.kind === 'host' ? 'DEL' : 'LEAVE', x: 684, y: y + 6, w: 100, h: 54, danger: true,
            act: () => { if (this.armedRealm === id) { this.h.onRealmRemove(r.code, r.kind); this.armedRealm = ''; this.build(); } else { this.armedRealm = id; this.armedAt = performance.now(); this.build(); } } });
        });
        this.btns.push({ label: 'BACK', x: 280, y: 410, w: 240, h: 60, act: () => this.go('multi') });
        break;
      }
      case 'lobby': {
        const l = this.lobby;
        this.btns = [];
        if (l && l.status === 'lobby' && l.isHost) {
          this.btns.push({ label: `SAVING: ${l.allowSaving ? 'ON' : 'OFF'}`, x: 40, y: 300, w: 350, h: 46, act: () => this.h.onToggleSaving() });
          this.btns.push({ label: `MAX PLAYERS: ${l.maxPlayers}`, x: 410, y: 300, w: 350, h: 46, act: () => this.h.onCycleMax() });
          this.btns.push({ label: l.realm ? 'START REALM' : 'START GAME', x: 190, y: 354, w: 420, h: 48, act: () => this.h.onStartLobby() });
        }
        if (l && l.status !== 'error' && l.status !== 'connecting') this.btns.push({ label: this.micLabel(l.mic), x: 30, y: 410, w: 200, h: 60, dim: l.mic === 'nomic', act: () => this.h.onToggleMic() });
        this.btns.push({ label: l && l.status === 'error' ? 'BACK' : 'LEAVE LOBBY', x: 250, y: 410, w: 300, h: 60, danger: true, act: () => { this.h.onLeaveLobby(); this.go('multi'); } });
        break;
      }
      case 'controls': case 'howto':
        this.btns = [this.back()];
        break;
      case 'guide': {
        const pages = Math.ceil(RESOURCE_GUIDE.length / GUIDE_PER_PAGE);
        const back = this.back(); back.x = 290; back.w = 220; back.y = 424; back.h = 56;
        this.btns = [
          { label: '< PREV', x: 40, y: 424, w: 220, h: 56, act: () => { this.guidePage = (this.guidePage + pages - 1) % pages; this.build(); } },
          back,
          { label: 'NEXT >', x: 540, y: 424, w: 220, h: 56, act: () => { this.guidePage = (this.guidePage + 1) % pages; this.build(); } },
        ];
        break;
      }
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

  private submitCode(): void {
    if (!this.typed) return;
    const r = redeem(this.typed);
    this.flash(r.message);
    if (r.ok) { this.typed = ''; if (r.equip) this.h.onLook({ ...this.h.getLook(), ...r.equip }); }
    this.build();
  }

  private micLabel(m: string): string { return m === 'on' ? 'MIC ON' : m === 'muted' ? 'MIC OFF' : m === 'nomic' ? 'NO MIC' : 'MIC...'; }

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
    if (this.armedRealm && performance.now() - this.armedAt > 3000) { this.armedRealm = ''; this.build(); }
    if (this.dirty) this.draw();
  }

  private draw(): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#ffb347';
    const titles: Record<Page, string> = { main: 'SATISMONKE', slots: 'CHOOSE A SLOT', controls: 'CONTROLS', howto: 'HOW TO PLAY', pause: 'PAUSED', settings: 'SETTINGS', guide: 'FIND RESOURCES', multi: 'MULTIPLAYER', join: 'ENTER LOBBY CODE', lobby: 'LOBBY', realms: 'MY REALMS', custom: 'CUSTOMISE', code: 'ENTER A CODE' };
    ctx.font = this.page === 'main' ? 'bold 72px monospace' : 'bold 48px monospace';
    ctx.fillText(titles[this.page], W / 2, this.page === 'main' ? 110 : 66);

    if (this.page === 'multi') {
      ctx.fillStyle = '#9ab'; ctx.font = '20px monospace';
      ctx.fillText('Play the planet with friends. One of you creates a lobby,', W / 2, 108);
      ctx.fillText('the others type its 4-letter code. Everyone starts fresh.', W / 2, 132);
    }
    if (this.page === 'custom') {
      const l = this.h.getLook(), u = loadUnlocked();
      const hat = HATS.find(h => h.id === l.hat)?.name ?? 'No hat', badge = BADGES.find(b => b.id === l.badge)?.name ?? 'No badge';
      const suitName = SUIT_NAMES[SUIT_PALETTE.indexOf(l.suit)] ?? 'Custom';
      const rows: [string, string, number | null][] = [['FUR', `${FUR_PALETTE.indexOf(l.fur) + 1 || '-'} / ${FUR_PALETTE.length}`, l.fur], ['SUIT', suitName, l.suit], ['HAT', hat, null], ['BADGE', badge, null]];
      rows.forEach(([label, val, col], i) => {
        const y = 96 + i * 76;
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(24, y - 4, 752, 64);
        ctx.textAlign = 'left'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 30px monospace'; ctx.fillText(label, 44, y + 38);
        if (col !== null) { ctx.fillStyle = '#' + col.toString(16).padStart(6, '0'); ctx.fillRect(200, y + 6, 56, 44); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(200, y + 6, 56, 44); }
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 26px monospace'; ctx.fillText(val, 605, y + 38);
      });
      ctx.textAlign = 'center'; ctx.fillStyle = '#7a8aa0'; ctx.font = '17px monospace';
      ctx.fillText(`Locked items appear here once you enter a code (${[...u].length} unlocked)`, W / 2, 396);
    }
    if (this.page === 'code') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px monospace'; ctx.textAlign = 'center';
      ctx.fillText(this.typed ? this.typed : '_', W / 2, 126);
      ctx.fillStyle = '#7a8aa0'; ctx.font = '18px monospace'; ctx.fillText('Type a code with the keys, then ENTER', W / 2, 152);
    }
    if (this.page === 'realms') {
      if (!this.realmList.length) { ctx.fillStyle = '#9ab'; ctx.font = '22px monospace'; ctx.fillText('No realms yet.', W / 2, 190); ctx.fillText('Host a lobby with SAVING: ON, then save from the pause menu.', W / 2, 224); }
      this.realmList.forEach((r, i) => {
        const y = 96 + i * 74;
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(24, y, 764, 66);
        ctx.textAlign = 'left'; ctx.fillStyle = r.kind === 'host' ? '#ffb347' : '#7fe3c1'; ctx.font = 'bold 30px monospace'; ctx.fillText(r.code.split('').join(' '), 44, y + 32);
        ctx.fillStyle = '#9ab'; ctx.font = '17px monospace'; ctx.fillText(r.line1, 44, y + 52); ctx.fillText(r.line2, 270, y + 32);
      });
      ctx.textAlign = 'center';
    }
    if (this.page === 'join') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 64px monospace';
      ctx.fillText((this.code + '_'.repeat(CODE_LEN - this.code.length)).split('').join(' '), W / 2, 130);
    }
    if (this.page === 'lobby') {
      const l = this.lobby;
      if (!l) { ctx.fillStyle = '#9ab'; ctx.font = '26px monospace'; ctx.fillText('Not in a lobby', W / 2, 200); }
      else if (l.status === 'error') { ctx.fillStyle = '#ff8a8a'; ctx.font = 'bold 26px monospace'; ctx.fillText(l.error || 'Something went wrong', W / 2, 220); }
      else if (l.status === 'connecting') { ctx.fillStyle = '#9ab'; ctx.font = '28px monospace'; ctx.fillText('Connecting...', W / 2, 220); }
      else {
        ctx.fillStyle = l.realm ? '#ffb347' : '#9ab'; ctx.font = '22px monospace'; ctx.fillText(l.realm ? 'REALM CODE (members only)' : 'LOBBY CODE', W / 2, 104);
        ctx.fillStyle = '#7fe3c1'; ctx.font = 'bold 72px monospace'; ctx.fillText(l.code.split('').join(' '), W / 2, 172);
        ctx.textAlign = 'left'; ctx.font = '24px monospace';
        l.players.slice(0, 8).forEach((p, i) => {
          const x = 60 + (i % 2) * 360, y = 220 + Math.floor(i / 2) * 26;
          ctx.fillStyle = '#' + p.color.toString(16).padStart(6, '0'); ctx.fillRect(x, y - 16, 16, 16);
          ctx.fillStyle = '#d8e8f0'; ctx.fillText(p.name, x + 26, y);
        });
        ctx.textAlign = 'center'; ctx.fillStyle = '#9ab'; ctx.font = '20px monospace';
        if (!l.isHost) ctx.fillText('Waiting for the host to start...', W / 2, 372);
      }
    }
    if (this.page === 'pause' && this.lobby && this.lobby.code) { ctx.fillStyle = '#7fe3c1'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'right'; ctx.fillText(`LOBBY ${this.lobby.code} - ${this.lobby.players.length} players`, W - 22, 36); ctx.textAlign = 'center'; }
    if (this.page === 'controls' || this.page === 'howto') {
      ctx.textAlign = 'left'; ctx.font = '22px monospace'; ctx.fillStyle = '#d8e8f0';
      (this.page === 'controls' ? CONTROLS_LINES : HOWTO_LINES).forEach((l, i) => ctx.fillText(l, 40, 112 + i * 30));
      ctx.textAlign = 'center';
    }
    if (this.page === 'guide') {
      const pages = Math.ceil(RESOURCE_GUIDE.length / GUIDE_PER_PAGE);
      ctx.textAlign = 'right'; ctx.fillStyle = '#9ab'; ctx.font = '22px monospace'; ctx.fillText(`${this.guidePage + 1} / ${pages}`, 770, 60); ctx.textAlign = 'left';
      RESOURCE_GUIDE.slice(this.guidePage * GUIDE_PER_PAGE, (this.guidePage + 1) * GUIDE_PER_PAGE).forEach((r, i) => {
        const y = 92 + i * 82;
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(24, y, 752, 76);
        ctx.fillStyle = r.color; ctx.font = 'bold 26px monospace'; ctx.fillText(r.name, 40, y + 28);
        ctx.fillStyle = '#d8e8f0'; ctx.font = '19px monospace'; ctx.fillText(r.lines[0], 40, y + 50); ctx.fillText(r.lines[1], 40, y + 70);
      });
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
      ctx.fillStyle = b.dim ? '#141a2a' : hot ? '#ffb347' : b.danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.dim ? '#4a5568' : hot ? '#10131f' : '#fff'; ctx.font = `bold ${b.h > 70 ? 36 : b.h < 52 ? 24 : 28}px monospace`;
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 11);
    });
    if (this.status) { ctx.fillStyle = '#7fe3c1'; ctx.font = 'bold 24px monospace'; ctx.fillText(this.status, W / 2, H - 22); }
    ctx.textAlign = 'start';
    this.refresh();
  }
}
