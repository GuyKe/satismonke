import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
import * as THREE from 'three';

interface Remote { call: MediaConnection; panner: PannerNode; analyser: AnalyserNode; level: number; el: HTMLAudioElement; buf: Uint8Array }

/**
 * Proximity voice chat over WebRTC (PeerJS media calls, one per pair of players). Each friend's voice comes from where
 * their avatar is: quieter and more to one side the farther and further round they are. If the microphone is denied you
 * can still hear everybody (a silent stream stands in for yours).
 */
export class Voice {
  /** 'off' until started, 'on' / 'muted' with a microphone, 'nomic' if it was denied or unavailable. */
  state: 'off' | 'on' | 'muted' | 'nomic' = 'off';
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private silent: MediaStream | null = null;
  private peer: Peer | null = null;
  private remotes = new Map<string, Remote>();
  private starting = false;
  volume = 1;

  /** Start (or update) voice for this peer and player list. Call from a user gesture the first time (mic prompt). */
  async sync(peer: Peer | null, self: string, others: string[]): Promise<void> {
    if (!peer) return;
    if (this.peer !== peer) { this.stop(); this.peer = peer; peer.on('call', c => this.answer(c)); }
    if (!this.ctx && !this.starting) await this.start();
    for (const id of others) if (id !== self && self < id && !this.remotes.has(id)) this.callOut(id);
    for (const id of [...this.remotes.keys()]) if (!others.includes(id)) this.drop(id);
  }

  private async start(): Promise<void> {
    this.starting = true;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      void this.ctx.resume();
      this.silent = this.ctx.createMediaStreamDestination().stream;
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        this.state = 'on';
      } catch { this.state = 'nomic'; }
    } finally { this.starting = false; }
  }

  private get out(): MediaStream { return this.mic ?? this.silent ?? new MediaStream(); }

  private callOut(id: string): void {
    if (!this.peer || !this.ctx) return;
    const call = this.peer.call(id, this.out);
    this.attach(id, call);
  }

  private async answer(call: MediaConnection): Promise<void> {
    if (!this.ctx && !this.starting) await this.start();
    call.answer(this.out);
    this.attach(call.peer, call);
  }

  private attach(id: string, call: MediaConnection): void {
    this.drop(id);
    call.on('stream', stream => this.play(id, call, stream));
    call.on('close', () => { if (this.remotes.get(id)?.call === call) this.drop(id); });
    call.on('error', () => { if (this.remotes.get(id)?.call === call) this.drop(id); });
  }

  private play(id: string, call: MediaConnection, stream: MediaStream): void {
    if (!this.ctx) return;
    this.remotes.get(id)?.el.remove();
    // Chrome only delivers a remote WebRTC stream into Web Audio if it is also attached to a media element.
    const el = document.createElement('audio'); el.srcObject = stream; el.muted = true; void el.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 1.5; panner.maxDistance = 60; panner.rolloffFactor = 1.4;
    const gain = this.ctx.createGain(); gain.gain.value = this.volume * 1.6;
    const analyser = this.ctx.createAnalyser(); analyser.fftSize = 256;
    src.connect(analyser); src.connect(panner); panner.connect(gain); gain.connect(this.ctx.destination);
    this.remotes.set(id, { call, panner, analyser, level: 0, el, buf: new Uint8Array(analyser.fftSize) });
  }

  private drop(id: string): void {
    const r = this.remotes.get(id); if (!r) return;
    try { r.call.close(); } catch { /* already closed */ }
    r.el.remove(); try { r.panner.disconnect(); } catch { /* ignore */ }
    this.remotes.delete(id);
  }

  /** Mute or unmute your microphone. */
  toggleMute(): void {
    if (!this.mic) return;
    const mute = this.state === 'on';
    this.mic.getAudioTracks().forEach(t => { t.enabled = !mute; });
    this.state = mute ? 'muted' : 'on';
  }

  /** Move each voice to where its player is, and the listener to your head. `headOf` gives a friend's head position. */
  update(camera: THREE.Camera, headOf: (id: string) => THREE.Vector3 | null): void {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = camera.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())), u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z; l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z; }
    for (const [id, r] of this.remotes) {
      const h = headOf(id);
      if (h) { r.panner.positionX.value = h.x; r.panner.positionY.value = h.y; r.panner.positionZ.value = h.z; }
      r.analyser.getByteTimeDomainData(r.buf as Uint8Array<ArrayBuffer>);
      let peak = 0; for (let i = 0; i < r.buf.length; i++) peak = Math.max(peak, Math.abs(r.buf[i] - 128));
      r.level = r.level * 0.8 + (peak / 128) * 0.2;
    }
  }

  /** How loud this friend is, 0..1 (quiet speech ~0.3, shouting 1), for the mouth. */
  loudness(id: string): number { const l = this.remotes.get(id)?.level ?? 0; return l < 0.012 ? 0 : Math.min(1, Math.sqrt((l - 0.012) / 0.2)); }

  /** Is this friend talking right now? */
  speaking(id: string): boolean { return (this.remotes.get(id)?.level ?? 0) > 0.012; }
  get connected(): number { return this.remotes.size; }
  levelOf(id: string): number { return this.remotes.get(id)?.level ?? 0; }

  stop(): void {
    for (const id of [...this.remotes.keys()]) this.drop(id);
    this.mic?.getTracks().forEach(t => t.stop()); this.mic = null; this.silent = null;
    void this.ctx?.close(); this.ctx = null; this.peer = null; this.state = 'off'; this.starting = false;
  }
}
