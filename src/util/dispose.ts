import * as THREE from 'three';

/** Free the GPU memory held by everything under `root`. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const k of Object.keys(mat)) { const v = (mat as unknown as Record<string, unknown>)[k]; if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose(); }
      mat.dispose();
    }
    (o as THREE.InstancedMesh).dispose?.();
  });
}
