import * as THREE from 'three';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { GorillaPlayer } from '../src/player/GorillaPlayer';
import { heightAt } from '../src/world/Terrain';
import { Progress, RECIPES } from '../src/game/Progress';
import { Factory } from '../src/game/Factory';
import { Zone, Gear, exposure, damagePerSecond, fallDamage, Health } from '../src/game/Hazards';
import { BuildSystem, PALETTE, cellGround } from '../src/world/BuildSystem';
import { ArmCalibration, REF_SPAN } from '../src/player/ArmCalibration';

let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failed++; };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const dt = 1 / 72, head = V(0, 1.6, 0);
const settings = () => ({ gravityG: 0.3, jumpMult: 1.25, maxSpeed: 8, laserAlways: false, armSpan: 0 });
const FLOOR_TOP = -1.8;

function floorWorld(slip: number) {
  const w = new CollisionWorld();
  w.addBox(V(0, -2, 0), V(5.2, 0.4, 11), slip);
  return w;
}

// 1. Hand push lifts the body; release launches it upward.
{
  const p = new GorillaPlayer(floorWorld(0.05), settings());
  p.teleport(V(0, FLOOR_TOP, 0));
  const h = [V(-0.3, 0.1, 0), V(0.3, 0.1, 0)];
  p.update(dt, head, h);
  for (let i = 0; i < 12; i++) { h.forEach(x => (x.y -= 0.02)); p.update(dt, head, h); }
  check('pushing down on the floor lifts the body', p.position.y > FLOOR_TOP + 0.1, `y=${p.position.y.toFixed(2)}`);
  for (let i = 0; i < 8; i++) { h.forEach(x => (x.y += 0.05)); p.update(dt, head, h); }
  check('releasing launches upward', p.velocity.y > 0.5, `vy=${p.velocity.y.toFixed(2)}`);
}

// 2. No legs: with hands in the air you never move horizontally and you sink to a torso rest.
{
  const p = new GorillaPlayer(floorWorld(0.05), settings());
  p.teleport(V(0.5, FLOOR_TOP, 0.5));
  const h = [V(-0.3, 1.2, -0.3), V(0.3, 1.2, -0.3)];
  for (let i = 0; i < 400; i++) p.update(dt, head, h);
  const headY = p.position.y + head.y;
  check('no horizontal movement without hand contact', Math.hypot(p.position.x - 0.5, p.position.z - 0.5) < 1e-6);
  check('legless: torso rests on floor, head is low', headY < FLOOR_TOP + 1.0 && headY > FLOOR_TOP + 0.5, `head ${(headY - FLOOR_TOP).toFixed(2)}m above floor`);
}

// 3. Surface slip: same swipe moves you far on sticky surfaces and barely on ice.
function swipe(slip: number): number {
  const p = new GorillaPlayer(floorWorld(slip), settings());
  p.teleport(V(0, FLOOR_TOP, 0));
  // hands pressed lightly into the floor, then dragged backwards (+z) along it
  const h = [V(-0.3, 0, -0.4), V(0.3, 0, -0.4)];
  const press = () => h.forEach(x => (x.y = FLOOR_TOP - 0.02 - p.position.y));
  for (let i = 0; i < 3; i++) { press(); p.update(dt, head, h); }
  const z0 = p.position.z;
  for (let i = 0; i < 15; i++) { h.forEach(x => (x.z += 0.03)); press(); p.update(dt, head, h); }
  return z0 - p.position.z; // body moves forward (-z) when the hands drag back
}
{
  const grippy = swipe(0), ice = swipe(0.95);
  check('swiping a sticky surface moves you', grippy > 0.15, `moved ${grippy.toFixed(2)}m`);
  check('ice gives far less traction than bark', ice < grippy * 0.2, `ice ${ice.toFixed(2)}m vs bark ${grippy.toFixed(2)}m`);
}

// 4. Per-collider slip lookup
{
  const w = new CollisionWorld();
  w.addBox(V(0, 0, 0), V(1, 1, 1), 0.95);
  w.addBox(V(0, -1.5, 0), V(1, 1, 1), 0.0);
  check('slipAt picks the nearest collider', w.slipAt(V(0, 0.55, 0)) === 0.95 && w.slipAt(V(0, -2.05, 0)) === 0);
}

// 5. Arm-span scaling
{
  const s = settings();
  const cal = new ArmCalibration(s);
  check('uncalibrated scale is 1', Math.abs(cal.scale - 1) < 1e-9);
  cal.start();
  const L = V(-0.6, 1.4, 0), R = V(0.6, 1.4, 0); // 1.2 m span: a small player
  for (let i = 0; i < 72 * 6; i++) cal.update(dt, L, R);
  check('calibration stores the measured span', Math.abs(s.armSpan - 1.2) < 1e-6, `span=${s.armSpan}`);
  check('short arms are scaled up to reference reach', Math.abs(cal.scale - REF_SPAN / 1.2) < 1e-6 || cal.scale === 1.6, `scale=${cal.scale.toFixed(2)}`);
  const out = cal.apply(V(0, 1.6, 0), V(0.5, 1.35, 0), V(0, 0, 0)); // hand 0.5m right of shoulders
  check('hand offset from shoulders is scaled', out.x > 0.5 && Math.abs(out.y - 1.35) < 1e-9, `x=${out.x.toFixed(2)}`);
}

// 6. Thin-bar tunnelling
{
  const w = new CollisionWorld(); w.addBox(V(0, 0, 0), V(2, 0.02, 2));
  const out = V(0, 0, 0), n = V(0, 0, 0);
  check('fast hand cannot tunnel through a thin bar', w.sweep(V(0, 0.5, 0), V(0, -0.5, 0), 0.07, out, n) && out.y > 0);
}

// 7. Terrain heightfield: flat at spawn, hills further out, hands can't sink into slopes
{
  const w = new CollisionWorld(); w.hull = false; w.heightFn = heightAt;
  check('terrain is flat at the landing spot', heightAt(0, 0) === 0 && Math.abs(heightAt(5, 5)) < 1e-9);
  let lo = 0, hi = 0;
  for (let x = -300; x <= 300; x += 5) for (let z = -300; z <= 300; z += 5) { const h = heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  check('terrain has rolling plains and a lake basin', hi > 2.5 && lo < -6, `range ${lo.toFixed(1)}..${hi.toFixed(1)} m`);
  const out = V(0, 0, 0), n = V(0, 0, 0);
  let bad = 0;
  for (let i = 0; i < 200; i++) { // fast hand strikes from above onto random hill points
    const x = -250 + (i * 37) % 500, z = -250 + (i * 91) % 500, h = heightAt(x, z);
    w.sweep(V(x, h + 2, z), V(x, h - 1.5, z), 0.07, out, n);
    if (out.y < heightAt(out.x, out.z) - 0.02) bad++;
  }
  check('hands never end up inside the terrain', bad === 0, `${bad} bad`);
  const p = new GorillaPlayer(w, settings());
  p.teleport(V(120, heightAt(120, 80) + 0.2, 80));
  const hs = [V(-0.3, 1.0, -0.3), V(0.3, 1.0, -0.3)];
  for (let i = 0; i < 300; i++) p.update(dt, head, hs);
  const hy = p.position.y + head.y - heightAt(p.position.x, p.position.z);
  check('legless torso rests on a hillside', hy > 0.5 && hy < 0.95, `head ${hy.toFixed(2)} m above ground`);
}

// 8. Punching a tree: hit speed, owner lookup, removing a felled tree's colliders
{
  const w = new CollisionWorld(); w.hull = false; w.groundY = 0;
  w.addCylinder(0, 0, 0, 8, 0.4, 0, 7);
  w.addSphere(V(0, 9, 0), 2, 0.2, 7);
  w.addCylinder(20, 0, 0, 8, 0.4, 0, 8);
  w.finalize();
  check('ownerAt finds the tree trunk', w.ownerAt(V(0.5, 3, 0)) === 7 && w.ownerAt(V(20.5, 3, 0)) === 8);
  const p = new GorillaPlayer(w, settings());
  p.teleport(V(-3, 0, 0));
  const slow = [V(1.8, 1.0, 0), V(-0.3, 0.5, 0)];
  for (let i = 0; i < 5; i++) p.update(dt, head, slow);
  const hh = [V(1.8, 1.0, 0), V(-0.3, 0.5, 0)];
  let hit = 0, best = 0;
  for (let i = 0; i < 16; i++) { hh[0].x += 0.06; p.update(dt, head, hh); if (p.hands[0].started) { hit = p.hands[0].impact; best = Math.max(best, hit); } }
  check('a fast punch registers a high impact speed', best > 2.2, `impact ${best.toFixed(1)} m/s`);
  w.removeOwner(7);
  check('felled tree stops being solid', w.ownerAt(V(0.5, 3, 0)) !== 7 && w.distance(V(0.4, 3, 0)) > 1);
  check('other trees stay solid', w.ownerAt(V(20.5, 3, 0)) === 8);
}

// 9. Rotated boxes and progress rules
{
  const w = new CollisionWorld(); w.hull = false;
  w.addBox(V(10, 0, 10), V(4, 2, 1), 0.2, Math.PI / 2); // long axis (x) turned to point along z
  check('rotated box is long along z', w.distance(V(10, 0, 11.8)) < 0 && w.distance(V(11.8, 0, 10)) > 1);
  const pr = new Progress();
  check('objective starts with the pod', pr.objective()[0].includes('pod'));
  pr.podDestroyed = true;
  check('hub objective says what is missing', pr.objective()[1] === 'Need 10 wood, 8 stone, 8 steel');
  pr.add('wood', 10); pr.add('stone', 8); pr.add('steel', 8);
  check('hub objective says press X when affordable', pr.objective()[1] === 'Press X');
  check('lantern stays locked until 20 wood', !pr.recipe('lantern').unlocked(pr) && (pr.add('wood', 10), pr.recipe('lantern').unlocked(pr)));
}

// 10. More recipes
{
  const pr = new Progress();
  check('36 recipes, four in the X menu', RECIPES.length === 36 && RECIPES.filter(r => r.where === 'x').length === 4);
  check('placeables are repeatable', RECIPES.filter(r => r.repeatable).map(r => r.id).join() === 'campfire,lamp,burner,miner,smelter,constructor,storage,conveyor,solar,splitter,sink');
  check('float core locked until 4 crystals', !pr.recipe('floatcore').unlocked(pr) && (pr.add('crystal', 4), pr.recipe('floatcore').unlocked(pr)));
  check('crystal gloves need power gloves first', !pr.recipe('crystalgloves').unlocked(pr) && (pr.crafted.add('gloves'), pr.add('crystal', 4), pr.recipe('crystalgloves').unlocked(pr)));
}

// 11. Save data round trip
{
  const a = new Progress();
  a.add('wood', 7); a.add('copper', 3); a.mined.copper = 2; a.crafted.add('axe'); a.made.campfire = 2; a.podDestroyed = true; a.hubPlaced = true;
  const json = JSON.parse(JSON.stringify(a.toJSON()));
  const b = new Progress(); b.add('gold', 99); b.load(json);
  check('progress survives a JSON save/load', b.items.wood === 7 && b.items.copper === 3 && b.items.gold === 0 && b.mined.copper === 2 && b.has('axe') && b.count('campfire') === 2 && b.podDestroyed && b.hubPlaced);
  b.reset();
  check('reset gives a fresh game', b.items.wood === 0 && !b.has('axe') && !b.podDestroyed && b.oresMined === 0);
  const c = new Progress(); c.podDestroyed = true; c.crafted.add('hub'); c.hubPlaced = true; c.benchOpened = true;
  c.made = { burner: 1, miner: 1, smelter: 1, constructor: 1, storage: 1 }; c.fueled = true; c.links = 2; c.platesCollected = 6; c.piecesBuilt = 3;
  ['axe'].forEach(i => c.crafted.add(i)); c.gamePlayed = true; ['lantern', 'gloves', 'floatcore'].forEach(i => c.crafted.add(i)); c.made.campfire = 1;
  check('objectives continue into the ore chain', c.objective()[0] === 'Find some ore');
  c.mined.iron = 4; check('iron pickaxe unlocks after 4 iron', c.objective()[0] === 'Craft the Iron Pickaxe');
}

// 12. Factory simulation
{
  const build = () => {
    const f = new Factory();
    const burner = f.addMachine('burner', 0, 0, 0); burner.fuel = 20;
    const miner = f.addMachine('miner', 5, 0, 0, 0, { index: 0, type: 'iron', purity: 1 });
    const smelter = f.addMachine('smelter', 15, 0, 0);
    const cons = f.addMachine('constructor', 25, 0, 0);
    const box = f.addMachine('storage', 35, 0, 0);
    for (const [a, b] of [[miner, smelter], [smelter, cons], [cons, box]]) { const l = f.link(a.id, b.id, 10); if (typeof l === 'string') throw new Error(l); }
    return { f, burner, miner, smelter, cons, box };
  };
  const run = (f: Factory, s: number, day = 1) => { for (let i = 0; i < s * 20; i++) f.update(0.05, day); };
  const A = build(); run(A.f, 120);
  const plates = A.box.stored.plate ?? 0;
  check('iron flows miner -> smelter -> constructor -> storage', plates >= 45 && plates <= 58, `${plates} plates in 120 s (about 30/min after warm-up)`);
  check('a powered miner reports about 30 ore/min', Math.abs(A.f.perMin(A.miner) - 30) < 6, `${A.f.perMin(A.miner).toFixed(0)}/min`);
  const B = build(); B.burner.fuel = 0; run(B.f, 60);
  check('no power, no production', (B.box.stored.plate ?? 0) === 0 && B.miner.status === 'No power' && B.f.power.ratio === 0);
  const C = build(); C.burner.fuel = 0; C.f.addMachine('solar', 0, 0, 5); C.f.addMachine('solar', 0, 0, 7); run(C.f, 120, 1);
  const half = (C.box.stored.plate ?? 0);
  const D = build(); D.burner.fuel = 0; D.f.addMachine('solar', 0, 0, 5); D.f.addMachine('solar', 0, 0, 7); run(D.f, 120, 0);
  check('solar power works by day and not at night', half > 5 && (D.box.stored.plate ?? 0) === 0, `day ${half} plates, night ${D.box.stored.plate ?? 0}`);
  const E = build(); for (let k = 0; k < 2; k++) { const extra = E.f.addMachine('miner', 7, 0, 3 + k, 0, { index: 1 + k, type: 'copper', purity: 1 }); E.f.link(extra.id, E.box.id, 20); }
  run(E.f, 60);
  check('a heavy overload trips the breaker and darkens the grid', E.f.tripped && E.f.power.ratio === 0 && E.miner.status === 'Breaker tripped', `demand ${E.f.power.demand.toFixed(1)} MW vs supply ${E.f.power.supply.toFixed(1)} MW`);
  const F = new Factory(); const fb = F.addMachine('burner', 0, 0, 0); fb.fuel = 5;
  const fm = F.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 1 }); const fc = F.addMachine('constructor', 5, 0, 0);
  F.link(fm.id, fc.id, 8); run(F, 120);
  check('ore on a belt into a constructor jams (wrong item = bottleneck)', fm.status === 'Output blocked' && (fc.input.ironIngot ?? 0) === 0 && (F.links[0].items.length > 0));
  check('links are refused when the ends make no sense', typeof A.f.link(A.box.id, A.miner.id, 5) === 'string' && typeof A.f.link(A.miner.id, A.smelter.id, 5) === 'string');
  const G = new Factory(); G.load(JSON.parse(JSON.stringify(A.f.toJSON())));
  check('factory state survives save/load', G.machines.length === 5 && G.links.length === 3 && (G.get(A.box.id)!.stored.plate ?? 0) === plates);
  const H = build(); const split = H.f.addMachine('smelter', 15, 0, 8); H.f.link(H.miner.id, split.id, 12); run(H.f, 100);
  check('a miner with two belts splits its output', (H.smelter.status !== 'Waiting for input') && (split.input.ironOre ?? 0) + (split.job ? 1 : 0) + (split.output.ironIngot ?? 0) > 0);
}

// 13. Advanced automation: purity, overclock, breaker, smart splitter, sink
{
  const mk = () => { const f = new Factory(); const b = f.addMachine('burner', 0, 0, 0); b.fuel = 60; return { f, b }; };
  const run = (f: Factory, s: number) => { for (let i = 0; i < s * 20; i++) f.update(0.05, 1); };
  // purity
  const P1 = mk(), P2 = mk();
  for (const [P, pur] of [[P1, 1], [P2, 2]] as const) { const m = P.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: pur }); const box = P.f.addMachine('storage', 5, 0, 0); P.f.link(m.id, box.id, 6); run(P.f, 90); }
  const got = (P: { f: Factory }) => P.f.machines.find(m => m.kind === 'storage')!.stored.ironOre ?? 0;
  check('a pure node mines about twice as fast as a normal one', got(P2) > got(P1) * 1.6, `pure ${got(P2)} vs normal ${got(P1)} ore in 90 s`);
  // overclock
  const O = mk(); const om = O.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 1 }); const ob = O.f.addMachine('storage', 5, 0, 0); O.f.link(om.id, ob.id, 6);
  O.f.overclock(om.id); O.f.overclock(om.id); run(O.f, 90);
  check('overclocking to 200% doubles output but draws more than double power', (ob.stored.ironOre ?? 0) > got(P1) * 1.6 && Math.abs(O.f.power.demand - 0.3 * Math.pow(2, 1.6)) < 0.02, `${ob.stored.ironOre} ore, ${O.f.power.demand.toFixed(2)} MW`);
  for (let i = 0; i < 10; i++) O.f.overclock(om.id);
  check('overclock stops at 250%', om.clock === 2.5);
  // breaker
  const T = mk(); for (let k = 0; k < 5; k++) { const m = T.f.addMachine('miner', k, 0, 0, 0, { index: k, type: 'iron', purity: 1 }); const b2 = T.f.addMachine('storage', 9 + k, 0, 0); T.f.link(m.id, b2.id, 6); }
  run(T.f, 5);
  check('overloading the grid trips the breaker', T.f.tripped && T.f.power.ratio === 0);
  T.f.addMachine('burner', 3, 0, 3).fuel = 60; T.f.addMachine('burner', 3, 0, 5).fuel = 60; T.f.resetBreaker(); run(T.f, 5);
  check('a bigger grid plus a reset brings it back', !T.f.tripped && T.f.power.ratio > 0.9);
  // smart splitter
  const S = mk(); S.f.addFuel(S.b.id, 0); S.f.addMachine('burner', 0, 0, 9).fuel = 60;
  const mi = S.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 2 }); const mc = S.f.addMachine('miner', 1, 0, 3, 0, { index: 1, type: 'copper', purity: 2 });
  const sp = S.f.addMachine('splitter', 6, 0, 1); const ba = S.f.addMachine('storage', 12, 0, -2), bb = S.f.addMachine('storage', 12, 0, 1), bc = S.f.addMachine('storage', 12, 0, 4);
  S.f.link(mi.id, sp.id, 6); S.f.link(mc.id, sp.id, 6);
  S.f.link(sp.id, ba.id, 6); S.f.link(sp.id, bb.id, 6); S.f.link(sp.id, bc.id, 6);
  sp.slots[0].filter = 'ironOre'; sp.slots[1].filter = 'copperOre'; sp.slots[2].filter = 'overflow'; run(S.f, 120);
  check('a smart splitter sends each item type to its own belt', (ba.stored.ironOre ?? 0) > 20 && (ba.stored.copperOre ?? 0) === 0 && (bb.stored.copperOre ?? 0) > 20 && (bb.stored.ironOre ?? 0) === 0, `A iron ${ba.stored.ironOre}, B copper ${bb.stored.copperOre}`);
  const V = mk(); V.f.addMachine('burner', 0, 0, 9).fuel = 60;
  const vm = V.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 1 }); const vs = V.f.addMachine('splitter', 6, 0, 0);
  const vj = V.f.addMachine('constructor', 12, 0, -2), vo = V.f.addMachine('storage', 12, 0, 3);
  V.f.link(vm.id, vs.id, 6); V.f.link(vs.id, vj.id, 6); V.f.link(vs.id, vo.id, 6);
  vs.slots[0].filter = 'ironOre'; vs.slots[1].filter = 'overflow'; vs.slots[2].filter = 'overflow'; run(V.f, 100);
  check('overflow takes what the main belt cannot (a jam never backs up the line)', (vo.stored.ironOre ?? 0) > 10 && vm.status !== 'Output blocked', `${vo.stored.ironOre} ore overflowed, miner ${vm.status}`);
  // sink
  const K = mk(); const km = K.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 1 }); const ks = K.f.addMachine('sink', 6, 0, 0); K.f.link(km.id, ks.id, 6); run(K.f, 90);
  check('the resource sink turns items into tokens and keeps the line moving', K.f.tokens >= 25 && km.status !== 'Output blocked' && K.f.takeTokens() >= 25 && K.f.tokens === 0, `${K.f.tokens} left after collecting`);
  // research
  const R = mk(); R.f.alt.plate = true; R.f.alt.wire = true;
  const rm = R.f.addMachine('miner', 1, 0, 0, 0, { index: 0, type: 'iron', purity: 2 }); const rs = R.f.addMachine('smelter', 6, 0, 0), rc = R.f.addMachine('constructor', 11, 0, 0), rb = R.f.addMachine('storage', 16, 0, 0);
  R.f.link(rm.id, rs.id, 6); R.f.link(rs.id, rc.id, 6); R.f.link(rc.id, rb.id, 6); run(R.f, 150);
  check('research recipes boost output (coated plates make 1.5 plates per ingot)', (rb.stored.plate ?? 0) > 60, `${rb.stored.plate} plates`);
}

// 14. Building pieces on the grid
{
  const w = new CollisionWorld(); w.hull = false; w.heightFn = heightAt;
  const bs = new BuildSystem(w);
  const face = V(0, 0, -1);
  const gp = (x: number, z: number) => V(x, heightAt(x, z), z);
  const plan1 = bs.plan('foundation', gp(10, 10), null, face);
  check('a foundation on the ground sits at the lowest floor level clear of the terrain', plan1.ok && plan1.level * 3 > cellGround(plan1.cx, plan1.cz).hi, `level ${plan1.level}`);
  const f1 = bs.add({ type: 'foundation', cx: plan1.cx, cz: plan1.cz, level: plan1.level, edge: 0, axis: 0, color: PALETTE[0] })!;
  check('the same cell cannot be built twice', !bs.plan('foundation', V((plan1.cx + 0.5) * 4, 0, (plan1.cz + 0.5) * 4), null, face).ok);
  const next = bs.plan('foundation', V((plan1.cx + 0.5) * 4 + 1.9, f1.level * 3, (plan1.cz + 0.5) * 4), f1, face);
  check('aiming at a foundation edge extends it into the neighbouring cell at the same level', next.ok && next.cx === plan1.cx + 1 && next.cz === plan1.cz && next.level === f1.level);
  const wp = bs.plan('wall', V((plan1.cx + 0.5) * 4 + 1.9, f1.level * 3, (plan1.cz + 0.5) * 4), f1, face);
  check('a wall goes on the nearest edge of the foundation', wp.ok && wp.edge === 0 && wp.cx === plan1.cx && wp.level === f1.level);
  const wall = bs.add({ type: 'wall', cx: wp.cx, cz: wp.cz, level: wp.level, edge: wp.edge, axis: 0, color: PALETTE[0] })!;
  check('walls stack upward', bs.plan('wall', V(0, 0, 0), wall, face).level === wall.level + 1);
  check('a wall needs a foundation to stand on', !bs.plan('wall', gp(30, 30), null, face).ok);
  const top = f1.level * 3;
  check('a foundation is solid at its top surface and a wall blocks the player', w.distance(V((plan1.cx + 0.5) * 4, top + 0.3, (plan1.cz + 0.5) * 4)) > 0.2 && w.distance(V((plan1.cx + 0.5) * 4, top - 0.6 + 0.1, (plan1.cz + 0.5) * 4)) < 0 && w.distance(V((plan1.cx + 1) * 4, top + 1.5, (plan1.cz + 0.5) * 4)) < 0);
  const json = JSON.parse(JSON.stringify(bs.toJSON()));
  const bs2 = new BuildSystem(new CollisionWorld()); bs2.load(json);
  check('buildings survive save/load', bs2.pieces.length === 2 && bs2.has(wall));
  bs.remove(wall.id);
  check('removing a piece takes its collision with it', w.distance(V((plan1.cx + 1) * 4, top + 1.5, (plan1.cz + 0.5) * 4)) > 0.5 && bs.pieces.length === 1);
}

// 15. Hazards and gear
{
  const zones: Zone[] = [{ kind: 'poison', x: 0, z: 0, r: 20 }, { kind: 'radiation', x: 100, z: 0, r: 20 }, { kind: 'poison', x: 110, z: 5, r: 20 }];
  const none: Gear = { mask: false, hazmat: false, boots: false };
  check('zones report what you are standing in', exposure(zones, 5, 5).poison && !exposure(zones, 5, 5).radiation && exposure(zones, 105, 0).radiation && exposure(zones, 105, 0).poison && !exposure(zones, 50, 0).poison);
  check('poison hurts without a mask and not with one', damagePerSecond({ poison: true, radiation: false }, none) > 0 && damagePerSecond({ poison: true, radiation: false }, { ...none, mask: true }) === 0);
  check('radiation needs a hazmat suit (a mask halves it)', damagePerSecond({ poison: false, radiation: true }, none) === 20 && damagePerSecond({ poison: false, radiation: true }, { ...none, mask: true }) === 10 && damagePerSecond({ poison: false, radiation: true }, { ...none, hazmat: true }) === 0);
  check('a hazmat suit does not stop poison', damagePerSecond({ poison: true, radiation: true }, { ...none, hazmat: true }) > 0);
  check('soft landings are free and hard ones hurt', fallDamage(8, none) === 0 && fallDamage(18, none) > 30);
  check('Blade Runners cut fall damage by 80%', Math.abs(fallDamage(18, { ...none, boots: true }) - fallDamage(18, none) * 0.2) < 1e-9);
  const hp = new Health();
  for (let i = 0; i < 40; i++) hp.update(0.1, 12);
  check('standing in poison drains health', hp.hp < 60 && hp.hp > 40, `${hp.hp.toFixed(0)} HP after 4 s`);
  const before = hp.hp; for (let i = 0; i < 100; i++) hp.update(0.1, 0);
  check('health comes back after a few safe seconds', hp.hp > before + 20);
  const dying = new Health(); let dead = false; for (let i = 0; i < 100 && !dead; i++) dead = dying.update(0.1, 20);
  check('enough radiation kills you', dead && dying.hp === 0);
  const rf = new Factory(); rf.addMachine('miner', 0, 0, 0, 0, { index: 0, type: 'iron', purity: 1 }); rf.reactor = 4; rf.update(1, 0);
  check('the reactor powers machines at night', rf.power.supply === 4 && rf.power.ratio === 1);
  const rp = new Progress(); rp.crafted.add('gasmask'); rp.crafted.add('hazmat'); rp.mined.uranium = 2;
  check('uranium counts as an ore and gates the reactor', rp.oresMined === 2 && !rp.recipe('reactor').unlocked(rp) && (rp.mined.uranium = 3, rp.recipe('reactor').unlocked(rp)));
  check('hazmat needs the gas mask first', !new Progress().recipe('hazmat').unlocked(new Progress()) && rp.recipe('hazmat').unlocked(rp));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
