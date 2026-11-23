// The menu button opens the inventory; a crafted Power Line shows up there; click it, then click two things to join them. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(2000);
const out = await p.evaluate(async () => {
  const g = window.__game, f = g.factory, v = g.factoryView, pp = g.pausePanel, wait = ms => new Promise(r => setTimeout(r, ms)), r = {};
  for (const k of ['wood', 'stone', 'steel', 'crystal', 'copper', 'iron', 'gold', 'plasma', 'uranium', 'plate', 'wire']) g.progress.items[k] = 12 + k.length;
  g.progress.made.pole = 1; g.progress.made.burner = 1;
  r.beforeCraft = g.progress.ownsTool('powerline');
  g.craft('powerline'); r.afterCraft = g.progress.ownsTool('powerline');
  g.craft('powerline'); // second time does nothing new
  // the menu button opens the inventory first
  g.togglePause(true); await wait(500);
  r.page = pp.page; r.tiles = pp.h.inventory().length; r.tools = pp.h.tools().map(t => `${t.name}:${t.owned ? 'owned' : 'no'}`);
  // place a burner, a pole and a miner
  const add = (k, x, z, ore = null) => { const m = f.addMachine(k, x, 0, z, 0, ore); v.addMachine(m); return m; };
  const burner = add('burner', -6, -12), pole = add('pole', 0, -12), miner = add('miner', 6, -12, { index: 0, type: 'iron', purity: 1 }); burner.fuel = 5;
  g.progress.items.copper = 20;
  // click POWER LINE in the inventory, then click two things (aiming = handleLink)
  pp.btns.find(b => /POWER LINE/.test(b.label)).act(); await wait(300);
  r.pausedAfterPick = g.pauseOpen;
  g.handleLink(burner.id); g.handleLink(pole.id);
  pp.open(); const btnsAfter = pp.btns.map(b => b.label);
  g.togglePause(false);
  r.wires = f.wires.length; r.copperLeft = g.progress.items.copper;
  // pick it again, connect the pole to the miner
  g.togglePause(true); await wait(300); pp.btns.find(b => /POWER LINE/.test(b.label)).act(); await wait(200);
  g.handleLink(pole.id); g.handleLink(miner.id);
  for (let i = 0; i < 60; i++) f.update(0.1, 1);
  r.minerStatus = miner.status; r.wiresNow = f.wires.length;
  g.togglePause(true); await wait(600); pp.open();
  return r;
});
console.log(JSON.stringify(out));
await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/claude-0/inventory.png' });
console.log(errs); await b.close();
