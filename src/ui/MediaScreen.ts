import * as THREE from 'three';
import { Screen } from './Screen';
import { Music, TRACKS } from '../audio/Music';
import { Clip, ClipMeta, CLIP_W, CLIP_H, FILTERS, CAPTIONS, FilterId, applyFilter, drawCaption, loadImage, editFrames, metaOf, newId } from '../media/Clip';

const W = 800, H = 500;
const PER_PAGE = 3;
type Page = 'home' | 'music' | 'list' | 'player' | 'edit';
type Tab = 'lobby' | 'global' | 'mine';

interface Btn { label: string; x: number; y: number; w: number; h: number; act: () => void; danger?: boolean; dim?: boolean; on?: boolean }

/** What the computer needs from the rest of the game. */
export interface MediaHost {
  music: Music;
  me(): { name: string; color: number };
  mine(): Promise<Clip[]>;
  saveClip(c: Clip): Promise<void>;
  deleteClip(id: string): Promise<void>;
  lobbyClips(): Clip[];
  inLobby(): boolean;
  publishLobby(c: Clip): void;
  globalConfigured(): boolean;
  globalList(): Promise<ClipMeta[]>;
  globalGet(id: string): Promise<Clip>;
  globalPublish(c: Clip): Promise<void>;
  globalReport(id: string): Promise<void>;
  /** Tell the player something (a toast). */
  say(text: string): void;
}

/** The media computer in the Hub: play music, watch clips from your lobby and the global feed, edit and publish your own. */
export class MediaScreen extends Screen {
  private page: Page = 'home';
  private tab: Tab = 'mine';
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private dirty = true;
  private list: ClipMeta[] = [];
  private listNote = '';
  private listPage = 0;
  private thumbs = new Map<string, HTMLImageElement>();
  private cur: Clip | null = null;
  private curSource: Tab = 'mine';
  private imgs: HTMLImageElement[] = [];
  private frame = 0;
  private acc = 0;
  private loading = false;
  private note = ''; private noteT = 0;
  // editor state
  private ed = { from: 0, to: 0, reverse: false, filter: 0, caption: 0, fps: 8 };
  private pv = document.createElement('canvas');
  private pg: CanvasRenderingContext2D;
  private t = 0;

  constructor(private h: MediaHost) {
    super(1.0, 1.0 * H / W, W, H);
    this.pv.width = CLIP_W; this.pv.height = CLIP_H; this.pg = this.pv.getContext('2d')!;
    this.build();
  }

  // ---- pointer ----
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
    if (i < 0 || !this.btns[i] || this.btns[i].dim) return i >= 0;
    this.btns[i].act(); this.dirty = true; return true;
  }

  private say(t: string): void { this.note = t; this.noteT = 4; this.dirty = true; }
  private go(p: Page): void { this.page = p; this.hovered.clear(); this.build(); }

  // ---- data ----
  async openList(tab: Tab): Promise<void> {
    this.tab = tab; this.listPage = 0; this.list = []; this.listNote = ''; this.go('list'); this.loading = true;
    try {
      if (tab === 'mine') this.list = (await this.h.mine()).map(metaOf);
      else if (tab === 'lobby') { this.list = this.h.lobbyClips().map(metaOf); if (!this.list.length) this.listNote = this.h.inLobby() ? 'No clips published in this lobby yet' : 'Join a multiplayer lobby to see clips friends publish'; }
      else if (!this.h.globalConfigured()) this.listNote = 'No global feed connected. See HANDOVER.md: run server/feed-server.mjs and open the game with ?feed=URL';
      else { this.list = await this.h.globalList(); if (!this.list.length) this.listNote = 'Nothing published yet. Be the first!'; }
    } catch { this.listNote = tab === 'global' ? 'Could not reach the global feed' : 'Could not load clips'; }
    this.loading = false; this.build(); this.dirty = true;
  }

  private async openClip(meta: ClipMeta, tab: Tab): Promise<void> {
    this.say('Loading...');
    try {
      let clip: Clip | undefined;
      if (tab === 'mine') clip = (await this.h.mine()).find(c => c.id === meta.id);
      else if (tab === 'lobby') clip = this.h.lobbyClips().find(c => c.id === meta.id);
      else clip = await this.h.globalGet(meta.id);
      if (!clip) { this.say('That clip is gone'); return; }
      this.cur = clip; this.curSource = tab; this.imgs = await Promise.all(clip.frames.map(loadImage)); this.frame = 0; this.acc = 0;
      this.ed = { from: 0, to: clip.frames.length, reverse: false, filter: 0, caption: Math.max(0, CAPTIONS.indexOf(clip.caption)), fps: clip.fps };
      this.go('player');
    } catch { this.say('Could not open that clip'); }
  }

  // ---- layout ----
  private build(): void {
    this.dirty = true;
    const b: Btn[] = this.btns = [];
    const back = (to: () => void, x = 24) => b.push({ label: 'BACK', x, y: 440, w: 150, h: 48, act: to });
    switch (this.page) {
      case 'home':
        b.push({ label: 'MUSIC', x: 60, y: 130, w: 320, h: 110, act: () => this.go('music') }, { label: 'WATCH', x: 420, y: 130, w: 320, h: 110, act: () => void this.openList(this.h.inLobby() ? 'lobby' : 'global') },
          { label: 'MY CLIPS', x: 60, y: 270, w: 320, h: 110, act: () => void this.openList('mine') }, { label: this.h.music.playing ? 'MUSIC OFF' : 'MUSIC: NONE', x: 420, y: 270, w: 320, h: 110, dim: !this.h.music.playing, on: this.h.music.playing, act: () => { this.h.music.stop(); this.build(); } });
        break;
      case 'music':
        TRACKS.forEach((t, i) => b.push({ label: this.h.music.current === t.id ? `STOP  ${t.name}` : `PLAY  ${t.name}`, x: 24 + (i % 2) * 388, y: 96 + Math.floor(i / 2) * 84, w: 376, h: 72, on: this.h.music.current === t.id, act: () => { if (this.h.music.current === t.id) this.h.music.stop(); else this.h.music.play(t.id); this.build(); } }));
        b.push({ label: '-', x: 560, y: 360, w: 70, h: 56, act: () => { this.h.music.setVolume(Math.max(0.1, this.h.music.volume - 0.15)); this.dirty = true; } }, { label: '+', x: 700, y: 360, w: 70, h: 56, act: () => { this.h.music.setVolume(Math.min(1, this.h.music.volume + 0.15)); this.dirty = true; } });
        back(() => this.go('home'));
        break;
      case 'list': {
        (['lobby', 'global', 'mine'] as Tab[]).forEach((t, i) => b.push({ label: t === 'mine' ? 'MINE' : t.toUpperCase(), x: 24 + i * 128, y: 14, w: 120, h: 44, on: this.tab === t, act: () => void this.openList(t) }));
        this.list.slice(this.listPage * PER_PAGE, (this.listPage + 1) * PER_PAGE).forEach((m, i) => b.push({ label: '', x: 24, y: 76 + i * 112, w: 752, h: 104, act: () => void this.openClip(m, this.tab) }));
        const pages = Math.max(1, Math.ceil(this.list.length / PER_PAGE));
        if (pages > 1) b.push({ label: '<', x: 330, y: 440, w: 70, h: 48, act: () => { this.listPage = (this.listPage + pages - 1) % pages; this.build(); } }, { label: '>', x: 410, y: 440, w: 70, h: 48, act: () => { this.listPage = (this.listPage + 1) % pages; this.build(); } });
        if (this.tab === 'global') b.push({ label: 'REFRESH', x: 620, y: 440, w: 156, h: 48, act: () => void this.openList('global') });
        back(() => this.go('home'));
        break;
      }
      case 'player': {
        const c = this.cur!, mine = this.curSource === 'mine';
        back(() => { this.go('list'); });
        if (mine) {
          b.push({ label: 'EDIT', x: 190, y: 440, w: 120, h: 48, act: () => this.go('edit') },
            { label: 'TO LOBBY', x: 322, y: 440, w: 150, h: 48, dim: !this.h.inLobby(), act: () => { this.h.publishLobby(c); this.say('Shared with your lobby'); this.h.say('Clip shared with the lobby'); } },
            { label: 'GLOBAL', x: 484, y: 440, w: 130, h: 48, dim: !this.h.globalConfigured(), act: () => void this.publishGlobal(c) },
            { label: 'DELETE', x: 626, y: 440, w: 150, h: 48, danger: true, act: () => { void this.h.deleteClip(c.id).then(() => this.openList('mine')); } });
        } else {
          b.push({ label: 'SAVE COPY', x: 190, y: 440, w: 160, h: 48, act: () => { void this.h.saveClip({ ...c, id: newId(), source: 'mine' }).then(() => this.say('Saved to MY CLIPS')); } });
          if (this.curSource === 'global') b.push({ label: 'REPORT', x: 626, y: 440, w: 150, h: 48, danger: true, act: () => { void this.h.globalReport(c.id).then(() => this.say('Reported, thanks')); } });
        }
        break;
      }
      case 'edit': {
        const e = this.ed, n = this.cur!.frames.length, step = Math.max(1, Math.round(this.cur!.fps)), row = (y: number, dec: () => void, inc: () => void) => b.push({ label: '-', x: 560, y, w: 56, h: 44, act: dec }, { label: '+', x: 720, y, w: 56, h: 44, act: inc });
        const cyc = (len: number, v: number, d: number) => (v + d + len) % len;
        row(70, () => { e.from = Math.max(0, e.from - step); this.dirty = true; }, () => { e.from = Math.min(e.to - 1, e.from + step); this.dirty = true; });
        row(120, () => { e.to = Math.max(e.from + 1, e.to - step); this.dirty = true; }, () => { e.to = Math.min(n, e.to + step); this.dirty = true; });
        b.push({ label: e.reverse ? 'REVERSED' : 'REVERSE', x: 520, y: 172, w: 256, h: 44, on: e.reverse, act: () => { e.reverse = !e.reverse; this.build(); } });
        row(226, () => { e.filter = cyc(FILTERS.length, e.filter, -1); this.dirty = true; }, () => { e.filter = cyc(FILTERS.length, e.filter, 1); this.dirty = true; });
        row(276, () => { e.caption = cyc(CAPTIONS.length, e.caption, -1); this.dirty = true; }, () => { e.caption = cyc(CAPTIONS.length, e.caption, 1); this.dirty = true; });
        row(326, () => { e.fps = Math.max(4, e.fps / 2); this.dirty = true; }, () => { e.fps = Math.min(16, e.fps * 2); this.dirty = true; });
        b.push({ label: 'SAVE AS NEW', x: 520, y: 384, w: 256, h: 48, act: () => void this.saveEdit() });
        back(() => this.go('player'));
        break;
      }
    }
  }

  private async publishGlobal(c: Clip): Promise<void> {
    this.say('Publishing...');
    try { await this.h.globalPublish(c); this.say('Published to the global feed!'); this.h.say('Your clip is on the global feed'); }
    catch { this.say('Could not publish (is the feed server up? too many clips this hour?)'); }
  }

  private async saveEdit(): Promise<void> {
    const c = this.cur!, e = this.ed; this.say('Rendering...');
    const frames = await editFrames(c, { from: e.from, to: e.to, reverse: e.reverse, filter: FILTERS[e.filter].id as FilterId, caption: CAPTIONS[e.caption] });
    const w = this.h.me();
    const out: Clip = { id: newId(), author: w.name, color: w.color, title: `${w.name}'s edit`, caption: CAPTIONS[e.caption], fps: e.fps, created: Date.now(), frames, source: 'mine' };
    await this.h.saveClip(out); this.say('Saved as a new clip: see MY CLIPS'); this.h.say('Edit saved to MY CLIPS');
  }

  // ---- per frame ----
  update(dt: number): void {
    this.t += dt;
    if (this.noteT > 0 && (this.noteT -= dt) <= 0) { this.note = ''; this.dirty = true; }
    if ((this.page === 'player' || this.page === 'edit') && this.imgs.length) {
      this.acc += dt;
      const fps = this.page === 'edit' ? this.ed.fps : this.cur!.fps;
      while (this.acc >= 1 / fps) { this.acc -= 1 / fps; this.frame++; this.dirty = true; }
    }
    if (this.dirty) this.draw();
  }

  private drawFrame(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    if (!this.imgs.length) return;
    let from = 0, to = this.imgs.length, rev = false, filter: FilterId = 'none', caption = this.cur!.caption;
    if (this.page === 'edit') { from = this.ed.from; to = this.ed.to; rev = this.ed.reverse; filter = FILTERS[this.ed.filter].id; caption = CAPTIONS[this.ed.caption]; }
    const count = Math.max(1, to - from), i = this.frame % count, src = rev ? to - 1 - i : from + i;
    this.pg.drawImage(this.imgs[Math.min(src, this.imgs.length - 1)], 0, 0, CLIP_W, CLIP_H);
    if (this.page === 'edit') { applyFilter(this.pg, CLIP_W, CLIP_H, filter, this.t); if (caption !== this.cur!.caption) drawCaption(this.pg, CLIP_W, CLIP_H, caption); }
    ctx.drawImage(this.pv, x, y, w, h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  }

  private thumb(m: ClipMeta): HTMLImageElement | null {
    const t = this.thumbs.get(m.id);
    if (t) return t.complete && t.naturalWidth ? t : null;
    const img = new Image(); img.onload = () => { this.dirty = true; }; img.src = m.thumb; this.thumbs.set(m.id, img);
    return null;
  }

  private draw(): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.textAlign = 'center'; ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ff7ad8'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, W - 10, H - 10);
    const txt = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => { ctx.textAlign = align; ctx.fillStyle = color; ctx.font = `bold ${size}px monospace`; ctx.fillText(s, x, y); };
    switch (this.page) {
      case 'home':
        txt('MEDIA COMPUTER', W / 2, 76, 44, '#ff7ad8', 'center');
        txt('Music, and videos made with the camera next to me', W / 2, 108, 19, '#9ab', 'center');
        if (this.note) txt(this.note, W / 2, 420, 22, '#7fe3c1', 'center');
        break;
      case 'music':
        txt('MUSIC', 24, 62, 38, '#ff7ad8');
        txt('Plays here in the Hub, and gets quieter as you walk away', 220, 60, 17, '#9ab');
        txt('VOLUME', 560, 350, 18, '#9ab'); txt(`${Math.round(this.h.music.volume * 100)}%`, 665, 396, 28, '#fff', 'center');
        break;
      case 'list': {
        this.list.slice(this.listPage * PER_PAGE, (this.listPage + 1) * PER_PAGE).forEach((m, i) => {
          const y = 76 + i * 112, t = this.thumb(m);
          ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(24, y, 752, 104);
          if (t) ctx.drawImage(t, 34, y + 8, 160, 88); else { ctx.fillStyle = '#1c2a4a'; ctx.fillRect(34, y + 8, 160, 88); }
          txt(m.title, 212, y + 36, 26, '#fff');
          ctx.fillStyle = '#' + m.color.toString(16).padStart(6, '0'); ctx.fillRect(212, y + 50, 14, 14);
          txt(`${m.author}   ${(m.frameCount / m.fps).toFixed(1)} s${m.caption ? `   "${m.caption}"` : ''}`, 234, y + 63, 18, '#9ab');
          txt(new Date(m.created).toLocaleDateString(), 212, y + 90, 16, '#7a8aa0');
        });
        if (!this.list.length) txt(this.loading ? 'Loading...' : this.listNote || 'Nothing here yet', W / 2, 220, 22, '#9ab', 'center');
        const pages = Math.max(1, Math.ceil(this.list.length / PER_PAGE));
        if (pages > 1) txt(`${this.listPage + 1}/${pages}`, 404, 432, 18, '#9ab', 'center');
        if (this.note) txt(this.note, W / 2, 430, 20, '#7fe3c1', 'center');
        break;
      }
      case 'player': {
        const c = this.cur!;
        this.drawFrame(24, 24, 480, 270);
        txt(c.title, 524, 56, 26, '#fff'); txt(`by ${c.author}`, 524, 88, 20, '#9ab'); txt(`${(c.frames.length / c.fps).toFixed(1)} seconds`, 524, 116, 18, '#9ab');
        txt(this.curSource === 'mine' ? 'YOURS' : this.curSource === 'lobby' ? 'FROM YOUR LOBBY' : 'FROM THE GLOBAL FEED', 524, 150, 18, '#ff7ad8');
        if (c.caption) txt(`"${c.caption}"`, 524, 180, 20, '#ffd23a');
        txt(this.note || (this.curSource === 'mine' ? 'EDIT changes it, TO LOBBY / GLOBAL shares it' : ''), W / 2, 424, 18, '#7fe3c1', 'center');
        break;
      }
      case 'edit': {
        const e = this.ed, n = this.cur!.frames.length;
        txt('EDIT', 24, 52, 32, '#ff7ad8');
        this.drawFrame(24, 70, 480, 270);
        const label = (s: string, y: number) => { txt(s, 520, y + 28, 18, '#d8e8f0'); };
        label('', 0);
        txt(`START ${(e.from / this.cur!.fps).toFixed(0)}s`, 584, 100, 18, '#d8e8f0', 'center'); txt(`END ${(e.to / this.cur!.fps).toFixed(0)}s`, 668, 150, 18, '#d8e8f0', 'center');
        txt(FILTERS[e.filter].name, 668, 256, 20, '#fff', 'center'); txt(CAPTIONS[e.caption] ? `"${CAPTIONS[e.caption]}"` : 'NO CAPTION', 668, 306, 18, '#fff', 'center');
        txt(`SPEED x${e.fps / 8}`, 668, 356, 20, '#fff', 'center');
        txt(`${e.to - e.from} of ${n} frames`, 24, 372, 18, '#9ab');
        if (this.note) txt(this.note, 24, 420, 20, '#7fe3c1');
        break;
      }
    }
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      if (!b.label && this.page !== 'list') return;
      if (this.page === 'list' && !b.label) { if (hov.has(i)) { ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4; ctx.strokeRect(b.x, b.y, b.w, b.h); } return; }
      ctx.fillStyle = b.dim ? '#141a2a' : hov.has(i) ? '#ffb347' : b.on ? '#2f7a4a' : b.danger ? '#4a1c22' : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ff7ad8'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.dim ? '#4a5568' : hov.has(i) ? '#10131f' : '#fff'; let fs = b.h > 90 ? 40 : b.h > 60 ? 28 : 22; ctx.font = `bold ${fs}px monospace`;
      while (fs > 12 && ctx.measureText(b.label).width > b.w - 14) { fs--; ctx.font = `bold ${fs}px monospace`; }
      ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + fs * 0.35);
    });
    ctx.textAlign = 'start';
    this.refresh();
  }
}
