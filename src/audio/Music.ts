import * as THREE from 'three';

/** Songs the computer can play: made on the spot with oscillators (no audio files), looping forever. */
interface Track { id: string; name: string; bpm: number; root: number; scale: number[]; bass: number[]; lead: number[]; drums: string; pad?: boolean; leadWave: OscillatorType; bassWave: OscillatorType }
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], PENT = [0, 3, 5, 7, 10], DOR = [0, 2, 3, 5, 7, 9, 10];

export const TRACKS: Track[] = [
  { id: 'saturn', name: 'SATURN DRIFT', bpm: 72, root: 45, scale: DOR, bass: [0, -1, -1, -1, 4, -1, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1], lead: [7, -1, 9, -1, 11, -1, 9, -1, 7, -1, 4, -1, 2, -1, 4, -1], drums: 'k...............k.......k.......', pad: true, leadWave: 'sine', bassWave: 'triangle' },
  { id: 'funk', name: 'MONKE FUNK', bpm: 104, root: 40, scale: PENT, bass: [0, -1, 0, 2, -1, 0, -1, 3, 0, -1, 0, 2, -1, 4, 3, -1], lead: [4, -1, -1, 3, -1, 2, -1, -1, 4, -1, 3, -1, 2, -1, 0, -1], drums: 'k..hk..hk.s.k.sh', leadWave: 'square', bassWave: 'sawtooth' },
  { id: 'disco', name: 'ALIEN DISCO', bpm: 122, root: 47, scale: MINOR, bass: [0, -1, 0, -1, 0, -1, 0, -1, 3, -1, 3, -1, 2, -1, 2, -1], lead: [0, 2, 4, 2, 7, 4, 2, 4, 0, 2, 4, 7, 9, 7, 4, 2], drums: 'k.h.k.hsk.h.k.hs', leadWave: 'sawtooth', bassWave: 'square' },
  { id: 'night', name: 'NIGHT CRAWL', bpm: 64, root: 41, scale: MINOR, bass: [0, -1, -1, -1, -1, -1, 0, -1, 5, -1, -1, -1, 4, -1, -1, -1], lead: [-1, -1, 7, -1, -1, -1, 6, -1, -1, -1, 4, -1, -1, 3, -1, -1], drums: 'k.......k.......', pad: true, leadWave: 'triangle', bassWave: 'sine' },
  { id: 'pixel', name: 'PIXEL PLAINS', bpm: 138, root: 52, scale: MAJOR, bass: [0, 0, 4, 4, 5, 5, 4, 4, 0, 0, 4, 4, 3, 3, 4, 4], lead: [7, 9, 11, 14, 11, 9, 7, 4, 5, 7, 9, 12, 9, 7, 5, 2], drums: 'k.s.k.s.k.s.k.sk', leadWave: 'square', bassWave: 'triangle' },
  { id: 'lava', name: 'FOUNDRY HUM', bpm: 90, root: 38, scale: PENT, bass: [0, -1, 0, -1, 2, -1, 2, -1, 0, -1, 0, -1, 4, -1, 3, -1], lead: [-1, 2, -1, -1, 4, -1, -1, 3, -1, 2, -1, -1, 0, -1, -1, -1], drums: 'k.h.s.h.k.h.s.hh', leadWave: 'sawtooth', bassWave: 'sawtooth' },
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Plays one track at a spot in the world: it gets quieter and shifts to one side as you walk away. */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private panner: PannerNode | null = null;
  private timer = 0;
  private step = 0;
  private next = 0;
  current: string | null = null;
  /** Called when a player (not a lobby message) starts or stops the music: tell everyone. */
  onChange: ((id: string | null) => void) | null = null;
  volume = 0.7;
  readonly at = new THREE.Vector3();

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx(); this.master = this.ctx.createGain(); this.panner = this.ctx.createPanner();
      this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 2.5; this.panner.maxDistance = 60; this.panner.rolloffFactor = 1.2;
      this.master.connect(this.panner); this.panner.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    return this.ctx;
  }

  play(id: string, silent = false): void {
    const t = TRACKS.find(x => x.id === id); if (!t) return;
    this.stop(true); const ctx = this.ensure();
    this.current = id; this.step = 0; this.next = ctx.currentTime + 0.1;
    this.master!.gain.setValueAtTime(this.volume, ctx.currentTime);
    this.timer = window.setInterval(() => this.schedule(t), 80);
    this.schedule(t);
    if (!silent) this.onChange?.(id);
  }

  stop(silent = false): void { const was = this.current; if (this.timer) clearInterval(this.timer); this.timer = 0; this.current = null; if (!silent && was) this.onChange?.(null); }

  private schedule(t: Track): void {
    const ctx = this.ctx!, spb = 60 / t.bpm / 4;
    while (this.next < ctx.currentTime + 0.35) {
      const s = this.step % 16, when = this.next;
      const note = (deg: number, oct: number) => t.root + 12 * oct + t.scale[((deg % t.scale.length) + t.scale.length) % t.scale.length] + 12 * Math.floor(deg / t.scale.length);
      const tone = (freq: number, wave: OscillatorType, dur: number, gain: number, type = 0) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = wave; o.frequency.setValueAtTime(freq, when);
        g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(gain, when + 0.01 + type * 0.03); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        o.connect(g); g.connect(this.master!); o.start(when); o.stop(when + dur + 0.05);
      };
      const b = t.bass[s]; if (b >= 0) tone(midi(note(b, 0)), t.bassWave, spb * 2.2, 0.22);
      const l = t.lead[s]; if (l >= 0) tone(midi(note(l, 1)), t.leadWave, spb * 1.8, 0.1);
      if (t.pad && s % 8 === 0) for (const d of [0, 2, 4]) tone(midi(note(d, 1) - 12 + 12), 'sine', spb * 7.5, 0.045, 6);
      const d = t.drums[s % t.drums.length];
      if (d !== '.') {
        const len = d === 'k' ? 0.12 : 0.05, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(); src.buffer = buf;
        if (d === 'k') { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(130, when); o.frequency.exponentialRampToValueAtTime(40, when + 0.12); og.gain.setValueAtTime(0.5, when); og.gain.exponentialRampToValueAtTime(0.001, when + 0.14); o.connect(og); og.connect(this.master!); o.start(when); o.stop(when + 0.16); }
        else { f.type = 'highpass'; f.frequency.value = d === 'h' ? 7000 : 2000; g.gain.value = d === 'h' ? 0.12 : 0.22; src.connect(f); f.connect(g); g.connect(this.master!); src.start(when); }
      }
      this.step++; this.next += spb;
    }
  }

  /** Keep the sound where the computer is, and your ears where your head is. Call every frame. */
  update(camera: THREE.Camera, at: THREE.Vector3 | null): void {
    if (!this.ctx || !this.panner) return;
    if (at) { this.at.copy(at); this.panner.positionX.value = at.x; this.panner.positionY.value = at.y; this.panner.positionZ.value = at.z; }
    const l = this.ctx.listener, p = camera.getWorldPosition(new THREE.Vector3()), f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
  }

  setVolume(v: number): void { this.volume = v; if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  get playing(): boolean { return this.current !== null; }
}
