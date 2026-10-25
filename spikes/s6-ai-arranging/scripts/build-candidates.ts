// Candidate arrangements from the S6 experiments → ABC lead sheets (candidates/*.abc) and
// charts (charts/*.json, S5 format 0.2.0). Candidates never replace the S5 originals.
//   node scripts/build-candidates.ts [--mock] [--from-results]
// --from-results [--min-objective 0.3] re-assembles candidates/*.abc from results/{chords,descant}-<tag>.json (the
// experiments' selected outputs); without it, charts are rebuilt from the committed ABC files.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
// @ts-ignore -- S5 JS modules
import { realizeLeadSheet, dedupe } from '../../s5-chart-pipeline/src/arrange.mjs';
// @ts-ignore
import { buildChart, stringifyChart } from '../../s5-chart-pipeline/src/chart.mjs';
// @ts-ignore
import { validate } from '../../s5-chart-pipeline/src/validate.mjs';
import { abcHeader, parseAbc, parseFragment, type Note, type Score } from '../src/abc-io.ts';
import { assemble } from '../src/assemble.ts';
import { S6_DIR, template, runTag } from '../src/llm.ts';
import { chordsFromBars, chordsPerBar, loadS5Song, promptVars } from '../src/songs.ts';
import { playability } from '../src/theory.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const mock = argv.includes('--mock');
const tag = mock ? 'mock' : (opt('tag', '') || runTag(false));
const resDir = mock ? join(S6_DIR, 'results', 'mock') : join(S6_DIR, 'results');
const candDir = mock ? join(resDir, 'candidates') : join(S6_DIR, 'candidates');
const chartDir = mock ? join(resDir, 'charts') : join(S6_DIR, 'charts');
mkdirSync(candDir, { recursive: true });
mkdirSync(chartDir, { recursive: true });

const PROVENANCE = `Z:S6 AI candidate: qwen3:8b (Qwen3-8B, Apache-2.0) via ${tag === 'node' ? 'the cuccia AI node' : tag === 'local' ? 'a local llama.cpp stand-in (Q4_K_M GGUF)' : 'the offline mock'} (Go Go HarmoniYo spikes/s6-ai-arranging); prompts and replies in results/runs/*-${tag}.jsonl. Human resemblance review pending.`;

if (argv.includes('--from-results')) {
  const chordsRes = JSON.parse(readFileSync(join(resDir, `chords-${tag}.json`), 'utf8'));
  const descRes = existsSync(join(resDir, `descant-${tag}.json`)) ? JSON.parse(readFileSync(join(resDir, `descant-${tag}.json`), 'utf8')) : { results: {} };
  // Candidates only for the arranged carols: chord-only outputs for the SATB carols scored below
  // the SATB reference and a lead sheet would drop their inner voices (see the S6 report).
  const ids = new Set<string>(Object.keys(descRes.results ?? {}));
  const index: Record<string, unknown>[] = [];
  for (const id of ids) {
    const s = loadS5Song(id);
    const vars = promptVars(s);
    const ts = s.score.timeSigs[0];
    const header = { unit: '1/8', meter: `${ts.num}/${ts.den}`, key: vars.keyAbc, qpm: Math.round(60e6 / s.score.tempos[0].usPerQuarter) };
    const parts: string[] = [];
    let chords = s.current;
    let chordLabel: string | null = null;
    if (s.currentSource !== 'lead-sheet' && chordsRes.best?.[id]) {
      const r = chordsFromBars(s.score, chordsRes.best[id].chords);
      if (r.errors.length) throw new Error(`${id}: stored chords invalid: ${r.errors.join('; ')}`);
      chords = r.chords;
      const same = JSON.stringify(chordsPerBar(s.score, r.chords)) === JSON.stringify(chordsPerBar(s.score, s.current));
      chordLabel = `${chordsRes.best[id].label}${same ? ' (returned S5\'s inferred chords unchanged)' : ''}`;
      parts.push(same ? 'chord symbols (unchanged from S5 inference)' : 'chord symbols');
    }
    const d = descRes.results?.[id];
    // A descant must clear a minimum objective (see exp-descant.ts) to be worth a listen.
    const minObjective = Number(opt('min-objective', '0.3'));
    const bestD = d?.descant?.find((x: { label: string; objective: number }) => x.label === d.best?.descant && x.objective >= minObjective);
    const bestI = d?.introEnding?.find((x: { label: string }) => x.label === d.best?.introEnding);
    if (bestD) parts.push('descant (voice 2)');
    if (bestI) parts.push('intro and ending');
    if (!parts.length) continue;
    const c = assemble(s, {
      chords,
      descant: bestD ? parseFragment(bestD.abc, header) : null,
      intro: bestI ? parseFragment(bestI.intro, header) : null,
      ending: bestI ? parseFragment(bestI.ending, header) : null,
    }, {
      title: `${vars.title} (S6 AI candidate)`,
      extra: [
        `S:Tune: ${s.entry.license.id === 'CC0-1.0' ? 'S5 lead sheet' : 'Mutopia Project (public domain)'} spikes/s5-chart-pipeline/${posix.normalize(`songs/${s.entry.file}`)}`,
        PROVENANCE,
        `N:AI-generated parts: ${parts.join(', ')}.${chordLabel ? ` Chords: ${chordLabel}.` : ''}${bestD ? ` Descant: ${bestD.label}.` : ''}${bestI ? ` Intro/ending: ${bestI.label}.` : ''}`,
        `%%hh-id ${id}-s6`,
        '%%hh-license CC0-1.0',
        `%%hh-backing-style ${(s.entry.options?.backingStyle as string) ?? 'march'}`,
      ],
    });
    writeFileSync(join(candDir, `${id}-s6.abc`), c.abc);
    index.push({ id: `${id}-s6`, song: id, file: `${id}-s6.abc`, aiParts: parts, chords: chordLabel, descant: bestD?.label ?? null, introEnding: bestI?.label ?? null });
  }
  const tpls = ['system', 'chords-infer', 'chords-proofread', 'descant', 'intro-ending'].map((t) => ({ path: template(t).path, sha256: template(t).sha256 }));
  writeFileSync(join(candDir, 'candidates.json'), JSON.stringify({ $comment: 'Provenance of the S6 candidate lead sheets (generated by scripts/build-candidates.ts --from-results).', model: 'qwen3:8b (Qwen3-8B, Apache-2.0)', backend: tag === 'node' ? 'cuccia AI node, OpenAI-compatible /v1 (Ollama qwen3:8b), reasoning_effort none' : tag === 'local' ? 'local stand-in: scripts/local_llm_shim.py (llama.cpp, official Qwen/Qwen3-8B-GGUF Q4_K_M), thinking off' : 'offline mock', date: new Date().toISOString().slice(0, 10), prompts: tpls, logs: [`results/runs/chords-${tag}.jsonl`, `results/runs/descant-${tag}.jsonl`], candidates: index }, null, 2) + '\n');
}

// ---- charts from the ABC candidates ----
const schema = JSON.parse(readFileSync(join(S6_DIR, '..', 's5-chart-pipeline', 'schema', 'chart.schema.json'), 'utf8'));
const rows: string[] = [];
for (const f of readdirSync(candDir).filter((x) => x.endsWith('.abc')).sort()) {
  const text = readFileSync(join(candDir, f), 'utf8');
  const h = abcHeader(text);
  const score = parseAbc(text) as Score;
  const lead = score.notes.filter((n) => n.voice === '1').map((n) => ({ ...n, role: 'melody' }));
  const descant = score.notes.filter((n) => n.voice === '2').map((n) => ({ ...n, role: 'inner' }));
  const roleNotes: Note[] = dedupe([...realizeLeadSheet(score, lead), ...descant]);
  const id = String(score.meta.id ?? f.replace(/\.abc$/, ''));
  const baseId = id.replace(/-s6$/, '');
  const base = loadS5Song(baseId);
  const song = {
    id,
    title: score.title,
    composer: base.entry.composer ?? base.score.composer ?? '',
    year: (base.entry as { year?: number | null }).year ?? null,
    key: h.K ?? null,
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    source: { kind: 'other', file: `spikes/s6-ai-arranging/candidates/${f}`, notes: `S6 AI-assisted candidate (qwen3:8b; see the file's N: line). Tune from ${base.entry.source.kind === 'mutopia' ? `the Mutopia Project (${base.entry.source.url})` : 'the S5 CC0 lead sheet'}. Not proofread; human review pending. Does not replace the S5 chart ${baseId}.` },
  };
  const chart = buildChart({ score, roleNotes, song, ringerCounts: [3, 4, 5], profile: 'handbell' });
  const errs = validate(schema, chart);
  if (errs.length) throw new Error(`${f}: chart invalid: ${errs.slice(0, 5).join('; ')}`);
  writeFileSync(join(chartDir, `${id}.json`), stringifyChart(chart) + '\n');
  const p = playability(score, roleNotes);
  const o = playability(base.score, base.roleNotes);
  rows.push(`| ${id} | ${chart.timing.durationSec} s (${base.score.endTick ? Math.round((base.score.endTick / base.score.ppq) * (base.score.tempos[0].usPerQuarter / 1e6) * 10) / 10 : '?'} s) | ${chart.harmony?.source ?? '–'} (${chart.harmony?.chords.length ?? 0} chords) | ${o.strikes} → ${p.strikes} | ${o.distinctBells} → ${p.distinctBells} | ${o.violations} → ${p.violations} | ${p.dropped} | ${chart.handbellSet.set} |`);
  console.log(`chart ${id}: ${chart.parts.length} parts, ${chart.timing.durationSec} s, hard r4 violations ${p.violations}`);
}
const md = [
  `# S6 candidate charts (${tag}; generated by \`node scripts/build-candidates.ts${mock ? ' --mock' : ''}\`)`,
  '',
  'Hard tier, 4 ringers, profile `handbell`: original S5 chart → candidate. Violations = unplayable spots left after S5 repair; dropped = harmony notes removed by repair.',
  '',
  '| Candidate | Duration (original) | Harmony | Strikes | Bells | Violations | Dropped | Handbell set |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n');
writeFileSync(join(resDir, `candidates-${tag}.md`), md);
