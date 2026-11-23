import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CollisionWorld } from './physics/CollisionWorld';
import { GorillaPlayer } from './player/GorillaPlayer';
import { ArmCalibration } from './player/ArmCalibration';
import { buildCapsule } from './world/Capsule';
import { Planet, POD_OWNER, BOULDER_OWNER, CRYSTAL_OWNER, ORE_OWNER, MACHINE_OWNER, CRASH_OWNER, Loot, Harvest } from './world/Planet';
import { BuildSystem, BuildState, Plan, Piece, PieceType, PALETTE, COST as BUILD_COST, COLOR_COST, geometry as pieceGeometry } from './world/BuildSystem';
import { BuildPanel } from './ui/BuildPanel';
import { Narrator, LINES, Line } from './ui/Narrator';
import { D } from './ui/dialogue';
import { Net, playerId } from './net/Multiplayer';
import type { RealmSeed } from './net/Multiplayer';
import { Voice } from './net/Voice';
import { LoadingScreen } from './ui/LoadingScreen';
import { RemotePlayers } from './world/RemotePlayers';
import { PlayerModel } from './world/PlayerModel';
import { Health, Gear, damagePerSecond, fallDamage } from './game/Hazards';
import { toWorld } from './world/Hub';
import { Factory, MachineKind, ITEM_NAME, FactoryState, Wire, HUB_NODE, HUB_PLUG_RANGE, WIRE_RANGE } from './game/Factory';
import { FactoryView, buildMachineMesh } from './world/FactoryView';
import { MachinePanel, MachineAction } from './ui/MachinePanel';
import { MenuRoom, Slide } from './world/MenuRoom';
import { takeSnapshots } from './world/Snapshots';
import { MenuPanel, MenuHandlers } from './ui/MenuPanel';
import { SaveData, readSlot, writeSlot, deleteSlot, formatAgo } from './game/Save';
import { RealmSave, listRealms, readRealm, writeRealm, deleteRealm, listJoined, rememberJoined, forgetJoined } from './game/Realm';
import { disposeObject } from './util/dispose';
import { buildCampfire, buildLamp, makeGhost, PropKind } from './world/Props';
import { buildHubMesh, HubMesh } from './world/Hub';
import { heightAt, WATER_Y } from './world/Terrain';
import { MenuConsole } from './ui/MenuConsole';
import { TelemetryScreen } from './ui/TelemetryScreen';
import { LaserPointer } from './ui/LaserPointer';
import { Overlay } from './ui/Overlay';
import { MapMenu } from './ui/MapMenu';
import { RecipePanel } from './ui/RecipePanel';
import { ComputerScreen } from './ui/ComputerScreen';
import { ResourceHud, ObjectiveHud } from './ui/Hud';
import { Progress, RECIPES, POD_HITS, POD_STEEL, BOULDER_HITS, TREE_HITS, CRYSTAL_HITS, MAX_PLACED, MAX_MACHINES } from './game/Progress';
import { Story } from './game/Story';
import { Sfx } from './audio/Sfx';
import { loadSettings, saveSettings } from './settings';

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
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
      const snapPlanet = new Planet(7, settings.graphics);
      scene.add(snapPlanet.group);
      slides = await takeSnapshots(renderer, scene, snapPlanet);
      scene.remove(snapPlanet.group); disposeObject(snapPlanet.group);
    } catch (e) { console.warn('slideshow unavailable', e); }
    scene.fog = null; scene.background = new THREE.Color(0x05070d);
  }
  loadingDom.remove();

  const sfx = new Sfx();
  sfx.setVolume(settings.volume);
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
  const narrator = new Narrator(camera, () => settings.volume);
  const health = new Health();
  const chat = (key: string, cooldown = 60, low = false) => { const v = D[key]; return v ? narrator.sometimes(key, v, cooldown, low) : false; };
  const first = (key: string) => { const v = D[key]; if (v) narrator.once(key, v[0]); };
  const say = (key: keyof typeof LINES) => narrator.once(key, [...LINES[key]] as Line[]);

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
    if (p === 'map') first('map');
    floating = appMode === 'game' && !pauseOpen && planet && !ship.visible ? p : null;
    map.mesh.visible = floating === 'map'; craftPanel.mesh.visible = floating === 'craft';
  };

  // Hub: ghost while placing, bench + computer once built
  const MACHINE_KINDS: MachineKind[] = ['miner', 'smelter', 'constructor', 'storage', 'burner', 'solar', 'splitter', 'sink', 'pole'];
  const isMachine = (k: string | null): k is MachineKind => !!k && (MACHINE_KINDS as string[]).includes(k);
  const factory = new Factory();
  // Created here (not next to machineAction) because resetGame() uses it during boot; the action is late-bound.
  const machinePanel = new MachinePanel(factory, (a, id, arg) => machineAction(a, id, arg), () => progress.has('overclockst') && progress.items.core > 0);
  machinePanel.mesh.visible = false; scene.add(machinePanel.mesh);
  let factoryView: FactoryView | null = null;
  let lastPhase = 'day', knownSites = 0, hubSeen = false, idleT = 120;
  let linkKind: 'belt' | 'power' = 'belt';
  let linkMode = false, linkFrom: number | null = null, wasTripped = false;
  let hoveredMachine: number | null = null, selectedMachine: number | null = null, selectHold = 0;
  let placing: 'hub' | PropKind | MachineKind | null = null;
  let ghost: { group: THREE.Group } | null = null;
  let ghostPose: { x: number; z: number; y: number; yaw: number; ok: boolean; reason: string } | null = null;
  let hubUi: { bench: RecipePanel; computer: ComputerScreen; upgrades: RecipePanel; research: RecipePanel } | null = null;

  // ---- Building: foundations, walls and catwalks ----
  let buildSystem: BuildSystem | null = null;
  let buildActive = false;
  let buildPlan: Plan | null = null, buildTarget: Piece | null = null;
  const buildPanel = new BuildPanel(() => progress.colors, () => progress.items.token, i => {
    if (progress.items.token < COLOR_COST) { sfx.fail(); return false; }
    progress.items.token -= COLOR_COST; progress.colors.push(i); sfx.craft(); return true;
  }, () => setBuild(false));
  buildPanel.mesh.visible = false; scene.add(buildPanel.mesh);
  const buildGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.4, depthWrite: false }));
  buildGhost.visible = false; scene.add(buildGhost);
  const setBuild = (on: boolean) => {
    buildActive = on && !!planet && !!buildSystem;
    buildPanel.mesh.visible = buildActive; if (!buildActive) { buildGhost.visible = false; buildPlan = null; buildTarget = null; } else { setPanel(null); linkMode = false; }
  };
  const lantern = new THREE.PointLight(0xffe2a0, 3, 16, 2);

  const headPos = () => new THREE.Vector3().copy(player.position).add(camera.position);
  const startPlacing = (kind: 'hub' | PropKind | MachineKind) => {
    placing = kind; setPanel(null);
    if (kind === 'hub') ghost = buildHubMesh(true);
    else if (isMachine(kind)) { const mm = buildMachineMesh(kind); makeGhost(mm.group); ghost = mm; }
    else { const pm = kind === 'campfire' ? buildCampfire(false) : buildLamp(false); makeGhost(pm.group); ghost = pm; }
    scene.add(ghost.group);
    toast('Aim, then pull the trigger (B cancels)', headPos().add(new THREE.Vector3(0, 0.3, 0)));
  };
  /** B while placing: put the thing back in your pocket and refund it. */
  const cancelPlacing = () => {
    if (!placing) return;
    const id = placing;
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
    if ((id === 'campfire' || id === 'lamp') && progress.propsPlacedOrPending(r.id) >= MAX_PLACED) { sfx.fail(); toast(`Max ${MAX_PLACED} placed`, headPos()); return; }
    if (isMachine(id) && factory.machines.length >= MAX_MACHINES) { sfx.fail(); toast(`Max ${MAX_MACHINES} machines`, headPos()); return; }
    if (placing) { sfx.fail(); return; }
    if (id === 'buildtool') { setBuild(!buildActive); sfx.craft(); toast(buildActive ? 'Build mode: pick a piece, aim and pull the trigger' : 'Build mode off', headPos()); return; }
    if (id === 'conveyor' || id === 'powerline') { // tools: join two machines with a belt / a power line
      const kind = id === 'powerline' ? 'power' : 'belt';
      linkMode = !(linkMode && linkKind === kind); linkKind = kind; linkFrom = null; setPanel(null); sfx.craft();
      toast(linkMode ? (kind === 'power' ? 'Power line mode: aim at a pole, trigger, then aim at a machine. B stops' : 'Link mode: aim at a machine, trigger. B stops') : 'Link mode off', headPos());
      return;
    }
    progress.spend(r.cost); progress.made[r.id] = progress.count(r.id) + 1;
    if (!r.repeatable) progress.crafted.add(id);
    sfx.craft();
    if (r.gives) { for (const k of Object.keys(r.gives) as (keyof typeof r.gives)[]) progress.items[k] += r.gives[k] ?? 0; sfx.pickup(); toast(`+${Object.entries(r.gives).map(([k, n]) => `${n} ${k}`).join(', ')}`, headPos()); }
    if (id === 'hub' || id === 'campfire' || id === 'lamp' || isMachine(id)) startPlacing(id);
    chat('craft_' + id, 5);
    if (id === 'lab') say('lab');
    if (id === 'beacon') say('beacon');
    if (id === 'reactor') say('reactor');
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
    if (!(net.state === 'game' && !net.isHost)) { // in a lobby the host's factory settings rule (they arrive with its snapshots)
      factory.alt = { plate: progress.has('altplate'), wire: progress.has('altwire'), smelt: progress.has('altsmelt'), efficiency: progress.has('efficiency') };
      factory.roofSolar = progress.has('solarroof') ? 1.2 : 0;
      factory.reactor = progress.has('reactor') ? 4 : 0;
    }
    if (progress.has('bladerunners')) { player.maxSpeed += 4; player.jumpMult += 0.2; }
    planet?.setBeacon(progress.has('beacon'));
  };

  const hookPlanet = (pl: Planet) => {
    pl.onRoar = (pos, kind) => { sfx.roar(pos, kind); chat(kind === 'serpent' ? 'roar_serpent' : kind === 'manta' ? 'roar_manta' : 'creature', 90, true); };
    pl.onTreeLanded = pos => sfx.thump(pos);
    pl.onHarvest = (k, i) => net.sendWorld(k, i);
    pl.onWood = (n, pos) => { const k = n + (progress.has('axe') ? 1 : 0); progress.add('wood', k); progress.treesFelled++; sfx.pickup(); toast(`+${k} wood`, pos); first('firstWood'); if (progress.treesFelled % 6 === 0) chat('chop', 40, true); if (progress.items.wood >= 50) first('milestoneWood'); };
    pl.onStone = (n, pos) => { const k = n + (progress.has('ironpick') ? 2 : progress.has('pickaxe') ? 1 : 0); progress.add('stone', k); progress.bouldersBroken++; sfx.crumble(); toast(`+${k} stone`, pos); first('firstStone'); if (progress.bouldersBroken % 5 === 0) chat('rock', 40, true); };
    pl.onCrystal = (n, pos) => { progress.add('crystal', n); sfx.crumble(); sfx.pickup(); toast(`+${n} crystal`, pos); first('firstCrystal'); };
    pl.onOre = (type, n, pos) => { progress.add(type, n); progress.mined[type]++; sfx.crumble(); sfx.pickup(); toast(`+${n} ${type}`, pos); first('firstOre'); const ok = 'ore' + type.charAt(0).toUpperCase() + type.slice(1); if (D[ok]) first(ok); };
    pl.onPodDestroyed = pos => { progress.podDestroyed = true; progress.podHits = POD_HITS; progress.add('steel', POD_STEEL); sfx.crumble(); toast(`+${POD_STEEL} steel`, pos); say('podSmashed'); };
    pl.onLoot = (_i: number, loot: Loot, pos: THREE.Vector3) => {
      const parts: string[] = [];
      for (const [k, n] of Object.entries(loot) as [keyof Loot, number][]) { if (!n) continue; progress.items[k] += n; parts.push(`${n} ${k}`); }
      progress.lootOpened++; sfx.crumble(); sfx.pickup(); toast(`Loot: ${parts.join(', ')}`, pos);
      say('loot'); chat(loot.core && loot.artifact ? 'lootRare' : 'loot', 45, true);
      if (loot.artifact) { say('artifact'); if (progress.items.artifact >= 3) say('artifact3'); const n = progress.items.artifact; if (D['artifact' + n]) first('artifact' + n); }
    };
  };

  const buildHubUi = (built: { mesh: HubMesh; group: THREE.Group }) => {
    const bench = new RecipePanel('CRAFTING BENCH', RECIPES.filter(r => r.where === 'bench'), progress, id => craft(id), 'Unlock more by exploring', 1.15, 6);
    const computer = new ComputerScreen(() => { progress.gamePlayed = true; first('arcade'); });
    bench.mesh.position.copy(built.mesh.benchScreenAt);
    computer.mesh.position.copy(built.mesh.computerScreenAt);
    built.group.add(bench.mesh, computer.mesh);
    const upgrades = new RecipePanel('HUB UPGRADES', RECIPES.filter(r => r.where === 'hub'), progress, id => craft(id), 'Upgrades change the whole Hub', 1.15, 6);
    const research = new RecipePanel('RESEARCH', RECIPES.filter(r => r.where === 'lab'), progress, id => craft(id), 'Needs the Research Lab and data drives', 1.15, 6);
    upgrades.mesh.position.copy(built.mesh.upgradeScreenAt); research.mesh.position.copy(built.mesh.researchScreenAt);
    upgrades.mesh.rotation.y = Math.PI; research.mesh.rotation.y = Math.PI; // they hang on the front wall, facing in
    built.group.add(upgrades.mesh, research.mesh);
    hubUi = { bench, computer, upgrades, research };
  };

  /** Rebuild machines and belts from a save. */
  const restoreFactory = (pl: Planet, st: NonNullable<SaveData['planet']>['factory'] & object) => {
    factory.load(st);
    for (const mc of factory.machines) {
      factoryView!.addMachine(mc); pl.addMachineCollider(mc.id, mc.x, mc.y, mc.z);
      if (mc.ore) pl.setOreOccupied(mc.ore.index, true);
    }
    for (const l of factory.links) {
      const a = factory.get(l.from), b = factory.get(l.to);
      if (a && b) factoryView!.addLink(l, new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z));
    }
    for (const w of factory.wires) addWireView(w);
  };
  /** Where a power line meets a node: a machine's plug point, or the Hub's. */
  const plugPoint = (id: number): THREE.Vector3 | null => {
    if (id === HUB_NODE) { const h = planet?.hub?.pose; return h ? new THREE.Vector3(h.x, h.y + 3.3, h.z) : null; }
    const m = factory.get(id); return m ? FactoryView.plug(m.kind, m.x, m.y, m.z) : null;
  };
  const addWireView = (w: Wire) => { const a = plugPoint(w.a), b = plugPoint(w.b); if (a && b) factoryView?.addWire(w, a, b); };
  /** A pole built next to the Hub plugs into it by itself. */
  const plugToHub = (mc: { id: number; kind: string; x: number; z: number }) => {
    const h = planet?.hub?.pose;
    if (mc.kind !== 'pole' || !h || Math.hypot(h.x - mc.x, h.z - mc.z) > HUB_PLUG_RANGE) return;
    const w = factory.wire(mc.id, HUB_NODE); if (typeof w !== 'string') addWireView(w);
  };

  /** Land on the planet: a fresh landing (d = null) or a loaded save. */
  const startPlanet = (d: SaveData | null) => {
    const pl = new Planet(7, d?.planet?.quality ?? settings.graphics); planet = pl;
    ship.visible = false;
    scene.add(pl.group);
    player.world = pl.world;
    hookPlanet(pl);
    factory.reset();
    factoryView = new FactoryView(); pl.group.add(factoryView.group);
    buildSystem = new BuildSystem(pl.world); pl.group.add(buildSystem.group);
    if (d && d.planet) {
      progress.load(d.progress);
      pl.importState(d.planet);
      if (d.planet.podAlive) pl.placePod(new THREE.Vector3(...d.planet.podHead), new THREE.Vector3(...d.planet.podForward));
      if (pl.hub) buildHubUi(pl.hub);
      if (d.planet.factory) restoreFactory(pl, d.planet.factory);
      if (d.planet.build) buildSystem.load(d.planet.build);
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
      say('landed');
    }
    sfx.startWind();
  };

  const buildSave = (): SaveData => {
    const onPlanet = !!planet && (story.phase === 'planet' || story.phase === 'landing');
    return {
      version: 2, savedAt: Date.now(), playSeconds: Math.round(playSeconds),
      phase: onPlanet ? 'planet' : 'capsule', objective: onPlanet ? progress.objective()[0] : 'In the pod',
      progress: progress.toJSON(), player: { x: player.position.x, y: player.position.y, z: player.position.z },
      planet: onPlanet ? { ...planet!.exportState(), factory: factory.toJSON(), build: buildSystem?.toJSON() } : null,
    };
  };
  const saveGame = (): boolean => {
    if (currentSlot < 0) return false; // lobby games are saved as realms instead (see saveRealm)
    return writeSlot(currentSlot, buildSave());
  };

  /** Throw away everything about the running game. */
  const resetGame = () => {
    if (planet) { scene.remove(planet.group); disposeObject(planet.group); planet = null; }
    scene.fog = null; scene.background = new THREE.Color(0x05070d);
    progress.reset(); placing = null;
    if (ghost) { scene.remove(ghost.group); ghost = null; }
    ghostPose = null; hubUi = null;
    health.reset(); overlay.setTint(0, 0); factory.reset(); factoryView = null; buildSystem = null; setBuild(false); narrator.clearTold(); lastPhase = 'day'; knownSites = 0; hubSeen = false; idleT = 120; machinePanel.show(null); linkMode = false; linkFrom = null; selectedMachine = null; hoveredMachine = null;
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
    if (save && appMode === 'game' && currentSlot >= 0) saveGame();
    leaveLobby();
    resetGame();
    appMode = 'menu'; ship.visible = false; menuRoom.group.visible = true;
    player.world = menuRoom.world; player.teleport(MENU_SPAWN);
    mainPanel.open();
  };

  // ---- Multiplayer: lobbies over WebRTC, then everyone lands on the same planet ----
  const net = new Net();
  const remotes = new RemotePlayers();
  scene.add(remotes.group);
  const voice = new Voice();
  const lobbyInfo = () => net.state === 'off' ? null : {
    allowSaving: net.allowSaving, maxPlayers: net.maxPlayers, realm: net.members !== null, mic: voice.state, code: net.code, isHost: net.isHost, status: net.state, error: net.error,
    players: net.list.map(p => ({ name: p.name + (p.id === net.me.id ? ' (you)' : ''), color: p.color })),
  };
  const refreshLobby = () => {
    const l = lobbyInfo(); mainPanel.setLobby(l); pausePanel.setLobby(l); remotes.setPlayers(net.list, net.me.id);
    if (net.state === 'lobby' || net.state === 'game') {
      void voice.sync(net.peerObj, net.me.id, net.list.map(p => p.id)).then(() => { const l2 = lobbyInfo(); mainPanel.setLobby(l2); pausePanel.setLobby(l2); });
    } else voice.stop();
  };
  const toggleMic = () => { voice.toggleMute(); const l = lobbyInfo(); mainPanel.setLobby(l); pausePanel.setLobby(l); };
  net.onChange = refreshLobby;
  net.onPose = (id, p) => remotes.pose(id, p);
  net.onLeave = id => remotes.remove(id);
  net.onWorld = (k, i, d) => applyWorldEvent(k, i, d);
  net.onClock = c => { if (planet && Math.abs(planet.clock - c) > 1.5) planet.clock = c; };
  let pendingRealm: RealmSave | null = null;   // the realm this host is hosting (its saved world loads when they press START)
  net.getClock = () => planet?.clock ?? pendingRealm?.world.planet?.clock ?? 40;
  let factoryDirty = false, snapT = 0, sentBuildV = -1;
  const markFactory = () => { factoryDirty = true; };
  const applyWorldEvent = (k: string, i: number, d?: number[]) => {
    if (!planet) return;
    if (k === 'hub') { if (!planet.hub && d) { const built = planet.placeHub(d[0], d[1], d[2], d[3]); progress.hubPlaced = true; progress.crafted.add('hub'); buildHubUi(built); } }
    else if (k === 'prop') { if (d) planet.placeProp(d[0] === 0 ? 'campfire' : 'lamp', d[1], d[2]); }
    else planet.applyRemote(k as Harvest, i);
  };
  const applyFactoryState = (d: unknown) => {
    if (!planet || !factoryView || net.isHost) return;
    const diff = factory.applyState(d as FactoryState), at = (id: number) => { const m = factory.get(id); return m ? new THREE.Vector3(m.x, m.y, m.z) : null; };
    for (const l of diff.removedL) factoryView.removeLink(l.id);
    for (const w of diff.removedW) factoryView.removeWire(w.id);
    for (const m of diff.removedM) {
      if (m.ore) planet.setOreOccupied(m.ore.index, false);
      factoryView.removeMachine(m.id); planet.removeMachineCollider(m.id);
      if (selectedMachine === m.id) { selectedMachine = null; machinePanel.show(null); }
    }
    for (const m of diff.addedM) { factoryView.addMachine(m); planet.addMachineCollider(m.id, m.x, m.y, m.z); if (m.ore) planet.setOreOccupied(m.ore.index, true); }
    for (const l of diff.addedL) { const a = at(l.from), b = at(l.to); if (a && b) factoryView.addLink(l, a, b); }
    for (const w of diff.addedW) addWireView(w);
  };
  net.onOp = (from, op) => hostOp(from, op);
  net.onFactory = applyFactoryState;
  net.onBuild = d => { if (buildSystem && !net.isHost) buildSystem.load(d as BuildState); };
  net.snapshots = () => ({ f: factory.toJSON(), b: buildSystem?.toJSON() ?? null });
  net.onStart = clock => { if (appMode !== 'game' || currentSlot >= 0) withLoading(() => beginMultiplayer(clock)); };
  const leaveLobby = () => { pendingRealm = null; net.leave(); remotes.clear(); const l = lobbyInfo(); mainPanel.setLobby(l); pausePanel.setLobby(l); };
  const beginMultiplayer = (clock: number) => {
    resetGame();
    currentSlot = -1; appMode = 'game'; menuRoom.group.visible = false; autosave = 0; playSeconds = 0;
    const realmWorld = net.isHost ? pendingRealm?.world ?? null : null;
    startPlanet(realmWorld && realmWorld.planet ? realmWorld : null); story.phase = 'planet';
    if (net.isHost && realmWorld) playSeconds = realmWorld.playSeconds;
    if (planet) { if (!realmWorld) planet.clock = clock; for (const [k, i, d] of net.worldLog) applyWorldEvent(k, i, d); if (!net.isHost) { if (net.lastFactory) applyFactoryState(net.lastFactory); if (net.lastBuild && buildSystem) buildSystem.load(net.lastBuild as BuildState); } }
    // spread friends out a little so nobody lands inside anyone else
    const idx = Math.max(0, net.list.map(p => p.id).sort().indexOf(net.me.id));
    if (!realmWorld) player.teleport(new THREE.Vector3(Math.cos(idx * 1.3) * idx * 2.5, 0.1, Math.sin(idx * 1.3) * idx * 2.5));
    // a member coming back to a realm gets their own inventory and place back
    if (!net.isHost && net.restoreData) {
      const r = net.restoreData; net.restoreData = null;
      progress.load(r.progress as Parameters<typeof progress.load>[0]); applyGear();
      if (r.pos) player.teleport(new THREE.Vector3(r.pos[0], r.pos[1] + 0.1, r.pos[2]));
      toast('Welcome back: your progress is restored', headPos());
    }
    refreshLobby();
  };

  // ---- Realms: a saved multiplayer world with a member list ----
  net.onSaved = (code, host) => { rememberJoined(code, host); toast(`${host} saved the realm`, headPos()); };
  net.onSaveReq = () => ({ d: progress.toJSON(), pos: [player.position.x, player.position.y, player.position.z] });
  let savingRealm = false;
  const saveRealm = async (silent = false): Promise<boolean> => {
    if (!(net.isHost && net.state === 'game' && net.allowSaving && planet) || savingRealm) return false;
    savingRealm = true;
    try {
      const world = buildSave();
      const got = await net.collectProgress();
      const old = net.members ? Object.fromEntries(net.members) : {};
      const members: RealmSave['members'] = { ...old, [playerId()]: { name: net.me.name, color: net.me.color } };
      const progressOf: RealmSave['progressOf'] = {};
      for (const [pid, v] of net.memberData) progressOf[pid] = v;        // people who are not here keep what they had
      for (const m of net.connectedPids) {
        members[m.pid] = { name: m.name, color: m.color };
        const g = got.get(m.pid); if (g) progressOf[m.pid] = { progress: g.progress, pos: g.pos };
      }
      delete progressOf[playerId()];
      const realm: RealmSave = { version: 1, code: net.code, savedAt: Date.now(), hostName: net.me.name, maxPlayers: net.maxPlayers, members, progressOf, world };
      if (!writeRealm(realm)) { if (!silent) toast('Could not save the realm', headPos()); return false; }
      net.members = new Map(Object.entries(members)); net.memberData = new Map(Object.entries(progressOf));
      net.announceSaved(); refreshLobby();
      if (!silent) { sfx.craft(); toast(`Realm saved (${Object.keys(members).length} members)`, headPos()); }
      return true;
    } finally { savingRealm = false; }
  };
  const realmEntries = () => [
    ...listRealms().map(r => ({ code: r.code, kind: 'host' as const, line1: `${Object.keys(r.members).length} members`, line2: `you host - ${formatAgo(r.savedAt)}` })),
    ...listJoined().map(j => ({ code: j.code, kind: 'member' as const, line1: `host ${j.host}`, line2: `member - ${formatAgo(j.savedAt)}` })),
  ];
  /** The world's record of what has been used up, for friends who join a realm that is loaded from a save. */
  const seedRealmWorld = () => {
    const st = pendingRealm?.world.planet; if (!st) return;
    const ev: [string, number, number[]?][] = [];
    st.felledTrees.forEach(i => ev.push(['tree', i])); st.brokenBoulders.forEach(i => ev.push(['boulder', i])); st.brokenCrystals.forEach(i => ev.push(['crystal', i]));
    st.brokenOres.forEach(i => ev.push(['ore', i])); (st.lootedSites ?? []).forEach(i => ev.push(['site', i]));
    if (st.hub) ev.push(['hub', 0, [st.hub.x, st.hub.z, st.hub.yaw, st.hub.y]]);
    st.props.forEach((p, i) => ev.push(['prop', 1000 + i, [p.kind === 'campfire' ? 0 : 1, p.x, p.z]]));
    net.seedWorld(ev);
  };

  // ---- Loading screen: shown while a world is being built ----
  const loading = new LoadingScreen(net.me.color);
  const fastLoad = new URLSearchParams(location.search).has('fastload');
  let loadJob: (() => void) | null = null, loadFrames = 0, loadMin = 0;
  /** Show the loading screen, run `job` a few frames later (so the screen is up first), and keep it up for a moment. */
  const withLoading = (job: () => void, minSeconds = 4) => {
    loading.show(); loadJob = job; loadFrames = 0; loadMin = fastLoad ? 0 : minSeconds;
  };

  const beginGame = (slot: number, mode: 'new' | 'load') => {
    const d = mode === 'load' ? readSlot(slot) : null;
    resetGame();
    currentSlot = slot; appMode = 'game'; menuRoom.group.visible = false; autosave = 0;
    playSeconds = d ? d.playSeconds : 0;
    if (d && d.phase === 'planet' && d.planet) startPlanet(d);
    else { ship.visible = true; player.teleport(SPAWN); story.reset(); chat('capsuleStart', 0); if (!d) saveGame(); }
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
      sfx.ensure(); sfx.startAlarm(); chat('podAlarm', 0);
      menu.showMessage(['THRUSTERS FAILED', 'DEPLOYING EMERGENCY', 'BRAKES']);
    },
    onCrash: () => { sfx.stopAlarm(); sfx.crash(); chat('podCrash', 0); },
    onLand: () => withLoading(() => startPlanet(null), 3.5),
    onSkip: () => { sfx.stopAlarm(); sfx.duck(); },   // B in the capsule: straight to the title
  });

  // ---- Main menu room (slideshow of the map) and the pause menu ----
  const menuRoom = new MenuRoom(slides);
  menuRoom.group.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.2));
  scene.add(menuRoom.group);
  menuRoom.group.visible = false;
  const handlers: MenuHandlers = {
    onStart: (slot, mode) => { const d = mode === 'load' ? readSlot(slot) : null; if (d && d.phase === 'planet') withLoading(() => beginGame(slot, mode)); else beginGame(slot, mode); },
    onDelete: slot => deleteSlot(slot),
    onResume: () => togglePause(false),
    onSave: () => {
      if (currentSlot >= 0) { pausePanel.flash(saveGame() ? 'Game saved' : 'Could not save'); return; }
      if (!net.isHost) { pausePanel.flash('Only the host can save the realm'); return; }
      if (!net.allowSaving) { pausePanel.flash('Turn SAVE on (top right) to save'); return; }
      pausePanel.flash('Saving the realm...'); void saveRealm().then(ok => pausePanel.flash(ok ? 'Realm saved' : 'Could not save the realm'));
    },
    onMainMenu: () => enterMainMenu(true),
    onSettings: () => {
      saveSettings(settings); sfx.setVolume(settings.volume);
      renderer.setPixelRatio(settings.graphics === 'low' ? 1 : Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
    },
    onResetArms: () => { settings.armSpan = 0; saveSettings(settings); },
    onHost: () => { pendingRealm = null; net.host(); },
    onJoin: code => net.join(code),
    onLeaveLobby: () => leaveLobby(),
    onStartLobby: () => { if (net.isHost && net.members) seedRealmWorld(); net.start(); },
    onToggleSaving: () => { if (net.isHost) { net.allowSaving = !net.allowSaving; refreshLobby(); } },
    onCycleMax: () => { if (net.isHost) { net.maxPlayers = net.maxPlayers >= 8 ? 2 : net.maxPlayers + 1; refreshLobby(); } },
    realms: realmEntries,
    onRealmHost: code => { const r = readRealm(code); if (!r) return; pendingRealm = r; const seed: RealmSeed = { code: r.code, maxPlayers: r.maxPlayers, members: r.members, progressOf: r.progressOf as RealmSeed['progressOf'] }; net.host(0, seed); },
    onRealmJoin: code => net.join(code),
    onRealmRemove: (code, kind) => { if (kind === 'host') deleteRealm(code); else forgetJoined(code); },
    onToggleMic: () => toggleMic(),
  };
  const mainPanel = new MenuPanel('main', handlers, settings, 2.0);
  mainPanel.mesh.position.set(0, 1.05, -1.7);
  menuRoom.group.add(mainPanel.mesh);
  const pausePanel = new MenuPanel('pause', handlers, settings, 1.1);
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
  // You see your own pioneer: body, arms and fists (no head, it is where your eyes are).
  const selfModel = new PlayerModel(net.me.color, { head: false });
  scene.add(selfModel.group);
  const buzz = (i: number, strength: number, ms: number) => {
    const gp = inputs[i]?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, d: number): void }[] }) | undefined;
    try { gp?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* no haptics */ }
  };
  const press = (i: number) => {
    const t = hoverTarget[i];
    if (t && t.click(i)) { buzz(i, 0.6, 40); return; }
    if (linkMode && hoveredMachine !== null) { handleLink(hoveredMachine); return; }
    if (buildActive) { buildPress(); return; }
    if (placing) tryPlace();
  };
  const wristHud: (THREE.Mesh | null)[] = [null, null];
  const tmpHud = new THREE.Vector3(), hudLift = new THREE.Vector3(0, 0.17, 0.07);   // grip-local: up off the glove, a little toward you
  rays.forEach((r, i) => {
    rig.add(r); rig.add(grips[i]);
    r.addEventListener('connected', e => {
      inputs[i] = (e as unknown as { data: XRInputSource }).data;
      const hand = inputs[i]?.handedness;
      // wrist displays: resources on the left, objective on the right
      const hud = hand === 'left' ? resourceHud.mesh : hand === 'right' ? objectiveHud.mesh : null;
      if (hud) {
        hud.rotation.x = -Math.PI / 2 + 0.35; grips[i].add(hud); wristHud[i] = hud;
        // always draw over your own glove and arm, never behind them
        const mat = hud.material as THREE.MeshBasicMaterial; mat.depthTest = false; hud.renderOrder = 30;
      }
    });
    r.addEventListener('disconnected', () => { inputs[i] = null; });
    r.addEventListener('selectstart', () => press(i));
  });

  const arms = new ArmCalibration(settings);
  // Buttons (Quest Touch): right A = buttons[4], right B = buttons[5], left X = buttons[4], grip = buttons[1]
  const btn = (i: number, b: number) => !!inputs[i]?.gamepad?.buttons[b]?.pressed;
  const handBtn = (hand: 'left' | 'right', b: number) => [0, 1].some(i => inputs[i]?.handedness === hand && btn(i, b));
  const keys = { a: false, b: false, x: false, grip: false, menu: false };
  addEventListener('keydown', e => { if (e.code === 'KeyV' && net.state !== 'off') toggleMic(); });
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
  /** Build tool: place the planned piece, or demolish the aimed one. */
  const buildPress = () => {
    if (!buildSystem || !planet) return;
    const mode = buildPanel.mode;
    if (mode === 'demolish') {
      if (!buildTarget) { sfx.fail(); return; }
      const cost = BUILD_COST[buildTarget.type];
      for (const k of Object.keys(cost) as (keyof typeof cost)[]) progress.items[k] += Math.floor((cost[k] ?? 0) / 2);
      if (net.state === 'game' && !net.isHost) net.sendOp({ k: 'unbuild', id: buildTarget.id }, () => {}); else buildSystem.remove(buildTarget.id);
      buildTarget = null; sfx.crumble(); return;
    }
    if (!buildPlan || !buildPlan.ok) { sfx.fail(); toast(buildPlan?.reason || 'Aim at the ground', headPos()); return; }
    const cost = BUILD_COST[mode];
    if (!progress.canAfford(cost)) { sfx.fail(); toast(progress.describeMissing(cost), headPos()); return; }
    const want = { type: mode, cx: buildPlan.cx, cz: buildPlan.cz, level: buildPlan.level, edge: buildPlan.edge, axis: buildPlan.axis, color: PALETTE[buildPanel.color] };
    if (net.state === 'game' && !net.isHost) {
      progress.spend(cost); progress.piecesBuilt++;
      net.sendOp({ k: 'build', p: want }, r => { if (r.ok === false) { for (const k of Object.keys(cost) as (keyof typeof cost)[]) progress.items[k] += cost[k] ?? 0; progress.piecesBuilt--; sfx.fail(); toast(String(r.msg ?? 'Could not build there'), headPos()); } });
      sfx.thump(pieceGeometry(want).center); say('build'); return;
    }
    const piece = buildSystem.add(want);
    if (!piece) { sfx.fail(); return; }
    progress.spend(cost); progress.piecesBuilt++;
    const g = pieceGeometry(piece); sfx.thump(g.center); say('build'); first(mode === 'foundation' ? 'foundation' : mode === 'wall' ? 'wall' : 'catwalk'); if (progress.piecesBuilt % 8 === 0) chat('buildMore', 60, true);
  };

  /** Conveyor Link tool: first click picks the source, second the target. */
  const handlePowerLine = (id: number) => {
    const b = factory.get(id); if (!b) return;
    if (linkFrom === null) { linkFrom = id; sfx.pickup(); toast('Now aim at the other end (one end must be a Power Pole)', headPos()); return; }
    const a0 = factory.get(linkFrom); linkFrom = null;
    if (!a0) return;
    if (a0.kind !== 'pole' && b.kind !== 'pole') { sfx.fail(); toast('Power lines go through a Power Pole', headPos()); return; }
    const pa = FactoryView.plug(a0.kind, a0.x, a0.y, a0.z), pb = FactoryView.plug(b.kind, b.x, b.y, b.z), len = pa.distanceTo(pb), cost = Math.max(1, Math.ceil(len / 6));
    if (len > WIRE_RANGE) { sfx.fail(); toast(`Too far: ${WIRE_RANGE} m at most (add another pole)`, headPos()); return; }
    if (progress.items.copper < cost) { sfx.fail(); toast(`A ${Math.round(len)} m line needs ${cost} copper`, headPos()); return; }
    if (net.state === 'game' && !net.isHost) {
      progress.items.copper -= cost; progress.wires++;
      net.sendOp({ k: 'wire', a: a0.id, b: id }, r => { if (r.ok === false) { progress.items.copper += cost; progress.wires--; sfx.fail(); toast(String(r.msg ?? 'Could not connect them'), headPos()); } });
      sfx.craft(); toast(`Power line (${Math.round(len)} m, ${cost} copper)`, headPos()); return;
    }
    const res = factory.wire(a0.id, id);
    if (typeof res === 'string') { sfx.fail(); toast(res, headPos()); return; }
    progress.items.copper -= cost; progress.wires++;
    addWireView(res); markFactory(); sfx.craft(); chat('wired', 20); toast(`Power line (${Math.round(len)} m, ${cost} copper)`, headPos());
  };
  const handleLink = (id: number) => {
    if (linkKind === 'power') { handlePowerLine(id); return; }
    const a0 = linkFrom === null ? null : factory.get(linkFrom), b = factory.get(id);
    if (!b) return;
    if (!a0) {
      if (!Factory.canSend(b.kind)) { sfx.fail(); toast('That has no output: pick a Miner, Smelter or Constructor first', headPos()); return; }
      linkFrom = id; sfx.pickup(); toast('Now aim at the machine it should feed', headPos()); return;
    }
    const pts = FactoryView.path(new THREE.Vector3(a0.x, a0.y, a0.z), new THREE.Vector3(b.x, b.y, b.z));
    const len = FactoryView.pathLength(pts), cost = Math.ceil(len / 5);
    if (progress.items.iron < cost) { sfx.fail(); toast(`A ${Math.round(len)} m belt needs ${cost} iron`, headPos()); linkFrom = null; return; }
    if (net.state === 'game' && !net.isHost) {
      progress.items.iron -= cost; progress.links++;
      net.sendOp({ k: 'link', from: a0.id, to: id }, r => { if (r.ok === false) { progress.items.iron += cost; progress.links--; sfx.fail(); toast(String(r.msg ?? 'Could not link them'), headPos()); } });
      sfx.craft(); toast(`Belt built (${Math.round(len)} m, ${cost} iron)`, headPos()); linkFrom = null; return;
    }
    const res = factory.link(a0.id, id, len);
    if (typeof res === 'string') { sfx.fail(); toast(res, headPos()); linkFrom = null; return; }
    markFactory();
    progress.items.iron -= cost; progress.links++;
    factoryView!.addLink(res, new THREE.Vector3(a0.x, a0.y, a0.z), new THREE.Vector3(b.x, b.y, b.z));
    sfx.craft(); toast(`Belt built (${Math.round(len)} m, ${cost} iron)`, headPos()); linkFrom = null;
  };

  /** Dismantle a machine and everything attached to it. */
  const dismantle = (id: number) => {
    const mc = factory.get(id); if (!mc || !planet) return;
    if (mc.ore) planet.setOreOccupied(mc.ore.index, false);
    for (const lid of factory.removeMachine(id)) factoryView!.removeLink(lid);
    for (const wid of factory.removedWires) factoryView!.removeWire(wid);
    factoryView!.removeMachine(id); planet.removeMachineCollider(id);
    if (linkFrom === id) linkFrom = null;
    if (selectedMachine === id) { selectedMachine = null; machinePanel.show(null); }
    markFactory();
  };
  const cutLines = (id: number) => { for (const w of factory.wires.filter(w => w.a === id || w.b === id)) { factory.removeWire(w.id); factoryView?.removeWire(w.id); } markFactory(); };
  const giveItems = (got: Partial<Record<string, number>>, at: THREE.Vector3) => {
    const parts: string[] = [];
    const into: Record<string, 'iron' | 'copper' | 'plate' | 'wire'> = { ironOre: 'iron', copperOre: 'copper', ironIngot: 'iron', copperIngot: 'copper', plate: 'plate', wire: 'wire' };
    for (const [k, n] of Object.entries(got) as [keyof typeof into, number][]) { if (!n) continue; progress.items[into[k]] += n; parts.push(`${n} ${ITEM_NAME[k as keyof typeof ITEM_NAME]}`); if (k === 'plate') { progress.platesCollected += n; say('plates'); } }
    sfx.pickup(); toast(parts.length ? `Took ${parts.join(', ')}` : 'Nothing to take', at);
  };
  /** In a lobby the host owns the factory: clients ask it to do things (and pay for them here). */
  const clientMachineAction = (action: MachineAction, id: number, arg?: number) => {
    const mc = factory.get(id); if (!mc) return;
    const at = new THREE.Vector3(mc.x, mc.y + 2.5, mc.z);
    const ask = (op: Record<string, unknown>, ok: (r: Record<string, unknown>) => void, undo?: () => void) =>
      net.sendOp(op, r => { if (r.ok === false) { undo?.(); sfx.fail(); toast(String(r.msg ?? 'Not possible'), at); } else ok(r); });
    if (action === 'reset') { ask({ k: 'reset' }, () => { sfx.craft(); toast('Breaker reset', at); }); return; }
    if (action === 'filter') { ask({ k: 'filter', id, slot: arg ?? 0 }, () => sfx.pickup()); return; }
    if (action === 'unwire') { ask({ k: 'unwire', id }, () => { sfx.crumble(); toast('Power lines cut', at); }); return; }
    if (action === 'tokens') { ask({ k: 'tokens' }, r => { const n = Number(r.tokens) || 0; progress.items.token += n; sfx.pickup(); toast(n ? `+${n} tokens` : 'No tokens yet', at); if (n) { say('sink'); first('firstTokens'); } }); return; }
    if (action === 'overclock') {
      if (!progress.has('overclockst') || progress.items.core < 1) { sfx.fail(); toast('Needs the Overclock Station and a core', at); return; }
      progress.items.core -= 1;
      ask({ k: 'overclock', id }, () => { sfx.craft(); toast('Overclocked', at); say('overclock'); }, () => { progress.items.core += 1; });
      return;
    }
    if (action === 'fuel') {
      if (progress.items.wood < 5) { sfx.fail(); toast('Need 5 wood', at); return; }
      progress.items.wood -= 5;
      ask({ k: 'fuel', id }, () => { progress.fueled = true; sfx.pickup(); toast('+5 wood of fuel', at); }, () => { progress.items.wood += 5; });
    } else if (action === 'take') {
      ask({ k: 'take', id }, r => giveItems((r.items ?? {}) as Record<string, number>, at));
    } else {
      const r = progress.recipe(mc.kind);
      for (const k of Object.keys(r.cost) as (keyof typeof r.cost)[]) progress.items[k] += Math.floor((r.cost[k] ?? 0) / 2);
      ask({ k: 'remove', id }, () => { sfx.crumble(); toast('Dismantled (half the cost back)', at); });
      selectedMachine = null; machinePanel.show(null);
    }
  };
  const machineAction = (action: MachineAction, id: number, arg?: number) => {
    if (net.state === 'game' && !net.isHost) { clientMachineAction(action, id, arg); return; }
    const mc = factory.get(id); if (!mc || !planet) return;
    const at = new THREE.Vector3(mc.x, mc.y + 2.5, mc.z);
    if (action === 'reset') { factory.resetBreaker(); markFactory(); sfx.craft(); toast('Breaker reset', at); return; }
    if (action === 'filter') { factory.cycleFilter(id, arg ?? 0); markFactory(); sfx.pickup(); return; }
    if (action === 'unwire') { cutLines(id); sfx.crumble(); toast('Power lines cut', at); return; }
    if (action === 'tokens') { const n = factory.takeTokens(); markFactory(); progress.items.token += n; sfx.pickup(); toast(n ? `+${n} tokens` : 'No tokens yet', at); if (n) { say('sink'); first('firstTokens'); } return; }
    if (action === 'overclock') {
      if (!progress.has('overclockst') || progress.items.core < 1) { sfx.fail(); toast('Needs the Overclock Station and a core', at); return; }
      if (factory.overclock(id)) { progress.items.core -= 1; markFactory(); sfx.craft(); toast(`Clock ${Math.round(mc.clock * 100)}%`, at); say('overclock'); chat('overclockMore', 30, true); } else sfx.fail();
      return;
    }
    if (action === 'fuel') {
      if (progress.items.wood < 5) { sfx.fail(); toast('Need 5 wood', at); return; }
      progress.items.wood -= 5; factory.addFuel(id, 5); markFactory(); progress.fueled = true; sfx.pickup(); toast('+5 wood of fuel', at);
    } else if (action === 'take') {
      const got = factory.takeAll(id); markFactory(); giveItems(got, at);
    } else {
      const r = progress.recipe(mc.kind);
      for (const k of Object.keys(r.cost) as (keyof typeof r.cost)[]) progress.items[k] += Math.floor((r.cost[k] ?? 0) / 2);
      dismantle(id); sfx.crumble(); toast('Dismantled (half the cost back)', at);
    }
  };

  /** Host: do what a client asked for in the shared base. */
  const hostOp = (_from: string, op: Record<string, unknown>): Record<string, unknown> => {
    if (!planet || !factoryView) return { ok: false, msg: 'The host is not ready' };
    const n = (k: string) => Number(op[k]);
    const m = factory.get(n('id'));
    switch (op.k) {
      case 'place': {
        const kind = String(op.kind);
        if (!isMachine(kind)) return { ok: false, msg: 'Unknown machine' };
        if (factory.machines.length >= MAX_MACHINES) return { ok: false, msg: `Max ${MAX_MACHINES} machines` };
        type OreRef = { index: number; type: 'copper' | 'iron'; purity: number };
        let ore: OreRef | null = null;
        if (kind === 'miner') {
          const o = op.ore as OreRef | null;
          if (!o || !planet.isOreFree(o.index)) return { ok: false, msg: 'That ore deposit is taken' };
          ore = o; planet.setOreOccupied(o.index, true);
        }
        const mc = factory.addMachine(kind, n('x'), n('y'), n('z'), n('yaw'), ore);
        factoryView.addMachine(mc); planet.addMachineCollider(mc.id, mc.x, mc.y, mc.z); plugToHub(mc); markFactory();
        return { ok: true };
      }
      case 'remove': if (!m) return { ok: false, msg: 'Already gone' }; dismantle(m.id); return { ok: true };
      case 'link': {
        const a = factory.get(n('from')), b = factory.get(n('to'));
        if (!a || !b) return { ok: false, msg: 'A machine is gone' };
        const pa = new THREE.Vector3(a.x, a.y, a.z), pb = new THREE.Vector3(b.x, b.y, b.z);
        const res = factory.link(a.id, b.id, FactoryView.pathLength(FactoryView.path(pa, pb)));
        if (typeof res === 'string') return { ok: false, msg: res };
        factoryView.addLink(res, pa, pb); markFactory(); return { ok: true };
      }
      case 'overclock': if (!factory.overclock(n('id'))) return { ok: false, msg: 'Cannot overclock that further' }; markFactory(); return { ok: true };
      case 'filter': factory.cycleFilter(n('id'), n('slot')); markFactory(); return { ok: true };
      case 'unwire': cutLines(n('id')); return { ok: true };
      case 'wire': {
        const pa = plugPoint(n('a')), pb = plugPoint(n('b'));
        if (!pa || !pb) return { ok: false, msg: 'A machine is gone' };
        if (pa.distanceTo(pb) > WIRE_RANGE) return { ok: false, msg: `Too far: ${WIRE_RANGE} m at most` };
        const res = factory.wire(n('a'), n('b'));
        if (typeof res === 'string') return { ok: false, msg: res };
        addWireView(res); markFactory(); return { ok: true };
      }
      case 'fuel': if (!factory.addFuel(n('id'), 5)) return { ok: false, msg: 'That does not burn wood' }; markFactory(); return { ok: true };
      case 'take': { const items = factory.takeAll(n('id')); markFactory(); return { ok: true, items }; }
      case 'tokens': { const tokens = factory.takeTokens(); markFactory(); return { ok: true, tokens }; }
      case 'reset': factory.resetBreaker(); markFactory(); return { ok: true };
      case 'build': {
        if (!buildSystem) return { ok: false, msg: 'Not ready' };
        return buildSystem.add(op.p as Omit<Piece, 'id'>) ? { ok: true } : { ok: false, msg: 'Something is already there' };
      }
      case 'unbuild': return buildSystem?.remove(n('id')) ? { ok: true } : { ok: false, msg: 'Already gone' };
    }
    return { ok: false, msg: 'Unknown request' };
  };
  const tryPlace = () => {
    if (!placing || !planet || !ghostPose) return;
    if (!ghostPose.ok) { sfx.fail(); toast(ghostPose.reason || 'Aim at the ground', headPos()); return; }
    const gp = ghostPose, kind = placing;
    scene.remove(ghost!.group); ghost = null; placing = null; ghostPose = null;
    if (kind === 'hub') {
      const built = planet.placeHub(gp.x, gp.z, gp.yaw, gp.y);
      progress.hubPlaced = true;
      buildHubUi(built); net.sendWorld('hub', 0, [gp.x, gp.z, gp.yaw, gp.y]);
      sfx.craft(); sfx.thump(new THREE.Vector3(gp.x, gp.y, gp.z));
      toast('Hub built!', new THREE.Vector3(gp.x, gp.y + 3.5, gp.z)); say('hub');
    } else if (isMachine(kind)) {
      let ore: { index: number; type: 'copper' | 'iron'; purity: number } | null = null;
      if (kind === 'miner') {
        const o = planet.findFreeOre(gp.x, gp.z, 1.5);
        if (!o) { sfx.fail(); toast('Place the Miner on an iron or copper ore rock', headPos()); placing = kind; ghost = (() => { const mm = buildMachineMesh(kind); makeGhost(mm.group); scene.add(mm.group); return mm; })(); ghostPose = gp; return; }
        ore = { index: o.index, type: o.type, purity: o.purity }; planet.setOreOccupied(o.index, true); say('miner');
      }
      if (net.state === 'game' && !net.isHost) {
        const cost = progress.recipe(kind).cost;
        net.sendOp({ k: 'place', kind, x: gp.x, y: gp.y, z: gp.z, yaw: gp.yaw, ore }, r => {
          if (r.ok === false) { for (const k of Object.keys(cost) as (keyof typeof cost)[]) progress.items[k] += cost[k] ?? 0; sfx.fail(); toast(String(r.msg ?? 'Could not place it'), headPos()); }
        });
        sfx.craft(); sfx.thump(new THREE.Vector3(gp.x, gp.y, gp.z)); toast(`${kind} placed`, new THREE.Vector3(gp.x, gp.y + 3, gp.z));
        return;
      }
      const mc = factory.addMachine(kind, gp.x, gp.y, gp.z, gp.yaw, ore);
      factoryView!.addMachine(mc); planet.addMachineCollider(mc.id, gp.x, gp.y, gp.z); plugToHub(mc); markFactory();
      sfx.craft(); sfx.thump(new THREE.Vector3(gp.x, gp.y, gp.z));
      toast(`${kind} placed`, new THREE.Vector3(gp.x, gp.y + 3, gp.z));
    } else {
      planet.placeProp(kind, gp.x, gp.z); net.sendWorld('prop', Date.now() % 2147483647, [kind === 'campfire' ? 0 : 1, gp.x, gp.z]);
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
        if (bNow && !bPrev) { if (ship.visible) story.skipToTitle(); else { if (buildActive) setBuild(false); cancelPlacing(); if (linkMode) { linkMode = false; linkFrom = null; toast('Link mode off', headPos()); } } } // B: skip the crash scene (capsule) / cancel placing (planet)
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

    selfModel.visible = inXR;
    if (inXR) {
      const hq = camera.getWorldQuaternion(new THREE.Quaternion()), he = new THREE.Euler().setFromQuaternion(hq, 'YXZ');
      selfModel.setPose(new THREE.Vector3().copy(player.position).add(camera.position), he.y, he.x, he.z, player.hands[0].world, player.hands[1].world, dt);
    }
    // wrist displays ride above your glove (not on the raw controller), clear of the fist and sleeve
    player.hands.forEach((h, i) => {
      const hud = wristHud[i]; if (!hud || !inXR) return;
      grips[i].updateWorldMatrix(true, false);
      hud.position.copy(grips[i].worldToLocal(tmpHud.copy(h.world))).add(hudLift);
    });
    player.hands.forEach((h, i) => {
      if (h.touching && !hadTouch[i]) buzz(i, 0.35, 25);
      hadTouch[i] = h.touching;
    });

    // Safety net: if anything ever puts you outside the world, put you back instead of falling forever
    const headNow = new THREE.Vector3().copy(player.position).add(camera.position);
    if (appMode === 'menu' && (headNow.y < -2 || Math.abs(headNow.x) > 9.5 || Math.abs(headNow.z) > 9.5 || headNow.y > 16)) player.teleport(MENU_SPAWN);
    else if (appMode === 'game' && ship.visible && (headNow.y < -8 || headNow.length() > 14)) player.teleport(SPAWN);
    else if (appMode === 'game' && planet && !ship.visible && headNow.y < -60) player.teleport(new THREE.Vector3(0, 3, 0));

    // Hazards: poison clouds, radiation and hard landings
    const gear: Gear = { mask: progress.has('gasmask'), hazmat: progress.has('hazmat'), boots: progress.has('bladerunners') };
    const landed = player.popLanding();
    if (planet && appMode === 'game' && !pauseOpen && story.phase === 'planet') {
      const e = planet.hazardAt(headNow.x, headNow.z);
      const fd = fallDamage(landed, gear);
      if (fd > 1) { health.hurt(fd); sfx.hurt(); chat('fall', 45, true); toast(`Hard landing: -${Math.round(fd)} HP`, headNow.clone().add(new THREE.Vector3(0, 0.5, 0))); }
      if (health.hp < 30 && health.hp > 0) chat('lowHp', 60, true);
      if (headNow.y < WATER_Y + 1.2 && heightAt(headNow.x, headNow.z) < WATER_Y) chat('water', 120, true);
      const dps = damagePerSecond(e, gear);
      if (health.update(simDt, dps)) {
        const hubP = planet.hub?.pose;
        player.teleport(hubP ? toWorld([0, 0.95, 0], hubP) : new THREE.Vector3(0, 3, 0)); health.reset(); say('died'); chat('deaths', 5); sfx.fail();
      }
      if (dps > 0 && Math.random() < dt * 2.2) sfx.hurt();
      if (e.radiation && Math.random() < dt * (gear.hazmat ? 5 : 20)) sfx.geiger();
      overlay.setTint(health.flash > 0.02 ? 0xff2020 : e.radiation ? 0x40ff60 : e.poison ? 0xc8e040 : 0x000000, health.flash > 0.02 ? Math.min(0.55, health.flash * 0.6) : dps > 0 ? 0.28 : (e.poison || e.radiation) ? 0.07 : 0);
      const near = planet.nearestHazard(headNow.x, headNow.z);
      if (near && near.dist > 0 && near.dist < 30) say(near.kind === 'poison' ? 'poisonNear' : 'radNear');
    } else overlay.setTint(0, 0);

    // Grip + punch: fell trees, smash boulders (stone) and the crashed pod (steel)
    const headW = new THREE.Vector3().copy(player.position).add(camera.position);
    if (planet && appMode === 'game' && !pauseOpen && !ship.visible) {
      player.hands.forEach((h, i) => {
        if (!h.started || !gripDown[i]) return;
        const id = player.world.ownerAt(h.contact);
        if (id < 0) return;
        if (id >= CRASH_OWNER) { // a crashed pod: three punches to open it
          if (h.impact < 2.0) return;
          const left = planet!.hitSite(id - CRASH_OWNER); if (left) sfx.clink(); buzz(i, 1, 90); return;
        }
        if (id >= MACHINE_OWNER) return; // machines and building pieces are not something to punch
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
      if (buildActive) targets.push(buildPanel);
      if (machinePanel.mesh.visible) targets.push(machinePanel);
      if (hubUi && planet?.hub && Math.hypot(planet.hub.pose.x - headW.x, planet.hub.pose.z - headW.z) < 14) targets.push(hubUi.bench, hubUi.computer, hubUi.upgrades, hubUi.research);
    }
    const meshes = targets.map(t => t.mesh);
    const setHover = (pointer: number, hit: { index: number; uv: THREE.Vector2 } | null) => {
      targets.forEach((t, k) => t.hover(pointer, hit && hit.index === k ? hit.uv : null));
      hoverTarget[pointer] = hit ? targets[hit.index] : null;
      if (hit && hubUi && targets[hit.index] === hubUi.bench) progress.benchOpened = true;
    };
    if (inXR) lasers.forEach((l, i) => setHover(i, l.castMany(meshes, !!placing || settings.laserAlways)));
    else {
      lasers.forEach(l => l.hide());
      mouseRay.setFromCamera(mouse, camera);
      const h = mouseRay.intersectObjects(meshes, false).find(x => x.uv);
      setHover(99, h && h.uv ? { index: meshes.indexOf(h.object as THREE.Mesh), uv: h.uv } : null);
    }

    // Which machine is the laser (or mouse) pointing at? Aiming at one shows its status card.
    hoveredMachine = null;
    if (factoryView && planet && appMode === 'game' && !pauseOpen && !ship.visible) {
      const ray = new THREE.Raycaster(); ray.far = 22;
      let best: { id: number; distance: number } | null = null;
      if (inXR) rays.forEach(r => {
        ray.set(new THREE.Vector3().setFromMatrixPosition(r.matrixWorld), new THREE.Vector3(0, 0, -1).transformDirection(r.matrixWorld));
        const h = factoryView!.pick(ray); if (h && (!best || h.distance < best.distance)) best = h;
      });
      else { mouseRay.setFromCamera(mouse, camera); ray.set(mouseRay.ray.origin, mouseRay.ray.direction); best = factoryView.pick(ray); }
      hoveredMachine = best ? (best as { id: number }).id : null;
      const panelHot = [0, 1, 99].some(k => hoverTarget[k] === machinePanel);
      if (hoveredMachine !== null) { selectedMachine = hoveredMachine; selectHold = 0.8; }
      else if (!panelHot && (selectHold -= dt) <= 0) selectedMachine = null;
      machinePanel.show(selectedMachine);
      const sp = selectedMachine !== null ? factoryView.position(selectedMachine) : null;
      if (sp) {
        const dist = Math.max(1, sp.distanceTo(headW));
        machinePanel.mesh.position.set(sp.x, sp.y + 3.0 + dist * 0.12, sp.z);
        machinePanel.mesh.scale.setScalar(THREE.MathUtils.clamp(dist / 4, 1, 3.2));
        machinePanel.mesh.lookAt(headW);
      }
      machinePanel.update(dt);
      factoryView.focus.copy(headW);
      factory.update(simDt, planet.daylight);
      factoryView.update(simDt, factory);
      if (factory.tripped && !wasTripped) { say('trip'); chat('trip', 20); sfx.fail(); }
      if (factory.machines.length >= 10) first('milestoneMachines');
      if (progress.platesCollected >= 50) first('milestonePlates');
      wasTripped = factory.tripped;
    } else if (machinePanel.mesh.visible) machinePanel.show(null);

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
      const target = headW.clone().addScaledVector(fwd, floating === 'map' ? 1.05 : 0.85); target.y = headW.y - 0.1;
      panel.position.lerp(target, 1 - Math.exp(-8 * dt));
      panel.lookAt(headW);
      if (floating === 'map') { map.friends = remotes.positions; map.update(dt, planet, headW.x, headW.z, fwd.x, fwd.z); } else craftPanel.update();
    }
    if (hubUi) { hubUi.bench.update(); hubUi.computer.update(dt); hubUi.upgrades.update(); hubUi.research.update(); }

    // Build mode: aim at the ground or at a piece, see what would be placed
    if (buildActive && buildSystem && planet) {
      let o: THREE.Vector3, d: THREE.Vector3;
      if (inXR) {
        const idx = inputs[1]?.handedness === 'right' ? 1 : inputs[0]?.handedness === 'right' ? 0 : 1;
        o = new THREE.Vector3().setFromMatrixPosition(rays[idx].matrixWorld);
        d = new THREE.Vector3(0, 0, -1).transformDirection(rays[idx].matrixWorld);
      } else { o = headW.clone(); d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); }
      const ray = new THREE.Raycaster(o, d, 0, 40);
      const hp = buildSystem.pick(ray), tp = aimAtTerrain(o, d);
      const tpoint = tp ? new THREE.Vector3(tp.x, heightAt(tp.x, tp.z), tp.z) : null;
      const usePiece = !!hp && (!tpoint || hp.distance <= o.distanceTo(tpoint));
      buildTarget = usePiece ? hp!.piece : null;
      const point = usePiece ? hp!.point : tpoint;
      const mat = buildGhost.material as THREE.MeshBasicMaterial;
      if (!point) { buildGhost.visible = false; buildPlan = null; }
      else if (buildPanel.mode === 'demolish') {
        buildPlan = null; buildGhost.visible = !!buildTarget;
        if (buildTarget) { const g = pieceGeometry(buildTarget); buildGhost.position.copy(g.center); buildGhost.scale.copy(g.size).addScalar(0.05); mat.color.set(0xff5555); }
      } else {
        buildPlan = buildSystem.plan(buildPanel.mode, point, buildTarget, fwd);
        const g = pieceGeometry(buildPlan);
        buildGhost.visible = true; buildGhost.position.copy(g.center); buildGhost.scale.copy(g.size).addScalar(0.05);
        mat.color.set(buildPlan.ok && progress.canAfford(BUILD_COST[buildPanel.mode]) ? 0x55ff88 : 0xff5555);
      }
      // the palette hangs to your left
      const left = headW.clone().addScaledVector(fwd, 0.95).addScaledVector(new THREE.Vector3(-fwd.z, 0, fwd.x), -0.7); left.y = headW.y - 0.2;
      buildPanel.mesh.position.lerp(left, 1 - Math.exp(-8 * dt)); buildPanel.mesh.lookAt(headW); buildPanel.mesh.scale.setScalar(0.8);
      buildPanel.update();
    }

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
        let gx = hit.x, gz = hit.z;
        let res: { ok: boolean; y: number; reason: string };
        if (placing === 'hub') res = planet.canPlaceHub(hit.x, hit.z, yawH);
        else if (placing === 'miner') {
          const o = planet.findFreeOre(hit.x, hit.z, 4);
          if (o) { gx = o.x; gz = o.z; res = { ok: true, y: o.y, reason: '' }; } else res = { ok: false, y: heightAt(hit.x, hit.z), reason: 'Aim at an iron or copper ore rock' };
        } else if (isMachine(placing)) res = planet.canPlaceMachine(hit.x, hit.z);
        else res = planet.canPlaceProp(hit.x, hit.z);
        if (res.ok && placing === 'hub' && Math.hypot(hit.x - headW.x, hit.z - headW.z) < 8) { res.ok = false; res.reason = 'Too close: step back'; }
        const facing = Math.round(Math.atan2(-fwd.x, -fwd.z) / snap) * snap; // machines face you
        ghostPose = { x: gx, z: gz, y: res.y, yaw: placing === 'hub' ? yawH : isMachine(placing) ? facing : 0, ok: res.ok, reason: res.reason };
        ghost.group.position.set(gx, res.y, gz); ghost.group.rotation.y = ghostPose.yaw;
        (ghost.group.userData.ghostMaterial as THREE.MeshBasicMaterial | undefined)?.color.set(res.ok ? 0x55ff88 : 0xff5555);
      } else ghostPose = null;
    }

    if (appMode === 'game' && planet && story.phase === 'planet' && !pauseOpen) {
      const dl = planet.daylight, ph = dl > 0.55 ? 'day' : dl < 0.2 ? 'night' : lastPhase;
      if (ph !== lastPhase) { if (ph === 'night') chat('nightfall', 60); else if (ph === 'day') chat('sunrise', 60); lastPhase = ph; }
      else if (dl < 0.55 && dl > 0.2 && lastPhase === 'day') chat('sunset', 120, true);
      if (planet.siteMarks.length > knownSites) chat('podFound', 30, true);
      knownSites = planet.siteMarks.length;
      if (planet.hub && !hubSeen && Math.hypot(planet.hub.pose.x - headNow.x, planet.hub.pose.z - headNow.z) < 6) { hubSeen = true; first('hubEnter'); }
      if ((idleT -= dt) < 0) {
        idleT = 100 + Math.random() * 120;
        const night = dl < 0.3;
        const pool = night && Math.random() < 0.4 ? 'alienNight' : factory.machines.length > 2 && Math.random() < 0.5 ? 'idleFactory' : progress.piecesBuilt > 4 && Math.random() < 0.3 ? 'idleBuilder' : night ? 'idleNight' : 'idleDay';
        chat(pool, 0, true);
      }
    }
    if (appMode === 'game' && net.state === 'game' && net.isHost) {
      snapT += dt;
      if (factoryDirty || snapT >= 1) { snapT = 0; factoryDirty = false; net.broadcastFactory(factory.toJSON()); }
      if (buildSystem && buildSystem.version !== sentBuildV) { sentBuildV = buildSystem.version; net.broadcastBuild(buildSystem.toJSON()); }
    }
    if (net.state === 'lobby' || net.state === 'game') {
      voice.update(camera, id => remotes.headOf(id));
      for (const p of net.list) if (p.id !== net.me.id) { remotes.setSpeaking(p.id, voice.speaking(p.id)); remotes.setMouth(p.id, voice.loudness(p.id)); }
    }
    if (appMode === 'game' && net.state === 'game') {
      net.tick(dt, () => {
        const q = camera.getWorldQuaternion(new THREE.Quaternion());
        const hw = (i: number) => player.hands[i].world;
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return [r(headW.x), r(headW.y), r(headW.z), r(q.x), r(q.y), r(q.z), r(q.w), r(hw(0).x), r(hw(0).y), r(hw(0).z), r(hw(1).x), r(hw(1).y), r(hw(1).z)];
      });
      remotes.update(dt);
    }
    if (loading.active) {
      rig.updateMatrixWorld(true);
      loading.update(dt, camera);
      if (loadJob && ++loadFrames >= (fastLoad ? 1 : 3)) { const j = loadJob; loadJob = null; j(); }
      else if (!loadJob && loading.shownFor >= loadMin) loading.hide();
    }
    narrator.update(dt);

    // Wrist displays and the desktop text overlay
    const obj = progress.objective();
    resourceHud.set(progress); objectiveHud.set(obj, health.hp, [gear.mask && 'MASK', gear.hazmat && 'SUIT', gear.boots && 'BOOTS'].filter(Boolean).join(' '));
    hudDom.style.display = appMode === 'game' && planet && !inXR && !pauseOpen ? 'block' : 'none';
    hudDom.textContent = `OBJECTIVE: ${obj[0]}\n${obj[1]}\nwood ${progress.items.wood}  stone ${progress.items.stone}  iron ${progress.items.iron}  copper ${progress.items.copper}  plate ${progress.items.plate}\npower ${factory.power.supply.toFixed(1)} / ${factory.power.demand.toFixed(1)} MW${linkMode ? '   LINK MODE (B stops)' : ''}\n[M] map  [X] craft  [G+punch] hit  [click] use`;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i]; t.t += dt;
      t.sprite.position.y += dt * 0.8;
      (t.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t.t / 2.2);
      if (t.t > 2.2) { scene.remove(t.sprite); toasts.splice(i, 1); }
    }

    if (inXR || planet) sfx.setListener(headW, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    if (planet) planet.update(simDt, scene, player.position, headW);
    if (appMode === 'game' && planet && story.phase === 'planet' && !pauseOpen && (autosave += dt) > 45) { autosave = 0; saveGame(); if (net.isHost && net.state === 'game' && net.allowSaving) void saveRealm(true); }

    renderer.render(loading.active ? loading.scene : scene, camera);
  });

  // Exposed for debugging / automated tests
  (window as unknown as Record<string, unknown>).__game = {
    health, narrator, net, remotes, voice, loading, withLoading, planetRef: () => planet, get buildSystem() { return buildSystem; }, buildPanel, setBuild, buildPress, get buildPlan() { return buildPlan; }, factory, get factoryView() { return factoryView; }, machinePanel, handleLink, machineAction, progress, craft, tryPlaceHub: () => tryPlace(), cancelPlacing, setPanel, camera, beginGame, enterMainMenu, saveGame, togglePause, mainPanel, pausePanel, menuRoom,
    get appMode() { return appMode; }, get pauseOpen() { return pauseOpen; }, renderer, scene, player, story, settings, menu,
    fell: (id: number) => planet?.fellTree(id, new THREE.Vector3(0, 0, 0)),
    look: (y: number, p: number) => { yaw = y; pitch = p; },
    get placing() { return placing; }, get ghostPose() { return ghostPose; }, get hubUi() { return hubUi; },
    get planet() { return planet; },
  };
}

boot();
