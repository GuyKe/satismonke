// The global feed server: accepts good clips, rejects bad ones, rate-limits, hides reported clips. No browser needed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-')), port = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('node', ['server/feed-server.mjs'], { env: { ...process.env, PORT: String(port), DATA: dir, PER_HOUR: '3', REPORT_LIMIT: '2' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const base = `http://127.0.0.1:${port}`;
let failed = 0; const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++; };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
const post = (body, p = '/clips') => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const good = (over = {}) => ({ author: 'Brave Monke', color: 0xff00ff, title: 'My clip', caption: 'Epic!', fps: 8, frames: [jpeg, jpeg, jpeg, jpeg], ...over });
try {
  const r1 = await post(good()); const { id } = await r1.json(); ok('a good clip is accepted', r1.status === 200 && !!id);
  const list = await (await fetch(base + '/clips')).json(); ok('it shows in the list with a thumbnail and no frames', list.length === 1 && list[0].thumb.startsWith('data:image/jpeg') && !('frames' in list[0]) && list[0].frameCount === 4);
  const one = await (await fetch(`${base}/clips/${id}`)).json(); ok('it can be fetched with its frames', one.frames.length === 4 && one.caption === 'Epic!' && !('reports' in one));
  ok('a made-up caption is refused', (await post(good({ caption: 'buy my stuff at example.com' }))).status === 400);
  ok('non-JPEG frames are refused', (await post(good({ frames: ['data:text/html;base64,PGgxPmhpPC9oMT4=', jpeg] }))).status === 400);
  ok('too few frames are refused', (await post(good({ frames: [jpeg] }))).status === 400);
  ok('too many frames are refused', (await post(good({ frames: Array(130).fill(jpeg) }))).status === 400);
  ok('a silly frame rate is refused', (await post(good({ fps: 500 }))).status === 400);
  const clean = await (await post(good({ author: '<script>alert(1)</script> Monke', title: '<b>x</b>' }))).json();
  const got = await (await fetch(`${base}/clips/${clean.id}`)).json(); ok('names and titles are stripped of markup', !/[<>]/.test(got.author + got.title));
  ok('the third clip in an hour is fine', (await post(good())).status === 200);
  ok('a fourth clip in an hour is rate limited', (await post(good())).status === 429);
  await post({}, `/clips/${id}/report`); ok('one report keeps it up', (await fetch(`${base}/clips/${id}`)).status === 200);
  await post({}, `/clips/${id}/report`); ok('enough reports hide it', (await fetch(`${base}/clips/${id}`)).status === 404 && (await (await fetch(base + '/clips')).json()).every(c => c.id !== id));
  ok('path tricks are not served', (await fetch(`${base}/clips/..%2F..%2Fetc%2Fpasswd`)).status === 404);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
