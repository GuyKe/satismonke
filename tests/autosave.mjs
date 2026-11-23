// Autosave: saves every 5 minutes (here: forced to 1 s away), and not when it is switched off. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(2000);
const out = await p.evaluate(async () => {
  const g = window.__game, wait = ms => new Promise(r => setTimeout(r, ms));
  localStorage.removeItem('satismonke.save.0');
  g.autosaveIn(3000);   // far from the 5 minute mark: nothing yet
  await wait(1500);
  const early = !!localStorage.getItem('satismonke.save.0');
  g.autosaveIn(0.5); await wait(3000);
  const on = JSON.parse(localStorage.getItem('satismonke.save.0') || 'null');
  localStorage.removeItem('satismonke.save.0'); g.settings.autosave = false; g.autosaveIn(0.5); await wait(3000);
  const off = !!localStorage.getItem('satismonke.save.0');
  // the settings page still fits
  const mp = g.mainPanel; mp.go('settings'); const bad = mp.btns.filter(x => x.x < 0 || x.y < 0 || x.x + x.w > 800 || x.y + x.h > 500).map(x => x.label);
  let overlap = []; for (let i = 0; i < mp.btns.length; i++) for (let j = i + 1; j < mp.btns.length; j++) { const a = mp.btns[i], c = mp.btns[j]; if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) overlap.push(a.label + '/' + c.label); }
  return { savedTooEarly: early, savedWhenDue: !!on && on.phase === 'planet', savedWhenOff: off, labels: mp.btns.map(x => x.label), offPanel: bad, overlap, interval: 300 };
});
console.log(JSON.stringify(out), errs);
await b.close();
