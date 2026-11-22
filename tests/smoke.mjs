// Boot smoke test: loads the built game the way a player does (main menu path) and fails on any page error.
// Usage:  npm run build && npx vite preview --port 4173 &  then  node tests/smoke.mjs
// Playwright is loaded from PLAYWRIGHT_DIR (a node_modules folder) or normal resolution.
import { createRequire } from 'module';
const req = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + '/');
const { chromium } = req('playwright');
const url = process.env.URL ?? 'http://localhost:4173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(url);
let ok = false;
try { await p.waitForFunction(() => window.__game && window.__game.appMode === 'menu', null, { timeout: 90000 }); ok = true; } catch { /* reported below */ }
await b.close();
if (!ok || errors.length) { console.error('SMOKE FAILED', ok ? '' : '(never reached the main menu)', errors); process.exit(1); }
console.log('smoke ok: reached the main menu with no page errors');
