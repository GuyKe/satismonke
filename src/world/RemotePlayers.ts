import * as THREE from 'three';
import type { PlayerInfo, Pose } from '../net/Multiplayer';
import { disposeObject } from '../util/dispose';
import { PlayerModel } from './PlayerModel';

class Avatar {
  readonly model: PlayerModel;
  readonly tag: THREE.Sprite;
  readonly head = new THREE.Vector3(); readonly q = new THREE.Quaternion(); readonly l = new THREE.Vector3(); readonly r = new THREE.Vector3();
  readonly target = { head: new THREE.Vector3(), q: new THREE.Quaternion(), l: new THREE.Vector3(), r: new THREE.Vector3() };
  seen = false;
  private e = new THREE.Euler();

  constructor(info: PlayerInfo) {
    this.model = new PlayerModel(info.color);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!; g.fillStyle = 'rgba(8,12,24,0.7)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = 'bold 28px monospace'; g.textAlign = 'center'; g.fillText(info.name, 128, 42);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.tag.scale.set(0.6, 0.15, 1); this.tag.renderOrder = 10;
    this.model.group.add(this.tag);
    this.model.visible = false;
  }

  step(k: number, dt: number): void {
    if (!this.seen) return;
    const t = this.target;
    this.head.lerp(t.head, k); this.q.slerp(t.q, k); this.l.lerp(t.l, k); this.r.lerp(t.r, k);
    this.e.setFromQuaternion(this.q, 'YXZ');
    this.model.setPose(this.head, this.e.y, this.e.x, this.e.z, this.l, this.r, dt);
    this.tag.position.set(this.head.x, this.head.y + 0.42, this.head.z);
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
    if (!a.seen) { a.seen = true; a.model.visible = true; a.head.copy(t.head); a.q.copy(t.q); a.l.copy(t.l); a.r.copy(t.r); }
  }

  remove(id: string): void { const a = this.avatars.get(id); if (!a) return; this.group.remove(a.model.group); disposeObject(a.model.group); this.avatars.delete(id); }
  clear(): void { for (const id of [...this.avatars.keys()]) this.remove(id); this.infos.clear(); }
  get count(): number { return this.avatars.size; }
  update(dt: number): void { const k = 1 - Math.exp(-14 * dt); for (const a of this.avatars.values()) a.step(k, dt); }
}
