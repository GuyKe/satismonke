import * as THREE from 'three';

/** A visible ray + dot attached to a controller (or any Object3D pointing down -Z). */
export class LaserPointer {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private dot: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  hide(): void { this.group.visible = false; this.dot.visible = false; }
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  constructor(private source: THREE.Object3D) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 });
    // Unit-length cylinder along -Z, scaled to the hit distance.
    const geo = new THREE.CylinderGeometry(0.004, 0.004, 1, 8).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.beam = new THREE.Mesh(geo, mat);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), mat);
    this.group.add(this.beam);
    this.group.visible = false;
    source.add(this.group);
    source.add(this.dot);
    this.dot.visible = false;
    this.raycaster.far = 8;
  }

  /** Cast against several targets; returns the nearest hit's index and UV (or null). */
  castMany(targets: THREE.Mesh[], alwaysShow: boolean): { index: number; uv: THREE.Vector2 } | null {
    this.source.updateWorldMatrix(true, false);
    this.source.matrixWorld.decompose(this.origin, this.quat, new THREE.Vector3());
    this.dir.set(0, 0, -1).applyQuaternion(this.quat);
    this.raycaster.set(this.origin, this.dir);
    const hit = this.raycaster.intersectObjects(targets, false).find(h => h.uv && h.object.visible);
    if (hit && hit.uv) {
      this.beam.scale.z = hit.distance;
      this.dot.position.set(0, 0, -hit.distance);
      this.dot.visible = true; this.group.visible = true;
      return { index: targets.indexOf(hit.object as THREE.Mesh), uv: hit.uv };
    }
    this.dot.visible = false; this.beam.scale.z = 1.5; this.group.visible = alwaysShow;
    return null;
  }

  /**
   * Cast against `target`. Returns the UV of the hit, or null.
   * `show` decides whether the beam is visible when it misses.
   */
  cast(target: THREE.Mesh, alwaysShow: boolean): THREE.Vector2 | null {
    this.source.updateWorldMatrix(true, false);
    this.source.matrixWorld.decompose(this.origin, this.quat, new THREE.Vector3());
    this.dir.set(0, 0, -1).applyQuaternion(this.quat);
    this.raycaster.set(this.origin, this.dir);
    const hit = this.raycaster.intersectObject(target, false)[0];
    if (hit && hit.uv) {
      this.beam.scale.z = hit.distance;
      this.dot.position.set(0, 0, -hit.distance);
      this.dot.visible = true;
      this.group.visible = true;
      return hit.uv;
    }
    this.dot.visible = false;
    this.beam.scale.z = 1.5;
    this.group.visible = alwaysShow;
    return null;
  }
}
