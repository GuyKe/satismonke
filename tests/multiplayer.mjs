// Two browsers create/join a lobby and start. Needs: vite preview on :4173 and a local PeerServer on 127.0.0.1:9000 (see HANDOVER.md).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--no-sandbox'] });
const URL = 'http://localhost:4173/?peerhost=127.0.0.1&peerport=9000';
const mk = async () => { const p = await b.newPage(); p.errs=[]; p.on('pageerror', e=>p.errs.push(String(e))); await p.goto(URL); await p.waitForFunction(()=>window.__game,null,{timeout:30000}); await p.waitForTimeout(2000); return p; };
const A = await mk(), B = await mk();
await A.evaluate(()=>window.__game.net.host());
await A.waitForFunction(()=>window.__game.net.state==='lobby',null,{timeout:15000});
const code = await A.evaluate(()=>window.__game.net.code); console.log('code', code);
await B.evaluate(c=>window.__game.net.join(c), code);
await B.waitForFunction(()=>window.__game.net.state==='lobby',null,{timeout:15000});
console.log('A players', await A.evaluate(()=>window.__game.net.list.length), 'B players', await B.evaluate(()=>window.__game.net.list.length));
await A.evaluate(()=>window.__game.net.start());
await A.waitForTimeout(6000);
// resource sync: A breaks boulder 3 and fells tree 5; B must see both gone. Friends show up for the map.
await A.evaluate(()=>{ const pl=window.__game.planetRef(); pl.hitBoulder(3,1); pl.fellTree(5, {x:0,y:0,z:0}); });
await B.waitForTimeout(1500);
console.log('B sees boulder broken:', await B.evaluate(()=>window.__game.planetRef().boulderRecs[3].broken), 'tree felled:', await B.evaluate(()=>window.__game.planetRef().treeRecs[5].felled));
// and the other direction
await B.evaluate(()=>{ window.__game.planetRef().hitBoulder(4,1); });
await A.waitForTimeout(1500);
console.log('A sees boulder 4 broken:', await A.evaluate(()=>window.__game.planetRef().boulderRecs[4].broken));
console.log('friend on A map:', await A.evaluate(()=>window.__game.remotes.positions));
// a late joiner gets everything that was already used up
const C = await b.newPage(); C.on('pageerror',e=>console.log('C err',String(e))); C.on('console',m=>console.log('C log',m.text().slice(0,200))); await C.goto(URL); await C.waitForFunction(()=>window.__game,null,{timeout:90000}); await C.evaluate(c=>window.__game.net.join(c), code);
await C.waitForFunction(()=>window.__game.net.state==='game',null,{timeout:60000}); await C.waitForTimeout(3000);
console.log('late joiner sees boulders 3,4 broken and tree 5 felled:', await C.evaluate(()=>{const pl=window.__game.planetRef(); return [pl.boulderRecs[3].broken, pl.boulderRecs[4].broken, pl.treeRecs[5].felled];}));
for (const [n,p] of [['A',A],['B',B]]) console.log(n, await p.evaluate(()=>({st:window.__game.net.state, mode:window.__game.appMode, remotes:window.__game.remotes.count})), p.errs);
await b.close();
