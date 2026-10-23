// Generates the game's charts with the S5 pipeline (unchanged), optimised for phones:
// controller profile `phone-4zone` (≤4 bells per phone, one strike at a time) and 1–4 ringers.
//   node scripts/build-charts.mjs [--ringers 1,2,3,4] [--profile phone-4zone]
// Output: public/charts/<song>.json (S5 chart format, ADR-0007 proposal) + public/charts/index.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSong } from '../../s5-chart-pipeline/src/pipeline.mjs';
import { buildChart } from '../../s5-chart-pipeline/src/chart.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const s5 = join(here, '..', '..', 's5-chart-pipeline');
const out = join(here, '..', 'public', 'charts');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const ringerCounts = arg('ringers', '1,2,3,4').split(',').map(Number);
const profile = arg('profile', 'phone-4zone');

mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(s5, 'songs', 'manifest.json'), 'utf8'));
const index = [];
for (const entry of manifest.songs) {
  const { score, roleNotes, song } = loadSong(entry, join(s5, 'songs'));
  const chart = buildChart({ score, roleNotes, song, ringerCounts, profile });
  writeFileSync(join(out, `${song.id}.json`), JSON.stringify(chart));
  index.push({
    id: song.id,
    title: song.title,
    composer: song.composer,
    license: song.license?.id,
    durationSec: chart.timing.durationSec,
    parts: chart.parts.map((p) => ({ difficulty: p.difficulty, ringerCount: p.ringerCount, strikes: p.metrics.strikes, maxBellsPerRinger: p.metrics.maxBellsPerRinger })),
  });
}
index.sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(join(out, 'index.json'), JSON.stringify({ profile, ringerCounts, songs: index }, null, 1));
console.log(`charts: ${index.length} songs × ${ringerCounts.length} ringer counts × 3 tiers (profile ${profile}) → ${out}`);
