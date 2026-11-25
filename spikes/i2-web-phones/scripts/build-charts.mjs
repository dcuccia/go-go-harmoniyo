// Generates the game's charts with the S5 pipeline, optimised for phones: controller profile
// `phone-4zone` (≤4 bells per phone, one strike at a time), 1–4 ringers, every arrangement
// (balanced / chord split / by range) and tier (super easy … hard), in two lengths:
//   public/charts/<song>.json        full form (intro, verses that develop, coda; ~2–3 min)
//   public/charts/short/<song>.json  the song once
//   public/charts/first-ring/<song>.json  opt-in Short / one-pitch parts for supported songs
//   public/charts/index.json         song list for the lobby
//   node scripts/build-charts.mjs [--ringers 1,2,3,4] [--profile phone-4zone] [--key-change] [--force]
// --key-change adds a step up in the last verse. More notes may move to the TV guide because
// phone pitches are fixed for the whole song.
// Skips the work when nothing it depends on changed (hash in index.json); --force rebuilds.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSong } from '../../s5-chart-pipeline/src/pipeline.mjs';
import { buildChart, buildFirstRingChart, formSong } from '../../s5-chart-pipeline/src/chart.mjs';
import { supportsFirstRing } from '../../s5-chart-pipeline/src/first-ring.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const s5 = join(here, '..', '..', 's5-chart-pipeline');
const out = join(here, '..', 'public', 'charts');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const ringerCounts = arg('ringers', '1,2,3,4').split(',').map(Number);
const firstRingCounts = [...new Set(ringerCounts.filter((k) => Number.isInteger(k) && k >= 1 && k <= 4))];
const profile = arg('profile', 'phone-4zone');
const keyChange = process.argv.includes('--key-change') ? 'auto' : false;

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const hash = createHash('sha1');
for (const f of [fileURLToPath(import.meta.url), ...['src', 'songs', 'sources'].flatMap((d) => files(join(s5, d)))].sort()) {
  hash.update(relative(s5, f).replaceAll('\\', '/'));
  hash.update(readFileSync(f));
}
hash.update(JSON.stringify({ ringerCounts, profile, keyChange }));
const sourceHash = hash.digest('hex');
const indexPath = join(out, 'index.json');
if (!process.argv.includes('--force') && existsSync(indexPath)) {
  try {
    const cached = JSON.parse(readFileSync(indexPath, 'utf8'));
    if (cached.sourceHash === sourceHash && cached.songs.every((s) => !s.firstRing || existsSync(join(out, 'first-ring', `${s.id}.json`)))) {
      console.log(`charts: up to date (${out})`);
      process.exit(0);
    }
  } catch {
    // rebuild
  }
}

const t0 = performance.now();
mkdirSync(join(out, 'short'), { recursive: true });
const manifest = JSON.parse(readFileSync(join(s5, 'songs', 'manifest.json'), 'utf8'));
const index = [];
for (const entry of manifest.songs) {
  const { score, roleNotes, song } = loadSong(entry, join(s5, 'songs'));
  const forms = {};
  let firstRing;
  for (const form of ['full', 'short']) {
    const formed = formSong(score, roleNotes, form === 'full' ? { id: 'full', keyChange } : 'short');
    const chart = buildChart({ score, roleNotes, song, ringerCounts, profile, formed });
    writeFileSync(join(out, form === 'full' ? '' : 'short', `${song.id}.json`), JSON.stringify(chart));
    forms[form] = {
      durationSec: chart.timing.durationSec,
      sections: chart.form.sections.map((s) => s.label),
      parts: chart.parts.map((p) => ({ difficulty: p.difficulty, arrangement: p.arrangement, ringerCount: p.ringerCount, strikes: p.metrics.strikes, maxBellsPerRinger: p.metrics.maxBellsPerRinger, fairness: p.metrics.fairness.jain })),
    };
    if (form === 'short' && firstRingCounts.length && supportsFirstRing(song.id)) {
      const preset = buildFirstRingChart({ song, ringerCounts: firstRingCounts, profile, formed });
      mkdirSync(join(out, 'first-ring'), { recursive: true });
      writeFileSync(join(out, 'first-ring', `${song.id}.json`), JSON.stringify(preset));
      firstRing = { durationSec: preset.timing.durationSec, ringerCounts: firstRingCounts };
    }
  }
  index.push({
    id: song.id,
    title: song.title,
    composer: song.composer,
    license: song.license?.id,
    durationSec: forms.full.durationSec,
    parts: forms.full.parts,
    forms,
    ...(firstRing ? { firstRing } : {}),
  });
}
index.sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(indexPath, JSON.stringify({ profile, ringerCounts, keyChange: keyChange !== false, sourceHash, songs: index }, null, 1));
console.log(`charts: ${index.length} songs × full/short × ${ringerCounts.length} ringer counts × 3 arrangements × 4 tiers (profile ${profile}) in ${Math.round(performance.now() - t0)} ms → ${out}`);
