export interface Settings {
  /** Gravity in multiples of g (0 = zero-g). */
  gravityG: number;
  /** Multiplier applied to body velocity when you let go of a surface. */
  jumpMult: number;
  /** Hard cap on launch speed (m/s). */
  maxSpeed: number;
  /** Show the menu laser pointers all the time instead of only when aimed at the console. */
  laserAlways: boolean;
  /** Calibrated real-world hand-to-hand span in metres (arms outstretched). 0 = not calibrated. */
  armSpan: number;
}

export const GRAVITY_STEPS = [0, 0.15, 0.3, 0.6, 1];
export const JUMP_STEPS = [1.0, 1.1, 1.25, 1.4, 1.6];

const KEY = 'satismonke.settings.v1';

export function defaultSettings(): Settings {
  return { gravityG: 0.3, jumpMult: 1.25, maxSpeed: 8, laserAlways: false, armSpan: 0 };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return s;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
