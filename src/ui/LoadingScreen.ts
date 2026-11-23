import * as THREE from 'three';
import { Screen } from './Screen';
import { PlayerModel } from '../world/PlayerModel';

/** Ordinary tips, and a few rare ones that turn up now and then. */
export const TIPS: string[] = [
  'Push off surfaces with your hands to move: there are no legs and no joystick.',
  'Hold grip and punch a tree to fell it. Two hits without an axe, one with.',
  'Press X to craft. Your first goal is to destroy your crashed pod and build the Hub.',
  'Press A to open the map. The Hub signal always points you home if you get lost.',
  'Ore rocks come in impure, normal and pure. A pure node mines twice as fast.',
  'No crashed pod? Mine iron and Forge Steel from the X menu: 6 iron and 3 stone make 2 steel.',
  'Machines need power lines: wire a Biomass Burner to a Power Pole, then the pole to your machines.',
  'Power Poles reach 35 metres. Build one close to the Hub and it plugs into the Hub grid by itself.',
  'A burner only burns wood while something is drawing power. Wire it up before you refuel it.',
  'Overloading a power network trips its breaker. Reset it from any machine on that network.',
  'Conveyors only go one way, and cost 1 iron per 5 metres. Plan the spaghetti.',
  'Smart Splitters sort items: tap a slot to cycle its filter, and use Overflow for the leftovers.',
  'The Resource Sink turns anything into tokens, and tokens buy cosmetic colours for your buildings.',
  'Crashed pods hide loot: data drives for research, cores for overclocking, and sometimes artifacts.',
  'Poison clouds need a Gas Mask. Radiation needs a Hazmat Suit. Hard landings need Blade Runners.',
  'Creatures look at you, avoid you and roar now and then. They are curious, not hostile.',
  'A day lasts 7 minutes and a night 5. Solar panels sleep at night; burners and reactors do not.',
  'Foundations, walls and catwalks snap to a grid. Aim at an edge to put a wall there.',
  'Press the menu button for the Find Resources guide: it tells you where every ore lives.',
  'In multiplayer your friends appear on the map, and their voices come from where they stand.',
  'Hosting a lobby? Turn on "Allow saving" and your friends can rejoin the same world later.',
  'Gravity too heavy? The Float Core and the Plasma Core make every jump floatier.',
];

export const RARE_TIPS: string[] = [
  'Yes, this was made with Claude, so what?',
  'The planet\'s real name is Kevin. Please do not tell Halcyon.',
  'Tip: this is not a tip.',
  'VESPER would like you to know she is not sentient. VESPER would also like you to stop asking.',
  'If you can read this, the loading screen is working. Congratulations to everyone involved.',
];

const RARE_CHANCE = 0.06;
export const pickTip = (last = ''): { text: string; rare: boolean } => {
  const rare = Math.random() < RARE_CHANCE;
  const pool = rare ? RARE_TIPS : TIPS;
  let text = pool[Math.floor(Math.random() * pool.length)];
  if (text === last) text = pool[(pool.indexOf(text) + 1) % pool.length];
  return { text, rare };
};

/**
 * A loading screen in its own little scene (so the world never shows through): a picture of your pioneer waving on a
 * dark backdrop, with a tip beside it. It follows your head, so it works in VR and on the desktop.
 */
export class LoadingScreen {
  readonly scene = new THREE.Scene();
  active = false;
  /** Seconds the screen has been up. */
  shownFor = 0;
  private root = new THREE.Group();
  private figure = new THREE.Group();
  private model: PlayerModel;
  private panel = new Screen(1.5, 0.95, 960, 608);
  private tip = { text: '', rare: false };
  private tipT = 0;
  private yaw = 0;
  private t = 0;
  private ctxd = false;

  constructor(color: number) {
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x302040, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-1, 2, 2); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa8ff, 1.2); rim.position.set(2, 1, -2); this.scene.add(rim);
    // stars
    const g = new THREE.BufferGeometry(), pts: number[] = [];
    for (let i = 0; i < 400; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(30); pts.push(v.x, v.y, v.z); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.root.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, sizeAttenuation: true })));
    // a soft glowing plate under the figure
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), new THREE.MeshBasicMaterial({ color: 0x1c2a4a, transparent: true, opacity: 0.8 }));
    plate.rotation.x = -Math.PI / 2; plate.position.set(-0.7, -0.62, -1.9); this.root.add(plate);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0xffb347 })); ring.rotation.x = -Math.PI / 2; ring.position.copy(plate.position).add(new THREE.Vector3(0, 0.002, 0)); this.root.add(ring);
    // the pioneer, standing and waving
    this.model = new PlayerModel(color);
    this.figure.add(this.model.group);
    this.figure.scale.setScalar(1.15); this.figure.position.set(-0.7, -0.02, -1.9);
    this.root.add(this.figure);
    this.panel.mesh.position.set(0.55, 0.05, -1.9); this.root.add(this.panel.mesh);
    this.scene.add(this.root);
  }

  show(): void {
    this.active = true; this.shownFor = 0; this.tip = pickTip(); this.tipT = 0; this.ctxd = false; this.draw();
  }
  hide(): void { this.active = false; }

  /** Move with the head and animate. `camera` is the player's camera. */
  update(dt: number, camera: THREE.Camera): void {
    if (!this.active) return;
    this.t += dt; this.shownFor += dt; this.tipT += dt;
    if (this.tipT > 3.4) { this.tipT = 0; this.tip = pickTip(this.tip.text); this.ctxd = false; this.draw(); }
    camera.updateWorldMatrix(true, false);
    const p = camera.getWorldPosition(new THREE.Vector3()), q = camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0;
    if (fwd.lengthSq() > 1e-4) { const target = Math.atan2(-fwd.x, -fwd.z); let d = target - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; this.yaw += d * Math.min(1, dt * 4); }
    this.root.position.copy(p); this.root.rotation.y = this.yaw;
    // the pioneer sways, turns a little and waves
    this.figure.rotation.y = Math.PI + Math.sin(this.t * 0.6) * 0.4 - 0.2;   // the model faces -z, so turn it to face you
    const wave = Math.sin(this.t * 5);
    this.model.setPose(new THREE.Vector3(0, 0, 0), 0, 0, Math.sin(this.t * 0.9) * 0.06,
      new THREE.Vector3(-0.34 - wave * 0.04, 0.1 + wave * 0.05, -0.08), new THREE.Vector3(0.27, -0.5, -0.05), dt);   // left arm waves, right hangs
    this.model.setMouth(0.15 + 0.1 * Math.max(0, Math.sin(this.t * 2)));
    if (!this.ctxd) this.draw();
    this.panel.refresh();
  }

  private draw(): void {
    this.ctxd = true;
    const { ctx } = this.panel, W = 960, H = 608;
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = this.tip.rare ? '#7fe3c1' : '#ffb347'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffb347'; ctx.font = 'bold 56px monospace'; ctx.fillText('SATISMONKE', 44, 96);
    ctx.fillStyle = '#7a8aa0'; ctx.font = 'bold 26px monospace'; ctx.fillText(this.tip.rare ? 'RARE TIP' : 'TIP', 44, 168);
    ctx.fillStyle = '#e8f0fa'; ctx.font = '36px monospace';
    const words = this.tip.text.split(' '), lines: string[] = []; let line = '';
    for (const w of words) { if (ctx.measureText(line + w).width > W - 100 && line) { lines.push(line.trim()); line = ''; } line += w + ' '; }
    lines.push(line.trim());
    lines.slice(0, 7).forEach((l, i) => ctx.fillText(l, 44, 232 + i * 52));
    const dots = '.'.repeat(1 + Math.floor(this.t * 2) % 3);
    ctx.fillStyle = '#9ab'; ctx.font = 'bold 30px monospace'; ctx.fillText('Loading' + dots, 44, H - 44);
  }
}
