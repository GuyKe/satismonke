import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CollisionWorld } from './physics/CollisionWorld';
import { GorillaPlayer } from './player/GorillaPlayer';
import { ArmCalibration } from './player/ArmCalibration';
import { buildCapsule } from './world/Capsule';
import { Planet } from './world/Planet';
import { MenuConsole } from './ui/MenuConsole';
import { TelemetryScreen } from './ui/TelemetryScreen';
import { LaserPointer } from './ui/LaserPointer';
import { Overlay } from './ui/Overlay';
import { MapMenu } from './ui/MapMenu';
import { WoodHud } from './ui/WoodHud';
import { Story } from './game/Story';
import { Sfx } from './audio/Sfx';
import { loadSettings } from './settings';

const PLANET_GRAVITY_G = 0.6;

async function boot() {
  if (new URLSearchParams(location.search).has('emu')) {
    // Desktop WebXR emulation (Meta's IWER) for testing without a headset.
    const { XRDevice, metaQuest3 } = await import('iwer');
    new XRDevice(metaQuest3).installRuntime();
  }

  const settings = loadSettings();
  const SPAWN = new THREE.Vector3(0, -1.8, 2);
  const debugSkip = new URLSearchParams(location.search).get('skip'); // ?skip=planet jumps straight there

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 6000);

  const sfx = new Sfx();
  renderer.xr.addEventListener('sessionstart', () => sfx.ensure());
  addEventListener('pointerdown', () => sfx.ensure());

  // ---- Ship (capsule interior) ----
  const shipWorld = new CollisionWorld();
  const ship = new THREE.Group();
  const capsule = buildCapsule(shipWorld);
  ship.add(capsule.group);
  scene.add(ship);

  const player = new GorillaPlayer(shipWorld, settings);
  player.teleport(SPAWN);

  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  const overlay = new Overlay(camera);

  // ---- Story: Play -> alarm -> crash -> title -> planet ----
  let planet: Planet | null = null;
  const land = () => {
    planet = new Planet();
    ship.visible = false;
    scene.add(planet.group);
    player.world = planet.world;
    player.gravityG = PLANET_GRAVITY_G;
    player.teleport(new THREE.Vector3(0, 0.1, 0));
    // Your pod sits behind wherever you are facing when you land
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    planet.placePod(new THREE.Vector3().copy(player.position).add(camera.position), fwd.normalize());
    planet.onRoar = (pos, kind) => sfx.roar(pos, kind);
    planet.onTreeLanded = pos => sfx.thump(pos);
    planet.onWood = (n, pos) => { wood += n; woodHud.set(wood); sfx.pickup(); toast(`+${n} wood`, pos); };
    sfx.startWind();
  };
  const story = new Story({
    onAlarm: () => {
      sfx.ensure(); sfx.startAlarm();
      menu.showMessage(['THRUSTERS FAILED', 'DEPLOYING EMERGENCY', 'BRAKES']);
    },
    onCrash: () => { sfx.stopAlarm(); sfx.crash(); },
    onLand: land,
    onSkip: () => { sfx.stopAlarm(); sfx.duck(); },   // B in the capsule: straight to the title
  });

  // ---- Console + screens (on the ship) ----
  const menu = new MenuConsole(() => story.start());
  menu.mesh.position.set(0, -0.8, -3.38);
  ship.add(menu.mesh);

  const telemetry = new TelemetryScreen();
  telemetry.mesh.position.set(-2.9, -0.3, -0.5);
  telemetry.mesh.rotation.y = Math.PI / 2;
  ship.add(telemetry.mesh);

  // ---- Controllers ----
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
    r.addEventListener('connected', e => {
      inputs[i] = (e as unknown as { data: XRInputSource }).data;
      if (inputs[i]?.handedness === 'left') { // wood counter on the left wrist
        woodHud.mesh.rotation.x = -Math.PI / 2; woodHud.mesh.position.set(0, 0.03, 0.03);
        grips[i].add(woodHud.mesh);
      }
    });
    r.addEventListener('disconnected', () => { inputs[i] = null; });
    r.addEventListener('selectstart', () => { if (menu.click(i)) buzz(i, 0.6, 40); });
  });

  const arms = new ArmCalibration(settings);
  const torso = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 20, 14).scale(1, 1.35, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.95 }),
  );
  scene.add(torso);

  // ---- Wood, map, toasts ----
  let wood = 0;
  const woodHud = new WoodHud();
  const woodDom = document.createElement('div');
  woodDom.style.cssText = 'position:fixed;right:16px;top:16px;font:bold 18px monospace;color:#e8b27a;display:none;pointer-events:none';
  document.body.appendChild(woodDom);
  const toasts: { sprite: THREE.Sprite; t: number }[] = [];
  const toast = (text: string, pos: THREE.Vector3) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#000'; g.fillStyle = '#ffd9a0';
    g.strokeText(text, 128, 46); g.fillText(text, 128, 46);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    sp.scale.set(2, 0.5, 1); sp.position.copy(pos); sp.renderOrder = 900;
    scene.add(sp); toasts.push({ sprite: sp, t: 0 });
  };
  const map = new MapMenu(() => setMap(false));
  map.mesh.visible = false;
  scene.add(map.mesh);
  let mapOpen = false;
  const setMap = (open: boolean) => { mapOpen = open && !!planet && !ship.visible; map.mesh.visible = mapOpen; };
  // Right controller: A (buttons[4]) = map, B (buttons[5]) = skip the crash scene. Squeeze (buttons[1]) = grip.
  const btn = (i: number, b: number) => !!inputs[i]?.gamepad?.buttons[b]?.pressed;
  const keys = { a: false, b: false, grip: false };
  addEventListener('keydown', e => { if (e.code === 'KeyM') keys.a = true; if (e.code === 'KeyB') keys.b = true; if (e.code === 'KeyG') keys.grip = true; });
  addEventListener('keyup', e => { if (e.code === 'KeyM') keys.a = false; if (e.code === 'KeyB') keys.b = false; if (e.code === 'KeyG') keys.grip = false; });
  let aPrev = false, bPrev = false;

  // ---- Desktop preview: drag to look, click the menu ----
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
  addEventListener('click', () => { if (!renderer.xr.isPresenting) { if (mapOpen) map.click(99); else menu.click(99); } });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  if (debugSkip === 'planet') { land(); story.phase = 'planet'; }

  // ---- Alarm lighting ----
  const baseHemi = capsule.lights.hemi.intensity;
  const baseHemiColor = capsule.lights.hemi.color.clone();
  const basePoint = capsule.lights.points.map(l => ({ c: l.color.clone(), i: l.intensity }));
  const red = new THREE.Color(0xff1010);
  const setAlarmLights = (on: boolean, time: number) => {
    const pulse = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 1.3);
    capsule.lights.hemi.color.copy(on ? red : baseHemiColor);
    capsule.lights.hemi.intensity = on ? 0.05 + pulse * 0.7 : baseHemi;
    capsule.lights.points.forEach((l, i) => {
      l.color.copy(on ? red : basePoint[i].c);
      l.intensity = on ? basePoint[i].i * (0.05 + pulse * 1.6) : basePoint[i].i;
    });
  };

  const hl = [new THREE.Vector3(), new THREE.Vector3()];   // raw controller positions
  const sl = [new THREE.Vector3(), new THREE.Vector3()];   // arm-span-scaled, fed to physics
  const hadTouch = [false, false];
  const clock = new THREE.Clock();
  let elapsed = 0;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    const inXR = renderer.xr.isPresenting;

    story.update(dt);

    // Buttons
    const aNow = keys.a || btn(0, 4) && inputs[0]?.handedness === 'right' || btn(1, 4) && inputs[1]?.handedness === 'right';
    const bNow = keys.b || btn(0, 5) && inputs[0]?.handedness === 'right' || btn(1, 5) && inputs[1]?.handedness === 'right';
    if (aNow && !aPrev) setMap(!mapOpen);                 // A: map (on the planet)
    if (bNow && !bPrev && ship.visible) story.skipToTitle(); // B: skip the crash scene (capsule only)
    aPrev = aNow; bPrev = bNow;
    const gripDown = [keys.grip || btn(0, 1), keys.grip || btn(1, 1)];
    overlay.set(story.blackAlpha, story.titleAlpha);
    sfx.rumble(story.rumble);

    if (inXR) {
      // In XR, three updates camera + controller transforms (rig-local) before this callback.
      const raw = [0, 1].map(i => {
        const connected = inputs[i] !== null && grips[i].position.lengthSq() > 0;
        return connected ? hl[i].copy(grips[i].position) : null;
      });
      arms.observe(dt, raw[0], raw[1]);
      const handLocals = raw.map((r, i) => (r ? arms.apply(camera.position, r, sl[i]) : null));
      player.update(dt, camera.position, handLocals);
    } else {
      camera.position.copy(headStand);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      player.update(dt, headStand, [null, null]);
    }
    rig.position.copy(player.position);
    torso.visible = inXR;
    torso.position.set(player.position.x + camera.position.x, player.position.y + camera.position.y - 0.45, player.position.z + camera.position.z);

    player.hands.forEach((h, i) => {
      handMeshes[i].visible = inXR && inputs[i] !== null;
      handMeshes[i].position.copy(h.world);
      if (h.touching && !hadTouch[i]) buzz(i, 0.35, 25);
      hadTouch[i] = h.touching;
    });

    // Grip + punch a tree: it falls over, vanishes after 3 s and gives wood
    const headW = new THREE.Vector3().copy(player.position).add(camera.position);
    if (planet && !ship.visible) {
      player.hands.forEach((h, i) => {
        if (!h.started || !gripDown[i] || h.impact < 2.2) return;
        const id = player.world.ownerAt(h.contact);
        if (id >= 0 && planet!.fellTree(id, headW)) { sfx.chop(); buzz(i, 1, 90); }
      });
    }

    if (ship.visible) {
      // Ship shakes and flashes red during the emergency
      const s = story.shake;
      ship.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      setAlarmLights(story.alarm > 0, elapsed);

      scene.updateMatrixWorld(true);
      if (inXR) {
        lasers.forEach((l, i) => menu.hover(i, l.cast(menu.mesh, false)));
      } else {
        mouseRay.setFromCamera(mouse, camera);
        menu.hover(99, mouseRay.intersectObject(menu.mesh, false)[0]?.uv ?? null);
      }
      menu.update(elapsed);
      telemetry.update(dt, {
        speed: player.velocity.length(),
        height: player.position.y + (inXR ? camera.position.y : 1.6) + 3,
        touching: player.hands.filter(h => h.touching).length,
        gravityG: player.gravityG,
        gripPct: (1 - player.lastSlip) * 100,
      });
    } else {
      scene.updateMatrixWorld(true);
      if (mapOpen) {
        if (inXR) lasers.forEach((l, i) => map.hover(i, l.cast(map.mesh, false)));
        else { mouseRay.setFromCamera(mouse, camera); map.hover(99, mouseRay.intersectObject(map.mesh, false)[0]?.uv ?? null); }
      } else lasers.forEach(l => l.hide());
    }
    if (mapOpen && planet) {
      // float in front of you, facing you
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const target = headW.clone().addScaledVector(fwd, 0.85); target.y = headW.y - 0.1;
      map.mesh.position.lerp(target, 1 - Math.exp(-8 * dt));
      map.mesh.lookAt(headW);
      map.update(dt, planet, player.position.x + camera.position.x, player.position.z + camera.position.z, fwd.x, fwd.z);
    }
    woodDom.style.display = planet && !inXR ? 'block' : 'none';
    woodDom.textContent = `WOOD ${wood}   [M] map  [G+punch] chop`;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i]; t.t += dt;
      t.sprite.position.y += dt * 0.8;
      (t.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t.t / 2.2);
      if (t.t > 2.2) { scene.remove(t.sprite); toasts.splice(i, 1); }
    }

    if (inXR || planet) sfx.setListener(headW, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    if (planet) planet.update(dt, scene, player.position, headW);

    renderer.render(scene, camera);
  });

  // Exposed for debugging / automated tests
  (window as unknown as Record<string, unknown>).__game = { fell: (id: number) => planet?.fellTree(id, new THREE.Vector3(0, 0, 0)), setMap, wood: () => wood, renderer, scene, look: (y: number, p: number) => { yaw = y; pitch = p; }, player, story, settings, menu, get planet() { return planet; } };
}

boot();
