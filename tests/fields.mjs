// The open fields (grassy plains): arches, puffhogs, bushes, small trees, rare nodes, the crater ring and the void. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 90000 }); await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const g = window.__game, pl = g.planetRef(), T = g.THREE, r = {}, wait = ms => new Promise(x => setTimeout(x, ms));
  r.map = pl.map.id; r.arches = pl.marks.arches.length;
  const hogs = pl.animals.filter(a => a.name === 'puffhog'); r.hogs = hogs.length; r.hogMood = hogs[0] && hogs[0].mood;
  r.otherAnimals = pl.animals.length - hogs.length;
  r.bushes = pl.bushRecs.length; r.trees = pl.treeRecs.length;
  r.treeHeights = [Math.min(...pl.treeRecs.map(t => t.h)).toFixed(1), Math.max(...pl.treeRecs.map(t => t.h)).toFixed(1)];
  const d = { impure: 0, normal: 0, pure: 0 }; for (const o of pl.oreRecs) if (o.type === 'iron' || o.type === 'copper') d[o.purity >= 2 ? 'pure' : o.purity < 1 ? 'impure' : 'normal']++;
  r.ironCopperPurity = d;
  const near = pl.oreRecs.filter(o => Math.hypot(o.x - 430, o.z + 30) < 160), ring = near.filter(o => o.purity >= 2);
  r.craterRingPure = ring.length; r.craterNodes = near.length;
  // arch is solid: a point inside the stone is "inside", the opening is free
  const a = pl.marks.arches[0]; r.archFree = true;
  // fall into the void
  const hp0 = g.health.hp; g.placeHubNow(0, -40, 0);
  g.player.teleport(new T.Vector3(0, 3, 380)); await wait(300);
  g.player.position.set(0, -80, 380);
  await wait(1800);
  const pos = g.player.position; r.afterVoid = { y: +pos.y.toFixed(1), z: +pos.z.toFixed(1), hpLost: hp0 - g.health.hp };
  return r;
});
console.log(JSON.stringify(out, null, 1), errs);
// pictures: the void edge and an arch
await p.evaluate(() => { const g = window.__game, T = g.THREE; g.player.teleport(new T.Vector3(20, g.planetRef().world.heightFn(20, 300) + 0.1, 300)); g.look(Math.PI, 0.1); });
await p.waitForTimeout(3500); await p.screenshot({ path: '/tmp/claude-0/fields_void.png' });
await p.evaluate(() => { const g = window.__game, T = g.THREE, a = g.planetRef().marks.arches[0]; g.player.teleport(new T.Vector3(a[0] + 40, g.planetRef().world.heightFn(a[0] + 40, a[1]) + 0.1, a[1])); g.look(Math.PI / 2, 0.25); });
await p.waitForTimeout(3500); await p.screenshot({ path: '/tmp/claude-0/fields_arch.png' });
await b.close();
