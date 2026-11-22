import { Screen } from './Screen';

export interface Telemetry { speed: number; height: number; touching: number; gravityG: number; }

export class TelemetryScreen extends Screen {
  private acc = 0;
  constructor() { super(1.6, 1.0, 512); }

  update(dt: number, t: Telemetry): void {
    this.acc += dt;
    if (this.acc < 0.1) return; // ~10 Hz is plenty
    this.acc = 0;
    const { ctx, canvas: c } = this;
    ctx.fillStyle = '#04121a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#2ee6a6'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
    ctx.fillStyle = '#2ee6a6'; ctx.font = 'bold 34px monospace';
    ctx.fillText('TELEMETRY', 28, 56);
    ctx.font = '30px monospace'; ctx.fillStyle = '#bff';
    const rows = [
      `SPEED   ${t.speed.toFixed(1).padStart(5)} m/s`,
      `HEIGHT  ${t.height.toFixed(1).padStart(5)} m`,
      `HANDS   ${t.touching}/2 in contact`,
      `GRAVITY ${t.gravityG.toFixed(2)} g`,
    ];
    rows.forEach((r, i) => ctx.fillText(r, 28, 120 + i * 52));
    // speed bar
    ctx.fillStyle = '#123'; ctx.fillRect(28, 340, 456, 26);
    ctx.fillStyle = '#2ee6a6'; ctx.fillRect(28, 340, 456 * Math.min(t.speed / 8, 1), 26);
    this.refresh();
  }
}
