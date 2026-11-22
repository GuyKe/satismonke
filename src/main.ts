import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CollisionWorld } from './physics/CollisionWorld';
import { GorillaPlayer } from './player/GorillaPlayer';
import { ArmCalibration } from './player/ArmCalibration';
import { buildCapsule } from './world/Capsule';
import { Planet, POD_OWNER, BOULDER_OWNER } from './world/Planet';
import { buildHubMesh, HubMesh } from './world/Hub';
import { heightAt } from './world/Terrain';
import { MenuConsole } from './ui/MenuConsole';
import { TelemetryScreen } from './ui/TelemetryScreen';
import { LaserPointer } from './ui/LaserPointer';
import { Overlay } from './ui/Overlay';
import { MapMenu } from './ui/MapMenu';
import { RecipePanel } from './ui/RecipePanel';
import { ComputerScreen } from './ui/ComputerScreen';
import { ResourceHud, ObjectiveHud } from './ui/Hud';
import { Progress, RECIPES, POD_HITS, POD_STEEL } from './game/Progress';
import { Story } from './game/Story';
import { Sfx } from './audio/Sfx';
import { loadSettings } from './settings';

const PLANET_GRAVITY_G = 0.6;

/** Anything you can point the laser at and click. */
interface Interactive { mesh: THREE.Mesh; hover(pointer: number, uv: THREE.Vector2 | null): boolean; click(pointer: number): boolean }

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

  // ---- Progress, crafting, HUDs ----
  const progress = new Progress();
  const resourceHud = new ResourceHud();
  const objectiveHud = new ObjectiveHud();
  const hudDom = document.createElement('div');
  hudDom.style.cssText = 'position:fixed;right:16px;top:16px;font:bold 16px monospace;color:#e8b27a;display:none;pointer-events:none;text-align:right;white-space:pre;text-shadow:0 0 4px #000';
  document.body.appendChild(hudDom);

  const toasts: { sprite: THREE.Sprite; t: number }[] = [];
  const toast = (text: string, pos: THREE.Vector3) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const g = c.getContext('2d')!; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#000'; g.fillStyle = '#ffd9a0';
    g.strokeText(text, 256, 46); g.fillText(text, 256, 46);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    sp.scale.set(3, 0.375, 1); sp.position.copy(pos); sp.renderOrder = 900;
    scene.add(sp); toasts.push({ sprite: sp, t: 0 });
  };

  // Floating panels (map = A, crafting = X): one at a time, in front of your face
  const map = new MapMenu(() => setPanel(null));
  const craftPanel = new RecipePanel('CRAFTING', RECIPES.filter(r => r.where === 'x'), progress, id => craft(id), 'More recipes at the Hub crafting bench', 0.8);
  map.mesh.visible = craftPanel.mesh.visible = false;
  scene.add(map.mesh, craftPanel.mesh);
  let floating: 'map' | 'craft' | null = null;
  const setPanel = (p: 'map' | 'craft' | null) => {
    floating = planet && !ship.visible ? p : null;
    map.mesh.visible = floating === 'map'; craftPanel.mesh.visible = floating === 'craft';
  };

  // Hub: ghost while placing, bench + computer once built
  let placing = false;
  let ghost: HubMesh | null = null;
  let ghostPose: { x: number; z: number; y: number; yaw: number; ok: boolean; reason: string } | null = null;
  let hubUi: { bench: RecipePanel; computer: ComputerScreen } | null = null;
  const lantern = new THREE.PointLight(0xffe2a0, 3, 16, 2);

  const craft = (id: string) => {
    const r = progress.recipe(id);
    if (progress.has(id) || !r.unlocked(progress) || !progress.canAfford(r.cost)) { sfx.fail(); return; }
    progress.spend(r.cost); progress.crafted.add(id); sfx.craft();
    if (id === 'hub') {
      placing = true; setPanel(null);
      ghost = buildHubMesh(true); scene.add(ghost.group);
      toast('Aim and pull the trigger to place', new THREE.Vector3().copy(player.position).add(camera.position).add(new THREE.Vector3(0, 0.3, 0)));
    }
    if (id === 'lantern') { lantern.position.set(0, -0.2, -0.2); camera.add(lantern); }
    if (id === 'gloves') { player.jumpMult = 1.5; player.maxSpeed = 10; }
  };

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
    planet.onWood = (n, pos) => { const k = n + (progress.has('axe') ? 1 : 0); progress.add('wood', k); sfx.pickup(); toast(`+${k} wood`, pos); };
    planet.onStone = (n, pos) => { progress.add('stone', n); progress.bouldersBroken++; sfx.crumble(); toast(`+${n} stone`, pos); };
    planet.onPodDestroyed = pos => { progress.podDestroyed = true; progress.podHits = POD_HITS; progress.add('steel', POD_STEEL); sfx.crumble(); toast(`+${POD_STEEL} steel`, pos); };
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
  const hoverTarget: (Interactive | null)[] = [null, null];
  hoverTarget[99] = null;
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
  const press = (i: number) => {
    const t = hoverTarget[i];
    if (t && t.click(i)) { buzz(i, 0.6, 40); return; }
    if (placing) tryPlaceHub();
  };
  rays.forEach((r, i) => {
    rig.add(r); rig.add(grips[i]);
    r.addEventListener('connected', e => {
      inputs[i] = (e as unknown as { data: XRInputSource }).data;
      const hand = inputs[i]?.handedness;
      // wrist displays: resources on the left, objective on the right
      const hud = hand === 'left' ? resourceHud.mesh : hand === 'right' ? objectiveHud.mesh : null;
      if (hud) { hud.rotation.x = -Math.PI / 2 + 0.35; hud.position.set(0, 0.04, 0.05); grips[i].add(hud); }
    });
    r.addEventListener('disconnected', () => { inputs[i] = null; });
    r.addEventListener('selectstart', () => press(i));
  });

  const arms = new ArmCalibration(settings);
  const torso = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 20, 14).scale(1, 1.35, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.95 }),
  );
  scene.add(torso);

  // Buttons (Quest Touch): right A = buttons[4], right B = buttons[5], left X = buttons[4], grip = buttons[1]
  const btn = (i: number, b: number) => !!inputs[i]?.gamepad?.buttons[b]?.pressed;
  const handBtn = (hand: 'left' | 'right', b: number) => [0, 1].some(i => inputs[i]?.handedness === hand && btn(i, b));
  const keys = { a: false, b: false, x: false, grip: false };
  const keyMap: Record<string, keyof typeof keys> = { KeyM: 'a', KeyB: 'b', KeyX: 'x', KeyG: 'grip' };
  addEventListener('keydown', e => { const k = keyMap[e.code]; if (k) keys[k] = true; });
  addEventListener('keyup', e => { const k = keyMap[e.code]; if (k) keys[k] = false; });
  let aPrev = false, bPrev = false, xPrev = false;

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
  addEventListener('click', () => { if (!renderer.xr.isPresenting) press(99); });
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

  // ---- Hub placement ----
  /** Where does a ray first dip below the terrain? */
  const aimAtTerrain = (o: THREE.Vector3, d: THREE.Vector3): THREE.Vector3 | null => {
    for (let t = 1; t <= 40; t += 0.5) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < heightAt(x, z)) {
        let a = t - 0.5, b = t;
        for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * b, 0, o.z + d.z * b);
      }
    }
    return null;
  };
  const tryPlaceHub = () => {
    if (!placing || !planet || !ghostPose) return;
    if (!ghostPose.ok) { sfx.fail(); toast(ghostPose.reason || 'Aim at the ground', new THREE.Vector3().copy(player.position).add(camera.position)); return; }
    const built = planet.placeHub(ghostPose.x, ghostPose.z, ghostPose.yaw, ghostPose.y);
    scene.remove(ghost!.group); ghost = null; placing = false; progress.hubPlaced = true;
    const bench = new RecipePanel('CRAFTING BENCH', RECIPES.filter(r => r.where === 'bench'), progress, id => craft(id), 'Unlock more by exploring', 1.2);
    const computer = new ComputerScreen(() => { progress.gamePlayed = true; });
    bench.mesh.position.copy(built.mesh.benchScreenAt);
    computer.mesh.position.copy(built.mesh.computerScreenAt);
    built.group.add(bench.mesh, computer.mesh);
    hubUi = { bench, computer };
    sfx.craft(); sfx.thump(new THREE.Vector3(ghostPose.x, ghostPose.y, ghostPose.z));
    toast('Hub built!', new THREE.Vector3(ghostPose.x, ghostPose.y + 3.5, ghostPose.z));
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
    const aNow = keys.a || handBtn('right', 4), bNow = keys.b || handBtn('right', 5), xNow = keys.x || handBtn('left', 4);
    if (aNow && !aPrev) setPanel(floating === 'map' ? null : 'map');        // A: map
    if (xNow && !xPrev) setPanel(floating === 'craft' ? null : 'craft');    // X: crafting
    if (bNow && !bPrev && ship.visible) story.skipToTitle();               // B: skip the crash scene (capsule only)
    aPrev = aNow; bPrev = bNow; xPrev = xNow;
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

    // Grip + punch: fell trees, smash boulders (stone) and the crashed pod (steel)
    const headW = new THREE.Vector3().copy(player.position).add(camera.position);
    if (planet && !ship.visible) {
      player.hands.forEach((h, i) => {
        if (!h.started || !gripDown[i]) return;
        const id = player.world.ownerAt(h.contact);
        if (id < 0) return;
        const isTree = id < POD_OWNER;
        const need = isTree ? (progress.has('axe') ? 1.2 : 2.2) : 2.0;
        if (h.impact < need) return;
        if (id === POD_OWNER) {
          const left = planet!.hitPod(POD_HITS); progress.podHits = POD_HITS - left;
          if (left) sfx.clink(); buzz(i, 1, 90);
        } else if (id >= BOULDER_OWNER) {
          const left = planet!.hitBoulder(id - BOULDER_OWNER);
          if (left) sfx.clink(); buzz(i, 1, 90);
        } else if (planet!.fellTree(id, headW)) { sfx.chop(); buzz(i, 1, 90); }
      });
    }

    // Everything you can point at right now
    scene.updateMatrixWorld(true);
    const targets: Interactive[] = [];
    if (ship.visible) targets.push(menu);
    else {
      if (floating === 'map') targets.push(map);
      if (floating === 'craft') targets.push(craftPanel);
      if (hubUi && planet?.hub && Math.hypot(planet.hub.pose.x - headW.x, planet.hub.pose.z - headW.z) < 14) targets.push(hubUi.bench, hubUi.computer);
    }
    const meshes = targets.map(t => t.mesh);
    const setHover = (pointer: number, hit: { index: number; uv: THREE.Vector2 } | null) => {
      targets.forEach((t, k) => t.hover(pointer, hit && hit.index === k ? hit.uv : null));
      hoverTarget[pointer] = hit ? targets[hit.index] : null;
      if (hit && hubUi && targets[hit.index] === hubUi.bench) progress.benchOpened = true;
    };
    if (inXR) lasers.forEach((l, i) => setHover(i, l.castMany(meshes, placing)));
    else {
      lasers.forEach(l => l.hide());
      mouseRay.setFromCamera(mouse, camera);
      const h = mouseRay.intersectObjects(meshes, false).find(x => x.uv);
      setHover(99, h && h.uv ? { index: meshes.indexOf(h.object as THREE.Mesh), uv: h.uv } : null);
    }

    if (ship.visible) {
      // Ship shakes and flashes red during the emergency
      const s = story.shake;
      ship.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      setAlarmLights(story.alarm > 0, elapsed);
      menu.update(elapsed);
      telemetry.update(dt, {
        speed: player.velocity.length(),
        height: player.position.y + (inXR ? camera.position.y : 1.6) + 3,
        touching: player.hands.filter(h => h.touching).length,
        gravityG: player.gravityG,
        gripPct: (1 - player.lastSlip) * 100,
      });
    }

    // Floating panels sit in front of your face
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    if (floating && planet) {
      const panel = floating === 'map' ? map.mesh : craftPanel.mesh;
      const target = headW.clone().addScaledVector(fwd, 0.85); target.y = headW.y - 0.1;
      panel.position.lerp(target, 1 - Math.exp(-8 * dt));
      panel.lookAt(headW);
      if (floating === 'map') map.update(dt, planet, headW.x, headW.z, fwd.x, fwd.z); else craftPanel.update();
    }
    if (hubUi) { hubUi.bench.update(); hubUi.computer.update(dt); }

    // Hub placement ghost follows your aim
    if (placing && ghost && planet) {
      let o: THREE.Vector3, d: THREE.Vector3;
      if (inXR) {
        const idx = inputs[1]?.handedness === 'right' ? 1 : inputs[0]?.handedness === 'right' ? 0 : 1;
        o = new THREE.Vector3().setFromMatrixPosition(rays[idx].matrixWorld);
        d = new THREE.Vector3(0, 0, -1).transformDirection(rays[idx].matrixWorld);
      } else { o = headW.clone(); d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); }
      const hit = aimAtTerrain(o, d);
      ghost.group.visible = !!hit;
      if (hit) {
        const yawH = Math.round(Math.atan2(-fwd.z, fwd.x) / (Math.PI / 12)) * (Math.PI / 12); // long axis along your facing
        const res = planet.canPlaceHub(hit.x, hit.z, yawH);
        if (res.ok && Math.hypot(hit.x - headW.x, hit.z - headW.z) < 8) { res.ok = false; res.reason = 'Too close: step back'; }
        ghostPose = { x: hit.x, z: hit.z, y: res.y, yaw: yawH, ok: res.ok, reason: res.reason };
        ghost.group.position.set(hit.x, res.y, hit.z); ghost.group.rotation.y = yawH;
        (ghost.group.userData.ghostMaterial as THREE.MeshBasicMaterial).color.set(res.ok ? 0x55ff88 : 0xff5555);
      } else ghostPose = null;
    }

    // Wrist displays and the desktop text overlay
    const obj = progress.objective();
    resourceHud.set(progress); objectiveHud.set(obj);
    hudDom.style.display = planet && !inXR ? 'block' : 'none';
    hudDom.textContent = `OBJECTIVE: ${obj[0]}\n${obj[1]}\nwood ${progress.items.wood}  stone ${progress.items.stone}  steel ${progress.items.steel}\n[M] map  [X] craft  [G+punch] hit  [click] use`;
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
  (window as unknown as Record<string, unknown>).__game = {
    progress, craft, tryPlaceHub, setPanel, renderer, scene, player, story, settings, menu,
    fell: (id: number) => planet?.fellTree(id, new THREE.Vector3(0, 0, 0)),
    look: (y: number, p: number) => { yaw = y; pitch = p; },
    get placing() { return placing; }, get ghostPose() { return ghostPose; }, get hubUi() { return hubUi; },
    get planet() { return planet; },
  };
}

boot();
