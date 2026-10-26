// Load a manifest entry -> { score, roleNotes, song } ready for chart building.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseAbc } from './abc.mjs';
import { midiToScore } from './midi.mjs';
import { parseMusicXml } from './musicxml.mjs';
import { assignRoles, realizeLeadSheet } from './arrange.mjs';
import { measureLength, parsePitch, pitchName, timeSigAt } from './score.mjs';

/**
 * Manifest `corrections`: proofread fixes to a pinned source, applied on import so the source file
 * stays byte-for-byte as published. Each correction re-pitches consecutive onsets of one voice:
 *   { voice, fromTick, was: ['B4', …], now: ['G4', …], why }
 * Onset i (the i-th distinct note start at or after `fromTick`) must contain a note sounding
 * `was[i]`; every such note becomes `now[i]`. Anything else is an error, so a correction can never
 * silently land on the wrong notes.
 */
export function applyCorrections(notes, corrections = []) {
  for (const c of corrections) {
    if (!Array.isArray(c.was) || !Array.isArray(c.now) || c.was.length !== c.now.length || !c.was.length) {
      throw new Error(`correction for ${c.voice}@${c.fromTick}: was/now must be non-empty arrays of the same length`);
    }
    const mine = notes.filter((n) => n.voice === c.voice && n.tick >= c.fromTick);
    const onsets = [...new Set(mine.map((n) => n.tick))].sort((a, b) => a - b);
    c.was.forEach((was, i) => {
      const tick = onsets[i];
      const hit = mine.filter((n) => n.tick === tick && n.midi === parsePitch(was));
      if (tick === undefined || !hit.length) {
        const found = mine.filter((n) => n.tick === tick).map((n) => pitchName(n.midi)).join('/') || 'nothing';
        throw new Error(`correction for ${c.voice}@${c.fromTick}: onset ${i} (tick ${tick}) expected ${was}, found ${found}`);
      }
      for (const n of hit) n.midi = parsePitch(c.now[i]);
    });
  }
  return notes;
}

export function loadScore(entry, baseDir) {
  const path = join(baseDir, entry.file);
  let score;
  if (entry.format === 'abc') score = parseAbc(readFileSync(path, 'utf8'));
  else if (entry.format === 'midi') score = midiToScore(readFileSync(path));
  else if (entry.format === 'musicxml') score = parseMusicXml(readFileSync(path, 'utf8'));
  else throw new Error(`Unknown format ${entry.format}`);
  const o = entry.options || {};
  if (o.corrections) applyCorrections(score.notes, o.corrections);
  if (o.tempoQpm) score.tempos = [{ tick: 0, usPerQuarter: Math.round(60e6 / o.tempoQpm) }];
  // For sources typeset in the wrong meter (e.g. a 3/4 hymn tune engraved in 4/4).
  if (o.timeSig) {
    const [num, den] = o.timeSig.split('/').map(Number);
    score.timeSigs = [{ tick: 0, num, den }];
    score.barTicks = [];
  }
  if (o.backingStyle) score.meta['backing-style'] = o.backingStyle;
  if (o.pickupTicks && !score.barTicks.length) {
    const bars = [];
    for (let t = o.pickupTicks; t < score.endTick; t += measureLength(score, timeSigAt(score, t))) bars.push(t);
    score.barTicks = bars;
  }
  return score;
}

export function arrange(score, entry) {
  const o = entry.options || {};
  const voices = new Set(score.notes.map((n) => n.voice));
  if (score.chords.length && voices.size === 1) {
    const melody = score.notes.map((n) => ({ ...n, role: 'melody' }));
    return realizeLeadSheet(score, melody);
  }
  return assignRoles(score, { melodyVoice: o.melodyVoice, bassVoice: o.bassVoice });
}

export function songMeta(score, entry) {
  return {
    id: entry.id,
    title: entry.title || score.title,
    composer: entry.composer || score.composer,
    year: entry.year ?? null,
    key: score.meta.key || null,
    license: entry.license,
    source: { ...entry.source, file: `spikes/s5-chart-pipeline/${posix.normalize(`songs/${entry.file}`)}` },
  };
}

export function loadSong(entry, baseDir) {
  const score = loadScore(entry, baseDir);
  const roleNotes = arrange(score, entry);
  return { score, roleNotes, song: songMeta(score, entry) };
}
