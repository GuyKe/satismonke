/**
 * Environmental hazards and the player's health. Pure logic so it can be tested in node.
 *
 * Poison clouds hurt unless you wear a Gas Mask. Radiation zones hurt unless you wear a Hazmat Suit
 * (a mask alone halves it). Landing hard hurts too, and Blade Runners soften that.
 */
export interface Zone { kind: 'poison' | 'radiation'; x: number; z: number; r: number }
export interface Gear { mask: boolean; hazmat: boolean; boots: boolean }

export const MAX_HP = 100;
export const SAFE_LANDING = 10;   // m/s you can land at without a scratch
export const POISON_DPS = 12;
export const RADIATION_DPS = 20;

/** Which hazards is a point inside? */
export function exposure(zones: readonly Zone[], x: number, z: number): { poison: boolean; radiation: boolean } {
  let poison = false, radiation = false;
  for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) { if (zn.kind === 'poison') poison = true; else radiation = true; }
  return { poison, radiation };
}

/** Damage per second for the current exposure and gear. */
export function damagePerSecond(e: { poison: boolean; radiation: boolean }, g: Gear): number {
  let d = 0;
  if (e.poison && !g.mask) d += POISON_DPS;
  if (e.radiation && !g.hazmat) d += g.mask ? RADIATION_DPS * 0.5 : RADIATION_DPS;
  return d;
}

/** Damage from landing at `speed` m/s. */
export function fallDamage(speed: number, g: Gear): number {
  const v = Math.max(0, speed - SAFE_LANDING);
  return v * v * 0.6 * (g.boots ? 0.2 : 1);
}

export class Health {
  hp = MAX_HP;
  /** 0..1 how recently we were hurt (for the red flash). */
  flash = 0;
  private safe = 0;

  /** Returns true if this call killed the player. */
  update(dt: number, dps: number): boolean {
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (dps > 0) { this.hurt(dps * dt, false); this.safe = 0; }
    else { this.safe += dt; if (this.safe > 4 && this.hp < MAX_HP) this.hp = Math.min(MAX_HP, this.hp + 6 * dt); }
    return this.hp <= 0;
  }

  hurt(n: number, flash = true): void { this.hp = Math.max(0, this.hp - n); this.safe = 0; if (flash) this.flash = Math.min(1, 0.5 + n / 40); else this.flash = Math.max(this.flash, 0.25); }
  reset(): void { this.hp = MAX_HP; this.flash = 0; this.safe = 0; }
}
