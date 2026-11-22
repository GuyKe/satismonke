import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CollisionWorld } from './physics/CollisionWorld';
import { GorillaPlayer } from './player/GorillaPlayer';
import { ArmCalibration } from './player/ArmCalibration';
import { buildCapsule } from './world/Capsule';
import { Planet, POD_OWNER, BOULDER_OWNER, CRYSTAL_OWNER, ORE_OWNER } from './world/Planet';
import { MenuRoom, Slide } from './world/MenuRoom';
import { takeSnapshots } from './world/Snapshots';
import { MenuPanel, MenuHandlers } from './ui/MenuPanel';
import { SaveData, readSlot, writeSlot, deleteSlot } from './game/Save';
import { disposeObject } from './util/dispose';
import { buildCampfire, buildLamp, makeGhost, PropKind } from './world/Props';
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
import { Progress, RECIPES, POD_HITS, POD_STEEL, BOULDER_HITS, TREE_HITS, CRYSTAL_HITS, MAX_PLACED } from './game/Progress';
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

  // Pictures of the planet for the main-menu slideshow (skipped for the ?skip=planet debug shortcut)
  const loadingDom = document.createElement('div');
  loadingDom.textContent = 'Loading the planet...';
  loadingDom.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:bold 28px monospace;color:#ffb347;background:#05070d;z-index:10';
  document.body.appendChild(loadingDom);
  let slides: Slide[] = [];
  if (debugSkip !== 'planet') {
    await new Promise(r => setTimeout(r, 40));
    try {
      const snapPlanet = new Planet();
      scene.add(snapPlanet.group);
      slides = await takeSnapshots(renderer, scene, snapPlanet);
      scene.remove(snapPlanet.group); disposeObject(snapPlanet.group);
    } catch (e) { console.warn('slideshow unavailable', e); }
    scene.fog = null; scene.background = new THREE.Color(0x05070d);
  }
  loadingDom.remove();

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
    floating = appMode === 'game' && !pauseOpen && planet && !ship.visible ? p : null;
    map.mesh.visible = floating === 'map'; craftPanel.mesh.visible = floating === 'craft';
  };

  // Hub: ghost while placing, bench + computer once built
  let placing: 'hub' | PropKind | null = null;
  let ghost: { group: THREE.Group } | null = null;
  let ghostPose: { x: number; z: number; y: number; yaw: number; ok: boolean; reason: string } | null = null;
  let hubUi: { bench: RecipePanel; computer: ComputerScreen } | null = null;
  const lantern = new THREE.PointLight(0xffe2a0, 3, 16, 2);

  const headPos = () => new THREE.Vector3().copy(player.position).add(camera.position);
  const startPlacing = (kind: 'hub' | PropKind) => {
    placing = kind; setPanel(null);
    if (kind === 'hub') ghost = buildHubMesh(true);
    else { const pm = kind === 'campfire' ? buildCampfire(false) : buildLamp(false); makeGhost(pm.group); ghost = pm; }
    scene.add(ghost.group);
    toast('Aim, then pull the trigger (B cancels)', headPos().add(new THREE.Vector3(0, 0.3, 0)));
  };
  /** B while placing: put the thing back in your pocket and refund it. */
  const cancelPlacing = () => {
    if (!placing) return;
    const id = placing === 'hub' ? 'hub' : placing;
    const r = progress.recipe(id);
    for (const k of Object.keys(r.cost) as (keyof typeof r.cost)[]) progress.items[k] += r.cost[k] ?? 0;
    if (!r.repeatable) progress.crafted.delete(id);
    progress.made[id] = Math.max(0, progress.count(id) - 1);
    scene.remove(ghost!.group); ghost = null; placing = null; ghostPose = null;
  };

  const craft = (id: string) => {
    const r = progress.recipe(id);
    if (!r.unlocked(progress) || !progress.canAfford(r.cost)) { sfx.fail(); return; }
    if (!r.repeatable && progress.has(id)) { sfx.fail(); return; }
    if (r.repeatable && progress.propsPlacedOrPending(r.id) >= MAX_PLACED) { sfx.fail(); toast(`Max ${MAX_PLACED} placed`, headPos()); return; }
    if (placing) { sfx.fail(); return; }
    progress.spend(r.cost); progress.made[r.id] = progress.count(r.id) + 1;
    if (!r.repeatable) progress.crafted.add(id);
    sfx.craft();
    if (id === 'hub' || id === 'campfire' || id === 'lamp') startPlacing(id);
    applyGear();
  };

  // ---- Game state: main menu <-> game ----
  let appMode: 'menu' | 'game' = 'menu';
  let planet: Planet | null = null;
  let currentSlot = 0, playSeconds = 0, autosave = 0, pauseOpen = false;
  const MENU_SPAWN = new THREE.Vector3(0, 0, 2.4);

  /** Gear you own changes how you move and mine. Safe to call any time (also after loading a save). */
  const applyGear = () => {
    player.jumpMult = settings.jumpMult; player.maxSpeed = settings.maxSpeed;
    if (progress.has('gloves')) { player.jumpMult = 1.5; player.maxSpeed = 10; }
    if (progress.has('crystalgloves')) { player.jumpMult = 1.8; player.maxSpeed = 12; }
    player.slipScale = progress.has('sticky') ? 0.3 : 1;
    if (planet) player.gravityG = progress.has('plasmacore') ? 0.2 : progress.has('floatcore') ? 0.35 : PLANET_GRAVITY_G;
    if (progress.has('lantern')) {
      const bright = progress.has('copperlantern');
      lantern.intensity = bright ? 6 : 3; lantern.distance = bright ? 28 : 16;
      lantern.position.set(0, -0.2, -0.2); camera.add(lantern);
    } else camera.remove(lantern);
    map.showOre = progress.has('scanner');
  };

  const hookPlanet = (pl: Planet) => {
    pl.onRoar = (pos, kind) => sfx.roar(pos, kind);
    pl.onTreeLanded = pos => sfx.thump(pos);
    pl.onWood = (n, pos) => { const k = n + (progress.has('axe') ? 1 : 0); progress.add('wood', k); progress.treesFelled++; sfx.pickup(); toast(`+${k} wood`, pos); };
    pl.onStone = (n, pos) => { const k = n + (progress.has('ironpick') ? 2 : progress.has('pickaxe') ? 1 : 0); progress.add('stone', k); progress.bouldersBroken++; sfx.crumble(); toast(`+${k} stone`, pos); };
    pl.onCrystal = (n, pos) => { progress.add('crystal', n); sfx.crumble(); sfx.pickup(); toast(`+${n} crystal`, pos); };
    pl.onOre = (type, n, pos) => { progress.add(type, n); progress.mined[type]++; sfx.crumble(); sfx.pickup(); toast(`+${n} ${type}`, pos); };
    pl.onPodDestroyed = pos => { progress.podDestroyed = true; progress.podHits = POD_HITS; progress.add('steel', POD_STEEL); sfx.crumble(); toast(`+${POD_STEEL} steel`, pos); };
  };

  const buildHubUi = (built: { mesh: HubMesh; group: THREE.Group }) => {
    const bench = new RecipePanel('CRAFTING BENCH', RECIPES.filter(r => r.where === 'bench'), progress, id => craft(id), 'Unlock more by exploring', 1.15, 6);
    const computer = new ComputerScreen(() => { progress.gamePlayed = true; });
    bench.mesh.position.copy(built.mesh.benchScreenAt);
    computer.mesh.position.copy(built.mesh.computerScreenAt);
    built.group.add(bench.mesh, computer.mesh);
    hubUi = { bench, computer };
  };

  /** Land on the planet: a fresh landing (d = null) or a loaded save. */
  const startPlanet = (d: SaveData | null) => {
    const pl = new Planet(); planet = pl;
    ship.visible = false;
    scene.add(pl.group);
    player.world = pl.world;
    hookPlanet(pl);
    if (d && d.planet) {
      progress.load(d.progress);
      pl.importState(d.planet);
      if (d.planet.podAlive) pl.placePod(new THREE.Vector3(...d.planet.podHead), new THREE.Vector3(...d.planet.podForward));
      if (pl.hub) buildHubUi(pl.hub);
      applyGear();
      player.teleport(new THREE.Vector3(d.player.x, d.player.y, d.player.z));
      story.phase = 'planet';
    } else {
      player.teleport(new THREE.Vector3(0, 0.1, 0));
      // Your pod sits behind wherever you are facing when you land
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      pl.placePod(new THREE.Vector3().copy(player.position).add(camera.position), fwd.normalize());
      applyGear();
    }
    sfx.startWind();
  };

  const saveGame = (): boolean => {
    const onPlanet = !!planet && (story.phase === 'planet' || story.phase === 'landing');
    const d: SaveData = {
      version: 1, savedAt: Date.now(), playSeconds: Math.round(playSeconds),
      phase: onPlanet ? 'planet' : 'capsule', objective: onPlanet ? progress.objective()[0] : 'In the pod',
      progress: progress.toJSON(), player: { x: player.position.x, y: player.position.y, z: player.position.z },
      planet: onPlanet ? planet!.exportState() : null,
    };
    return writeSlot(currentSlot, d);
  };

  /** Throw away everything about the running game. */
  const resetGame = () => {
    if (planet) { scene.remove(planet.group); disposeObject(planet.group); planet = null; }
    scene.fog = null; scene.background = new THREE.Color(0x05070d);
    progress.reset(); placing = null;
    if (ghost) { scene.remove(ghost.group); ghost = null; }
    ghostPose = null; hubUi = null;
    for (const t of toasts) scene.remove(t.sprite);
    toasts.length = 0;
    floating = null; map.mesh.visible = craftPanel.mesh.visible = false; map.showOre = false;
    camera.remove(lantern);
    player.world = shipWorld; player.gravityG = settings.gravityG; player.jumpMult = settings.jumpMult; player.maxSpeed = settings.maxSpeed; player.slipScale = 1;
    sfx.stopWind(); sfx.stopAlarm(); sfx.rumble(0);
    story.reset(); menu.reset(); ship.position.set(0, 0, 0); overlay.set(0, 0);
    pauseOpen = false; pausePanel.mesh.visible = false;
  };

  const enterMainMenu = (save: boolean) => {
    if (save && appMode === 'game') saveGame();
    resetGame();
    appMode = 'menu'; ship.visible = false; menuRoom.group.visible = true;
    player.world = menuRoom.world; player.teleport(MENU_SPAWN);
    mainPanel.open();
  };

  const beginGame = (slot: number, mode: 'new' | 'load') => {
    const d = mode === 'load' ? readSlot(slot) : null;
    resetGame();
    currentSlot = slot; appMode = 'game'; menuRoom.group.visible = false; autosave = 0;
    playSeconds = d ? d.playSeconds : 0;
    if (d && d.phase === 'planet' && d.planet) startPlanet(d);
    else { ship.visible = true; player.teleport(SPAWN); story.reset(); if (!d) saveGame(); }
  };

  const togglePause = (open?: boolean) => {
    if (appMode !== 'game') return;
    pauseOpen = open ?? !pauseOpen;
    pausePanel.mesh.visible = pauseOpen;
    if (pauseOpen) { pausePanel.open(); setPanel(null); }
  };

  // ---- Story: Play -> alarm -> crash -> title -> planet ----
  const story = new Story({
    onAlarm: () => {
      sfx.ensure(); sfx.startAlarm();
      menu.showMessage(['THRUSTERS FAILED', 'DEPLOYING EMERGENCY', 'BRAKES']);
    },
    onCrash: () => { sfx.stopAlarm(); sfx.crash(); },
    onLand: () => startPlanet(null),
    onSkip: () => { sfx.stopAlarm(); sfx.duck(); },   // B in the capsule: straight to the title
  });

  // ---- Main menu room (slideshow of the map) and the pause menu ----
  const menuRoom = new MenuRoom(slides);
  menuRoom.group.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.2));
  scene.add(menuRoom.group);
  menuRoom.group.visible = false;
  const handlers: MenuHandlers = {
    onStart: (slot, mode) => beginGame(slot, mode),
    onDelete: slot => deleteSlot(slot),
    onResume: () => togglePause(false),
    onSave: () => pausePanel.flash(saveGame() ? 'Game saved' : 'Could not save'),
    onMainMenu: () => enterMainMenu(true),
  };
  const mainPanel = new MenuPanel('main', handlers, 2.0);
  mainPanel.mesh.position.set(0, 1.05, -1.7);
  menuRoom.group.add(mainPanel.mesh);
  const pausePanel = new MenuPanel('pause', handlers, 1.1);
  pausePanel.mesh.visible = false;
  scene.add(pausePanel.mesh);

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
    if (placing) tryPlace();
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
  const keys = { a: false, b: false, x: false, grip: false, menu: false };
  const keyMap: Record<string, keyof typeof keys> = { KeyM: 'a', KeyB: 'b', KeyX: 'x', KeyG: 'grip', Escape: 'menu' };
  addEventListener('keydown', e => { const k = keyMap[e.code]; if (k) keys[k] = true; });
  addEventListener('keyup', e => { const k = keyMap[e.code]; if (k) keys[k] = false; });
  let aPrev = false, bPrev = false, xPrev = false, yPrev = false;

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

  if (debugSkip === 'planet') { appMode = 'game'; menuRoom.group.visible = false; startPlanet(null); story.phase = 'planet'; }
  else enterMainMenu(false);

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
  const tryPlace = () => {
    if (!placing || !planet || !ghostPose) return;
    if (!ghostPose.ok) { sfx.fail(); toast(ghostPose.reason || 'Aim at the ground', headPos()); return; }
    const gp = ghostPose, kind = placing;
    scene.remove(ghost!.group); ghost = null; placing = null; ghostPose = null;
    if (kind === 'hub') {
      const built = planet.placeHub(gp.x, gp.z, gp.yaw, gp.y);
      progress.hubPlaced = true;
      buildHubUi(built);
      sfx.craft(); sfx.thump(new THREE.Vector3(gp.x, gp.y, gp.z));
      toast('Hub built!', new THREE.Vector3(gp.x, gp.y + 3.5, gp.z));
    } else {
      planet.placeProp(kind, gp.x, gp.z);
      sfx.craft(); sfx.thump(new THREE.Vector3(gp.x, gp.y, gp.z));
      toast(kind === 'campfire' ? 'Campfire lit!' : 'Lamp placed!', new THREE.Vector3(gp.x, gp.y + 2, gp.z));
    }
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

    const simDt = appMode === 'game' && pauseOpen ? 0 : dt; // the game stands still while the pause menu is open
    if (appMode === 'game' && !pauseOpen) { playSeconds += dt; }
    story.update(simDt);

    // Buttons
    const aNow = keys.a || handBtn('right', 4), bNow = keys.b || handBtn('right', 5), xNow = keys.x || handBtn('left', 4), yNow = keys.menu || handBtn('left', 5);
    if (appMode === 'game') {
      if (yNow && !yPrev) togglePause();                                        // Y / Esc: pause menu
      if (!pauseOpen) {
        if (aNow && !aPrev) setPanel(floating === 'map' ? null : 'map');        // A: map
        if (xNow && !xPrev) setPanel(floating === 'craft' ? null : 'craft');    // X: crafting
        if (bNow && !bPrev) { if (ship.visible) story.skipToTitle(); else cancelPlacing(); } // B: skip the crash scene (capsule) / cancel placing (planet)
      }
    }
    aPrev = aNow; bPrev = bNow; xPrev = xNow; yPrev = yNow;
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
      player.update(simDt, camera.position, handLocals);
    } else {
      camera.position.copy(headStand);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      player.update(simDt, headStand, [null, null]);
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
    if (planet && appMode === 'game' && !pauseOpen && !ship.visible) {
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
        } else if (id >= ORE_OWNER) {
          const left = planet!.hitOre(id - ORE_OWNER, progress.has('ironpick') ? 'iron' : progress.has('pickaxe') ? 'pick' : 'hand');
          if (left) sfx.clink(); buzz(i, 1, 90);
        } else if (id >= CRYSTAL_OWNER) {
          const left = planet!.hitCrystal(id - CRYSTAL_OWNER, progress.has('pickaxe') ? 1 : CRYSTAL_HITS);
          if (left) sfx.clink(); buzz(i, 1, 90);
        } else if (id >= BOULDER_OWNER) {
          const left = planet!.hitBoulder(id - BOULDER_OWNER, progress.has('pickaxe') ? 1 : BOULDER_HITS);
          if (left) sfx.clink(); buzz(i, 1, 90);
        } else {
          const left = planet!.hitTree(id, headW, progress.has('axe') ? 1 : TREE_HITS);
          sfx.chop(); buzz(i, 1, 90);
          if (left > 0) toast(`${left} more hit`, new THREE.Vector3(planet!.trees[id].x, planet!.trees[id].y + 2, planet!.trees[id].z));
        }
      });
    }

    // Everything you can point at right now
    scene.updateMatrixWorld(true);
    const targets: Interactive[] = [];
    if (appMode === 'menu') targets.push(mainPanel);
    else if (pauseOpen) targets.push(pausePanel);
    else if (ship.visible) targets.push(menu);
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
    if (inXR) lasers.forEach((l, i) => setHover(i, l.castMany(meshes, !!placing)));
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
    if (appMode === 'menu') { menuRoom.update(dt); mainPanel.update(dt); }
    if (pauseOpen) {
      const target = headW.clone().addScaledVector(fwd, 0.85); target.y = headW.y - 0.05;
      pausePanel.mesh.position.lerp(target, 1 - Math.exp(-8 * dt));
      pausePanel.mesh.lookAt(headW);
      pausePanel.update(dt);
    }
    if (floating && planet) {
      const panel = floating === 'map' ? map.mesh : craftPanel.mesh;
      const target = headW.clone().addScaledVector(fwd, 0.85); target.y = headW.y - 0.1;
      panel.position.lerp(target, 1 - Math.exp(-8 * dt));
      panel.lookAt(headW);
      if (floating === 'map') map.update(dt, planet, headW.x, headW.z, fwd.x, fwd.z); else craftPanel.update();
    }
    if (hubUi) { hubUi.bench.update(); hubUi.computer.update(dt); }

    // Placement ghost follows your aim
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
        const snap = Math.PI / 12;
        const yawH = Math.round(Math.atan2(-fwd.z, fwd.x) / snap) * snap; // hub: long axis along your facing
        const res = placing === 'hub' ? planet.canPlaceHub(hit.x, hit.z, yawH) : planet.canPlaceProp(hit.x, hit.z);
        if (res.ok && placing === 'hub' && Math.hypot(hit.x - headW.x, hit.z - headW.z) < 8) { res.ok = false; res.reason = 'Too close: step back'; }
        ghostPose = { x: hit.x, z: hit.z, y: res.y, yaw: placing === 'hub' ? yawH : 0, ok: res.ok, reason: res.reason };
        ghost.group.position.set(hit.x, res.y, hit.z); ghost.group.rotation.y = ghostPose.yaw;
        (ghost.group.userData.ghostMaterial as THREE.MeshBasicMaterial | undefined)?.color.set(res.ok ? 0x55ff88 : 0xff5555);
      } else ghostPose = null;
    }

    // Wrist displays and the desktop text overlay
    const obj = progress.objective();
    resourceHud.set(progress); objectiveHud.set(obj);
    hudDom.style.display = appMode === 'game' && planet && !inXR && !pauseOpen ? 'block' : 'none';
    hudDom.textContent = `OBJECTIVE: ${obj[0]}\n${obj[1]}\nwood ${progress.items.wood}  stone ${progress.items.stone}  steel ${progress.items.steel}\n[M] map  [X] craft  [G+punch] hit  [click] use`;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i]; t.t += dt;
      t.sprite.position.y += dt * 0.8;
      (t.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t.t / 2.2);
      if (t.t > 2.2) { scene.remove(t.sprite); toasts.splice(i, 1); }
    }

    if (inXR || planet) sfx.setListener(headW, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    if (planet) planet.update(simDt, scene, player.position, headW);
    if (appMode === 'game' && planet && story.phase === 'planet' && !pauseOpen && (autosave += dt) > 45) { autosave = 0; saveGame(); }

    renderer.render(scene, camera);
  });

  // Exposed for debugging / automated tests
  (window as unknown as Record<string, unknown>).__game = {
    progress, craft, tryPlaceHub: () => tryPlace(), cancelPlacing, setPanel, camera, beginGame, enterMainMenu, saveGame, togglePause, mainPanel, pausePanel, menuRoom,
    get appMode() { return appMode; }, get pauseOpen() { return pauseOpen; }, renderer, scene, player, story, settings, menu,
    fell: (id: number) => planet?.fellTree(id, new THREE.Vector3(0, 0, 0)),
    look: (y: number, p: number) => { yaw = y; pitch = p; },
    get placing() { return placing; }, get ghostPose() { return ghostPose; }, get hubUi() { return hubUi; },
    get planet() { return planet; },
  };
}

boot();
