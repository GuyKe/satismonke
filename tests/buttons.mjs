// Every button on every panel must sit inside its panel and not overlap another one (a button off the edge can never be clicked).
// Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?skip=planet'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(2000);
const bad = await p.evaluate(() => {
  const g = window.__game, f = g.factory, mp = g.machinePanel, out = [];
  const audit = (name, btns, W, H) => {
    for (const b of btns) if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) out.push(`${name}: "${b.label}" is outside the panel (${b.x},${b.y},${b.w}x${b.h})`);
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) { const a = btns[i], c = btns[j]; if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) out.push(`${name}: "${a.label}" overlaps "${c.label}"`); }
  };
  mp.canOverclock = () => true;
  const pole = f.addMachine('pole', 0, 0, 20);
  for (const kind of ['burner', 'miner', 'smelter', 'constructor', 'storage', 'sink', 'splitter', 'pole', 'solar']) {
    for (const trip of [false, true]) for (const wired of [false, true]) {
      const m = kind === 'pole' ? pole : f.addMachine(kind, 10 + f.machines.length, 0, 20, 0, kind === 'miner' ? { index: 0, type: 'iron', purity: 1 } : null);
      f.wires = f.wires.filter(w => w.a !== m.id && w.b !== m.id);
      if (wired && kind !== 'pole') f.wire(pole.id, m.id); else if (wired && kind === 'pole') { const o = f.addMachine('storage', 30, 0, 20); f.wire(pole.id, o.id); }
      f.legacyGrid = false; f.breaker.clear(); if (trip) { f.breaker.add(m.id); } f.update(0.1, 1);
      mp.show(m.id); mp.draw(m);
      audit(`${kind}${trip ? '/tripped' : ''}${wired ? '/wired' : ''}`, mp.btns, 640, 470);
    }
  }
  // the media computer and the camera panel
  g.placeHubNow(0, -30, 0); const media = g.hubUi.media, cam = g.hubUi.cam;
  audit('camera', cam.btns, 640, 540);
  const fakeThumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
  media.list = Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, author: 'a', color: 1, title: 't', caption: '', fps: 8, created: 0, thumb: fakeThumb, frameCount: 8 }));
  for (const page of ['home', 'music']) { media.go(page); audit('media/' + page, media.btns, 800, 500); }
  for (const tab of ['lobby', 'global', 'mine']) { media.tab = tab; media.go('list'); audit('media/list/' + tab, media.btns, 800, 500); }
  media.cur = { id: 'c', author: 'a', color: 1, title: 't', caption: '', fps: 8, created: 0, frames: [fakeThumb, fakeThumb, fakeThumb] };
  for (const src of ['mine', 'lobby', 'global']) { media.curSource = src; media.go('player'); audit('media/player/' + src, media.btns, 800, 500); }
  media.ed = { from: 0, to: 3, reverse: false, filter: 0, caption: 0, fps: 8 }; media.go('edit'); audit('media/edit', media.btns, 800, 500);
  return out;
});
console.log(bad.length ? bad.join('\n') : 'all machine-panel buttons fit and none overlap', errs);
await b.close();
