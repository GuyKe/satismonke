// Realms: the host saves, members get their progress back, outsiders are refused. Needs vite preview on :4173 and a local PeerServer on 127.0.0.1:9000.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const URL = 'http://localhost:4173/?peerhost=127.0.0.1&peerport=9000&fastload=1';
const mk = async () => { const c = await b.newContext({ permissions: ['microphone'] }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(URL); await p.waitForFunction(() => window.__game, null, { timeout: 60000 }); return p; };
const G = (p, f, ...a) => p.evaluate(f, ...a);
const A = await mk(), B = await mk(), C = await mk();
const out = {};
// A hosts with saving on; B joins; start
await G(A, () => { window.__game.net.host(); }); await A.waitForFunction(() => window.__game.net.state === 'lobby');
await G(A, () => { window.__game.mainPanel.h.onToggleSaving(); });
const code = await G(A, () => window.__game.net.code);
await G(B, c => window.__game.net.join(c), code); await B.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
await G(A, () => window.__game.mainPanel.h.onStartLobby());
await A.waitForFunction(() => window.__game.planetRef(), null, { timeout: 60000 }); await B.waitForFunction(() => window.__game.planetRef(), null, { timeout: 60000 });
// play a bit: B gets 77 iron, A breaks a boulder and A's machine goes in
await G(B, () => { window.__game.progress.items.iron = 77; });
await G(A, () => { const g = window.__game; g.planetRef().hitBoulder(3, 1); g.progress.items.copper = 55; const m = g.factory.addMachine('storage', 5, 0, 5, 0); g.factoryView.addMachine(m); });
await A.waitForTimeout(1500);
out.saved = await G(A, async () => await new Promise(res => { window.__game.mainPanel.h.onSave && 0; res(null); }));
await G(A, () => { window.__game.pausePanel.h.onSave(); }); await A.waitForTimeout(4000);
out.realmStored = await G(A, code => { const r = JSON.parse(localStorage.getItem('satismonke.realm.' + code) || 'null'); return r && { members: Object.keys(r.members).length, memberProgress: Object.values(r.progressOf).map(v => v.progress.items.iron), hostCopper: r.world.progress.items.copper, boulders: r.world.planet.brokenBoulders, machines: r.world.planet.factory.machines.length }; }, code);
out.bRemembers = await G(B, () => JSON.parse(localStorage.getItem('satismonke.joined') || '[]').map(j => j.code));
// everyone leaves; A hosts the realm again from the menu list
await G(A, () => window.__game.enterMainMenu(false)); await G(B, () => window.__game.enterMainMenu(false));
await A.waitForTimeout(1500);
out.realmList = await G(A, () => window.__game.mainPanel.h.realms());
await G(A, c => window.__game.mainPanel.h.onRealmHost(c), code);
await A.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
out.sameCode = (await G(A, () => window.__game.net.code)) === code;
// an outsider is refused
await G(C, c => window.__game.net.join(c), code); await C.waitForFunction(() => window.__game.net.state === 'error', null, { timeout: 20000 });
out.outsider = await G(C, () => window.__game.net.error);
// the member rejoins and gets progress back
await G(B, c => window.__game.net.join(c), code); await B.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
await G(A, () => window.__game.mainPanel.h.onStartLobby());
await A.waitForFunction(() => window.__game.planetRef(), null, { timeout: 60000 }); await B.waitForFunction(() => window.__game.planetRef(), null, { timeout: 60000 });
await B.waitForTimeout(2500);
out.bIronAfter = await G(B, () => window.__game.progress.items.iron);
out.aCopperAfter = await G(A, () => window.__game.progress.items.copper);
out.worldRestoredOnA = await G(A, () => [window.__game.planetRef().boulderRecs[3].broken, window.__game.factory.machines.length]);
out.worldRestoredOnB = await G(B, () => [window.__game.planetRef().boulderRecs[3].broken, window.__game.factory.machines.length]);
console.log(JSON.stringify(out, null, 1), A.errs, B.errs, C.errs);
await b.close();
