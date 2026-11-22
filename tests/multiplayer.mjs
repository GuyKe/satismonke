// Two browsers create/join a lobby and start. Needs: vite preview on :4173 and a local PeerServer on 127.0.0.1:9000 (see HANDOVER.md).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--no-sandbox'] });
const URL = 'http://localhost:4173/?peerhost=127.0.0.1&peerport=9000';
const mk = async () => { const p = await b.newPage(); p.errs=[]; p.on('pageerror', e=>p.errs.push(String(e))); await p.goto(URL); await p.waitForTimeout(3000); return p; };
const A = await mk(), B = await mk();
await A.evaluate(()=>window.__game.net.host());
await A.waitForFunction(()=>window.__game.net.state==='lobby',null,{timeout:15000});
const code = await A.evaluate(()=>window.__game.net.code); console.log('code', code);
await B.evaluate(c=>window.__game.net.join(c), code);
await B.waitForFunction(()=>window.__game.net.state==='lobby',null,{timeout:15000});
console.log('A players', await A.evaluate(()=>window.__game.net.list.length), 'B players', await B.evaluate(()=>window.__game.net.list.length));
await A.evaluate(()=>window.__game.net.start());
await A.waitForTimeout(6000);
for (const [n,p] of [['A',A],['B',B]]) console.log(n, await p.evaluate(()=>({st:window.__game.net.state, mode:window.__game.appMode, remotes:window.__game.remotes.count})), p.errs);
await b.close();
