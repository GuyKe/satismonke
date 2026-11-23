// Trees, boulders and ore rocks grow back 5 minutes (game time) after they are used up. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(2000);
const r = await p.evaluate(() => {
  const g = window.__game, pl = g.planetRef(), V = g.camera.position.constructor, far = new V(0, 0, 0);
  const t = pl.treeRecs.find(t => Math.hypot(t.x, t.z) > 60), bi = pl.boulderRecs.findIndex(b => Math.hypot(b.x, b.z) > 60), oi = pl.oreRecs.findIndex(o => Math.hypot(o.x, o.z) > 60);
  const ti = pl.treeRecs.indexOf(t), b0 = pl.boulderRecs[bi], o0 = pl.oreRecs[oi];
  const solidNear = (x, y, z) => pl.world.distance(new V(x, y, z));
  const before = { tree: solidNear(t.x + 0.0, t.y + 3, t.z), boulder: solidNear(b0.x, b0.y + b0.r * 0.3, b0.z), ore: solidNear(o0.x, o0.y + o0.r * 0.35, o0.z) };
  pl.fellTree(ti, far); while (pl.hitBoulder(bi, 1) > 0); while (pl.hitOre(oi, 'iron') > 0);
  const gone = { tree: t.felled, boulder: b0.broken, ore: o0.broken, treeSolid: solidNear(t.x, t.y + 3, t.z) };
  const events = []; pl.onRespawn = (k, i) => events.push(k + ':' + i);
  // 4 minutes: still gone
  for (let i = 0; i < 240; i++) pl.update(1, g.scene, far, far);
  const at4 = { tree: t.felled, boulder: b0.broken, ore: o0.broken };
  // 5 minutes: back
  for (let i = 0; i < 70; i++) pl.update(1, g.scene, far, far);
  const at5 = { tree: t.felled, boulder: b0.broken, ore: o0.broken, treeSolid: solidNear(t.x, t.y + 3, t.z), boulderSolid: solidNear(b0.x, b0.y + b0.r * 0.3, b0.z) };
  // and can be used up again
  const again = pl.fellTree(ti, far);
  // a player standing right there delays it
  const here = new V(b0.x, 0, b0.z); while (pl.hitBoulder(bi, 1) > 0); for (let i = 0; i < 320; i++) pl.update(1, g.scene, far, here);
  const blocked = b0.broken; for (let i = 0; i < 20; i++) pl.update(1, g.scene, far, far);
  return { before, gone, at4, at5, events, again, blockedWhileStandingThere: blocked, backAfterLeaving: !b0.broken };
});
console.log(JSON.stringify(r, null, 1), errs);
await b.close();
