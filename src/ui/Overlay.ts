import * as THREE from 'three';

/** Head-locked fade-to-black plane and title text, parented to the camera. */
export class Overlay {
  private black: THREE.Mesh;
  private title: THREE.Mesh;
  private tint: THREE.Mesh;

  constructor(camera: THREE.Camera, text = 'SATISMONKE') {
    const common = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false } as const;
    this.black = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, ...common }),
    );
    this.black.position.z = -0.25;
    this.black.renderOrder = 1000;
    this.black.frustumCulled = false;

    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.font = 'bold 150px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ffb347'; g.shadowBlur = 30;
    g.fillText(text, 512, 134);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.title = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.4),
      new THREE.MeshBasicMaterial({ map: tex, opacity: 0, ...common }),
    );
    this.title.position.z = -1.2;
    this.title.renderOrder = 1001;
    this.title.frustumCulled = false;

    // a full-view tint for pain and hazards (red, toxic green)
    this.tint = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, opacity: 0, ...common }));
    this.tint.position.z = -0.3; this.tint.renderOrder = 990; this.tint.frustumCulled = false; this.tint.visible = false;
    this.black.visible = this.title.visible = false;
    camera.add(this.black, this.title, this.tint);
  }

  /** Tint the whole view (0 = off). */
  setTint(color: number, alpha: number): void {
    const m = this.tint.material as THREE.MeshBasicMaterial;
    m.color.set(color); m.opacity = alpha; this.tint.visible = alpha > 0.005;
  }

  set(blackAlpha: number, titleAlpha: number): void {
    const bm = this.black.material as THREE.MeshBasicMaterial;
    const tm = this.title.material as THREE.MeshBasicMaterial;
    bm.opacity = blackAlpha; tm.opacity = titleAlpha;
    this.black.visible = blackAlpha > 0.001;
    this.title.visible = titleAlpha > 0.001;
  }
}
