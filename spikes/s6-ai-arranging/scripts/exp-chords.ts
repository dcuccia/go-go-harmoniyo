// Experiment 2a: chord-symbol inference and proofreading for the three Mutopia carols with qwen3:8b.
// The model sees only the melody (inference) or the melody plus S5's inferred chords
// (proofreading). Good King Wenceslas and It Came Upon the Midnight Clear have SATB
// sources, so S5's chords inferred from all four voices serve as a reference; The Holly and the
// Ivy is melody-only (no reference: judged by fit, cadence and listening).
//   node scripts/exp-chords.ts [--mock] [--songs a,b] [--samples 4]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractJson, type Chord } from '../src/abc-io.ts';
import { median, openHarness, pct, render, S6_DIR, template, runTag, backendLabel } from '../src/llm.ts';
import { chordsFromBars, chordsPerBar, loadS5Song, melodyAbc, melodyListing, promptVars, type Song } from '../src/songs.ts';
import { chordAgreement, chordDiatonic, chordToneFit, endsOnTonic } from '../src/theory.ts';

const argv = process.argv.slice(2);
const mock = argv.includes('--mock');
const opt = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const songs = opt('songs', 'the-holly-and-the-ivy,good-king-wenceslas,it-came-upon-the-midnight-clear').split(',');
const samples = Number(opt('samples', '4'));
const tag = mock ? 'mock' : (opt('tag', '') || runTag(false));
const outDir = mock ? join(S6_DIR, 'results', 'mock') : join(S6_DIR, 'results');
const h = await openHarness({ mock, log: join(outDir, 'runs', `chords-${tag}.jsonl`) });
const system = template('system');

function validate(s: Song) {
  return (reply: string) => {
    let perBar: string[][];
    try {
      const j = extractJson<{ bars?: unknown }>(reply);
      if (!Array.isArray(j.bars)) return { value: null, errors: ['JSON has no "bars" array'] };
      perBar = j.bars.map((b) => (Array.isArray(b) ? b.map(String) : [String(b)]));
    } catch (e) {
      return { value: null, errors: [`reply is not valid JSON: ${(e as Error).message}`] };
    }
    const { chords, errors } = chordsFromBars(s.score, perBar);
    return { value: errors.length ? null : { perBar, chords }, errors };
  };
}

export function chordMetrics(s: Song, chords: Chord[], reference: Chord[] | null) {
  const fit = chordToneFit(s.score, s.melody, chords);
  const perBar = chordsPerBar(s.score, chords);
  const cpb = perBar.reduce((a, b) => a + b.length, 0) / perBar.length;
  const out = {
    fitAll: fit.all,
    fitStrong: fit.strong,
    diatonic: chordDiatonic(s.score, chords),
    endsTonic: endsOnTonic(s.score, chords),
    chordsPerBar: Math.round(cpb * 100) / 100,
    vsReference: reference ? chordAgreement(s.score, chords, reference) : null,
    vsCurrent: chordAgreement(s.score, chords, s.current),
    objective: 0,
  };
  // Reference-free selection score (the reference is used only to report, never to pick).
  out.objective = Math.round((0.45 * out.fitStrong + 0.25 * out.fitAll + 0.15 * out.diatonic + 0.15 * (out.endsTonic ? 1 : 0) - 0.05 * Math.max(0, cpb - 1.5)) * 1000) / 1000;
  return out;
}

const report: Record<string, unknown>[] = [];
for (const id of songs) {
  const s = loadS5Song(id);
  const vars = promptVars(s);
  const reference = s.hasSatbReference ? s.current : null;
  const listing = melodyListing(s.score, s.melody);
  const abc = melodyAbc(s).trim();
  // Proofreading starts from what a melody-only source would have: S5's melody-only inference
  // (for SATB songs, the SATB-derived chords are the reference, so they must not be the input).
  const current = chordsPerBar(s.score, s.melodyOnlyInferred).map((b, i) => `Bar ${i + 1}: ${b.join(' ')}`).join('\n');
  const baselines = [
    { label: 'S5 inferred from melody only', chords: s.melodyOnlyInferred },
    ...(s.hasSatbReference ? [{ label: 'S5 inferred from SATB (reference)', chords: s.current }] : []),
  ];
  const rows: Record<string, unknown>[] = baselines.map((b) => ({ song: id, label: b.label, kind: 'baseline', ok: true, ...chordMetrics(s, b.chords, reference), chords: chordsPerBar(s.score, b.chords) }));
  const runs = [
    { kind: 'infer', tpl: 'chords-infer', temperature: 0, seed: 1 },
    ...Array.from({ length: samples }, (_, i) => ({ kind: 'infer', tpl: 'chords-infer', temperature: 0.7, seed: 11 + 10 * i })),
    { kind: 'proofread', tpl: 'chords-proofread', temperature: 0, seed: 1 },
    ...Array.from({ length: Math.max(1, samples >> 1) }, (_, i) => ({ kind: 'proofread', tpl: 'chords-proofread', temperature: 0.7, seed: 11 + 10 * i })),
  ];
  for (const run of runs) {
    const tpl = template(run.tpl);
    const user = render(tpl.text, { ...vars, listing, abc, current });
    // Offline mock: echo S5's melody-only inference.
    h.setMock(() => JSON.stringify({ bars: chordsPerBar(s.score, s.melodyOnlyInferred), changes: [] }));
    const label = `qwen3 ${run.kind} T=${run.temperature} seed ${run.seed}`;
    const r = await h.ask({ exp: 'chords', song: id, label, template: tpl.path, system: system.text, user, temperature: run.temperature, seed: run.seed, maxTokens: 1200, validate: validate(s) });
    const lat = r.attempts.map((a) => a.latencyMs);
    const base = { song: id, label, kind: run.kind, temperature: run.temperature, seed: run.seed, ok: r.ok, attempts: r.attempts.length, firstTryOk: r.attempts[0].errors.length === 0, latencyMs: lat, completionTokens: r.attempts.map((a) => (a.usage as { completion_tokens?: number } | null)?.completion_tokens ?? null), errors: r.errors, firstErrors: r.attempts[0].errors };
    if (r.ok && r.value) {
      const v = r.value as { perBar: string[][]; chords: Chord[] };
      rows.push({ ...base, ...chordMetrics(s, v.chords, reference), chords: v.perBar });
    } else rows.push(base);
    console.log(`  ${id} ${label}: ${r.ok ? 'ok' : 'FAILED'} in ${r.attempts.length} attempt(s), ${lat.join('/')} ms`);
  }
  report.push(...rows);
}
await h.close();

const llm = report.filter((r) => r.kind !== 'baseline');
const lat = llm.flatMap((r) => r.latencyMs as number[]);
const summary = {
  mode: tag,
  date: new Date().toISOString(),
  calls: lat.length,
  outputs: llm.length,
  validFinal: llm.filter((r) => r.ok).length,
  validFirstTry: llm.filter((r) => r.firstTryOk).length,
  latencyMs: { median: median(lat), p90: pct(lat, 90), max: Math.max(...lat) },
};
const best: Record<string, unknown> = {};
for (const id of songs) {
  const cands = llm.filter((r) => r.song === id && r.ok).sort((a, b) => (b.objective as number) - (a.objective as number));
  if (cands[0]) best[id] = { label: cands[0].label, objective: cands[0].objective, chords: cands[0].chords };
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `chords-${tag}.json`), JSON.stringify({ summary, best, rows: report }, null, 1) + '\n');

const fmtRef = (r: Record<string, unknown>) => (r.vsReference ? `${(r.vsReference as { root: number }).root} / ${(r.vsReference as { exact: number }).exact}` : '–');
const md = [
  `# S6 chord experiment (${tag}, ${summary.date.slice(0, 10)}; generated by \`node scripts/exp-chords.ts${mock ? ' --mock' : ''}\`)`,
  '',
  mock ? '> **MOCK RUN**: the "model" echoes S5 baselines; numbers only show the pipeline works.\n' : '',
  `Model qwen3:8b via ${backendLabel(tag)}. ${summary.outputs} outputs from ${summary.calls} calls; valid ${summary.validFinal}/${summary.outputs} after repairs, ${summary.validFirstTry}/${summary.outputs} on the first try. Latency per call: median ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms, max ${summary.latencyMs.max} ms.`,
  '',
  'Fit = duration-weighted share of melody time on chord tones (all / notes starting on strong beats). Ref = per-beat agreement with the SATB-derived chords (root / exact). Objective = reference-free selection score.',
  '',
  '| Song | Source | Valid (attempts) | Fit all / strong | Diatonic | Ends on I | Chords/bar | Ref root / exact | Objective | Latency (ms) |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...report.map((r) => `| ${r.song} | ${r.label} | ${r.kind === 'baseline' ? '–' : `${r.ok ? 'yes' : 'no'} (${r.attempts})`} | ${r.fitAll ?? '–'} / ${r.fitStrong ?? '–'} | ${r.diatonic ?? '–'} | ${r.endsTonic === undefined ? '–' : r.endsTonic ? 'yes' : 'no'} | ${r.chordsPerBar ?? '–'} | ${fmtRef(r)} | ${r.objective ?? '–'} | ${r.latencyMs ? (r.latencyMs as number[]).join(' / ') : '–'} |`),
  '',
  '## Selected (highest objective per song)',
  '',
  ...Object.entries(best).map(([id, b]) => `- **${id}**: ${(b as { label: string }).label} (objective ${(b as { objective: number }).objective}): ${((b as { chords: string[][] }).chords).map((x) => x.join(' ')).join(' | ')}`),
  '',
].join('\n');
writeFileSync(join(outDir, `chords-${tag}.md`), md);
console.log(JSON.stringify(summary));
