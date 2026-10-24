// Load a manifest entry -> { score, roleNotes, song } ready for chart building.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseAbc } from './abc.mjs';
import { midiToScore } from './midi.mjs';
import { parseMusicXml } from './musicxml.mjs';
import { assignRoles, realizeLeadSheet } from './arrange.mjs';
import { measureLength, timeSigAt } from './score.mjs';

export function loadScore(entry, baseDir) {
  const path = join(baseDir, entry.file);
  let score;
  if (entry.format === 'abc') score = parseAbc(readFileSync(path, 'utf8'));
  else if (entry.format === 'midi') score = midiToScore(readFileSync(path));
  else if (entry.format === 'musicxml') score = parseMusicXml(readFileSync(path, 'utf8'));
  else throw new Error(`Unknown format ${entry.format}`);
  const o = entry.options || {};
  if (o.tempoQpm) score.tempos = [{ tick: 0, usPerQuarter: Math.round(60e6 / o.tempoQpm) }];
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
