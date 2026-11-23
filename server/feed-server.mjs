#!/usr/bin/env node
// A tiny server for the Satismonke global video feed. No dependencies: `node server/feed-server.mjs`.
//   PORT=8787 DATA=./feed-data node server/feed-server.mjs
// Then open the game once with ?feed=http://YOUR-HOST:8787 (use https if the game is served over https).
//
//   GET  /clips?limit=24     newest clips, without frames: [{id, author, color, title, caption, fps, created, thumb, frameCount}]
//   GET  /clips/:id          one clip with its frames
//   POST /clips              publish {author, color, title, caption, fps, created, frames[]}  -> {id}
//   POST /clips/:id/report   report a clip; at REPORT_LIMIT reports it is hidden until you delete its file
//
// Clips can only be made with the in-game camera and captions come from a fixed list, but this server still checks
// sizes, only accepts JPEG frames and captions from the list, rate-limits publishing per address, and hides clips that
// get reported. Review ./feed-data yourself before you run a public one.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787), DATA = process.env.DATA ?? './feed-data';
const MAX_BODY = 1_800_000, MAX_FRAMES = 120, PER_HOUR = Number(process.env.PER_HOUR ?? 6), REPORT_LIMIT = Number(process.env.REPORT_LIMIT ?? 3);
const CAPTIONS = new Set(['', 'Epic!', 'Base tour', 'Look at this!', 'Monke moment', 'Factory flex', 'Night shift', 'Explorer log']);
fs.mkdirSync(DATA, { recursive: true });

const file = id => path.join(DATA, `${id}.json`);
const readAll = () => fs.readdirSync(DATA).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return null; } }).filter(Boolean);
const hits = new Map();   // address -> timestamps of recent publishes
const okRate = ip => { const now = Date.now(), a = (hits.get(ip) ?? []).filter(t => now - t < 3600_000); hits.set(ip, a); return a.length < PER_HOUR; };

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); res.end(JSON.stringify(body)); };
const clean = (s, n) => String(s ?? '').replace(/[^\p{L}\p{N} '\-!?.]/gu, '').slice(0, n);
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

function validate(b) {
  if (!b || !Array.isArray(b.frames) || b.frames.length < 2 || b.frames.length > MAX_FRAMES) return 'bad frame count';
  if (!b.frames.every(f => typeof f === 'string' && f.length < 40_000 && JPEG.test(f))) return 'frames must be small JPEGs';
  if (!CAPTIONS.has(b.caption ?? '')) return 'caption not allowed';
  const fps = Number(b.fps); if (!(fps >= 2 && fps <= 24)) return 'bad fps';
  return '';
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x'), parts = url.pathname.split('/').filter(Boolean);
  const ip = req.socket.remoteAddress ?? '?';
  if (req.method === 'GET' && parts[0] === 'clips' && parts.length === 1) {
    const limit = Math.min(60, Number(url.searchParams.get('limit') ?? 24));
    const list = readAll().filter(c => (c.reports ?? 0) < REPORT_LIMIT).sort((a, b) => b.created - a.created).slice(0, limit)
      .map(c => ({ id: c.id, author: c.author, color: c.color, title: c.title, caption: c.caption, fps: c.fps, created: c.created, thumb: c.frames[0], frameCount: c.frames.length }));
    return send(res, 200, list);
  }
  if (req.method === 'GET' && parts[0] === 'clips' && parts.length === 2 && /^[a-z0-9]+$/.test(parts[1])) {
    try { const c = JSON.parse(fs.readFileSync(file(parts[1]), 'utf8')); if ((c.reports ?? 0) >= REPORT_LIMIT) return send(res, 404, { error: 'gone' }); const { reports, ...pub } = c; void reports; return send(res, 200, pub); } catch { return send(res, 404, { error: 'not found' }); }
  }
  if (req.method === 'POST' && parts[0] === 'clips' && parts.length === 1) {
    if (!okRate(ip)) return send(res, 429, { error: 'too many clips, try later' });
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size > MAX_BODY) { send(res, 413, { error: 'too big' }); req.destroy(); } else chunks.push(d); });
    req.on('end', () => {
      if (res.writableEnded) return;
      let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'bad json' }); }
      const bad = validate(b); if (bad) return send(res, 400, { error: bad });
      const id = crypto.randomBytes(6).toString('hex'), clip = { id, author: clean(b.author, 24) || 'Monke', color: Number(b.color) & 0xffffff, title: clean(b.title, 40) || 'Clip', caption: b.caption ?? '', fps: Number(b.fps), created: Date.now(), frames: b.frames, reports: 0 };
      fs.writeFileSync(file(id), JSON.stringify(clip)); hits.get(ip).push(Date.now()); send(res, 200, { id });
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'clips' && parts[2] === 'report' && /^[a-z0-9]+$/.test(parts[1])) {
    try { const c = JSON.parse(fs.readFileSync(file(parts[1]), 'utf8')); c.reports = (c.reports ?? 0) + 1; fs.writeFileSync(file(parts[1]), JSON.stringify(c)); return send(res, 200, { ok: true }); } catch { return send(res, 404, { error: 'not found' }); }
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`Satismonke feed server on :${PORT}, data in ${DATA}`));
