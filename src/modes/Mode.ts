import type * as THREE from 'three';

export type ModeId = 'propHunt' | 'backrooms' | 'sandbox';

/** What the game hands a mode each frame. */
export interface ModeCtx {
  camera: THREE.Camera;
  head: THREE.Vector3;
  hands: THREE.Vector3[];
  /** Fists swinging (m/s) and whether the grip is held, per hand. */
  handSpeed: number[];
  gripDown: boolean[];
  hurt(amount: number): void;
  toast(text: string, at: THREE.Vector3): void;
  say(key: string): void;
  pickup(): void;
  growl(at: THREE.Vector3): void;
}

/** A game mode other than the story: it owns its world and what the wrist display says. */
export interface Mode {
  readonly id: ModeId;
  hud(): [string, string];
  update(dt: number, ctx: ModeCtx): void;
  dispose(): void;
}
