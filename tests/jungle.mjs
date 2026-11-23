// The crowded jungle: how many trees, how much open ground, and is there still a way through? Needs vite preview on :4173.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR + 'playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } }); const errs = []; p.on('pageerror', e => errs.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')));
const t0 = Date.now();
await p.goto('http://localhost:4173/?skip=planet&map=jungle'); await p.waitForFunction(() => window.__game?.planetRef(), null, { timeout: 120000 });
const buildMs = Date.now() - t0; await p.waitForTimeout(2000);
const r = await p.evaluate(() => {
  const g = window.__game, pl = g.planetRef(), trees = pl.treeRecs, H = pl.world.heightFn;
  // trunk radius as the collider has it
  const rad = t => t.pine ? 0.3 : (t.h * 0.1 + 0.6) * 0.38;
  // free ground: 1.5 m grid within 250 m; blocked if inside a trunk + body clearance
  const N = 250, S = 1.5, dim = Math.ceil(2 * N / S), blocked = new Uint8Array(dim * dim), dry = new Uint8Array(dim * dim);
  const grid = new Map(); for (const t of trees) { const k = Math.floor(t.x / 8) * 4096 + Math.floor(t.z / 8); (grid.get(k) ?? grid.set(k, []).get(k)).push(t); }
  const near = (x, z) => { const ci = Math.floor(x / 8), cj = Math.floor(z / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const t of grid.get(i * 4096 + j) ?? []) if (Math.hypot(t.x - x, t.z - z) < rad(t) + 0.55) return true; return false; };
  let freeCells = 0, openCells = 0;
  for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) {
    const x = -N + i * S, z = -N + j * S; if (Math.hypot(x, z) > N) continue;
    if (H(x, z) < -2.5) continue; dry[i * dim + j] = 1;
    if (near(x, z)) blocked[i * dim + j] = 1; else freeCells++;
    // "open field": no tree within 14 m
    if (!trees.some(t => Math.abs(t.x - x) < 14 && Math.abs(t.z - z) < 14 && Math.hypot(t.x - x, t.z - z) < 14)) openCells++;
  }
  // flood fill from the landing site over free cells
  const seen = new Uint8Array(dim * dim), c0 = Math.round(N / S) * dim + Math.round(N / S), q = [c0]; seen[c0] = 1; let reached = 0;
  while (q.length) { const c = q.pop(); reached++; const i = Math.floor(c / dim), j = c % dim; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= dim || nj >= dim) continue; const k = ni * dim + nj; if (!seen[k] && dry[k] && !blocked[k]) { seen[k] = 1; q.push(k); } } }
  let dryCells = 0; for (const d of dry) dryCells += d;
  const tree = trees.find(t => Math.hypot(t.x, t.z) > 40 && !t.pine);
  return { trees: trees.length, treeHits: pl.map.treeHits, freeOfDry: +(freeCells / dryCells).toFixed(2), openFieldOfDry: +(openCells / dryCells).toFixed(3), reachableOfFree: +(reached / freeCells).toFixed(2),
    hitsToFell: (() => { let n = 0; const from = new g.camera.position.constructor(0, 0, 0); const id = trees.indexOf(tree); for (let k = 0; k < 20; k++) { n++; if (pl.hitTree(id, from, pl.map.treeHits) === 0) break; } return n; })(),
    boulders: pl.boulderRecs.length, ores: pl.oreRecs.length };
});
console.log('built in', buildMs, 'ms', JSON.stringify(r), errs);
await p.screenshot({ path: '/tmp/claude-0/jungle_start.png' });
// stand in the forest
await p.evaluate(() => { const g = window.__game, pl = g.planetRef(); const t = pl.treeRecs.find(t => Math.hypot(t.x, t.z) > 120); g.player.teleport(new g.camera.position.constructor(t.x + 2.5, t.y + 0.2, t.z + 2.5)); });
await p.waitForTimeout(2500); await p.screenshot({ path: '/tmp/claude-0/jungle_inside.png' });
await b.close();
