import * as THREE from 'three';

/** A wall panel that draws into a canvas used as a texture. */
export class Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;

  constructor(public width: number, public height: number, pxW = 512, pxH = Math.round(pxW * height / width)) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
  }

  /** Call after drawing to push the canvas to the GPU. */
  refresh(): void { this.texture.needsUpdate = true; }
}
