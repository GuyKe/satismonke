// Builds each map in the browser and compares what is in it. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const out = {};
for (const map of ['plains', 'jungle', 'desert']) {
  const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
  await p.goto(`http://localhost:4173/?skip=planet&map=${map}`); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 90000 }); await p.waitForTimeout(2500);
  out[map] = await p.evaluate(() => {
    const pl = window.__game.planetRef(), ores = {}; for (const o of pl.oreRecs) ores[o.type] = (ores[o.type] ?? 0) + 1;
    const trees = pl.treeRecs, hf = (x, z) => 0;
    let land = 0, open = 0;
    for (let x = -420; x <= 420; x += 14) for (let z = -420; z <= 420; z += 14) {
      if (Math.hypot(x, z) > 420) continue;
      if (!pl.world.heightFn) continue;
      const h = pl.world.heightFn(x, z); if (h < -2.8) continue; land++;
      if (!trees.some(t => Math.hypot(t.x - x, t.z - z) < 10)) open++;
    }
    return { map: pl.map.id, trees: trees.length, boulders: pl.boulderRecs.length, crystals: pl.crystalRecs.length, sites: pl.siteRecs.length, ores, animals: pl.animals.length, openOfLand: +(open / land).toFixed(2), landSamples: land };
  });
  await p.screenshot({ path: `/tmp/claude-0/map_${map}.png` });
  out[map].errs = errs; await p.close();
}
console.log(JSON.stringify(out, null, 1)); await b.close();
