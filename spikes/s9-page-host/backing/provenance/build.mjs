// Realizes every song (engine + specs), lays the result out on the Short and Full charts, removes
// anything that would rub against a bell of any built part, and writes:
//   out/manifest.json     wire format agreed with the integration session (backing-preview-v1)
//   out/corpus.md         compact reading copy for one independent score review
//   out/report.json       numbers per song and form, flagged bars
//   node build.mjs [songId ...]   (with ids: dry run for those songs, prints the lines)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARTS, UNIT, loadModel, nm, pc, realize } from './engine.mjs';
import { SPECS } from './specs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const index = JSON.parse(readFileSync(join(CHARTS, 'index.json'), 'utf8'));
if (index.keyChange) throw new Error('charts were built with --key-change; rebuild with the default options');
const only = process.argv.slice(2);
const ids = index.songs.map((s) => s.id).sort();
const ic = (a, b) => Math.min(pc(a - b), pc(b - a));
const LIGHT = new Set(['intro', 'light', 'quiet']);
const GAIN = { intro: 0.85, light: 0.9, quiet: 0.82, full: 1, descant: 1, finale: 1.05, coda: 1.05, once: 1, interlude: 0.9 };

/** Source notes -> chart ticks of one form, by the same section layout S5's form.mjs uses. */
function layout(M, notes, chart) {
  const sections = chart.form.sections;
  const verseEnd = M.bars.at(-1).end;
  const out = [];
  for (const [i, s] of sections.entries()) {
    const lastSection = i === sections.length - 1;
    const dev = s.development;
    let from = M.pickup, base, holdFrom = null;
    if (s.kind === 'verse') base = i === 0 ? M.pickup : s.tick;
    else if (s.kind === 'intro' || s.kind === 'coda') {
      const bars = Math.round((s.endTick - s.tick) / M.barLen) - (s.kind === 'coda' ? 1 : 0);
      from = verseEnd - bars * M.barLen;
      base = s.tick;
      if (s.kind === 'coda') holdFrom = s.endTick - M.barLen;
    } else throw new Error(`${M.id}: section kind ${s.kind} is not supported (charts must be built without --key-change)`);
    for (const n of notes) {
      if (n.tick < from) continue;
      if (n.opt && LIGHT.has(dev)) continue;
      if (n.end && !lastSection) continue;
      const tick = n.tick - from + base;
      const limit = holdFrom ?? s.endTick;
      const dur = Math.min(n.dur, limit - tick);
      if (dur <= 0) continue;
      out.push({ ...n, tick, dur, vel: Math.min(1, Math.round(n.vel * GAIN[dev] * 100) / 100), section: i, dev, srcTick: n.tick });
      // Coda: the final sonority is struck again under the held last bar.
      if (holdFrom !== null && n.fin && !n.end) out.push({ ...n, tick: holdFrom, dur: s.endTick - holdFrom, vel: Math.round(n.vel * 0.85 * 100) / 100, section: i, dev, srcTick: n.tick, hold: true });
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
}

/** Every bell any part of the chart can ring (players' notes and guide), written and sounding. */
function allBells(chart) {
  const midi = new Map(chart.bells.map((b) => [b.id, b.midi]));
  const shift = chart.handbellSet?.transposeSemitones ?? 12;
  const seen = new Map();
  for (const p of chart.parts) for (const n of [...p.notes, ...(p.guide ?? [])]) {
    const k = `${n.tick}:${n.bell}`;
    const prev = seen.get(k);
    if (!prev || n.dur > prev.dur) seen.set(k, { tick: n.tick, dur: n.dur, written: midi.get(n.bell), sounding: midi.get(n.bell) + shift, role: n.role });
  }
  return [...seen.values()].sort((a, b) => a.tick - b.tick);
}

/** Drop a backing note that is a semitone (any octave) from a bell struck with it or sounding when it enters. */
function guard(notes, bells, beatLen) {
  const kept = [], dropped = [];
  let j = 0;
  for (const n of notes) {
    while (j < bells.length && bells[j].tick + bells[j].dur <= n.tick - 4 * 1920) j++;
    const until = n.tick + Math.min(n.dur, beatLen);
    let bad = null;
    for (let k = j; k < bells.length && bells[k].tick < until; k++) {
      const b = bells[k];
      if (b.tick + b.dur <= n.tick) continue;
      if (ic(b.written, n.midi) !== 1 || ((b.role === 'melody' || b.role === 'descant') && b.tick > n.tick)) continue;
      if (n.chartBass && (b.role === 'melody' || b.role === 'descant')) continue; // the chart's own bass under its own tune
      const at = Math.max(n.tick, b.tick);
      if (bells.slice(j, k + 40).some((x) => x.tick <= at && x.tick + x.dur > at && pc(x.written) === pc(n.midi))) continue; // the bells ring this pitch themselves
      bad = b; break;
    }
    (bad ? dropped : kept).push(bad ? { ...n, against: bad } : n);
  }
  return { kept, dropped };
}

function tuples(notes, chart) {
  const beats = chart.harmony.beats;
  const end = chart.form.sections.at(-1).endTick;
  const pos = (tick) => {
    let i = beats.length - 1;
    while (i > 0 && beats[i].tick > tick) i--;
    const span = (beats[i + 1]?.tick ?? end) - beats[i].tick;
    return [i, Math.min((tick - beats[i].tick) / span, 0.999999)];
  };
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  return notes.map((n) => {
    const [i, f] = pos(n.tick);
    const stop = Math.min(n.tick + n.dur, end);
    const [j, g] = stop >= end ? [beats.length - 1, 1] : pos(stop);
    const len = Math.min(16, j + g - (i + f));
    return [i, r6(f), r6(len), n.midi, 'harp', n.vel];
  }).filter((t) => t[2] > 0);
}

const manifest = { schema: 'backing-preview-v1', sourceHash: index.sourceHash, songs: {} };
const report = { generated: new Date().toISOString(), sourceHash: index.sourceHash, songs: {} };
const corpus = ['# Catalog backing candidates: reading copy', '',
  'Chart-aware by construction: every pitch is a pitch class the song\'s own source voices or lead-sheet chord sound at that moment (the only exceptions are stepwise bass links and written passing notes, marked ~). Melody, bells, meter, tempo and bar timing are the charts\'. All notes are played by the recorded harp. Symbolic material only; nobody has listened to it.', '',
  'Notation per bar: `voice: Pitch@beat(length in beats)`; `~` = passing/link note (left out in the intro and the light and quiet verses of the Full form).', ''];
let bad = 0;

for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  const spec = SPECS[id];
  if (!spec) throw new Error(`no spec for ${id}`);
  const M = loadModel(id);
  const covered = new Set(spec.phrases.flatMap((p) => Array.from({ length: p.bars[1] - p.bars[0] + 1 }, (_, k) => p.bars[0] + k)));
  if (covered.size !== M.bars.length || Math.max(...covered) !== M.bars.length) throw new Error(`${id}: phrases cover ${covered.size} of ${M.bars.length} bars`);
  const { notes, flags, errors } = realize(M, spec);
  for (const e of errors) console.log(`  x ${e}`);
  if (errors.length) bad++;
  const forms = {};
  const rep = { title: M.title, meter: M.meter, bpm: M.bpm, bars: M.bars.length, harmony: M.harmonySource, sourceNotes: notes.length, errors, flags: [...flags], forms: {} };
  for (const form of ['short', 'full']) {
    const chart = JSON.parse(readFileSync(join(CHARTS, form === 'short' ? 'short' : '', `${id}.json`), 'utf8'));
    const laid = layout(M, notes, chart);
    const { kept, dropped } = guard(laid, allBells(chart), M.beatLen);
    // Same onset and pitch from two voices: one attack, the stronger velocity, the longer of the existing lengths.
    const merged = new Map();
    for (const n of kept) {
      const k = n.tick + ':' + n.midi;
      const prev = merged.get(k);
      merged.set(k, prev ? { ...prev, vel: Math.max(prev.vel, n.vel), dur: Math.max(prev.dur, n.dur) } : n);
    }
    const coalesced = kept.length - merged.size;
    kept.length = 0;
    kept.push(...[...merged.values()].sort((a, b) => a.tick - b.tick || a.midi - b.midi));
    forms[form] = tuples(kept, chart);
    const perSection = chart.form.sections.map((s, i) => `${s.label ?? s.kind}:${kept.filter((n) => n.section === i).length}`);
    rep.forms[form] = { events: forms[form].length, dropped: dropped.length, coalesced, sections: perSection.join(' '), chartSha256: sha(readFileSync(join(CHARTS, form === 'short' ? 'short' : '', `${id}.json`))) };
    for (const d of dropped) {
      const bar = M.bars.find((b) => d.srcTick >= b.tick && d.srcTick < b.end);
      const msg = `${form}${form === 'full' ? ` (${chart.form.sections[d.section].label})` : ''}: ${d.voice} ${nm(d.midi)} at +${d.srcTick - bar.tick} removed, against ${d.against.role} bell ${nm(d.against.written)}`;
      if (!rep.flags.some((f) => f.bar === bar.n && f.msg === msg)) rep.flags.push({ bar: bar.n, msg });
    }
    if (!forms[form].length) { console.log(`  x ${id} ${form}: no events`); bad++; }
  }
  manifest.songs[id] = forms;
  report.songs[id] = rep;

  // Reading copy.
  const beat = (off) => { const b = off / M.beatLen; return Number.isInteger(b) ? `${b + 1}` : `${(b + 1).toFixed(2).replace(/0+$/, '')}`; };
  const len = (d) => `${+(d / M.beatLen).toFixed(2)}`;
  corpus.push(`## ${M.title} (\`${id}\`)`, '', `${M.meter}, quarter = ${M.bpm}, ${M.bars.length} bars${M.pickup ? ' + pickup' : ''}, harmony from ${M.lead ? 'the lead sheet' : 'the source voices'}. ${spec.idea}`, '',
    '| Bars | Bass | Inner | Dyn | Notes | Notes/bar |', '|---|---|---|---|---|---|',
    ...spec.phrases.map((p, i) => { const c = notes.filter((n) => n.phrase === i).length; return `| ${p.bars[0]}-${p.bars[1]} | ${p.bass} | ${p.inner}${p.breath ? ' (breath)' : ''} | ${p.dyn} | ${c} | ${(c / (p.bars[1] - p.bars[0] + 1)).toFixed(1)} |`; }), '',
    '| Bar | Tune (written) | Chart harmony | Backing |', '|---|---|---|---|');
  for (const b of M.bars) {
    const tune = M.melody.filter((n) => n.tick >= b.tick && n.tick < b.end).map((n) => nm(n.midi)).join(' ');
    const harm = M.lead ? M.chart.harmony.chords.filter((c) => c.tick >= b.tick && c.tick < b.end).map((c) => c.symbol).join(' ') || '(held)' : [...new Set(M.beats.filter((x) => x.tick >= b.tick && x.tick < b.end).map((x) => nm(M.bassPcAt(x.tick)).replace(/-?\d+$/, '')))].join(' ') + ' (bass)';
    const voices = [...new Set(notes.filter((n) => n.tick >= b.tick && n.tick < b.end).map((n) => n.voice))];
    const cell = voices.map((v) => `${v}: ${notes.filter((n) => n.voice === v && n.tick >= b.tick && n.tick < b.end).map((n) => `${nm(n.midi)}${n.pass ? '~' : ''}@${beat(n.tick - b.tick)}(${len(n.dur)})`).join(' ')}`).join(' / ');
    corpus.push(`| ${b.n} | ${tune} | ${harm} | ${cell || '-'} |`);
  }
  corpus.push('', rep.flags.length ? '**Flagged:**' : '**Flagged:** none.', ...rep.flags.map((f) => `- bar ${f.bar}: ${f.msg}`), '',
    `Events: Short ${rep.forms.short.events} (${rep.forms.short.dropped} removed by the bell guard), Full ${rep.forms.full.events} (${rep.forms.full.dropped} removed). Full by section: ${rep.forms.full.sections}.`, '');
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${id.padEnd(34)} src ${String(notes.length).padStart(3)}  short ${String(rep.forms.short.events).padStart(3)} (-${rep.forms.short.dropped})  full ${String(rep.forms.full.events).padStart(4)} (-${rep.forms.full.dropped})  flags ${rep.flags.length}`);
  if (only.length) console.log(corpus.slice(corpus.findIndex((l) => l.startsWith(`## ${M.title}`))).join('\n'));
}

if (!only.length) {
  mkdirSync(join(HERE, 'out'), { recursive: true });
  if (bad) { console.log(`${bad} song(s) failed; nothing written`); process.exit(1); }
  const text = JSON.stringify(manifest);
  writeFileSync(join(HERE, 'out', 'manifest.json'), text);
  report.manifestSha256 = sha(text);
  writeFileSync(join(HERE, 'out', 'report.json'), JSON.stringify(report, null, 1) + '\n');
  writeFileSync(join(HERE, 'out', 'corpus.md'), corpus.join('\n') + '\n');
  console.log(`manifest ${join(HERE, 'out', 'manifest.json')} (${(text.length / 1024).toFixed(0)} KB, sha256 ${report.manifestSha256.slice(0, 16)}), sourceHash ${index.sourceHash}`);
}
