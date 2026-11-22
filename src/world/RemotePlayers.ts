import * as THREE from 'three';
import type { PlayerInfo, Pose } from '../net/Multiplayer';
import { disposeObject } from '../util/dispose';

class Avatar {
  readonly group = new THREE.Group();
  readonly head: THREE.Group; readonly hands: THREE.Mesh[];
  readonly target = { head: new THREE.Vector3(), q: new THREE.Quaternion(), l: new THREE.Vector3(), r: new THREE.Vector3() };
  seen = false;

  constructor(info: PlayerInfo) {
    const mat = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.6 });
    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat));
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x10131f, roughness: 0.2, metalness: 0.5 }));
    visor.rotation.x = Math.PI / 2; visor.position.z = -0.05; this.head.add(visor);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 10), mat); torso.position.y = -0.34;
    this.hands = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat));
    this.group.add(this.head, torso, ...this.hands);
    this.torso = torso;
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!; g.fillStyle = 'rgba(8,12,24,0.7)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = 'bold 28px monospace'; g.textAlign = 'center'; g.fillText(info.name, 128, 42);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.tag.scale.set(0.6, 0.15, 1); this.tag.renderOrder = 10;
    this.group.add(this.tag);
    this.group.visible = false;
  }
  torso: THREE.Mesh; tag: THREE.Sprite;

  step(k: number): void {
    const t = this.target;
    if (!this.seen) return;
    this.head.position.lerp(t.head, k); this.head.quaternion.slerp(t.q, k);
    this.hands[0].position.lerp(t.l, k); this.hands[1].position.lerp(t.r, k);
    const e = new THREE.Euler().setFromQuaternion(this.head.quaternion, 'YXZ');
    this.torso.position.set(this.head.position.x, this.head.position.y - 0.34, this.head.position.z);
    this.torso.rotation.set(0, e.y, 0);
    this.tag.position.set(this.head.position.x, this.head.position.y + 0.36, this.head.position.z);
  }
}

/** Other players in the lobby, drawn as a floating head, torso and two hands with a name tag. */
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
    if (!a) { a = new Avatar(info); this.avatars.set(id, a); this.group.add(a.group); }
    const t = a.target;
    t.head.set(p[0], p[1], p[2]); t.q.set(p[3], p[4], p[5], p[6]).normalize(); t.l.set(p[7], p[8], p[9]); t.r.set(p[10], p[11], p[12]);
    if (!a.seen) { a.seen = true; a.group.visible = true; a.head.position.copy(t.head); a.head.quaternion.copy(t.q); a.hands[0].position.copy(t.l); a.hands[1].position.copy(t.r); }
  }

  remove(id: string): void { const a = this.avatars.get(id); if (!a) return; this.group.remove(a.group); disposeObject(a.group); this.avatars.delete(id); }
  clear(): void { for (const id of [...this.avatars.keys()]) this.remove(id); this.infos.clear(); }
  get count(): number { return this.avatars.size; }
  update(dt: number): void { const k = 1 - Math.exp(-14 * dt); for (const a of this.avatars.values()) a.step(k); }
}
