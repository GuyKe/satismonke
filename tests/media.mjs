// The media computer end to end: record with the camera, edit, save, publish to a global feed server, watch it, play music.
// Needs vite preview on :4173 and (for the global part) `node server/feed-server.mjs` on :8787 with PER_HOUR large.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1100, height: 650 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
await p.goto('http://localhost:4173/?skip=planet&feed=http://localhost:8787'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 60000 }); await p.waitForTimeout(1500);
const out = await p.evaluate(async () => {
  const g = window.__game, T = g.THREE, wait = ms => new Promise(r => setTimeout(r, ms)), r = {};
  try {
  indexedDB.deleteDatabase('satismonke-clips'); await wait(300);
  g.narrator.clearTold(); g.placeHubNow(0, -30, 0);
  const hub = g.planetRef().hub, w = hub.group.localToWorld(new T.Vector3(0.0, 0.6, 1.0)); g.player.teleport(new T.Vector3(w.x, w.y, w.z)); await wait(1500);
  const cam = g.hubUi.cam, media = g.hubUi.media;
  const until = async (cond, ms = 25000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(200); return cond(); };
  const press = (panel, re) => { const b = panel.btns.find(b => re.test(b.label)); if (!b) throw new Error('no button ' + re + ' in ' + panel.btns.map(b => b.label)); b.act(); };
  // --- camera: choose a filter and a caption, record about 5 seconds
  press(cam, /^>$/); r.filter = cam.filter;               // first ">" is the FILTER one
  cam.caption = 1; cam.build();
  // (a headless browser draws only a frame or two per second, so drive the camera by hand: 0.2 s per step)
  const pump = n => { for (let i = 0; i < n; i++) cam.update(0.2, g.renderer, g.scene, g.hubUi.mediaCam); };
  press(cam, /^REC$/); cam.countdown = 0.05; pump(3); r.state = cam.state;
  pump(12); const framesWhileRecording = cam.frames.length; press(cam, /^STOP$/); await wait(800);
  r.framesRecorded = framesWhileRecording;
  // --- computer: my clips
  await media.openList('mine'); await wait(500);
  r.mineCount = media.list.length;
  const m0 = media.list[0]; r.title = m0 && m0.title; r.caption = m0 && m0.caption;
  media.btns.find(b => b.label === '' && b.y === 76).act(); await until(() => media.page === 'player');
  r.page = media.page; r.curFrames = media.cur && media.cur.frames.length; r.openNote = media.note;
  // --- edit: trim, reverse, filter, save as new
  press(media, /^EDIT$/); media.ed.to = Math.max(2, Math.floor(media.cur.frames.length / 2)); media.ed.reverse = true; media.ed.filter = 3; media.ed.fps = 16; media.build();
  press(media, /SAVE AS NEW/); await until(() => /Saved as a new clip/.test(media.note), 40000);
  await media.openList('mine'); await wait(500); r.afterEdit = media.list.length;
  // --- publish the first one to the global feed, then see it in the global list
  media.btns.find(b => b.label === '' && b.y === 76).act(); await until(() => media.page === 'player');
  press(media, /^GLOBAL$/); await until(() => /Published|Could not/.test(media.note), 30000); r.publishNote = media.note;
  await media.openList('global'); await until(() => !media.loading); r.globalCount = media.list.length;
  media.btns.find(b => b.label === '' && b.y === 76).act(); await until(() => media.page === 'player');
  r.globalPlayer = media.page + ':' + media.curSource + ':' + (media.cur && media.cur.frames.length);
  press(media, /REPORT/); await wait(800);
  // --- music
  media.go('music'); const tracks = media.btns.filter(b => /PLAY/.test(b.label)).length; r.tracks = tracks;
  media.btns.find(b => /PLAY  MONKE FUNK/.test(b.label)).act(); await wait(1500); r.musicOn = g.music.current;
  media.btns.find(b => /STOP  MONKE FUNK/.test(b.label)).act(); r.musicOff = g.music.current;
  } catch (e) { r.error = String(e); r.status = g.hubUi && g.hubUi.cam.status; }
  return r;
});
console.log(JSON.stringify(out, null, 1), errs);
await b.close();
