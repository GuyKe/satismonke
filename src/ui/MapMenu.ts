import * as THREE from 'three';
import { Screen } from './Screen';
import { heightAt, pathMask, PONDS, pondY, WATER_Y } from '../world/Terrain';
import type { Planet } from '../world/Planet';

const W = 640, H = 740;
const MAP = { x: 20, y: 58, s: 600 };
const BUTTONS = [
  { label: '-', x: 20, w: 190 }, { label: '+', x: 225, w: 190 }, { label: 'Close', x: 430, w: 190 },
];
const BTN_Y = 670, BTN_H = 56;
const ZOOMS = [200, 500, 1000, 2000]; // half-width of the map in metres (the last shows the whole world)
const RES = 200;               // terrain sample grid

const lerp = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** Top-down map of the planet, opened with the A button. North (top) is toward the lake (-z). */
export class MapMenu extends Screen {
  private zoom = 1;
  private hovered = new Map<number, number>();
  private base = document.createElement('canvas');
  private baseCtx: CanvasRenderingContext2D;
  private timer = 1;
  private dirty = true;

  constructor(private onClose: () => void) {
    super(1.35, 1.35 * H / W, W, H); // a big map
    this.base.width = this.base.height = RES;
    this.baseCtx = this.base.getContext('2d')!;
  }

  private pick(uv: THREE.Vector2 | null): number {
    if (!uv) return -1;
    const px = uv.x * W, py = (1 - uv.y) * H;
    if (py < BTN_Y || py > BTN_Y + BTN_H) return -1;
    return BUTTONS.findIndex(b => px >= b.x && px <= b.x + b.w);
  }

  hover(pointer: number, uv: THREE.Vector2 | null): boolean {
    const i = this.pick(uv);
    if (i !== (this.hovered.get(pointer) ?? -1)) { this.hovered.set(pointer, i); this.dirty = true; }
    return i >= 0;
  }

  click(pointer: number): boolean {
    const i = this.hovered.get(pointer) ?? -1;
    if (i < 0) return false;
    if (i === 0) this.zoom = Math.min(ZOOMS.length - 1, this.zoom + 1);   // "-" zooms out
    else if (i === 1) this.zoom = Math.max(0, this.zoom - 1);              // "+" zooms in
    else this.onClose();
    this.timer = 1; this.dirty = true;
    return true;
  }

  zoomBy(dir: number): void { this.zoom = THREE.MathUtils.clamp(this.zoom + dir, 0, ZOOMS.length - 1); this.timer = 1; }

  /** Re-render the terrain layer around (px, pz). */
  private renderBase(px: number, pz: number): void {
    const R = ZOOMS[this.zoom];
    const img = this.baseCtx.createImageData(RES, RES);
    const pink = [198, 80, 180], violet = [138, 74, 204], sand = [226, 186, 160], shallow = [90, 214, 230], deep = [20, 80, 120];
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const wx = px + ((i + 0.5) / RES - 0.5) * 2 * R, wz = pz + ((j + 0.5) / RES - 0.5) * 2 * R;
        const h = heightAt(wx, wz);
        let water = h < WATER_Y, depth = clamp01((WATER_Y - h) / 16);
        if (!water) for (const p of PONDS) if (Math.hypot(wx - p.x, wz - p.z) < p.r * 1.1 && h < pondY(p)) { water = true; depth = 0.2; }
        let c: number[];
        if (water) c = lerp(shallow, deep, depth);
        else {
          c = lerp(pink, violet, clamp01((h + 2) / 12));
          if (h < WATER_Y + 1.6) c = lerp(c, sand, 0.8);
          if (pathMask(wx, wz) > 0.5) c = lerp(c, sand, 0.85);
          const shade = 1 + THREE.MathUtils.clamp((heightAt(wx + R / RES, wz) - h) * 0.12, -0.25, 0.25); // light from the west
          c = [c[0] * shade, c[1] * shade, c[2] * shade];
        }
        const k = (j * RES + i) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    this.baseCtx.putImageData(img, 0, 0);
  }

  /** Call every frame while open. (px, pz) = player; (fx, fz) = facing direction. */
  /** Show ore deposits (needs the Ore Scanner). */
  showOre = false;
  /** Friends in your lobby, drawn on the map with their names. */
  friends: { name: string; color: number; x: number; z: number }[] = [];

  update(dt: number, planet: Planet, px: number, pz: number, fx: number, fz: number): void {
    this.timer += dt;
    if (this.timer < 0.25 && !this.dirty) return;
    if (this.timer >= 0.25 || this.dirty) { this.timer = 0; this.dirty = false; this.draw(planet, px, pz, fx, fz); }
  }

  private draw(planet: Planet, px: number, pz: number, fx: number, fz: number): void {
    const ctx = this.ctx, R = ZOOMS[this.zoom], k = MAP.s / (2 * R);
    this.renderBase(px, pz);
    ctx.fillStyle = '#0a0f1f'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.fillStyle = '#ffb347'; ctx.font = 'bold 34px monospace'; ctx.textAlign = 'left';
    ctx.fillText('MAP', 22, 44);
    ctx.font = '20px monospace'; ctx.fillStyle = '#9ab'; ctx.textAlign = 'right';
    ctx.fillText(`${R * 2} m across   N = lake`, W - 22, 42);

    ctx.save();
    ctx.beginPath(); ctx.rect(MAP.x, MAP.y, MAP.s, MAP.s); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, MAP.x, MAP.y, MAP.s, MAP.s);
    const X = (wx: number) => MAP.x + MAP.s / 2 + (wx - px) * k, Y = (wz: number) => MAP.y + MAP.s / 2 + (wz - pz) * k;

    ctx.fillStyle = 'rgba(150,140,160,0.95)';
    for (const [x, z, r] of [...planet.marks.mesas, ...planet.marks.buttes]) { ctx.beginPath(); ctx.arc(X(x), Y(z), Math.max(3, r * k), 0, 7); ctx.fill(); }
    for (const [x, z, r] of planet.marks.spires) { ctx.beginPath(); ctx.arc(X(x), Y(z), Math.max(3, r * k), 0, 7); ctx.fillStyle = '#d8d0e8'; ctx.fill(); }
    ctx.fillStyle = '#6ff0ff';
    for (const [x, z] of planet.marks.crystals) { const sx = X(x), sy = Y(z); ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 4, sy); ctx.lineTo(sx, sy + 6); ctx.lineTo(sx - 4, sy); ctx.fill(); }
    for (const t of planet.trees) { if (t.felled) continue; ctx.fillStyle = t.pine ? '#1f9a7a' : '#46d9b0'; ctx.fillRect(X(t.x) - 2, Y(t.z) - 2, 4, 4); }
    ctx.fillStyle = '#ffffff';
    for (const a of planet.creatures) { if (a.group.visible) ctx.fillRect(X(a.group.position.x) - 1.5, Y(a.group.position.z) - 1.5, 3, 3); }
    if (this.showOre) {
      const col: Record<string, string> = { copper: '#e08a3c', iron: '#8fa6c8', gold: '#ffd23a', plasma: '#d27aff' };
      for (const o of planet.oreMarks) { const sx = X(o.x), sy = Y(o.z); ctx.fillStyle = col[o.type]; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const hub = planet.hub;
    if (hub) { ctx.save(); ctx.translate(X(hub.pose.x), Y(hub.pose.z)); ctx.rotate(-hub.pose.yaw); ctx.fillStyle = '#b8c4d8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; const w = Math.max(8, 12.4 * k), d = Math.max(5, 5.4 * k); ctx.fillRect(-w / 2, -d / 2, w, d); ctx.strokeRect(-w / 2, -d / 2, w, d); ctx.restore(); }
    for (const pr of planet.props) { ctx.fillStyle = pr.kind === 'campfire' ? '#ff8a30' : '#6ff0ff'; ctx.beginPath(); ctx.arc(X(pr.x), Y(pr.z), 5, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    for (const z of planet.zoneMarks) { // hazard zones: yellow = poison cloud, green = radiation
      const sx = X(z.x), sy = Y(z.z), rr = Math.max(5, z.r * k);
      ctx.fillStyle = z.kind === 'poison' ? 'rgba(200,224,64,0.38)' : 'rgba(90,255,106,0.34)'; ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.fill();
      ctx.strokeStyle = z.kind === 'poison' ? '#e8f060' : '#5aff6a'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#10200a'; ctx.font = `bold ${Math.min(26, Math.max(12, rr))}px monospace`; ctx.textAlign = 'center'; ctx.fillText(z.kind === 'poison' ? 'GAS' : 'RAD', sx, sy + 5); ctx.textAlign = 'left';
    }
    for (const st of planet.siteMarks) { const sx = X(st.x), sy = Y(st.z); ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 6, sy + 5); ctx.lineTo(sx - 6, sy + 5); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    const pod = planet.podPosition;
    if (pod) { ctx.fillStyle = '#ff8a30'; ctx.fillRect(X(pod.x) - 6, Y(pod.z) - 6, 12, 12); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(X(pod.x) - 6, Y(pod.z) - 6, 12, 12); }

    // you
    ctx.translate(MAP.x + MAP.s / 2, MAP.y + MAP.s / 2);
    ctx.rotate(Math.atan2(fz, fx));
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-9, 9); ctx.lineTo(-4, 0); ctx.lineTo(-9, -9); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();

    // Hub signal: a pulsing ring on the map, and an arrow on the edge when it is out of view (so you can always find home)
    if (planet.hub) {
      const hx = planet.hub.pose.x, hz = planet.hub.pose.z, dx = hx - px, dz = hz - pz, dist = Math.hypot(dx, dz);
      const sx = MAP.x + MAP.s / 2 + dx * k, sy = MAP.y + MAP.s / 2 + dz * k, inside = Math.abs(sx - (MAP.x + MAP.s / 2)) < MAP.s / 2 - 8 && Math.abs(sy - (MAP.y + MAP.s / 2)) < MAP.s / 2 - 8;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = `rgba(111,232,255,${0.9 - 0.6 * pulse})`;
      if (inside) { ctx.beginPath(); ctx.arc(sx, sy, 12 + pulse * 16, 0, 7); ctx.stroke(); }
      else {
        const cx = MAP.x + MAP.s / 2, cy = MAP.y + MAP.s / 2, e = MAP.s / 2 - 26, s = e / Math.max(Math.abs(dx), Math.abs(dz), 1e-3);
        ctx.translate(cx + dx * s, cy + dz * s); ctx.rotate(Math.atan2(dz, dx));
        ctx.fillStyle = '#6fe8ff'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, 13); ctx.lineTo(-6, 0); ctx.lineTo(-12, -13); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#06323a'; ctx.stroke();
        ctx.rotate(-Math.atan2(dz, dx)); ctx.fillStyle = '#6fe8ff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(`HUB ${Math.round(dist)} m`, 0, dx * s > 0 ? -22 : 34);
      }
      ctx.restore();
    }

    // friends: a coloured dot with their name, or an arrow on the edge pointing toward them when they are off the map
    for (const f of this.friends) {
      const dx = f.x - px, dz = f.z - pz, dist = Math.hypot(dx, dz), cx = MAP.x + MAP.s / 2, cy = MAP.y + MAP.s / 2;
      const sx = cx + dx * k, sy = cy + dz * k, inside = Math.abs(sx - cx) < MAP.s / 2 - 8 && Math.abs(sy - cy) < MAP.s / 2 - 8;
      const col = '#' + f.color.toString(16).padStart(6, '0');
      ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 17px monospace';
      if (inside) {
        ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(8,12,24,0.75)'; const tw = ctx.measureText(f.name).width + 10; ctx.fillRect(sx - tw / 2, sy - 34, tw, 21);
        ctx.fillStyle = '#fff'; ctx.fillText(f.name, sx, sy - 18);
      } else {
        const e = MAP.s / 2 - 26, s = e / Math.max(Math.abs(dx), Math.abs(dz), 1e-3), ang = Math.atan2(dz, dx);
        ctx.translate(cx + dx * s, cy + dz * s); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, 13); ctx.lineTo(-6, 0); ctx.lineTo(-12, -13); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.rotate(-ang); ctx.fillStyle = '#fff'; ctx.fillText(`${f.name} ${Math.round(dist)} m`, dx * s > 0 ? -48 : 48, dz * s > 0 ? -22 : 34);
      }
      ctx.restore();
    }

    // north marker + frame
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
    ctx.fillText('N', MAP.x + MAP.s / 2, MAP.y + 28);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(MAP.x, MAP.y, MAP.s, MAP.s);

    // legend
    ctx.font = '16px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ff8a30'; ctx.fillText('■ pod', MAP.x + 8, MAP.y + MAP.s - 10);
    ctx.fillStyle = '#6ff0ff'; ctx.fillText('◆ crystals', MAP.x + 80, MAP.y + MAP.s - 10);
    ctx.fillStyle = '#46d9b0'; ctx.fillText('■ trees', MAP.x + 205, MAP.y + MAP.s - 10);
    ctx.fillStyle = '#fff'; ctx.fillText('■ creatures', MAP.x + 300, MAP.y + MAP.s - 10);
    ctx.fillStyle = '#ff4a4a'; ctx.fillText('▲ pods', MAP.x + 440, MAP.y + MAP.s - 10);
    ctx.fillStyle = '#e8f060'; ctx.fillText('● hazard', MAP.x + 505, MAP.y + MAP.s - 10);
    if (this.showOre) { ctx.fillStyle = '#ffd23a'; ctx.fillText('● ore', MAP.x + 420, MAP.y + MAP.s - 10); }

    const hov = new Set(this.hovered.values());
    BUTTONS.forEach((b, i) => {
      ctx.fillStyle = hov.has(i) ? '#ffb347' : '#1c2a4a'; ctx.fillRect(b.x, BTN_Y, b.w, BTN_H);
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(b.x, BTN_Y, b.w, BTN_H);
      ctx.fillStyle = hov.has(i) ? '#10131f' : '#fff'; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, BTN_Y + 38);
    });
    ctx.textAlign = 'start';
    this.refresh();
  }
}
