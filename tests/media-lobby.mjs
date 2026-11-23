// Clips and music are shared inside a lobby (and late joiners get the latest clips). Needs vite preview on :4173 and a local PeerServer on 127.0.0.1:9000.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const URL = 'http://localhost:4173/?peerhost=127.0.0.1&peerport=9000&fastload=1';
const mk = async () => { const c = await b.newContext(); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(URL); await p.waitForFunction(() => window.__game, null, { timeout: 60000 }); return p; };
const A = await mk(), B = await mk();
await A.evaluate(() => window.__game.net.host()); await A.waitForFunction(() => window.__game.net.state === 'lobby');
const code = await A.evaluate(() => window.__game.net.code);
await B.evaluate(c => window.__game.net.join(c), code); await B.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
const send = id => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); const frames = []; for (let i = 0; i < 6; i++) { g.fillStyle = `hsl(${i * 50},70%,50%)`; g.fillRect(0, 0, 320, 180); frames.push(c.toDataURL('image/jpeg', 0.6)); } window.__game.net.sendClip({ id, author: 'Test', color: 0xff00ff, title: 'Test clip', caption: 'Epic!', fps: 8, created: Date.now(), frames }); };
await A.evaluate(send, 'c1');
await B.waitForFunction(() => window.__game.net.lobbyClips.length === 1, null, { timeout: 20000 });
// the other direction
await B.evaluate(send, 'c2');
await A.waitForFunction(() => window.__game.net.lobbyClips.length === 2, null, { timeout: 20000 });
// music for everyone
await A.evaluate(() => window.__game.music.play('disco'));
await B.waitForFunction(() => window.__game.music.current === 'disco', null, { timeout: 15000 });
await B.evaluate(() => window.__game.music.stop());
await A.waitForFunction(() => window.__game.music.current === null, null, { timeout: 15000 });
// a late joiner receives the clips
const C = await mk(); await C.evaluate(c => window.__game.net.join(c), code); await C.waitForFunction(() => window.__game.net.state === 'lobby', null, { timeout: 20000 });
await C.waitForFunction(() => window.__game.net.lobbyClips.length === 2, null, { timeout: 20000 });
console.log('clips A/B/C:', await A.evaluate(() => window.__game.net.lobbyClips.length), await B.evaluate(() => window.__game.net.lobbyClips.length), await C.evaluate(() => window.__game.net.lobbyClips.length), 'music synced both ways, late joiner got the clips', A.errs, B.errs, C.errs);
await b.close();
