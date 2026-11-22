import * as THREE from 'three';
import { Planet, DAY_SECONDS } from './Planet';
import { heightAt } from './Terrain';
import type { Slide } from './MenuRoom';

interface Shot { caption: string; clock: number; pos: (p: Planet) => THREE.Vector3; look: (p: Planet) => THREE.Vector3 }

const ground = (x: number, z: number, up = 0) => new THREE.Vector3(x, heightAt(x, z) + up, z);

const SHOTS: Shot[] = [
  { caption: 'Rolling plains', clock: 90, pos: () => ground(-25, 35, 2.2), look: () => ground(10, -90, 7) },
  { caption: 'The Great Lake', clock: 160, pos: () => ground(0, -120, 14), look: () => new THREE.Vector3(0, 6, -520) },
  { caption: 'Crystal groves', clock: 240, pos: p => { const c = p.marks.crystals[0] ?? [40, -40]; return ground(c[0] + 18, c[1] + 18, 3); }, look: p => { const c = p.marks.crystals[0] ?? [40, -40]; return ground(c[0], c[1], 5); } },
  { caption: 'The view from above', clock: 130, pos: () => new THREE.Vector3(70, 75, 130), look: () => new THREE.Vector3(0, 0, -30) },
  { caption: 'Saturn sets over the plains', clock: DAY_SECONDS * 0.955, pos: () => ground(0, 0, 2), look: () => new THREE.Vector3(-300, 40, -110) },
  { caption: 'Night bloom', clock: 585, pos: () => ground(30, 50, 1.4), look: () => ground(10, -10, 2.5) },
  { caption: 'Rivers and ponds', clock: 110, pos: () => new THREE.Vector3(70, 95, 70), look: () => new THREE.Vector3(95, 0, -150) },
  { caption: 'A wider world', clock: 200, pos: () => new THREE.Vector3(-40, 300, 420), look: () => new THREE.Vector3(-20, -10, -140) },
  { caption: 'Spires in the lake', clock: 320, pos: () => ground(30, -200, 9), look: () => new THREE.Vector3(80, 30, -540) },
];

/**
 * Render pictures of the planet into textures (once, at boot) for the main-menu slideshow.
 * The planet must already be in `scene`.
 */
export async function takeSnapshots(renderer: THREE.WebGLRenderer, scene: THREE.Scene, planet: Planet, w = 1280, h = 720): Promise<Slide[]> {
  const cam = new THREE.PerspectiveCamera(62, w / h, 0.1, 6000);
  const slides: Slide[] = [];
  for (const s of SHOTS) {
    planet.clock = s.clock;
    cam.position.copy(s.pos(planet));
    cam.lookAt(s.look(planet));
    cam.updateMatrixWorld(true);
    planet.update(0, scene, cam.position, cam.position);
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true });
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    slides.push({ tex: rt.texture, caption: s.caption });
    await new Promise(r => setTimeout(r, 0)); // let the page breathe between pictures
  }
  return slides;
}
