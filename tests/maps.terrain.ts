// The three maps' land: landing site is flat and dry, how much is water, how hilly, steepest ground.
import { heightAt, setMap, WATER_Y } from '../src/world/Terrain';
import { MAP_IDS } from '../src/world/MapDef';

let failed = 0;
const ok = (n: string, c: boolean, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${extra}`); if (!c) failed++; };
const stats: Record<string, { land: number; mean: number; sd: number; max: number; min: number; steep: number }> = {};
for (const id of MAP_IDS) {
  setMap(id);
  let n = 0, land = 0, sum = 0, sq = 0, max = -1e9, min = 1e9, steep = 0;
  for (let x = -440; x <= 440; x += 10) for (let z = -440; z <= 440; z += 10) {
    if (Math.hypot(x, z) > 440) continue;
    const h = heightAt(x, z); n++; sum += h; sq += h * h; max = Math.max(max, h); min = Math.min(min, h); if (h > WATER_Y + 1.2) land++;
    const g = Math.max(Math.abs(heightAt(x + 4, z) - h), Math.abs(heightAt(x, z + 4) - h)) / 4; if (g > 0.7) steep++;
  }
  const mean = sum / n; stats[id] = { land: land / n, mean, sd: Math.sqrt(sq / n - mean * mean), max, min, steep: steep / n };
  console.log(id.padEnd(7), 'land', (100 * land / n).toFixed(0) + '%', 'mean', mean.toFixed(1), 'sd', stats[id].sd.toFixed(1), 'max', max.toFixed(0), 'min', min.toFixed(0), 'steep>35deg', (100 * steep / n).toFixed(1) + '%');
  let flat = 0, dry = true; for (let x = -8; x <= 8; x += 2) for (let z = -8; z <= 8; z += 2) if (Math.hypot(x, z) <= 8) { const h = heightAt(x, z); flat = Math.max(flat, Math.abs(h)); }
  for (let x = -40; x <= 40; x += 5) for (let z = -40; z <= 40; z += 5) if (heightAt(x, z) < WATER_Y + 1.5) dry = false;
  ok(`${id}: landing site is flat and the ground around it is dry`, flat < 0.1 && dry, `(max |h| ${flat.toFixed(3)} within 8 m)`);
  let rough = 0, rn = 0; for (let x = -420; x <= 420; x += 12) for (let z = -420; z <= 420; z += 12) { const a = heightAt(x, z), b = heightAt(x + 12, z); if (a > WATER_Y + 1 && b > WATER_Y + 1 && Math.hypot(x, z) < 420) { rough += Math.abs(a - b); rn++; } }
  (stats[id] as { rough?: number }).rough = rough / rn;
  ok(`${id}: no NaN heights`, Number.isFinite(heightAt(123.4, -321.9)));
}
const R = (id: string) => (stats[id] as unknown as { rough: number }).rough;
console.log('roughness (m per 12 m):', MAP_IDS.map(id => `${id} ${R(id).toFixed(2)}`).join('  '));
ok('jungle is hillier than the plains', R('jungle') > R('plains') * 1.4);
ok('desert has real dunes', R('desert') > R('plains') * 1.3);
ok('jungle has canyons (deeper lows than the plains)', stats.jungle.min < stats.plains.min || stats.jungle.steep > stats.plains.steep);
ok('desert has more water than the plains', stats.desert.land < stats.plains.land);
ok('every map is mostly dry land', MAP_IDS.every(id => stats[id].land > 0.6));
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
