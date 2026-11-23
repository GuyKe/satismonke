import * as THREE from 'three';
import { Screen } from './Screen';
import { Clip, CLIP_W, CLIP_H, FILTERS, CAPTIONS, applyFilter, drawCaption, toJpeg, newId } from '../media/Clip';

const W = 640, H = 540;
const VF = { x: 80, y: 58, w: 480, h: 270 };
const SPEEDS = [{ name: 'SLOW-MO', capture: 16 }, { name: 'NORMAL', capture: 8 }, { name: 'TIME-LAPSE', capture: 4 }];
const LENGTHS = [8, 12, 15];
const PLAY_FPS = 8;

interface Btn { label: string; x: number; y: number; w: number; h: number; act: () => void; danger?: boolean }

/**
 * The camera's control panel. It shows what the tripod camera sees (rendered into a small off-screen image), lets you
 * choose a filter, speed, length and caption, and records the clip when you press REC: a few seconds of frames that
 * are saved to your clips on the computer.
 */
export class CameraPanel extends Screen {
  private btns: Btn[] = [];
  private hovered = new Map<number, number>();
  private filter = 0; private speed = 1; private length = 0; private caption = 0;
  private state: 'idle' | 'countdown' | 'rec' = 'idle';
  private countdown = 0;
  private frames: string[] = [];
  private acc = 0;
  private dirty = true;
  private status = '';
  private statusT = 0;
  private rt = new THREE.WebGLRenderTarget(CLIP_W, CLIP_H);
  private px = new Uint8Array(CLIP_W * CLIP_H * 4);
  private view = document.createElement('canvas');
  private vg: CanvasRenderingContext2D;
  private tick = 0;

  constructor(
    private who: () => { name: string; color: number },
    private onSaved: (c: Clip) => void,
  ) {
    super(0.8, 0.8 * H / W, W, H);
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.view.width = CLIP_W; this.view.height = CLIP_H; this.vg = this.view.getContext('2d')!;
    this.build();
  }

  get recording(): boolean { return this.state !== 'idle'; }

  private build(): void {
    const cyc = <T,>(arr: T[], i: number, d: number) => (i + d + arr.length) % arr.length;
    this.btns = [
      { label: '<', x: 20, y: 342, w: 64, h: 48, act: () => { this.filter = cyc(FILTERS, this.filter, -1); this.dirty = true; } },
      { label: '>', x: 556, y: 342, w: 64, h: 48, act: () => { this.filter = cyc(FILTERS, this.filter, 1); this.dirty = true; } },
      { label: '<', x: 20, y: 396, w: 64, h: 44, act: () => { this.speed = cyc(SPEEDS, this.speed, -1); this.dirty = true; } },
      { label: '>', x: 276, y: 396, w: 64, h: 44, act: () => { this.speed = cyc(SPEEDS, this.speed, 1); this.dirty = true; } },
      { label: '<', x: 356, y: 396, w: 64, h: 44, act: () => { this.length = cyc(LENGTHS, this.length, -1); this.dirty = true; } },
      { label: '>', x: 556, y: 396, w: 64, h: 44, act: () => { this.length = cyc(LENGTHS, this.length, 1); this.dirty = true; } },
      { label: this.state === 'idle' ? 'REC' : 'STOP', x: 20, y: 456, w: 300, h: 66, danger: true, act: () => (this.state === 'idle' ? this.start() : this.finish()) },
      { label: CAPTIONS[this.caption] ? `"${CAPTIONS[this.caption]}"` : 'NO CAPTION', x: 336, y: 456, w: 284, h: 66, act: () => { this.caption = cyc(CAPTIONS, this.caption, 1); this.build(); this.dirty = true; } },
    ];
  }

  private start(): void { this.state = 'countdown'; this.countdown = 3; this.frames = []; this.acc = 0; this.build(); this.dirty = true; }

  private finish(): void {
    const frames = this.frames; this.frames = []; this.state = 'idle'; this.build(); this.dirty = true;
    if (frames.length < 4) { this.say('Too short: nothing saved'); return; }
    const w = this.who();
    const clip: Clip = { id: newId(), author: w.name, color: w.color, title: `${w.name}'s clip`, caption: CAPTIONS[this.caption], fps: PLAY_FPS, created: Date.now(), frames, source: 'mine' };
    this.say(`Saved: ${(frames.length / PLAY_FPS).toFixed(1)} s. Find it on the computer`);
    this.onSaved(clip);
  }

  private say(t: string): void { this.status = t; this.statusT = 5; this.dirty = true; }

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
    this.btns[i].act(); this.dirty = true; return true;
  }

  /**
   * Call every frame while the panel is in reach. Renders the camera's view when it is time (about 5 times a second,
   * or at the recording rate) into the viewfinder, and adds a frame while recording.
   * `before`/`after` let the game show your full avatar (head included) for the shot.
   */
  update(dt: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, before?: () => void, after?: () => void): void {
    if (this.statusT > 0 && (this.statusT -= dt) <= 0) { this.status = ''; this.dirty = true; }
    this.tick += dt; this.acc += dt;
    if (this.state === 'countdown') {
      this.countdown -= dt; this.dirty = true;
      if (this.countdown <= 0) { this.state = 'rec'; this.acc = 0; this.build(); }
    }
    const rate = this.state === 'rec' ? SPEEDS[this.speed].capture : 5;
    if (this.acc >= 1 / rate) {
      this.acc = 0;
      this.shoot(renderer, scene, cam, before, after);
      if (this.state === 'rec') {
        this.frames.push(toJpeg(this.view));
        if (this.frames.length >= LENGTHS[this.length] * PLAY_FPS) this.finish();
      }
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  private shoot(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, before?: () => void, after?: () => void): void {
    const xr = renderer.xr.enabled, prev = renderer.getRenderTarget();
    renderer.xr.enabled = false; before?.();           // an XR session would swap in the headset's camera
    renderer.setRenderTarget(this.rt); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, CLIP_W, CLIP_H, this.px);
    renderer.setRenderTarget(prev); renderer.xr.enabled = xr; after?.();
    const img = this.vg.createImageData(CLIP_W, CLIP_H);
    for (let y = 0; y < CLIP_H; y++) img.data.set(this.px.subarray((CLIP_H - 1 - y) * CLIP_W * 4, (CLIP_H - y) * CLIP_W * 4), y * CLIP_W * 4);
    this.vg.putImageData(img, 0, 0);
    applyFilter(this.vg, CLIP_W, CLIP_H, FILTERS[this.filter].id, this.tick);
    drawCaption(this.vg, CLIP_W, CLIP_H, CAPTIONS[this.caption]);
  }

  private draw(): void {
    this.dirty = false;
    const { ctx } = this;
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = this.state === 'rec' ? '#ff4040' : '#ffb347'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 32px monospace'; ctx.fillText('CAMERA', 24, 44);
    ctx.drawImage(this.view, VF.x, VF.y, VF.w, VF.h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(VF.x, VF.y, VF.w, VF.h);
    ctx.textAlign = 'right'; ctx.font = 'bold 26px monospace';
    if (this.state === 'rec') { ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(VF.x + VF.w - 150, 44, 10, 0, 7); ctx.fill(); ctx.fillText(`REC ${(this.frames.length / PLAY_FPS).toFixed(1)}s / ${LENGTHS[this.length]}s`, W - 24, 52); }
    else if (this.state === 'countdown') { ctx.fillStyle = '#ffd23a'; ctx.fillText(`GET IN SHOT: ${Math.max(1, Math.ceil(this.countdown))}`, W - 24, 52); }
    else { ctx.fillStyle = '#7a8aa0'; ctx.font = '20px monospace'; ctx.fillText('stand in front of the camera', W - 24, 50); }
    if (this.state === 'countdown') { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 120px monospace'; ctx.fillText(String(Math.max(1, Math.ceil(this.countdown))), VF.x + VF.w / 2, VF.y + VF.h / 2 + 40); }
    // labels between the arrows
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 26px monospace';
    ctx.fillText(`FILTER: ${FILTERS[this.filter].name}`, W / 2, 374);
    ctx.font = 'bold 20px monospace'; ctx.fillText(SPEEDS[this.speed].name, 180, 425); ctx.fillText(`${LENGTHS[this.length]} SECONDS`, 488, 425);
    const hov = new Set(this.hovered.values());
    this.btns.forEach((b, i) => {
      ctx.fillStyle = hov.has(i) ? '#ffb347' : b.danger ? (this.state === 'idle' ? '#7a1c22' : '#c02830') : '#1c2a4a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.danger ? '#ff6a6a' : '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; let fs = b.h > 60 ? 34 : 26; ctx.font = `bold ${fs}px monospace`;
      while (fs > 12 && ctx.measureText(b.label).width > b.w - 14) { fs--; ctx.font = `bold ${fs}px monospace`; }
      ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + fs * 0.35);
    });
    if (this.status) { ctx.fillStyle = '#7fe3c1'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center'; ctx.fillText(this.status, W / 2, 536); }
    ctx.textAlign = 'start';
    this.refresh();
  }
}
