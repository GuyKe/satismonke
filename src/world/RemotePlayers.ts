import * as THREE from 'three';
import type { PlayerInfo, Pose } from '../net/Multiplayer';
import { disposeObject } from '../util/dispose';
import { PlayerModel } from './PlayerModel';

class Avatar {
  readonly model: PlayerModel;
  readonly info: PlayerInfo;
  readonly tag: THREE.Sprite;
  readonly head = new THREE.Vector3(); readonly q = new THREE.Quaternion(); readonly l = new THREE.Vector3(); readonly r = new THREE.Vector3();
  readonly target = { head: new THREE.Vector3(), q: new THREE.Quaternion(), l: new THREE.Vector3(), r: new THREE.Vector3() };
  seen = false;
  private e = new THREE.Euler();

  constructor(info: PlayerInfo) {
    this.info = info;
    this.model = new PlayerModel(info.color, { suit: info.look?.suit, hat: info.look?.hat, badge: info.look?.badge });
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!; g.fillStyle = 'rgba(8,12,24,0.7)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = 'bold 28px monospace'; g.textAlign = 'center'; g.fillText(info.name, 128, 42);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.tag.scale.set(0.6, 0.15, 1); this.tag.renderOrder = 10;
    this.model.group.add(this.tag);
    this.model.visible = false;
  }

  setMouth(loud: number): void { this.model.setMouth(loud); }
  private disguise: THREE.Object3D | null = null; private groundY: ((x: number, z: number) => number) | null = null;
  key: string | null = null;
  get disguised(): boolean { return this.key !== null; }
  setDisguise(key: string | null, d: { prop: THREE.Object3D; groundY: (x: number, z: number) => number } | null): void {
    this.key = key;
    if (this.disguise) { this.disguise.parent?.remove(this.disguise); this.disguise = null; }
    this.groundY = null;
    if (d) { this.disguise = d.prop; this.groundY = d.groundY; this.group().add(d.prop); }
    this.model.visible = key === null && this.seen; this.tag.visible = key === null;
  }
  private group(): THREE.Object3D { return this.model.group.parent ?? this.model.group; }
  setSpeaking(on: boolean): void { (this.tag.material as THREE.SpriteMaterial).color.set(on ? 0x7fffa0 : 0xffffff); this.tag.scale.setScalar(1); this.tag.scale.set(on ? 0.7 : 0.6, on ? 0.175 : 0.15, 1); }

  step(k: number, dt: number): void {
    if (!this.seen) return;
    const t = this.target;
    this.head.lerp(t.head, k); this.q.slerp(t.q, k); this.l.lerp(t.l, k); this.r.lerp(t.r, k);
    this.e.setFromQuaternion(this.q, 'YXZ');
    this.model.setPose(this.head, this.e.y, this.e.x, this.e.z, this.l, this.r, dt);
    this.tag.position.set(this.head.x, this.head.y + 0.42, this.head.z);
    if (this.disguise && this.groundY) { this.disguise.position.set(this.head.x, this.groundY(this.head.x, this.head.z), this.head.z); this.disguise.rotation.y = this.e.y; }
  }
}

/** Other players in the lobby, drawn with the Monke Pioneer model and a name tag. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private avatars = new Map<string, Avatar>();
  private infos = new Map<string, PlayerInfo>();

  setPlayers(list: PlayerInfo[], selfId: string): void {
    this.infos.clear(); for (const p of list) if (p.id !== selfId) this.infos.set(p.id, p);
    for (const id of [...this.avatars.keys()]) if (!this.infos.has(id)) this.remove(id);
  }

  pose(id: string, p: Pose): void {
    const info = this.infos.get(id); if (!info || p.length < 13) return;
    let a = this.avatars.get(id);
    if (!a) { a = new Avatar(info); this.avatars.set(id, a); this.group.add(a.model.group); }
    const t = a.target;
    t.head.set(p[0], p[1], p[2]); t.q.set(p[3], p[4], p[5], p[6]).normalize(); t.l.set(p[7], p[8], p[9]); t.r.set(p[10], p[11], p[12]);
    if (!a.seen) { a.seen = true; a.model.visible = !a.disguised; a.head.copy(t.head); a.q.copy(t.q); a.l.copy(t.l); a.r.copy(t.r); }
  }

  remove(id: string): void { const a = this.avatars.get(id); if (!a) return; this.group.remove(a.model.group); disposeObject(a.model.group); this.avatars.delete(id); }
  clear(): void { for (const id of [...this.avatars.keys()]) this.remove(id); this.infos.clear(); }
  /** Where your friends are (for the map). */
  get positions(): { name: string; color: number; x: number; z: number }[] {
    return [...this.avatars.values()].filter(a => a.seen).map(a => ({ name: a.info.name, color: a.info.color, x: a.head.x, z: a.head.z }));
  }
  /** Show a player as something else: a prop (by id) standing on the ground, or hidden. null = as themselves. */
  setDisguise(id: string, key: string | null, make?: () => { prop: THREE.Object3D; groundY: (x: number, z: number) => number }): void {
    const a = this.avatars.get(id); if (!a || a.key === key) return;
    a.setDisguise(key, key && make ? make() : null);
  }
  /** A friend's head position (for voice). */
  headOf(id: string): THREE.Vector3 | null { const a = this.avatars.get(id); return a && a.seen ? a.head : null; }
  /** Open a friend's mouth to match how loud they are (0..1). */
  setMouth(id: string, loud: number): void { this.avatars.get(id)?.setMouth(loud); }
  /** Light up a friend's name tag while they talk. */
  setSpeaking(id: string, on: boolean): void { const a = this.avatars.get(id); if (a) a.setSpeaking(on); }
  get count(): number { return this.avatars.size; }
  update(dt: number): void { const k = 1 - Math.exp(-14 * dt); for (const a of this.avatars.values()) a.step(k, dt); }
}
