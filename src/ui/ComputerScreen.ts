import * as THREE from 'three';
import { Screen } from './Screen';

const W = 640, H = 400;
type Mode = 'menu' | 'pong' | 'snake' | 'whack' | 'over';

/** The Hub computer: a tiny arcade. Point the laser at the screen; trigger = click. */
export class ComputerScreen extends Screen {
  private mode: Mode = 'menu';
  private pointer = new Map<number, THREE.Vector2>();
  private lastGame: Mode = 'pong';
  private score = 0;
  private message = '';
  private acc = 0;
  private time = 0;
  // pong
  private ball = { x: 320, y: 200, vx: 260, vy: 140 };
  private pad = 200; private ai = 200; private pScore = 0; private aScore = 0;
  // snake
  private snake: [number, number][] = []; private dir: [number, number] = [1, 0]; private apple: [number, number] = [8, 5]; private step = 0;
  // whack
  private targets: { x: number; y: number; life: number }[] = []; private spawn = 0; private left = 30;

  constructor(private onPlay: () => void) { super(0.9, 0.9 * H / W, W, H); this.draw(); }

  private cursor(): { x: number; y: number } | null {
    for (const uv of this.pointer.values()) return { x: uv.x * W, y: (1 - uv.y) * H };
    return null;
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    if (uv) this.pointer.set(pointer, uv); else this.pointer.delete(pointer);
    return !!uv;
  }

  private buttons = [
    { label: 'PONG', mode: 'pong' as Mode, x: 60, y: 120, w: 240, h: 90 }, { label: 'SNAKE', mode: 'snake' as Mode, x: 340, y: 120, w: 240, h: 90 },
    { label: 'WHACK', mode: 'whack' as Mode, x: 60, y: 235, w: 240, h: 90 }, { label: 'RANDOM', mode: 'menu' as Mode, x: 340, y: 235, w: 240, h: 90 },
  ];

  click(pointer: number): boolean {
    const uv = this.pointer.get(pointer);
    if (!uv) return false;
    const x = uv.x * W, y = (1 - uv.y) * H;
    if (this.mode === 'menu') {
      const b = this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (!b) return true;
      this.start(b.label === 'RANDOM' ? (['pong', 'snake', 'whack'] as Mode[])[Math.floor(Math.random() * 3)] : b.mode);
    } else if (this.mode === 'over') this.mode = 'menu';
    else if (this.mode === 'whack') {
      const hit = this.targets.findIndex(t => Math.hypot(t.x - x, t.y - y) < 34);
      if (hit >= 0) { this.targets.splice(hit, 1); this.score++; }
      else if (x > W - 120 && y < 50) this.mode = 'menu';
    } else if (x > W - 120 && y < 50) this.mode = 'menu';
    return true;
  }

  private start(m: Mode): void {
    this.mode = m; this.lastGame = m; this.score = 0; this.onPlay();
    if (m === 'pong') { this.ball = { x: 320, y: 200, vx: 260 * (Math.random() > 0.5 ? 1 : -1), vy: 120 }; this.pScore = this.aScore = 0; }
    if (m === 'snake') { this.snake = [[4, 5], [3, 5], [2, 5]]; this.dir = [1, 0]; this.apple = [10, 5]; this.step = 0; }
    if (m === 'whack') { this.targets = []; this.left = 30; this.spawn = 0; }
  }

  update(dt: number): void {
    this.time += dt; this.acc += dt;
    const cur = this.cursor();
    if (this.mode === 'pong') this.tickPong(dt, cur);
    if (this.mode === 'snake') this.tickSnake(dt, cur);
    if (this.mode === 'whack') this.tickWhack(dt);
    if (this.acc > 0.04 || this.mode === 'menu') { this.acc = 0; this.draw(); }
  }

  private tickPong(dt: number, cur: { x: number; y: number } | null): void {
    const b = this.ball;
    if (cur) this.pad += (Math.min(Math.max(cur.y, 40), H - 40) - this.pad) * Math.min(1, dt * 14);
    this.ai += Math.sign(b.y - this.ai) * Math.min(Math.abs(b.y - this.ai), 170 * dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 10 || b.y > H - 10) b.vy = -b.vy;
    if (b.x < 40 && Math.abs(b.y - this.pad) < 46 && b.vx < 0) { b.vx = -b.vx * 1.06; b.vy += (b.y - this.pad) * 3; }
    if (b.x > W - 40 && Math.abs(b.y - this.ai) < 46 && b.vx > 0) b.vx = -b.vx * 1.02;
    if (b.x < 0 || b.x > W) {
      if (b.x < 0) this.aScore++; else this.pScore++;
      this.ball = { x: 320, y: 200, vx: 260 * (b.x < 0 ? 1 : -1), vy: 120 };
      if (this.pScore >= 5 || this.aScore >= 5) { this.message = this.pScore >= 5 ? 'YOU WIN!' : 'AI WINS'; this.mode = 'over'; }
    }
  }

  private tickSnake(dt: number, cur: { x: number; y: number } | null): void {
    this.step += dt;
    const head = this.snake[0];
    if (cur) { // steer toward the pointer along the dominant axis, never straight back
      const dx = cur.x / 40 - head[0] - 0.5, dy = cur.y / 40 - head[1] - 0.5;
      const want: [number, number] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
      if (want[0] !== -this.dir[0] || want[1] !== -this.dir[1]) if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) this.dir = want;
    }
    if (this.step < 0.13) return;
    this.step = 0;
    const nx = head[0] + this.dir[0], ny = head[1] + this.dir[1];
    if (nx < 0 || ny < 0 || nx >= 16 || ny >= 10 || this.snake.some(s => s[0] === nx && s[1] === ny)) { this.message = `GAME OVER  ${this.score}`; this.mode = 'over'; return; }
    this.snake.unshift([nx, ny]);
    if (nx === this.apple[0] && ny === this.apple[1]) { this.score++; this.apple = [Math.floor(Math.random() * 16), Math.floor(Math.random() * 10)]; }
    else this.snake.pop();
  }

  private tickWhack(dt: number): void {
    this.left -= dt; this.spawn -= dt;
    if (this.spawn <= 0) { this.targets.push({ x: 60 + Math.random() * (W - 120), y: 80 + Math.random() * (H - 120), life: 1.3 }); this.spawn = 0.5; }
    this.targets.forEach(t => (t.life -= dt));
    this.targets = this.targets.filter(t => t.life > 0);
    if (this.left <= 0) { this.message = `TIME!  ${this.score} hits`; this.mode = 'over'; }
  }

  private draw(): void {
    const { ctx } = this, cur = this.cursor();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#05110d'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2ee6a6'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, W - 8, H - 8);
    if (this.mode === 'menu') {
      ctx.fillStyle = '#2ee6a6'; ctx.font = 'bold 44px monospace'; ctx.fillText('HUB-OS ARCADE', W / 2, 75);
      for (const b of this.buttons) {
        const hot = cur && cur.x >= b.x && cur.x <= b.x + b.w && cur.y >= b.y && cur.y <= b.y + b.h;
        ctx.fillStyle = hot ? '#2ee6a6' : '#0d2a22'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#2ee6a6'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = hot ? '#05110d' : '#bff'; ctx.font = 'bold 36px monospace'; ctx.fillText(b.label, b.x + b.w / 2, b.y + 58);
      }
      ctx.fillStyle = '#6a9'; ctx.font = '20px monospace'; ctx.fillText('point + trigger', W / 2, 372);
    } else {
      ctx.fillStyle = '#bff'; ctx.font = 'bold 26px monospace';
      if (this.mode === 'pong') {
        ctx.fillRect(20, this.pad - 40, 12, 80); ctx.fillRect(W - 32, this.ai - 40, 12, 80); ctx.fillRect(this.ball.x - 8, this.ball.y - 8, 16, 16);
        for (let y = 10; y < H; y += 30) ctx.fillRect(W / 2 - 2, y, 4, 16);
        ctx.fillText(`${this.pScore}   ${this.aScore}`, W / 2, 40);
      } else if (this.mode === 'snake') {
        ctx.fillStyle = '#ff6a6a'; ctx.fillRect(this.apple[0] * 40 + 8, this.apple[1] * 40 + 8, 24, 24);
        this.snake.forEach((s, i) => { ctx.fillStyle = i ? '#2ee6a6' : '#fff'; ctx.fillRect(s[0] * 40 + 3, s[1] * 40 + 3, 34, 34); });
        ctx.fillStyle = '#bff'; ctx.fillText(String(this.score), 40, 36);
      } else if (this.mode === 'whack') {
        for (const t of this.targets) { ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(t.x, t.y, 30 * Math.min(1, t.life * 3), 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#bff'; ctx.fillText(`${this.score}   ${Math.ceil(this.left)}s`, W / 2, 40);
      } else if (this.mode === 'over') {
        ctx.fillStyle = '#ffb347'; ctx.font = 'bold 54px monospace'; ctx.fillText(this.message, W / 2, 180);
        ctx.fillStyle = '#bff'; ctx.font = '24px monospace'; ctx.fillText('click to continue', W / 2, 240);
      }
      if (this.mode !== 'over') { ctx.fillStyle = '#12382e'; ctx.fillRect(W - 120, 8, 110, 38); ctx.fillStyle = '#bff'; ctx.font = '20px monospace'; ctx.fillText('MENU', W - 65, 34); }
    }
    if (cur) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cur.x, cur.y, 6, 0, 7); ctx.fill(); }
    ctx.textAlign = 'start';
    this.refresh();
  }
}
