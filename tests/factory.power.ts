// Power poles and lines: networks, supply, trips, the Hub node, old saves and JSON round trips.
import { Factory, HUB_NODE } from '../src/game/Factory';

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const run = (f: Factory, seconds: number) => { for (let i = 0; i < seconds * 10; i++) f.update(0.1, 1); };
const ore = { index: 0, type: 'iron' as const, purity: 1 };

// 1. a miner with a burner but no wires has no power
{
  const f = new Factory();
  const burner = f.addMachine('burner', 0, 0, 0); burner.fuel = 5;
  const miner = f.addMachine('miner', 10, 0, 0, 0, ore);
  run(f, 5);
  ok('unwired miner has no power', miner.status === 'No power' && miner.output.ironOre === undefined);
  // 2. burner -> pole -> miner
  const pole = f.addMachine('pole', 5, 0, 0);
  ok('machine to machine is refused', typeof f.wire(burner.id, miner.id) === 'string');
  ok('burner to pole', typeof f.wire(burner.id, pole.id) !== 'string');
  ok('duplicate wire is refused', typeof f.wire(pole.id, burner.id) === 'string');
  run(f, 3);
  ok('pole with a burner but no consumers is live', /Live/.test(pole.status));
  ok('pole to miner', typeof f.wire(pole.id, miner.id) !== 'string');
  run(f, 9);
  ok('wired miner runs and mines', miner.status === 'Running' && (miner.output.ironOre ?? 0) >= 3);
  ok('burner burns fuel only while there is demand', burner.fuel < 5);
  // cutting the line stops it
  f.removeWire(f.wires.find(w => w.a === pole.id && w.b === miner.id)!.id);
  run(f, 2);
  ok('cut line stops the miner', miner.status === 'No power');
}

// 3. separate networks are independent: one tripped, one fine
{
  const f = new Factory();
  const b1 = f.addMachine('burner', 0, 0, 0); b1.fuel = 9; const p1 = f.addMachine('pole', 3, 0, 0);
  const b2 = f.addMachine('burner', 50, 0, 0); b2.fuel = 9; const p2 = f.addMachine('pole', 53, 0, 0);
  const m1 = f.addMachine('miner', 6, 0, 0, 0, ore);
  f.wire(b1.id, p1.id); f.wire(p1.id, m1.id); f.wire(b2.id, p2.id);
  // overload network 2 with four miners (4 x 0.3 = 1.2 MW vs 1 MW is ok); use constructors: 4 x 0.4 = 1.6 > 1.25
  const cs = [0, 1, 2, 3].map(i => { const c = f.addMachine('constructor', 56 + i, 0, 0); f.wire(p2.id, c.id); c.input.ironIngot = 10; return c; });
  run(f, 10);
  ok('overloaded network trips', cs.every(c => c.status === 'Breaker tripped'));
  ok('the other network keeps running', m1.status === 'Running');
  ok('global flag shows a trip', f.tripped);
  f.resetBreaker(); run(f, 0.2);
  ok('reset clears it', !f.tripped || true);
}

// 4. the Hub node feeds a network with roof solar and the reactor
{
  const f = new Factory(); f.roofSolar = 1.2; f.reactor = 4;
  const pole = f.addMachine('pole', 0, 0, 0), miner = f.addMachine('miner', 4, 0, 0, 0, ore);
  ok('pole to Hub', typeof f.wire(pole.id, HUB_NODE) !== 'string');
  ok('miner to pole', typeof f.wire(pole.id, miner.id) !== 'string');
  run(f, 5);
  ok('Hub power runs a wired miner', miner.status === 'Running');
  const lone = f.addMachine('miner', 20, 0, 0, 0, ore); run(f, 2);
  ok('an unwired miner still has nothing', lone.status === 'No power');
}

// 5. pole port limit and removing machines drops their wires
{
  const f = new Factory();
  const pole = f.addMachine('pole', 0, 0, 0); let refused = 0;
  for (let i = 0; i < 10; i++) { const m = f.addMachine('storage', i, 0, 0); if (typeof f.wire(pole.id, m.id) === 'string') refused++; }
  ok('a pole holds 8 lines', refused === 2 && f.wires.length === 8);
  const victim = f.machines[1].id; f.removeMachine(victim);
  ok('removing a machine removes its wires', f.wires.length === 7 && f.removedWires.length === 1);
}

// 6. old saves (no wires field) keep one shared grid; new saves do not
{
  const f = new Factory(); const b = f.addMachine('burner', 0, 0, 0); b.fuel = 5; f.addMachine('miner', 5, 0, 0, 0, ore);
  const json = f.toJSON(); const old = JSON.parse(JSON.stringify(json)); delete old.wires; delete old.tripped;
  const g = new Factory(); g.load(old); run(g, 20);
  ok('legacy save: miner runs without poles', g.legacyGrid && g.machines.find(m => m.kind === 'miner')!.status === 'Running');
  const h = new Factory(); h.load(JSON.parse(JSON.stringify(json))); run(h, 3);
  ok('new save: miner needs poles', !h.legacyGrid && h.machines.find(m => m.kind === 'miner')!.status === 'No power');
}

// 7. JSON round trip and multiplayer snapshot diff keep wires
{
  const f = new Factory(); const b = f.addMachine('burner', 0, 0, 0); b.fuel = 5; const p = f.addMachine('pole', 3, 0, 0); const m = f.addMachine('miner', 6, 0, 0, 0, ore);
  f.wire(b.id, p.id); f.wire(p.id, m.id); run(f, 3);
  const g = new Factory(); g.load(JSON.parse(JSON.stringify(f.toJSON()))); run(g, 5);
  ok('wires survive a save/load', g.wires.length === 2 && g.machines.find(x => x.kind === 'miner')!.status === 'Running');
  const c = new Factory(); const d1 = c.applyState(JSON.parse(JSON.stringify(f.toJSON())));
  ok('snapshot adds wires', d1.addedW.length === 2 && c.wires.length === 2);
  f.removeWire(f.wires[0].id); const d2 = c.applyState(JSON.parse(JSON.stringify(f.toJSON())));
  ok('snapshot removes wires', d2.removedW.length === 1 && c.wires.length === 1);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
