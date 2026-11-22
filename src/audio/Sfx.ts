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

  stopWind(): void {
    for (const n of this.windNodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* already stopped */ } n.disconnect(); }
    this.windNodes = [];
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

  /** Cut all current sound quickly (used when the crash scene is skipped), then restore the volume. */
  duck(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.03);
    this.master.gain.setTargetAtTime(0.8, t + 0.6, 0.05);
  }

  /** A hard punch into wood: crack + thump. */
  chop(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const th = c.createOscillator(); th.type = 'sine';
    th.frequency.setValueAtTime(150, t); th.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    const tg = c.createGain(); tg.gain.setValueAtTime(1.0, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    th.connect(tg); tg.connect(this.master); th.start(t); th.stop(t + 0.35);
    const n = this.noiseSource(false);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.15);
  }

  /** The tree hitting the ground. */
  thump(pos: { x: number; y: number; z: number }): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const panner = c.createPanner(); panner.panningModel = 'HRTF'; panner.refDistance = 5;
    panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
    panner.connect(this.master);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const g = c.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g); g.connect(panner); o.start(t); o.stop(t + 0.7);
    const n = this.noiseSource(false);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(lp); lp.connect(ng); ng.connect(panner); n.start(t); n.stop(t + 0.55);
  }

  /** Little rising blip when wood is collected. */
  pickup(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const [f, dt] of [[520, 0], [780, 0.07]] as const) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.35, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.2);
      o.connect(g); g.connect(this.master); o.start(t + dt); o.stop(t + dt + 0.25);
    }
  }

  /** Stone being hit. */
  clink(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const f of [1400, 2100]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.08);
      const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.12);
    }
    const n = this.noiseSource(false), bp = c.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 2500;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.4, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.1);
  }

  /** Rock or steel breaking apart. */
  crumble(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource(false), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
    const g = c.createGain(); g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    n.connect(lp); lp.connect(g); g.connect(this.master); n.start(t); n.stop(t + 1.1);
    const th = c.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(110, t); th.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const tg = c.createGain(); tg.gain.setValueAtTime(1.0, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    th.connect(tg); tg.connect(this.master); th.start(t); th.stop(t + 0.55);
  }

  /** Crafting success: rising chime. */
  craft(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    [392, 523, 659, 784].forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); const at = t + i * 0.08;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.3, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      o.connect(g); g.connect(this.master); o.start(at); o.stop(at + 0.4);
    });
  }

  /** Can't do that. */
  fail(): void {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.2);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.25);
  }

  /** Keep the 3D audio listener on the player's head. */
  setListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** A creature roar, synthesized and positioned in 3D. `kind` picks the voice. */
  roar(pos: { x: number; y: number; z: number }, kind: string): void {
    if (!this.ctx) return;
    const v = VOICES[kind] ?? VOICES.longneck;
    const c = this.ctx, t = c.currentTime, end = t + v.dur;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = 6; panner.rolloffFactor = 1.2; panner.maxDistance = 400;
    panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(v.gain, t + Math.min(0.08, v.dur * 0.2));
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    out.connect(panner); panner.connect(this.master);

    // Two formant filters shape the sound into a throat
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = v.form[0]; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = v.form[1]; f2.Q.value = 4;
    const mix = c.createGain(); mix.connect(f1); mix.connect(f2); f1.connect(out); f2.connect(out);

    // Voice: pitch glide + vibrato
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(v.f0, t); o.frequency.exponentialRampToValueAtTime(v.f1, end);
    const vib = c.createOscillator(); vib.frequency.value = 5 + Math.random() * 3;
    const vibAmt = c.createGain(); vibAmt.gain.value = v.f0 * 0.03;
    vib.connect(vibAmt); vibAmt.connect(o.frequency);
    const og = c.createGain(); og.gain.value = 1 - v.noise * 0.6;
    o.connect(og); og.connect(mix);

    // Breath / growl noise
    const n = this.noiseSource(false);
    const ng = c.createGain(); ng.gain.value = v.noise;
    n.connect(ng); ng.connect(mix);

    // Tremolo for rasp
    if (v.trem > 0) {
      const tr = c.createOscillator(); tr.frequency.value = v.trem;
      const trg = c.createGain(); trg.gain.value = 0.45;
      tr.connect(trg); trg.connect(mix.gain); mix.gain.value = 0.55;
      tr.start(t); tr.stop(end + 0.05);
    }
    o.start(t); vib.start(t); n.start(t);
    o.stop(end + 0.05); vib.stop(end + 0.05); n.stop(end + 0.05);
  }
}

interface Voice { f0: number; f1: number; dur: number; noise: number; trem: number; form: [number, number]; gain: number }
const VOICES: Record<string, Voice> = {
  longneck: { f0: 95, f1: 70, dur: 1.8, noise: 0.25, trem: 6, form: [600, 1100], gain: 1.0 },
  stilter: { f0: 380, f1: 170, dur: 1.0, noise: 0.1, trem: 9, form: [900, 1800], gain: 0.8 },
  worm: { f0: 60, f1: 90, dur: 1.2, noise: 0.5, trem: 14, form: [300, 700], gain: 1.0 },
  hopper: { f0: 620, f1: 300, dur: 0.5, noise: 0.15, trem: 0, form: [1200, 2400], gain: 0.7 },
  crawler: { f0: 200, f1: 120, dur: 1.1, noise: 0.9, trem: 30, form: [1500, 3000], gain: 0.9 },
  manta: { f0: 55, f1: 100, dur: 3.0, noise: 0.1, trem: 3, form: [300, 600], gain: 1.2 },
  bird: { f0: 1700, f1: 900, dur: 0.45, noise: 0.1, trem: 0, form: [2500, 3500], gain: 0.6 },
  buzzer: { f0: 300, f1: 360, dur: 0.7, noise: 0.2, trem: 60, form: [800, 1500], gain: 0.5 },
  floater: { f0: 420, f1: 380, dur: 2.2, noise: 0.0, trem: 5, form: [700, 1400], gain: 0.6 },
};
