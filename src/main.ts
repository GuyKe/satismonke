import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CollisionWorld } from './physics/CollisionWorld';
import { GorillaPlayer } from './player/GorillaPlayer';
import { buildCapsule } from './world/Capsule';
import { MenuConsole } from './ui/MenuConsole';
import { TelemetryScreen } from './ui/TelemetryScreen';
import { LaserPointer } from './ui/LaserPointer';
import { loadSettings } from './settings';

async function boot() {
  if (new URLSearchParams(location.search).has('emu')) {
    // Desktop WebXR emulation (Meta's IWER) for testing without a headset.
    const { XRDevice, metaQuest3 } = await import('iwer');
    new XRDevice(metaQuest3).installRuntime();
  }

  const settings = loadSettings();
  const SPAWN = new THREE.Vector3(0, -1.8, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 50);

  // World + collisions
  const world = new CollisionWorld();
  scene.add(buildCapsule(world));

  const player = new GorillaPlayer(world, settings);
  player.teleport(SPAWN);

  // Rig: moving it moves the whole play space. Camera and controllers are children.
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  // Menu console + side screens
  const menu = new MenuConsole(settings, { resetPosition: () => player.teleport(SPAWN) });
  menu.mesh.position.set(0, -0.8, -3.38);
  scene.add(menu.mesh);

  const telemetry = new TelemetryScreen();
  telemetry.mesh.position.set(-2.9, -0.3, -0.5);
  telemetry.mesh.rotation.y = Math.PI / 2;
  scene.add(telemetry.mesh);

  // Controllers: grip = hand position, controller ray = laser
  const grips = [0, 1].map(i => renderer.xr.getControllerGrip(i));
  const rays = [0, 1].map(i => renderer.xr.getController(i));
  const inputs: (XRInputSource | null)[] = [null, null];
  const lasers = rays.map(r => new LaserPointer(r));
  const handMeshes = [0, 1].map(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(player.handRadius, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 }),
    );
    scene.add(m); // world space: shows the resolved hand, not the raw controller
    return m;
  });
  const buzz = (i: number, strength: number, ms: number) => {
    const gp = inputs[i]?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, d: number): void }[] }) | undefined;
    try { gp?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* no haptics */ }
  };
  rays.forEach((r, i) => {
    rig.add(r); rig.add(grips[i]);
    r.addEventListener('connected', e => { inputs[i] = (e as unknown as { data: XRInputSource }).data; });
    r.addEventListener('disconnected', () => { inputs[i] = null; });
    r.addEventListener('selectstart', () => { if (menu.click(i)) buzz(i, 0.6, 40); });
  });

  // Desktop preview: drag to look, click the menu with the mouse.
  const mouse = new THREE.Vector2();
  const mouseRay = new THREE.Raycaster();
  let yaw = 0, pitch = 0, dragging = false;
  const headStand = new THREE.Vector3(0, 1.6, 0);
  addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', e => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (dragging) { yaw -= e.movementX * 0.004; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.004, -1.4, 1.4); }
  });
  addEventListener('click', () => { if (!renderer.xr.isPresenting) menu.click(99); });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const hl = [new THREE.Vector3(), new THREE.Vector3()];
  const hadTouch = [false, false];
  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const inXR = renderer.xr.isPresenting;

    if (inXR) {
      // In XR, three updates camera + controller transforms (rig-local) before this callback.
      const handLocals = [0, 1].map(i => {
        const connected = inputs[i] !== null && grips[i].position.lengthSq() > 0;
        return connected ? hl[i].copy(grips[i].position) : null;
      });
      player.update(dt, camera.position, handLocals);
    } else {
      camera.position.copy(headStand);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      player.update(dt, headStand, [null, null]);
    }
    rig.position.copy(player.position);

    // Resolved hand spheres + haptics on first contact
    player.hands.forEach((h, i) => {
      handMeshes[i].visible = inXR && inputs[i] !== null;
      handMeshes[i].position.copy(h.world);
      if (h.touching && !hadTouch[i]) buzz(i, 0.35, 25);
      hadTouch[i] = h.touching;
    });

    // Laser pointers over the menu
    scene.updateMatrixWorld(true);
    if (inXR) {
      lasers.forEach((l, i) => menu.hover(i, l.cast(menu.mesh, settings.laserAlways)));
    } else {
      mouseRay.setFromCamera(mouse, camera);
      const hit = mouseRay.intersectObject(menu.mesh, false)[0];
      menu.hover(99, hit?.uv ?? null);
    }
    menu.update();
    telemetry.update(dt, {
      speed: player.velocity.length(),
      height: player.position.y + (inXR ? camera.position.y : 1.6) + 3,
      touching: player.hands.filter(h => h.touching).length,
      gravityG: settings.gravityG,
    });

    renderer.render(scene, camera);
  });

  // Exposed for debugging / automated tests
  (window as unknown as Record<string, unknown>).__game = { player, world, settings, menu };
}

boot();
