import * as THREE from 'three';
import { Screen } from '../ui/Screen';
import { CollisionWorld } from '../physics/CollisionWorld';

export interface Slide { tex: THREE.Texture; caption: string }

/** Cross-fading slideshow of pictures of the game's map, with a slow Ken Burns zoom. */
export class Slideshow {
  readonly mesh: THREE.Mesh;
  readonly caption: Screen;
  private mat: THREE.ShaderMaterial;
  private i = 0;
  private t = 0;
  private readonly HOLD = 6.5;
  private readonly FADE = 1.6;

  constructor(private slides: Slide[], width = 16, height = 9) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tA: { value: slides[0].tex }, tB: { value: slides[1 % slides.length].tex }, mixv: { value: 0 }, zA: { value: 1 }, zB: { value: 1 }, oA: { value: new THREE.Vector2() }, oB: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tA, tB; uniform float mixv, zA, zB; uniform vec2 oA, oB; varying vec2 vUv;
        void main(){
          vec3 a = texture2D(tA, (vUv - 0.5) / zA + 0.5 + oA).rgb;
          vec3 b = texture2D(tB, (vUv - 0.5) / zB + 0.5 + oB).rgb;
          gl_FragColor = vec4(mix(a, b, mixv), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.mat);
    this.caption = new Screen(width * 0.4, width * 0.4 * 0.11, 1024, 113);
    (this.caption.mesh.material as THREE.MeshBasicMaterial).transparent = true;
    this.drawCaption();
  }

  private drawCaption(): void {
    const { ctx } = this.caption;
    ctx.clearRect(0, 0, 1024, 113);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 1024, 113);
    ctx.fillStyle = '#ffd9a0'; ctx.font = 'bold 56px monospace'; ctx.textAlign = 'center';
    ctx.fillText(this.slides[this.i].caption, 512, 76);
    this.caption.refresh();
  }

  update(dt: number): void {
    this.t += dt;
    const cycle = this.HOLD + this.FADE, n = this.slides.length;
    if (this.t >= cycle) { this.t -= cycle; this.i = (this.i + 1) % n; this.drawCaption(); }
    const u = this.mat.uniforms, k = (x: number) => Math.min(Math.max(x, 0), 1);
    const fade = k((this.t - this.HOLD) / this.FADE);
    u.tA.value = this.slides[this.i].tex; u.tB.value = this.slides[(this.i + 1) % n].tex;
    u.mixv.value = fade * fade * (3 - 2 * fade);
    u.zA.value = 1 + 0.12 * k(this.t / cycle);
    u.zB.value = 1 + 0.12 * k(Math.max(0, this.t - this.HOLD) / cycle);
    // drift the pan direction a little per slide so it is not always the same move
    const dir = this.i % 2 ? 1 : -1;
    u.oA.value.set(dir * 0.02 * k(this.t / cycle), 0.01 * k(this.t / cycle));
    u.oB.value.set(-dir * 0.02 * k(Math.max(0, this.t - this.HOLD) / cycle), 0);
    (this.caption.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.t / 0.6) * (1 - fade);
  }
}

/** The main-menu "room": a dark platform under the stars, with a big screen showing pictures of the map. */
export class MenuRoom {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly slideshow: Slideshow | null;

  constructor(slides: Slide[]) {
    this.world.hull = false;
    this.world.addBox(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(18, 0.6, 18), 0.15);

    // platform with a glowing edge
    const floor = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 18), new THREE.MeshBasicMaterial({ color: 0x0d1220 }));
    floor.position.y = -0.3; this.group.add(floor);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.06, 18.2), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    edge.position.y = 0.01; this.group.add(edge);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(17.9, 0.08, 17.9), new THREE.MeshBasicMaterial({ color: 0x0d1220 }));
    inner.position.y = 0.02; this.group.add(inner);

    // stars
    const pts: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pts.push(Math.cos(a) * s * 90, Math.abs(u) * 90, Math.sin(a) * s * 90);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));

    // the big slideshow screen with a frame
    if (slides.length) {
      this.slideshow = new Slideshow(slides, 21, 11.8125);
      this.slideshow.mesh.position.set(0, 5.4, -10);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(21.6, 12.4, 0.2), new THREE.MeshBasicMaterial({ color: 0x1a2236 }));
      frame.position.set(0, 5.4, -10.12);
      this.slideshow.caption.mesh.position.set(0, 5.4 + 5.9 - 0.7, -9.95); // a caption bar across the top of the picture
      this.group.add(frame, this.slideshow.mesh, this.slideshow.caption.mesh);
    } else this.slideshow = null;
  }

  update(dt: number): void { this.slideshow?.update(dt); }
}
