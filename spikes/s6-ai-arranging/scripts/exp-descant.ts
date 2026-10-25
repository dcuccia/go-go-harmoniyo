// Experiment 2b: descant + intro/ending with qwen3:8b for two carols, validated by the S5 ABC
// parser and music-theory checks, compared with a rule-based descant, and assembled into
// candidate arrangements (see scripts/build-candidates.ts for the chart/asset output).
//   node scripts/exp-descant.ts [--mock] [--songs deck-the-halls,the-holly-and-the-ivy] [--samples 5]
// The Holly and the Ivy has no chord symbols: it uses the best chords from exp-chords.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abcBody, abcBodyOnly, abcPitch, barLengths, extractBlock, fullBar, parseFragment, tonicPc, type Chord, type Note, type Score } from '../src/abc-io.ts';
import { assemble } from '../src/assemble.ts';
import { median, openHarness, pct, render, S6_DIR, template, runTag, backendLabel } from '../src/llm.ts';
import { ruleDescant } from '../src/rule-descant.ts';
import { bars, chordsFromBars, loadS5Song, melodyAbc, promptVars, spell, type Song } from '../src/songs.ts';
import { chordToneFit, nonDiatonic, playability, range, verticals } from '../src/theory.ts';

const argv = process.argv.slice(2);
const mock = argv.includes('--mock');
const opt = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const songs = opt('songs', 'deck-the-halls,the-holly-and-the-ivy').split(',');
const samples = Number(opt('samples', '5'));
const tag = mock ? 'mock' : (opt('tag', '') || runTag(false));
const outDir = mock ? join(S6_DIR, 'results', 'mock') : join(S6_DIR, 'results');
mkdirSync(outDir, { recursive: true });
const h = await openHarness({ mock, log: join(outDir, 'runs', `descant-${tag}.jsonl`) });
const system = template('system');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function chordsFor(s: Song): { chords: Chord[]; source: string } {
  if (s.currentSource === 'lead-sheet') return { chords: s.current, source: 'lead sheet (S5)' };
  const f = join(outDir, `chords-${tag}.json`);
  if (existsSync(f)) {
    const best = JSON.parse(readFileSync(f, 'utf8')).best?.[s.entry.id];
    if (best) {
      const { chords, errors } = chordsFromBars(s.score, best.chords);
      if (!errors.length) return { chords, source: `exp-chords best: ${best.label}` };
    }
  }
  return { chords: s.current, source: 'S5 inferred (no exp-chords result)' };
}

const lengthsEqual = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function descantMetrics(s: Song, chords: Chord[], d: Note[]) {
  const fit = chordToneFit(s.score, d, chords);
  const v = verticals(s.melody, d);
  const rg = range(d);
  const short = d.filter((n) => n.dur < s.score.ppq / 2).length;
  const play = playability(s.score, [...s.melody.map((n) => ({ ...n, role: 'melody' })), ...d.map((n) => ({ ...n, role: 'inner' }))]);
  const distinct = new Set(d.map((n) => n.midi)).size;
  const variety = barVariety(d);
  const objective = r3((0.3 * fit.strong + 0.15 * fit.all + 0.15 * (1 - v.dissonant) + 0.1 * v.aboveRatio + 0.1 * (play.violations === 0 ? 1 : 0) + 0.2 * (1 - v.similar)) * Math.min(1, distinct / 5) * Math.min(1, variety / 0.5) - 0.02 * v.parallels - 0.01 * short);
  return { notes: d.length, distinctPitches: distinct, barVariety: variety, similarMotion: v.similar, fitAll: fit.all, fitStrong: fit.strong, dissonant: v.dissonant, aboveRatio: v.aboveRatio, crossings: v.crossings, parallels: v.parallels, range: `${rg.lowName}–${rg.highName}`, nonDiatonic: nonDiatonic(s.score, d), shortNotes: short, playability: play, objective };
}

/** Share of distinct bar patterns (relative onsets + pitches + durations) among bars with notes. */
function barVariety(ns: Note[], barStarts: number[] = currentBars): number {
  const pats = barStarts.map((t, i) => {
    const end = i + 1 < barStarts.length ? barStarts[i + 1] : Infinity;
    return ns.filter((n) => n.tick >= t && n.tick < end).map((n) => `${n.tick - t}:${n.midi}:${n.dur}`).join(',');
  }).filter(Boolean);
  return pats.length ? r3(new Set(pats).size / pats.length) : 0;
}

/** Longest run of identical consecutive bars. */
function maxRepeat(ns: Note[], barStarts: number[]): number {
  let best = 1, run = 1, prev = '';
  barStarts.forEach((t, i) => {
    const end = i + 1 < barStarts.length ? barStarts[i + 1] : Infinity;
    const p = ns.filter((n) => n.tick >= t && n.tick < end).map((n) => `${n.tick - t}:${n.midi}:${n.dur}`).join(',');
    run = p && p === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = p;
  });
  return best;
}
let currentBars: number[] = [];

const results: Record<string, unknown> = {};
for (const id of songs) {
  const s = loadS5Song(id);
  currentBars = bars(s.score).map((b) => b.start);
  const vars = promptVars(s);
  const { chords, source: chordSource } = chordsFor(s);
  const f = Number(s.score.meta.fifths ?? 0);
  const ts = s.score.timeSigs[0];
  const header = { unit: '1/8', meter: `${ts.num}/${ts.den}`, key: vars.keyAbc, qpm: Math.round(60e6 / s.score.tempos[0].usPerQuarter) };
  const mel = range(s.melody);
  const low = mel.low + 7;
  const high = mel.high + 7;
  const melBars = barLengths({ ...s.score, barTicks: bars(s.score).slice(1).map((b) => b.start) });
  const bs = bars(s.score);
  const pickup = bs[0].pickup ? bs[0].end - bs[0].start : 0;
  const abc = melodyAbc(s, chords).trim();
  const common = { ...vars, unit: '1/8', abc, low: spell(low, f), high: spell(high, f), lowAbc: abcPitch(low, f), highAbc: abcPitch(high, f) };

  // ---- descant ----
  const dVars = { ...common, barEighths: fullBar(s.score) / (s.score.ppq / 2), pickupRule: pickup ? ' Bar 1 is the short pickup bar: fill it with a rest or a note of the same length.' : '' };
  const dTpls = [template('descant'), template('descant-v2')];
  const rule = ruleDescant(s.score, s.melody, chords, low, high);
  h.setMock(() => '```abc\n' + abcBody(s.score, rule) + '\n```');
  const validateDescant = (reply: string) => {
    const errors: string[] = [];
    let d: Score;
    try {
      const body = abcBodyOnly(extractBlock(reply, 'abc')).replace(/"[^"]*"/g, '');
      d = parseFragment(body, header);
    } catch (e) {
      return { value: null, errors: [`ABC does not parse: ${(e as Error).message}`] };
    }
    const lens = barLengths(d);
    if (!lengthsEqual(lens, melBars)) {
      if (lens.length !== melBars.length) errors.push(`descant has ${lens.length} bars, the tune has ${melBars.length}`);
      lens.forEach((l, i) => { if (l !== melBars[i] && i < melBars.length) errors.push(`bar ${i + 1} lasts ${l / (s.score.ppq / 2)} eighths, the tune's bar ${i + 1} lasts ${melBars[i] / (s.score.ppq / 2)}`); });
    }
    if (!d.notes.length) errors.push('no notes');
    else {
      const out = d.notes.filter((n) => n.midi < low - 2 || n.midi > high + 2);
      if (out.length) errors.push(`${out.length} notes outside ${spell(low, f)}–${spell(high, f)} (e.g. ${spell(out[0].midi, f)})`);
      if (nonDiatonic(s.score, d.notes) > 0.1) errors.push(`too many notes outside ${vars.key}`);
      const distinct = new Set(d.notes.map((n) => n.midi)).size;
      if (distinct < 4) errors.push(`the descant uses only ${distinct} different pitch${distinct === 1 ? '' : 'es'}; use at least 5 and make it a melody`);
      const rep = maxRepeat(d.notes, [0, ...d.barTicks.filter((t) => t > 0 && t < d.endTick)]);
      if (rep > 2) errors.push(`the same bar repeats ${rep} times in a row; write a melody that develops (at most 2 identical bars in a row)`);
    }
    return { value: errors.length ? null : d, errors: errors.slice(0, 8) };
  };
  const dRows: Record<string, unknown>[] = [{ label: 'rule-based descant (baseline)', kind: 'baseline', ok: true, ...descantMetrics(s, chords, rule), abc: abcBody(s.score, rule) }];
  const dRuns = dTpls.flatMap((tpl, k) => [{ t: 0, seed: 1 }, ...Array.from({ length: samples }, (_, i) => ({ t: 0.8, seed: 11 + 10 * i }))].map((r) => ({ ...r, tpl, v: k + 1 })));
  for (const run of dRuns) {
    const label = `qwen3 descant v${run.v} T=${run.t} seed ${run.seed}`;
    const r = await h.ask({ exp: 'descant', song: id, label, template: run.tpl.path, system: system.text, user: render(run.tpl.text, dVars), temperature: run.t, seed: run.seed, maxTokens: 1500, validate: validateDescant });
    const base = { label, kind: 'llm', temperature: run.t, seed: run.seed, ok: r.ok, attempts: r.attempts.length, firstTryOk: !r.attempts[0].errors.length, latencyMs: r.attempts.map((a) => a.latencyMs), completionTokens: r.attempts.map((a) => (a.usage as { completion_tokens?: number } | null)?.completion_tokens ?? null), firstErrors: r.attempts[0].errors, errors: r.errors };
    const d = r.value as Score | null;
    dRows.push(d ? { ...base, ...descantMetrics(s, chords, d.notes), abc: abcBody(s.score, d.notes.map((n) => ({ ...n }))) } : base);
    console.log(`  ${id} ${label}: ${r.ok ? 'ok' : 'FAILED'} (${r.attempts.length} attempt(s)) ${r.ok ? '' : r.errors[0]}`);
  }

  // ---- intro + ending ----
  const iTpl = template('intro-ending');
  const introBars = 4;
  const endingBars = 2;
  const iUser = render(iTpl.text, { ...common, introBars, endingBars, introPickupRule: pickup ? ` (hold the last note at least ${pickup / s.score.ppq} beat${pickup > s.score.ppq ? 's' : ''}: the tune's pickup is played over it)` : '' });
  const bar = fullBar(s.score);
  const lastFull = bs.filter((b) => b.end - b.start === bar).slice(-2);
  const mockFrag = (from: number, to: number) => {
    const ns = s.melody.filter((n) => n.tick >= from && n.tick < to).map((n) => ({ ...n, tick: n.tick - from, dur: Math.min(n.dur, to - n.tick) }));
    const cs = chords.filter((c) => c.tick < to && c.tick + c.dur > from).map((c) => ({ ...c, tick: Math.max(0, c.tick - from) }));
    return abcBody({ ...s.score, barTicks: [bar], endTick: to - from }, ns, cs);
  };
  h.setMock(() => `INTRO:\n${mockFrag(lastFull[0].start, lastFull[1].end)}\nENDING:\n${mockFrag(lastFull[0].start, lastFull[1].end)}`);
  const tonic = tonicPc(s.score);
  const validateFrame = (reply: string) => {
    const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```[a-z]*\s*/gi, '');
    const m = /INTRO:\s*([\s\S]*?)ENDING:\s*([\s\S]*)$/i.exec(text);
    if (!m) return { value: null, errors: ['reply must have an "INTRO:" section followed by an "ENDING:" section'] };
    const errors: string[] = [];
    const out: Record<string, Score> = {};
    for (const [name, raw, want] of [['intro', m[1], [2, 4]], ['ending', m[2], [2, 4]]] as [string, string, number[]][]) {
      let sc: Score;
      try {
        sc = parseFragment(abcBodyOnly(raw), header);
      } catch (e) {
        errors.push(`${name}: ABC does not parse: ${(e as Error).message}`);
        continue;
      }
      const lens = barLengths(sc);
      if (lens.length < want[0] || lens.length > want[1]) errors.push(`${name} has ${lens.length} bars (want ${want[0]}–${want[1]})`);
      lens.forEach((l, i) => { if (l !== bar) errors.push(`${name} bar ${i + 1} is ${l / (s.score.ppq / 2)} eighths long, a full bar is ${bar / (s.score.ppq / 2)}`); });
      if (!sc.chords.length) errors.push(`${name}: no chord symbols`);
      if (!sc.notes.length) errors.push(`${name}: no notes`);
      const outR = sc.notes.filter((n) => n.midi < mel.low - 5 || n.midi > mel.high + 5);
      if (outR.length) errors.push(`${name}: ${outR.length} notes outside ${spell(mel.low - 5, f)}–${spell(mel.high + 5, f)}`);
      out[name] = sc;
    }
    if (out.intro?.chords.length) {
      const lc = out.intro.chords[out.intro.chords.length - 1];
      if (lc.root !== (tonic + 7) % 12 && lc.root !== tonic) errors.push(`intro should end on the dominant (${vars.dominant}) chord, not ${lc.symbol}`);
      const ln = out.intro.notes[out.intro.notes.length - 1];
      if (pickup && ln && (ln.tick + ln.dur < out.intro.endTick || ln.dur < pickup)) errors.push(`the intro's last note must be held at least ${pickup / s.score.ppq} beat(s) to the end of the bar`);
    }
    if (out.ending?.notes.length) {
      const lc = out.ending.chords[out.ending.chords.length - 1];
      if (lc && lc.root !== tonic) errors.push(`ending must finish on the tonic chord (${vars.tonic}), not ${lc.symbol}`);
      const ln = out.ending.notes[out.ending.notes.length - 1];
      if (ln.midi % 12 !== tonic) errors.push(`ending's last note must be the tonic ${vars.tonic}`);
    }
    return { value: errors.length ? null : out, errors: errors.slice(0, 8) };
  };
  const iRows: Record<string, unknown>[] = [];
  const iRuns = [{ t: 0, seed: 1 }, ...Array.from({ length: Math.max(1, samples - 1) }, (_, i) => ({ t: 0.8, seed: 11 + 10 * i }))];
  for (const run of iRuns) {
    const label = `qwen3 intro+ending T=${run.t} seed ${run.seed}`;
    const r = await h.ask({ exp: 'intro-ending', song: id, label, template: iTpl.path, system: system.text, user: iUser, temperature: run.t, seed: run.seed, maxTokens: 1000, validate: validateFrame });
    const base = { label, kind: 'llm', temperature: run.t, seed: run.seed, ok: r.ok, attempts: r.attempts.length, firstTryOk: !r.attempts[0].errors.length, latencyMs: r.attempts.map((a) => a.latencyMs), firstErrors: r.attempts[0].errors, errors: r.errors };
    const v = r.value as Record<string, Score> | null;
    if (v) {
      const fi = chordToneFit(v.intro, v.intro.notes, v.intro.chords);
      const fe = chordToneFit(v.ending, v.ending.notes, v.ending.chords);
      const introEndsV = v.intro.chords[v.intro.chords.length - 1].root === (tonic + 7) % 12;
      iRows.push({ ...base, introBars: barLengths(v.intro).length, endingBars: barLengths(v.ending).length, introFit: fi.all, endingFit: fe.all, introEndsOnV: introEndsV, objective: r3(0.35 * fi.all + 0.35 * fe.all + 0.2 * (introEndsV ? 1 : 0) + 0.1 * (r.attempts.length === 1 ? 1 : 0)), intro: abcBody(v.intro, v.intro.notes, v.intro.chords), ending: abcBody(v.ending, v.ending.notes, v.ending.chords) });
    } else iRows.push(base);
    console.log(`  ${id} ${label}: ${r.ok ? 'ok' : 'FAILED'} (${r.attempts.length} attempt(s)) ${r.ok ? '' : r.errors[0]}`);
  }

  // ---- best of each, assembled ----
  const bestD = dRows.filter((r) => r.kind === 'llm' && r.ok).sort((a, b) => (b.objective as number) - (a.objective as number))[0] ?? null;
  const bestI = iRows.filter((r) => r.ok).sort((a, b) => (b.objective as number) - (a.objective as number))[0] ?? null;
  let assembled: Record<string, unknown> | null = null;
  if (bestD || bestI) {
    const c = assemble(s, {
      chords,
      descant: bestD ? parseFragment(bestD.abc as string, header) : null,
      intro: bestI ? parseFragment(bestI.intro as string, header) : null,
      ending: bestI ? parseFragment(bestI.ending as string, header) : null,
    }, { title: `${vars.title} (S6 AI candidate)` });
    assembled = { bars: bars(c.score).length, durationTicks: c.score.endTick, playabilityHardR4: playability(c.score, c.roleNotes), playabilityHardR3: playability(c.score, c.roleNotes, 'hard', 3), abcChars: c.abc.length };
  }
  const baselinePlay = playability(s.score, s.roleNotes);
  results[id] = { chordSource: chordSource, low: spell(low, f), high: spell(high, f), descant: dRows, introEnding: iRows, best: { descant: bestD?.label ?? null, introEnding: bestI?.label ?? null }, assembled, originalPlayabilityHardR4: baselinePlay };
}
await h.close();

const all = Object.values(results).flatMap((r) => [...((r as { descant: Record<string, unknown>[] }).descant), ...((r as { introEnding: Record<string, unknown>[] }).introEnding)]).filter((x) => x.kind === 'llm');
const lat = all.flatMap((x) => x.latencyMs as number[]);
const summary = { mode: tag, date: new Date().toISOString(), outputs: all.length, calls: lat.length, validFinal: all.filter((x) => x.ok).length, validFirstTry: all.filter((x) => x.firstTryOk).length, latencyMs: { median: median(lat), p90: pct(lat, 90), max: Math.max(...lat) } };
writeFileSync(join(outDir, `descant-${tag}.json`), JSON.stringify({ summary, results }, null, 1) + '\n');

const md: string[] = [
  `# S6 descant + intro/ending experiment (${tag}, ${summary.date.slice(0, 10)}; generated by \`node scripts/exp-descant.ts${mock ? ' --mock' : ''}\`)`,
  '',
  ...(mock ? ['> **MOCK RUN**: the "model" returns the rule-based descant and repeats of the last phrase; numbers only show the pipeline works.', ''] : []),
  `Model qwen3:8b via ${backendLabel(tag)}. ${summary.outputs} outputs from ${summary.calls} calls; valid ${summary.validFinal}/${summary.outputs} after up to 2 repair turns, ${summary.validFirstTry}/${summary.outputs} on the first try. Latency per call: median ${summary.latencyMs.median} ms, p90 ${summary.latencyMs.p90} ms, max ${summary.latencyMs.max} ms.`,
  '',
  'Descant metrics: pitches = distinct pitches (validator requires ≥ 4, and at most 2 identical bars in a row); bar variety = distinct bars / bars; fit = share of descant time on chord tones (all / strong-beat onsets); dissonant = share of onsets forming a 2nd, 7th or tritone with the tune; above = share of onsets above the tune; similar motion = share of steps where both voices move the same way (a copied tune scores ~1); playability = S5 assignment + repair for melody + descant, 4 ringers, profile `handbell` (violations left / harmony notes dropped).',
  '',
];
for (const [id, r0] of Object.entries(results)) {
  const r = r0 as { chordSource: string; low: string; high: string; descant: Record<string, unknown>[]; introEnding: Record<string, unknown>[]; best: Record<string, string | null>; assembled: Record<string, unknown> | null; originalPlayabilityHardR4: Record<string, unknown> };
  md.push(`## ${id}`, '', `Chords: ${r.chordSource}. Descant range asked: ${r.low}–${r.high}.`, '', '| Descant | Valid (attempts) | First-try errors | Notes (pitches; bar variety) | Fit all / strong | Dissonant | Above | Similar motion | Parallels | Range | Violations / dropped | Objective | Latency (ms) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of r.descant) {
    const p = d.playability as { violations: number; dropped: number } | undefined;
    md.push(`| ${d.label} | ${d.kind === 'baseline' ? '–' : `${d.ok ? 'yes' : 'no'} (${d.attempts})`} | ${((d.firstErrors as string[] | undefined) ?? []).slice(0, 1).join('').replace(/\|/g, '/') || '–'} | ${d.notes ?? '–'}${d.distinctPitches ? ` (${d.distinctPitches}; ${d.barVariety})` : ''} | ${d.fitAll ?? '–'} / ${d.fitStrong ?? '–'} | ${d.dissonant ?? '–'} | ${d.aboveRatio ?? '–'} | ${d.similarMotion ?? '–'} | ${d.parallels ?? '–'} | ${d.range ?? '–'} | ${p ? `${p.violations} / ${p.dropped}` : '–'} | ${d.objective ?? '–'} | ${d.latencyMs ? (d.latencyMs as number[]).join(' / ') : '–'} |`);
  }
  md.push('', '| Intro + ending | Valid (attempts) | First-try errors | Bars | Fit intro / ending | Intro ends on V | Objective | Latency (ms) |', '|---|---|---|---|---|---|---|---|');
  for (const d of r.introEnding) md.push(`| ${d.label} | ${d.ok ? 'yes' : 'no'} (${d.attempts}) | ${((d.firstErrors as string[]) ?? []).slice(0, 1).join('').replace(/\|/g, '/') || '–'} | ${d.introBars ?? '–'} + ${d.endingBars ?? '–'} | ${d.introFit ?? '–'} / ${d.endingFit ?? '–'} | ${d.introEndsOnV === undefined ? '–' : d.introEndsOnV ? 'yes' : 'no'} | ${d.objective ?? '–'} | ${(d.latencyMs as number[]).join(' / ')} |`);
  md.push('', `Best: descant = ${r.best.descant ?? 'none'}; intro/ending = ${r.best.introEnding ?? 'none'}.`, '');
  if (r.assembled) md.push(`Assembled candidate: ${r.assembled.bars} bars; hard tier, 4 ringers: ${JSON.stringify(r.assembled.playabilityHardR4)}; 3 ringers: ${JSON.stringify(r.assembled.playabilityHardR3)}. Original chart (hard, 4 ringers): ${JSON.stringify(r.originalPlayabilityHardR4)}.`, '');
}
writeFileSync(join(outDir, `descant-${tag}.md`), md.join('\n'));
console.log(JSON.stringify(summary));
