// The host picks a map in the lobby; everyone builds that map. Needs vite preview on :4173 and a local PeerServer on 127.0.0.1:9000.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const URL = 'http://localhost:4173/?peerhost=127.0.0.1&peerport=9000&fastload=1';
const mk = async () => { const c = await b.newContext(); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(URL); await p.waitForFunction(() => window.__game, null, { timeout: 60000 }); return p; };
const A = await mk(), B = await mk();
await A.evaluate(() => window.__game.net.host()); await A.waitForFunction(() => window.__game.net.state === 'lobby');
await A.evaluate(() => window.__game.mainPanel.h.onPickMap('desert'));
const code = await A.evaluate(() => window.__game.net.code);
await B.evaluate(c => window.__game.net.join(c), code); await B.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
await A.evaluate(() => window.__game.mainPanel.h.onStartLobby());
await A.waitForFunction(() => window.__game.planetRef(), null, { timeout: 90000 }); await B.waitForFunction(() => window.__game.planetRef(), null, { timeout: 90000 });
const info = p => p.evaluate(() => { const pl = window.__game.planetRef(); return { map: pl.map.id, trees: pl.treeRecs.length, boulders: pl.boulderRecs.length, h: +pl.world.heightFn(120, -80).toFixed(3) }; });
const a = await info(A), bb = await info(B);
console.log('host', a, 'client', bb, 'identical worlds:', JSON.stringify(a) === JSON.stringify(bb), a.map === 'desert', A.errs, B.errs);
await b.close();
