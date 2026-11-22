/** Procedural WebAudio sounds: no asset files. Call ensure() from a user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private alarmNodes: AudioNode[] = [];
  private rumbleGain: GainNode | null = null;
  private windNodes: AudioNode[] = [];

  ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 3;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noiseSource(loop: boolean): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }

  /** Two-tone wailing siren. */
  startAlarm(): void {
    if (!this.ctx || this.alarmNodes.length) return;
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0.22; out.connect(this.master);
    const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 1.3;
    const depth = c.createGain(); depth.gain.value = 260;
    lfo.connect(depth);
    for (const [type, base] of [['square', 760], ['sawtooth', 764]] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = base;
      depth.connect(o.frequency);
      o.connect(out); o.start();
      this.alarmNodes.push(o);
    }
    lfo.start();
    this.alarmNodes.push(lfo, depth, out);
  }

  stopAlarm(): void {
    for (const n of this.alarmNodes) { try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ } n.disconnect(); }
    this.alarmNodes = [];
  }

  /** Low engine rumble that swells; set amount 0..1. */
  rumble(amount: number): void {
    if (!this.ctx) return;
    if (!this.rumbleGain) {
      const c = this.ctx;
      const src = this.noiseSource(true);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
      this.rumbleGain = c.createGain(); this.rumbleGain.gain.value = 0;
      src.connect(lp); lp.connect(this.rumbleGain); this.rumbleGain.connect(this.master);
      src.start();
    }
    this.rumbleGain.gain.setTargetAtTime(amount * 1.4, this.ctx.currentTime, 0.1);
  }

  crash(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.rumble(0);
    // roaring noise burst sweeping down
    const n = this.noiseSource(false);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.2);
    const g = c.createGain(); g.gain.setValueAtTime(1.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    n.connect(lp); lp.connect(g); g.connect(this.master); n.start(t); n.stop(t + 2.8);
    // deep thud
    const th = c.createOscillator(); th.type = 'sine';
    th.frequency.setValueAtTime(95, t); th.frequency.exponentialRampToValueAtTime(24, t + 0.8);
    const tg = c.createGain(); tg.gain.setValueAtTime(1.4, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    th.connect(tg); tg.connect(this.master); th.start(t); th.stop(t + 1.2);
    // tearing metal
    const m = c.createOscillator(); m.type = 'sawtooth';
    m.frequency.setValueAtTime(1500, t); m.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 3;
    const mg = c.createGain(); mg.gain.setValueAtTime(0.35, t); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    m.connect(bp); bp.connect(mg); mg.connect(this.master); m.start(t); m.stop(t + 0.9);
    // scattered debris
    for (let i = 0; i < 12; i++) {
      const at = t + 0.3 + Math.random() * 2;
      const s = this.noiseSource(false);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400 + Math.random() * 3000;
      const dg = c.createGain(); dg.gain.setValueAtTime(0.3, at); dg.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      s.connect(f); f.connect(dg); dg.connect(this.master); s.start(at); s.stop(at + 0.15);
    }
  }

  /** Soft alien wind for the planet. */
  startWind(): void {
    if (!this.ctx || this.windNodes.length) return;
    const c = this.ctx;
    const src = this.noiseSource(true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 450; bp.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = 0.07;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const d = c.createGain(); d.gain.value = 0.04;
    lfo.connect(d); d.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.windNodes.push(src, bp, g, lfo, d);
  }
}
