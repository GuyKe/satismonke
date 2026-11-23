// Biomass (bushes, tree leaves, burner fuel) and ore node rarity (impure 2, normal 3, pure 4). Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(1500);
const out = await p.evaluate(() => {
  const g = window.__game, pl = g.planetRef(), pr = g.progress, far = new g.camera.position.constructor(0, 0, 0), r = {};
  // ore yields by purity
  const yieldOf = o => { const i = pl.oreRecs.indexOf(o), before = pr.items[o.type]; while (pl.hitOre(i, 'iron') > 0); return pr.items[o.type] - before; };
  const dist = { impure: 0, normal: 0, pure: 0 };
  for (const o of pl.oreRecs) dist[o.purity >= 2 ? 'pure' : o.purity < 1 ? 'impure' : 'normal']++;
  r.distribution = dist;
  for (const [name, test] of [['impure', o => o.purity < 1], ['normal', o => o.purity >= 1 && o.purity < 2], ['pure', o => o.purity >= 2]]) {
    const o = pl.oreRecs.find(x => x.type === 'iron' && test(x) && !x.broken); r['yield_' + name] = o ? yieldOf(o) : 'no node';
  }
  // pure nodes carry a gem marker
  r.pureMarkers = pl.pureMarks.count === pl.oreRecs.filter(o => o.purity >= 2).length;
  // bushes
  r.bushes = pl.bushRecs.length; const bi = 0, bb = pl.bushRecs[bi];
  const bio0 = pr.items.biomass; pl.hitBush(bi); r.bushGave = pr.items.biomass - bio0; r.bushGone = bb.picked; r.bushAgain = pl.hitBush(bi);
  const solid = () => pl.world.distance(new g.camera.position.constructor(bb.x, bb.y + bb.r * 0.4, bb.z));
  const gone = solid();
  for (let i = 0; i < 305; i++) pl.update(1, g.scene, far, far);
  r.bushRegrew = !bb.picked && solid() < gone;
  // trees give leaves too
  const t = pl.treeRecs.findIndex(x => Math.hypot(x.x, x.z) > 40), bio1 = pr.items.biomass; pl.fellTree(t, far);
  for (let i = 0; i < 4; i++) pl.update(1, g.scene, far, far);
  r.treeBiomass = pr.items.biomass - bio1;
  // burner fuel
  const m = g.factory.addMachine('burner', 10, 0, 10); g.factoryView.addMachine(m);
  pr.items.biomass = 25; g.machineAction('fuelbio', m.id);
  r.burnerFuel = +m.fuel.toFixed(1); r.biomassLeft = pr.items.biomass;
  pr.items.biomass = 3; g.machineAction('fuelbio', m.id); r.notEnough = +m.fuel.toFixed(1);
  return r;
});
console.log(JSON.stringify(out, null, 1), errs);
await b.close();
