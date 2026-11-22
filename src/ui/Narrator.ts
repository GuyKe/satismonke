import * as THREE from 'three';
import { Screen } from './Screen';

export type Voice = 'vesper' | 'alien';
export interface Line { who: Voice; text: string }

/**
 * Subtitles (and spoken lines where the browser can speak) from VESPER, the cheerful and slightly menacing company
 * assistant, and now and then something older answering from underneath.
 */
export class Narrator {
  readonly panel: Screen;
  private queue: Line[] = [];
  private current: Line | null = null;
  private t = 0;
  private told = new Set<string>();

  constructor(camera: THREE.Object3D, private volume: () => number) {
    this.panel = new Screen(1.6, 0.3, 1024, 192);
    const m = this.panel.mesh;
    (m.material as THREE.MeshBasicMaterial).transparent = true; (m.material as THREE.MeshBasicMaterial).depthTest = false;
    m.position.set(0, -0.42, -1.2); m.renderOrder = 950; m.visible = false; m.frustumCulled = false;
    camera.add(m);
  }

  /** Say these lines once per `key` (so triggers can fire again without repeating the joke). */
  once(key: string, lines: Line[]): void {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.queue.push(...lines);
  }

  clearTold(): void { this.told.clear(); this.queue = []; this.current = null; this.panel.mesh.visible = false; }
  toldKeys(): string[] { return [...this.told]; }
  loadTold(keys: string[]): void { this.told = new Set(keys); }

  private speak(l: Line): void {
    try {
      const synth = window.speechSynthesis;
      if (!synth || this.volume() <= 0) return;
      const u = new SpeechSynthesisUtterance(l.text.replace(/[▒]/g, ''));
      u.volume = this.volume(); u.rate = l.who === 'vesper' ? 1.0 : 0.65; u.pitch = l.who === 'vesper' ? 1.15 : 0.1;
      synth.speak(u);
    } catch { /* no speech available: subtitles only */ }
  }

  private draw(l: Line, fade: number): void {
    const { ctx } = this.panel;
    ctx.clearRect(0, 0, 1024, 192);
    ctx.fillStyle = l.who === 'vesper' ? 'rgba(8,16,28,0.8)' : 'rgba(20,6,30,0.85)'; ctx.fillRect(0, 0, 1024, 192);
    ctx.strokeStyle = l.who === 'vesper' ? '#6fe8ff' : '#c04dff'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 1020, 188);
    ctx.textAlign = 'left'; ctx.font = 'bold 26px monospace';
    ctx.fillStyle = l.who === 'vesper' ? '#6fe8ff' : '#c04dff';
    ctx.fillText(l.who === 'vesper' ? 'VESPER' : '▒▒▒', 24, 40);
    ctx.fillStyle = l.who === 'vesper' ? '#fff' : '#e2b0ff'; ctx.font = '34px monospace';
    const words = l.text.split(' '), rows: string[] = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).length > 46) { rows.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    rows.push(cur);
    rows.slice(0, 3).forEach((r, i) => ctx.fillText(r, 24, 88 + i * 42));
    (this.panel.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
    this.panel.refresh();
  }

  update(dt: number): void {
    if (!this.current) {
      const next = this.queue.shift();
      if (!next) { this.panel.mesh.visible = false; return; }
      this.current = next; this.t = 0; this.panel.mesh.visible = true; this.speak(next);
    }
    this.t += dt;
    const dur = 2.5 + this.current.text.length * 0.055;
    this.draw(this.current, Math.min(1, this.t / 0.3, (dur - this.t) / 0.4));
    if (this.t >= dur) this.current = null;
  }
}

const V = (text: string): Line => ({ who: 'vesper', text });
const A = (text: string): Line => ({ who: 'alien', text });
export const LINES = {
  landed: [V('Welcome to the planet. Halcyon thanks you for your service, and regrets that the pod warranty does not cover crashing.')],
  podSmashed: [V('Salvage logged. Please do not feel bad about the pod. It cannot feel bad about you.')],
  hub: [V('A Hub. Productivity is up four hundred percent, from a baseline of zero.')],
  miner: [V('Your first miner. Please do not name it. Everyone who names them takes it badly.')],
  plates: [V('Plates. The backbone of industry, and several mediocre sandwiches.')],
  trip: [V('Breaker tripped. Statistically, this is the part where you learn about power.')],
  loot: [V('Another pod. Its previous occupants have been reassigned. Permanently.')],
  artifact: [V('Unidentified object. Halcyon advises you not to put it in your mouth.'), A('▒ you carry something of ours ▒')],
  artifact3: [V('That is three. Please stop collecting them, they are starting to collect you.'), A('▒ the lake remembers you ▒')],
  lab: [V('Research lab online. Curiosity is now a billable activity.')],
  sink: [V('Surplus shredded for tokens. Waste not, want not, report not.')],
  build: [V('Foundations. Remember: a building is just a very optimistic floor.')],
  overclock: [V('Overclocking. The machine did not consent, but it lacks a legal department.')],
  beacon: [V('Beacon active. You can now be found, which the pioneer safety handbook calls a feature.')],
} as const;
