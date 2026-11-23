// Backrooms and Sandbox: built, played with hand-fed input, and photographed. Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
await p.goto('http://localhost:4173/'); await p.waitForFunction(() => window.__game, null, { timeout: 60000 }); await p.waitForTimeout(2000);
const out = await p.evaluate(async () => {
  const g = window.__game, T = g.THREE, wait = ms => new Promise(r => setTimeout(r, ms)), r = {};
  const ctxFor = (extra = {}) => { const log = { hurt: 0, toasts: [], said: [] }; return { log, ctx: { camera: g.camera, head: new T.Vector3(g.player.position.x, 1.6, g.player.position.z), hands: [new T.Vector3(), new T.Vector3()], handSpeed: [0, 0], gripDown: [false, false], hurt: n => { log.hurt += n; }, toast: t => log.toasts.push(t), say: k => log.said.push(k), pickup() {}, growl() {}, ...extra } }; };
  // ---------------- backrooms ----------------
  g.beginBackrooms(); await wait(600);
  const br = g.gameMode; r.backrooms = { id: br.id, items: br.items.length, monsters: br.monsters.length, walls: br.world.boxes.length };
  r.brHud = br.hud();
  // pick up an item: put a hand on it
  const it = br.items.find(i => i.kind === 'water');
  br.thirst = 30; let c = ctxFor({ hands: [new T.Vector3(it.x, 0.1, it.z), new T.Vector3()] }); c.ctx.head.set(it.x + 5, 1.6, it.z);
  br.update(0.1, c.ctx); r.waterPicked = it.taken; r.thirstAfter = Math.round(br.thirst); r.collected = br.collected;
  // hunger and thirst fall; at zero it hurts
  br.hunger = 0.5; br.thirst = 0.5; c = ctxFor(); for (let i = 0; i < 30; i++) br.update(0.5, c.ctx); r.starvingHurts = c.log.hurt > 5;
  // a lurker that sees you chases and catches you
  br.hunger = br.thirst = 80;
  const mo = br.monsters[0]; mo.state = 'patrol'; mo.stun = 0; const cs = br.cellOf(mo.rig.group.position.x, mo.rig.group.position.z);
  c = ctxFor(); const [px, pz] = br.centerOf(cs[0], cs[1]); c.ctx.head.set(px, 1.6, pz + 0.01);
  for (let i = 0; i < 6; i++) br.update(0.1, c.ctx); r.lurkerState = mo.state; r.hurtByLurker = c.log.hurt;
  r.lurkerChasedSaid = c.log.said.includes('brChased');
  return r;
});
console.log(JSON.stringify(out, null, 1));
await p.screenshot({ path: '/tmp/claude-0/backrooms.png' });
// a look down a hall
await p.evaluate(() => { const g = window.__game; g.look(0.6, 0.0); });
await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/claude-0/backrooms2.png' });
console.log(errs);
await b.close();
