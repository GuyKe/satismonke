export type Phase = 'menu' | 'alarm' | 'crash' | 'dark' | 'title' | 'landing' | 'planet';

const T = { alarm: 7, crash: 0.4, dark: 2, titleIn: 2, titleHold: 1.5, titleOut: 2, landing: 3.5 };
const TITLE = T.titleIn + T.titleHold + T.titleOut;

const smooth = (x: number) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

/** The Play -> alarm -> crash -> title -> planet sequence. Pure timing, no rendering. */
export class Story {
  phase: Phase = 'menu';
  t = 0;

    private skipping = false;

  constructor(private hooks: { onAlarm(): void; onCrash(): void; onLand(): void; onSkip(): void }) {}

  /** B button: from the alarm/crash/dark scenes jump straight to the SATISMONKE title. Capsule only. */
  skipToTitle(): boolean {
    if (this.phase === 'alarm') { this.hooks.onSkip(); this.skipping = true; this.go('crash'); return true; }
    if (this.phase === 'crash') { this.hooks.onSkip(); this.skipping = true; return true; }
    if (this.phase === 'dark') { this.go('title'); return true; }
    return false;
  }

  start(): boolean {
    if (this.phase !== 'menu') return false;
    this.phase = 'alarm'; this.t = 0;
    this.hooks.onAlarm();
    return true;
  }

  private go(p: Phase): void { this.phase = p; this.t = 0; }

  update(dt: number): void {
    this.t += dt;
    switch (this.phase) {
      case 'alarm': if (this.t >= T.alarm) { this.go('crash'); this.hooks.onCrash(); } break;
      case 'crash': if (this.t >= T.crash) { const skip = this.skipping; this.skipping = false; this.go(skip ? 'title' : 'dark'); } break;
      case 'dark': if (this.t >= T.dark) this.go('title'); break;
      case 'title': if (this.t >= TITLE) { this.go('landing'); this.hooks.onLand(); } break;
      case 'landing': if (this.t >= T.landing) this.go('planet'); break;
    }
  }

  get blackAlpha(): number {
    switch (this.phase) {
      case 'crash': return smooth(this.t / T.crash);
      case 'dark': case 'title': return 1;
      case 'landing': return 1 - smooth(this.t / T.landing);
      default: return 0;
    }
  }

  get titleAlpha(): number {
    if (this.phase !== 'title') return 0;
    if (this.t < T.titleIn) return smooth(this.t / T.titleIn);
    if (this.t < T.titleIn + T.titleHold) return 1;
    return 1 - smooth((this.t - T.titleIn - T.titleHold) / T.titleOut);
  }

  /** 0..1 red-alarm strength. */
  get alarm(): number { return this.phase === 'alarm' ? 1 : 0; }

  /** Camera-shake style amplitude in metres for the ship interior. */
  get shake(): number {
    if (this.phase === 'alarm') return 0.004 + 0.02 * Math.pow(this.t / T.alarm, 2);
    if (this.phase === 'crash' && !this.skipping) return 0.12 * (1 - this.t / T.crash);
    return 0;
  }

  /** Engine rumble 0..1. */
  get rumble(): number {
    if (this.phase === 'alarm') return 0.25 + 0.75 * (this.t / T.alarm);
    return 0;
  }
}
