// Build engine-neutral chart JSON (see ../schema/chart.schema.json).
import { pitchName, makeTimeMap, measureStarts, timeSigAt, isNatural } from './score.mjs';
import { TIERS, tierNotes } from './arrange.mjs';
import { PROFILES, assignBells, evaluateRinger, repair, ringerLabel } from './assign.mjs';

export const FORMAT = 'go-go-harmoniyo.chart';
// Format ids written before the rename to Go Go HarmoniYo (ADR-0009); readers still accept them.
export const LEGACY_FORMATS = ['handbell-hero.chart'];
export const FORMAT_VERSION = '0.1.0';
export const GENERATOR = { name: 'go-go-harmoniyo/spikes/s5-chart-pipeline', version: '0.1.0' };

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

export function buildPart(score, roleNotes, tier, ringerCount, profileId) {
  const profile = PROFILES[profileId];
  const toSec = makeTimeMap(score);
  const base = tierNotes(score, roleNotes, tier).map((n) => ({ ...n, time: toSec(n.tick) }));
  let notes = base;
  let assignment = assignBells(notes, ringerCount, profile);
  let dropped = [];
  for (let iter = 0; iter < 2; iter++) {
    const ringerOf = mapper(assignment);
    const rep = repair(notes, ringerOf, profile);
    dropped = dropped.concat(rep.dropped);
    notes = rep.notes;
    assignment = assignBells(notes, ringerCount, profile);
  }
  const ringerOf = mapper(assignment);
  const ringers = assignment.ringers.map((r, i) => {
    const mine = notes.filter((n) => ringerOf(n.midi) === i).sort((a, b) => a.time - b.time || a.midi - b.midi);
    const ev = evaluateRinger(mine, profile);
    const durationSec = toSec(score.endTick);
    return {
      index: i,
      label: ringerLabel(r),
      bells: r.bells.map(pitchName),
      stats: {
        strikes: ev.strikes,
        bells: r.bells.length,
        strikesPerMinute: r3((ev.strikes / durationSec) * 60),
        maxSimultaneous: ev.maxSimultaneous,
        minGapSec: ev.minGapSec === null ? null : r3(ev.minGapSec),
        swaps: ev.swaps,
        violations: ev.violations,
      },
    };
  });
  const strikes = ringers.map((r) => r.stats.strikes).filter((s) => s > 0);
  return {
    difficulty: tier,
    ringerCount,
    profile: profileId,
    ringers,
    notes: notes
      .sort((a, b) => a.tick - b.tick || a.midi - b.midi)
      .map((n) => ({
        tick: n.tick,
        time: r3(n.time),
        dur: n.dur,
        durSec: r3(toSec(n.tick + n.dur) - n.time),
        bell: pitchName(n.midi),
        ringer: ringerOf(n.midi),
        role: n.role,
      })),
    metrics: {
      strikes: notes.length,
      distinctBells: new Set(notes.map((n) => n.midi)).size,
      droppedForPlayability: { total: dropped.length, bass: dropped.filter((n) => n.role === 'bass').length, inner: dropped.filter((n) => n.role === 'inner').length },
      remainingViolations: ringers.reduce((s, r) => s + r.stats.violations, 0),
      loadBalance: strikes.length ? r3(Math.max(...strikes) / Math.min(...strikes)) : null,
      maxBellsPerRinger: Math.max(...ringers.map((r) => r.stats.bells)),
      idleRingers: ringers.filter((r) => r.stats.strikes === 0).length,
    },
  };
}

function mapper(assignment) {
  const m = new Map();
  assignment.ringers.forEach((r, i) => r.bells.forEach((b) => m.set(b, i)));
  return (midi) => m.get(midi);
}

// Pretty JSON with leaf objects/arrays (e.g. each note) on a single line.
export function stringifyChart(value, indent = '') {
  const isLeaf = (v) => v === null || typeof v !== 'object' || Object.values(v).every((x) => x === null || typeof x !== 'object');
  if (isLeaf(value)) return JSON.stringify(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + stringifyChart(v, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringifyChart(v, inner)}`).join(',\n')}\n${indent}}`;
}

export function buildChart({ score, roleNotes, song, ringerCounts = [3, 4, 5], profile = 'handbell' }) {
  const toSec = makeTimeMap(score);
  const parts = [];
  for (const k of ringerCounts) for (const tier of TIERS) parts.push(buildPart(score, roleNotes, tier, k, profile));
  const allMidis = [...new Set(parts.flatMap((p) => p.notes.map((n) => n.bell)))];
  const bellMidi = new Map(roleNotes.map((n) => [pitchName(n.midi), n.midi]));
  const bells = allMidis.map((id) => bellMidi.get(id)).sort((a, b) => a - b).map((m) => ({ id: pitchName(m), midi: m, natural: isNatural(m) }));
  const starts = measureStarts(score);
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    generator: GENERATOR,
    song,
    timing: {
      resolution: score.ppq,
      tempos: score.tempos.map((t) => ({ tick: t.tick, time: r3(toSec(t.tick)), bpm: r3(60e6 / t.usPerQuarter) })),
      timeSignatures: score.timeSigs.map((t) => ({ tick: t.tick, numerator: t.num, denominator: t.den })),
      measures: starts.map((t, i) => ({ number: i + 1, tick: t, time: r3(toSec(t)), pickup: i === 0 && starts.length > 1 && starts[1] - t < (score.ppq * 4 * timeSigAt(score, t).num) / timeSigAt(score, t).den })),
      endTick: score.endTick,
      durationSec: r3(toSec(score.endTick)),
    },
    bells,
    handbellSet: fitHandbellSet(bells.map((b) => b.midi)),
    parts,
  };
}
