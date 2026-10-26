// Build everything: charts/*.json, exports/<id>/ (CH/YARG notes.mid + song.ini, audition MIDIs),
// results/metrics.md and results/previews.md.
//   node build.mjs [--ringers 4] [--arrangements balanced] [--metric-ringers 3,4,5] [--export-ringers 4] [--form full]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSong } from './src/pipeline.mjs';
import { buildChart, buildPart, formSong, stringifyChart } from './src/chart.mjs';
import { PROFILES } from './src/assign.mjs';
import { ARRANGEMENTS, TIERS } from './src/parts.mjs';
import { exportCloneHero, songIni, exportAudition, asciiPreview, findExportPart } from './src/export.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
// Committed charts carry every tier of the balanced arrangement for one ringer count (charts are
// large once the songs develop over 2–3 minutes); the metrics cover all arrangements and more
// ringer counts, and the I2 game builds its own charts with every arrangement.
const ringerCounts = arg('ringers', '4').split(',').map(Number);
const arrangements = arg('arrangements', 'balanced').split(',');
const metricRingers = arg('metric-ringers', '3,4,5').split(',').map(Number);
const exportRingers = Number(arg('export-ringers', '4'));
const form = arg('form', 'full');
const PHONE = 'phone-4zone';
const PHONE_RINGERS = [2, 3, 4];

const manifest = JSON.parse(readFileSync(join(root, 'songs', 'manifest.json'), 'utf8'));
const write = (rel, data) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

const fmt = (f) => `${f.jain.toFixed(2)} · ${f.strikes[0]}–${f.strikes[1]} · ${f.bells[0]}–${f.bells[1]}`;
const metricRows = [];
const fairRows = { handbell: [], [PHONE]: [] };
const fairAgg = {};
const profileAgg = {};
const previews = [];
const summary = [];
const t0 = performance.now();

for (const entry of manifest.songs) {
  const t = performance.now();
  const { score, roleNotes, song } = loadSong(entry, join(root, 'songs'));
  const formed = formSong(score, roleNotes, form);
  const chart = buildChart({ score, roleNotes, song, ringerCounts, profile: 'handbell', formed, arrangements });
  write(`charts/${song.id}.json`, stringifyChart(chart) + '\n');
  const ms = performance.now() - t;
  const short = formSong(score, roleNotes, 'short');

  const ch = exportCloneHero(formed.score, chart, exportRingers);
  write(`exports/${song.id}/notes.mid`, ch.midi);
  write(`exports/${song.id}/song.ini`, songIni(chart, exportRingers));
  for (const tier of TIERS) write(`exports/${song.id}/audition-${tier}-r${exportRingers}.mid`, exportAudition(formed.score, findExportPart(chart, tier, exportRingers)));

  const roles = { melody: 0, bass: 0, inner: 0 };
  for (const n of roleNotes) roles[n.role]++;
  summary.push({ song, chart, roles, ms, warnings: ch.warnings, shortSec: Math.round(short.toSec(short.score.endTick)) });

  // Fairness: S5 0.2-style charts (one pass, by-range) vs the balanced arrangement of the full form.
  for (const [pid, ks] of [['handbell', metricRingers], [PHONE, PHONE_RINGERS]]) {
    for (const k of ks) {
      for (const tier of TIERS) {
        const before = buildPart(short, tier, k, pid, 'by-range');
        const after = buildPart(formed, tier, k, pid, 'balanced');
        const chord = buildPart(formed, tier, k, pid, 'chord-split');
        fairRows[pid].push(`| ${song.id} | ${k} | ${tier} | ${fmt(before.metrics.fairness)} | ${fmt(after.metrics.fairness)} | ${fmt(chord.metrics.fairness)} | ${after.ringers.map((r) => `${r.name} ${r.stats.strikes}/${r.stats.bells}`).join(', ')} |`);
        const a = (fairAgg[`${pid}|${k}|${tier}`] ||= { before: [], after: [], chord: [], mixed: [0, 0], oneBell: [0, 0], ringers: 0 });
        a.before.push(before.metrics.fairness.jain);
        a.after.push(after.metrics.fairness.jain);
        a.chord.push(chord.metrics.fairness.jain);
        a.ringers += k;
        [before, after].forEach((p, i) => {
          a.mixed[i] += mixedRoleRingers(p);
          a.oneBell[i] += p.ringers.filter((r) => r.bells.length <= 1).length;
        });
        if (pid === 'handbell') metricRows.push(`| ${song.id} | ${k} | ${tier} | ${after.metrics.strikes} | ${after.metrics.distinctBells} | ${after.metrics.maxBellsPerRinger} | ${after.metrics.fairness.jain} | ${after.metrics.droppedForPlayability.total} | ${after.metrics.remainingViolations} | ${after.metrics.guideNotes ?? 0} | ${after.ringers.map((r) => `${r.name} ${r.label}`).join(', ')} |`);
      }
    }
  }
  for (const pid of Object.keys(PROFILES)) {
    for (const k of metricRingers) {
      for (const tier of TIERS) {
        const p = buildPart(formed, tier, k, pid, 'balanced');
        const a = (profileAgg[`${pid}|${k}|${tier}`] ||= { clean: 0, songs: 0, violations: 0, dropped: 0, overCap: 0 });
        const over = p.metrics.maxBellsPerRinger > PROFILES[pid].maxBells;
        a.songs++;
        if (!p.metrics.remainingViolations && !over) a.clean++;
        a.violations += p.metrics.remainingViolations;
        a.dropped += p.metrics.droppedForPlayability.total;
        if (over) a.overCap++;
      }
    }
  }
  const part = (tier) => findExportPart(chart, tier, exportRingers) || chart.parts[0];
  const verse2 = chart.form.sections.find((s) => s.label === 'Verse 2') ?? chart.form.sections[0];
  previews.push(`## ${song.title}\n\nForm: ${chart.form.sections.map((s) => `${s.label}${s.transpose ? ` (+${s.transpose})` : ''}`).join(' · ')} — ${chart.timing.durationSec} s\n\nSuper easy, ${exportRingers} ringers (first 4 bars of verse 1):\n\n\`\`\`\n${asciiPreview(formed.score, part('super-easy'), 4, chart.form.sections.find((s) => s.kind === 'verse')?.tick ?? 0)}\n\`\`\`\n\nHard, ${exportRingers} ringers (first 4 bars of ${verse2.label.toLowerCase()}):\n\n\`\`\`\n${asciiPreview(formed.score, part('hard'), 4, verse2.tick)}\n\`\`\`\n`);
}

function mixedRoleRingers(p) {
  const family = { bass: 'bass', inner: 'harmony', melody: 'tune', descant: 'tune' };
  return p.ringers.filter((r) => new Set(p.notes.filter((n) => n.ringer === r.index).map((n) => family[n.role])).size > 1).length;
}
const mean = (xs) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
const totalMs = performance.now() - t0;
const md = [
  '# S5 metrics (generated by `node build.mjs`; do not edit)',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} with Node ${process.version}. Total build time ${Math.round(totalMs)} ms (charts, exports and every metric below).`,
  '',
  '## Corpus and song form',
  '',
  `Form \`${form}\`: intro (last phrase) · verses that develop · interlude + key change before the last verse (3+ verses) · coda (tag + held final bar, ritardando). Short = the song once.`,
  '',
  '| Song | Source | License | Short (s) | Full (s) | Form | Melody / bass / inner notes (one pass) | Bell span (all parts) | Fits handbell set | Build (ms) |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...summary.map(({ song, chart, roles, ms, shortSec }) => `| ${song.title} | ${song.source.kind} | ${song.license.id} | ${shortSec} | ${Math.round(chart.timing.durationSec)} | ${chart.form.sections.map((s) => (s.kind === 'verse' ? `V${s.verse}${s.transpose ? '↑' : ''}` : s.kind[0].toUpperCase())).join(' ')} | ${roles.melody} / ${roles.bass} / ${roles.inner} | ${chart.bells[0].id}–${chart.bells[chart.bells.length - 1].id} (${chart.bells.length} bells) | ${chart.handbellSet.set ?? 'no'}${chart.handbellSet.transposeSemitones ? ` (transpose ${chart.handbellSet.transposeSemitones > 0 ? '+' : ''}${chart.handbellSet.transposeSemitones})` : ''} | ${Math.round(ms)} |`),
  '',
  'Form key: I intro, V*n* verse *n* (↑ up a step), I interlude, C coda.',
  '',
  '## Fairness: before vs after',
  '',
  'Fairness = Jain\'s index on each ringer\'s load (strikes + ½ bell changes; 1 = everyone equal, 1/n = one ringer does everything). Cells: `fairness · strikes min–max · bells min–max`.',
  '"Before" = the S5 0.2 assignment (by-range: bells cut by load, roles ignored) on the song played once; "after" = the balanced arrangement on the full form; chord split for comparison (unbalanced by design: 3 ringers share the chord, the rest the tune).',
  '',
  '### Mean fairness over the corpus',
  '',
  'Mixed = ringers whose bells mix roles (bass + harmony + tune); 1-bell = ringers with at most one bell (before → after, summed over songs).',
  '',
  '| Profile | Ringers | Tier | Before (by-range, short) | After (balanced, full) | Chord split (full) | Mixed-role ringers | 1-bell ringers |',
  '|---|---|---|---|---|---|---|---|',
  ...[['handbell', metricRingers], [PHONE, PHONE_RINGERS]].flatMap(([pid, ks]) => ks.flatMap((k) => TIERS.map((tier) => { const a = fairAgg[`${pid}|${k}|${tier}`]; return `| ${pid} | ${k} | ${tier} | ${mean(a.before)} | ${mean(a.after)} | ${mean(a.chord)} | ${a.mixed[0]} → ${a.mixed[1]} of ${a.ringers} | ${a.oneBell[0]} → ${a.oneBell[1]} |`; }))),
  '',
  `### Per song, profile \`${PHONE}\` (the I2 phone game)`,
  '',
  '| Song | Ringers | Tier | Before | After (balanced) | Chord split | Balanced parts (name strikes/bells) |',
  '|---|---|---|---|---|---|---|',
  ...fairRows[PHONE],
  '',
  '### Per song, profile `handbell`',
  '',
  '| Song | Ringers | Tier | Before | After (balanced) | Chord split | Balanced parts (name strikes/bells) |',
  '|---|---|---|---|---|---|---|',
  ...fairRows.handbell,
  '',
  '## Balanced charts (profile `handbell`, full form, after playability repair)',
  '',
  'Dropped = accompaniment notes removed for playability. Violations = remaining unplayable spots (the tune is never dropped). Guide = notes the host plays (super easy: the rest of the tune; every tier: the descant when no ringer has it).',
  '',
  '| Song | Ringers | Tier | Strikes | Bells | Max bells/ringer | Fairness | Dropped | Violations | Guide | Parts |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...metricRows,
  '',
  '## Controller profiles (balanced, all songs)',
  '',
  'Each profile re-runs arrangement + assignment + repair. Cell = `clean songs / total` (no remaining violations and within bell capacity), then Σ violations, Σ dropped accompaniment notes, songs over bell capacity.',
  '',
  ...Object.entries(PROFILES).map(([id, p]) => `- \`${id}\`: ${p.label} (maxBells ${p.maxBells}, maxSimultaneous ${p.maxSimultaneous}, minRepeat ${p.minRepeatSec}s, minSwitch ${p.minSwitchSec}s, swap ${p.swapSec === Infinity ? 'n/a' : `${p.swapSec}s`})`),
  '',
  `| Profile | Ringers | ${TIERS.join(' | ')} |`,
  `|---|---|${TIERS.map(() => '---').join('|')}|`,
  ...Object.keys(PROFILES).flatMap((pid) => metricRingers.map((k) => `| ${pid} | ${k} | ${TIERS.map((t) => { const a = profileAgg[`${pid}|${k}|${t}`]; return `${a.clean}/${a.songs} clean; ${a.violations}v ${a.dropped}d${a.overCap ? ` ${a.overCap} over cap` : ''}`; }).join(' | ')} |`)),
  '',
  ...(summary.some((s) => s.warnings.length) ? ['## Export warnings', '', ...summary.flatMap((s) => s.warnings.map((w) => `- ${s.song.id}: ${w}`)), ''] : []),
].join('\n');
write('results/metrics.md', md);
write('results/previews.md', `# Lane previews (generated; do not edit)\n\nBalanced arrangement. Legend: columns are each ringer's bells; M = melody, D = descant, B = bass, h = harmony; \`-\` marks a bar line row, \`.\` an empty eighth-note slot.\n\n${previews.join('\n')}`);
console.log(`Built ${summary.length} songs in ${Math.round(totalMs)} ms (${arrangements.join('+')} of ${ARRANGEMENTS.join('/')} × ${TIERS.length} tiers × ringers ${ringerCounts.join(',')})`);
for (const s of summary) console.log(`  ${s.song.id}: ${s.chart.bells.length} bells, ${s.shortSec}s → ${s.chart.timing.durationSec}s, set ${s.chart.handbellSet.set}`);
