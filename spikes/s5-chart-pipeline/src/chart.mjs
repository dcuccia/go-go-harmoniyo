// Build engine-neutral chart JSON (see ../schema/chart.schema.json).
import { pitchName, makeTimeMap, measureStarts, timeSigAt, isNatural } from './score.mjs';
import { buildHarmony, inferChords, keyOf } from './harmony.mjs';
import { expandForm } from './form.mjs';
import { ARRANGEMENTS, TIERS, buildFormPart } from './parts.mjs';

export const FORMAT = 'go-go-harmoniyo.chart';
// Format ids written before the rename to Go Go HarmoniYo (ADR-0009); readers still accept them.
export const LEGACY_FORMATS = ['handbell-hero.chart'];
// 0.2.0 adds the optional `harmony` block (chords + beat grid + backing style); 0.1 readers ignore it.
// 0.3.0 adds the optional `form` block (song sections), part `arrangement` + ringer `role`/`name`,
// the `super-easy` tier with a host-played `guide`, the `descant` note role and beat `section`s.
export const FORMAT_VERSION = '0.3.0';
export const GENERATOR = { name: 'go-go-harmoniyo/spikes/s5-chart-pipeline', version: '0.3.0' };

export const isChartFormat = (format) => format === FORMAT || LEGACY_FORMATS.includes(format);

// Standard handbell set ranges (written pitch; handbells sound an octave higher than written).
export const HANDBELL_SETS = [
  { id: '2oct', label: '2 octaves G4–G6 (25 bells)', low: 67, high: 91 },
  { id: '3oct', label: '3 octaves C4–C7 (37 bells)', low: 60, high: 96 },
  { id: '4oct', label: '4 octaves C3–C7 (49 bells)', low: 48, high: 96 },
  { id: '5oct', label: '5 octaves C2–C7 (61 bells)', low: 36, high: 96 },
];

export function fitHandbellSet(midis) {
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  // Prefer whole-octave shifts (same key), then the smallest transposition.
  const shifts = [];
  for (let s = -48; s <= 48; s++) shifts.push(s);
  shifts.sort((a, b) => (a % 12 === 0 ? 0 : 1) - (b % 12 === 0 ? 0 : 1) || Math.abs(a) - Math.abs(b));
  for (const set of HANDBELL_SETS) {
    const shift = shifts.find((sh) => lo + sh >= set.low && hi + sh <= set.high);
    if (shift !== undefined) return { set: set.id, label: set.label, transposeSemitones: shift, span: hi - lo };
  }
  return { set: null, label: 'exceeds 5 octaves', transposeSemitones: 0, span: hi - lo };
}

const r3 = (x) => Math.round(x * 1000) / 1000;

// Pretty JSON with leaf objects/arrays (e.g. each note) on a single line. Arrays of primitives
// inside an object (e.g. a chord's `tones`) keep that object on one line.
export function stringifyChart(value, indent = '') {
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object'));
  const isLeaf = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) ? v.every((x) => x === null || typeof x !== 'object') : Object.values(v).every(flat));
  if (isLeaf(value)) return JSON.stringify(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + stringifyChart(v, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringifyChart(v, inner)}`).join(',\n')}\n${indent}}`;
}


/**
 * What the form and the parts are built from: the tune, the score's own bass line (SATB sources;
 * empty for lead sheets and melody-only files) and a chord timeline (lead-sheet symbols, else
 * inferred from the notes).
 */
export function songMaterial(score, roleNotes) {
  const leadSheet = score.chords.length > 0;
  return {
    melody: roleNotes.filter((n) => n.role === 'melody'),
    sourceBass: leadSheet ? [] : roleNotes.filter((n) => n.role === 'bass'),
    sourceInner: leadSheet ? [] : roleNotes.filter((n) => n.role === 'inner'),
    chords: leadSheet ? score.chords : inferChords(score, roleNotes),
    chordSource: leadSheet ? 'lead-sheet' : 'inferred',
    key: keyOf(score, roleNotes),
  };
}

/** The song laid out in a form ('full' | 'short' | options object, see form.mjs). */
export function formSong(score, roleNotes, form = 'full') {
  return expandForm(score, songMaterial(score, roleNotes), form);
}

/** One part (see parts.mjs). `formed` from formSong(). */
export function buildPart(formed, tier, ringerCount, profileId, arrangement = 'balanced') {
  return buildFormPart(formed, tier, ringerCount, profileId, arrangement);
}

export function buildChart({ score, roleNotes, song, ringerCounts = [3, 4, 5], profile = 'handbell', form = 'full', arrangements = ARRANGEMENTS, tiers = TIERS, formed: pre }) {
  const formed = pre ?? formSong(score, roleNotes, form);
  const exp = formed.score;
  const toSec = makeTimeMap(exp);
  const parts = [];
  for (const arrangement of arrangements) for (const k of ringerCounts) for (const tier of tiers) parts.push(buildFormPart(formed, tier, k, profile, arrangement));
  const bellMidi = new Map();
  for (const n of [...formed.melody, ...formed.descant, ...formed.sourceBass]) bellMidi.set(pitchName(n.midi), n.midi);
  const noteIds = [...new Set(parts.flatMap((p) => [...p.notes, ...(p.guide ?? [])].map((n) => n.bell)))];
  const midiOf = (id) => bellMidi.get(id) ?? noteMidi(id);
  const bells = noteIds.map(midiOf).sort((a, b) => a - b).map((m) => ({ id: pitchName(m), midi: m, natural: isNatural(m) }));
  const starts = measureStarts(exp);
  const harmony = buildHarmony(exp, formed.melody, { chords: exp.chords, source: formed.chordSource, sectionAt: formed.sectionAt });
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    generator: GENERATOR,
    song,
    form: {
      id: formed.id,
      sections: formed.sections.map((s) => ({ ...s, time: r3(toSec(s.tick)), durSec: r3(toSec(s.endTick) - toSec(s.tick)) })),
    },
    timing: {
      resolution: exp.ppq,
      tempos: exp.tempos.map((t) => ({ tick: t.tick, time: r3(toSec(t.tick)), bpm: r3(60e6 / t.usPerQuarter) })),
      timeSignatures: exp.timeSigs.map((t) => ({ tick: t.tick, numerator: t.num, denominator: t.den })),
      measures: starts.map((t, i) => ({ number: i + 1, tick: t, time: r3(toSec(t)), pickup: i === 0 && starts.length > 1 && starts[1] - t < (exp.ppq * 4 * timeSigAt(exp, t).num) / timeSigAt(exp, t).den })),
      endTick: exp.endTick,
      durationSec: r3(toSec(exp.endTick)),
    },
    bells,
    handbellSet: fitHandbellSet(bells.map((b) => b.midi)),
    ...(harmony ? { harmony } : {}),
    parts,
  };
}

function noteMidi(id) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(id);
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(m[1]) + 12 * (Number(m[2]) + 1);
}
