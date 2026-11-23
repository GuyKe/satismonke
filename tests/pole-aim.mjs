// A power pole is thin: it must still be easy to aim at, and its status card must not hang in front of it. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(2000);
const out = await p.evaluate(async () => {
  const g = window.__game, T = g.THREE, f = g.factory, v = g.factoryView, wait = ms => new Promise(r => setTimeout(r, ms));
  const add = (k, x, z, ore = null) => { const m = f.addMachine(k, x, 0, z, 0, ore); v.addMachine(m); return m; };
  const burner = add('burner', -6, -14), pole = add('pole', 0, -14), miner = add('miner', 6, -14, { index: 0, type: 'iron', purity: 1 });
  v.group.updateMatrixWorld(true);
  const eye = new T.Vector3(0, 1.6, 0);
  const pick = (tx, ty, tz) => { const ray = new T.Raycaster(eye.clone(), new T.Vector3(tx, ty, tz).sub(eye).normalize()); ray.far = 40; const h = v.pick(ray); return h ? h.id : null; };
  const r = {};
  r.centre = pick(0, 2.2, -14) === pole.id;
  r.off05 = pick(0.5, 2.2, -14) === pole.id;          // half a metre beside the trunk
  r.off08 = pick(-0.8, 3.0, -14) === pole.id;
  r.burner = pick(-6, 1, -14) === burner.id; r.miner = pick(6, 1.5, -14) === miner.id;
  r.farMiss = pick(2.5, 2.2, -14) === null;            // well clear of everything
  // the status card hangs above the machine instead of in front of it
  g.machinePanel.show(pole.id);
  window.__game.setPanel(null);
  return r;
});
console.log(JSON.stringify(out), errs);
await b.close();
