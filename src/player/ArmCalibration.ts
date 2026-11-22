import * as THREE from 'three';
import { Settings, saveSettings } from '../settings';

/** Virtual arm span (hand to hand, arms outstretched) every player is scaled to. */
export const REF_SPAN = 1.7;
const COUNTDOWN = 3;   // seconds to get into position
const SAMPLE = 2;      // seconds measuring the widest span
const SHOULDER_DROP = 0.25;

/**
 * Arm-span scaling. A short calibration measures how far apart the player's hands get with arms
 * outstretched; afterwards all hand offsets from the shoulders are scaled so reach and push
 * leverage are the same for a child and a tall adult.
 */
export class ArmCalibration {
  private state: 'idle' | 'counting' | 'sampling' = 'idle';
  private t = 0;
  private widest = 0;
  private failed = false;

  constructor(private settings: Settings) {}

  get scale(): number {
    const span = this.settings.armSpan > 0 ? this.settings.armSpan : REF_SPAN;
    return THREE.MathUtils.clamp(REF_SPAN / span, 0.6, 1.6);
  }

  start(): void { this.state = 'counting'; this.t = 0; this.widest = 0; this.failed = false; }

  /** Feed raw (unscaled) hand positions each frame while calibrating. */
  update(dt: number, left: THREE.Vector3 | null, right: THREE.Vector3 | null): void {
    if (this.state === 'idle') return;
    this.t += dt;
    if (this.t < COUNTDOWN) return;
    this.state = 'sampling';
    if (left && right) this.widest = Math.max(this.widest, left.distanceTo(right));
    if (this.t >= COUNTDOWN + SAMPLE) {
      this.state = 'idle';
      if (this.widest > 0.8) { this.settings.armSpan = this.widest; saveSettings(this.settings); }
      else this.failed = true; // controllers not tracked or arms not spread
    }
  }

  /** Scale a hand position about the shoulders. `out` may alias nothing else. */
  apply(head: THREE.Vector3, hand: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const sx = head.x, sy = head.y - SHOULDER_DROP, sz = head.z;
    return out.set(
      sx + (hand.x - sx) * this.scale,
      sy + (hand.y - sy) * this.scale,
      sz + (hand.z - sz) * this.scale,
    );
  }

  status(): string {
    if (this.state === 'counting') return `Spread arms wide... ${Math.ceil(COUNTDOWN - this.t)}`;
    if (this.state === 'sampling') return `Hold! ${Math.ceil(COUNTDOWN + SAMPLE - this.t)}`;
    if (this.failed) return 'Calibration failed: try again';
    return this.settings.armSpan > 0
      ? `Arm span ${this.settings.armSpan.toFixed(2)}m  scale x${this.scale.toFixed(2)}`
      : 'Arms not calibrated';
  }
}
