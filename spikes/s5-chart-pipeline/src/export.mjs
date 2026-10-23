// Exports: Clone Hero / YARG (Rock Band-style) notes.mid + song.ini, a General MIDI "audition"
// file, and an ASCII lane preview.
import { writeMidi, meta, noteEvents } from './midi.mjs';
import { beatGrid, measureStarts } from './score.mjs';

// One ringer per CH/YARG 5-lane instrument track. Lanes = that ringer's bells low->high.
export const CH_TRACKS = ['PART GUITAR', 'PART BASS', 'PART RHYTHM', 'PART KEYS', 'PART GUITAR COOP'];
const CH_BASE = { easy: [60], medium: [72], hard: [84, 96] }; // hard also fills Expert
const CH_NOTE_LEN = 60; // ticks @480: well below the default sustain cutoff, so no sustains

export function laneOf(bellIndex, bellCount) {
  if (bellCount <= 5) return bellIndex;
  return Math.round((bellIndex * 4) / (bellCount - 1));
}

export function exportCloneHero(score, chart, ringerCount) {
  if (ringerCount > CH_TRACKS.length) throw new Error(`CH/YARG export supports up to ${CH_TRACKS.length} ringers`);
  const tempoTrack = {
    name: chart.song.title,
    events: [...score.tempos.map((t) => meta.tempo(t.tick, t.usPerQuarter)), ...score.timeSigs.map((t) => meta.timeSig(t.tick, t.num, t.den))],
  };
  const tracks = [tempoTrack];
  const warnings = [];
  for (let r = 0; r < ringerCount; r++) {
    const events = [];
    for (const tier of ['easy', 'medium', 'hard']) {
      const part = chart.parts.find((p) => p.difficulty === tier && p.ringerCount === ringerCount);
      const ringer = part.ringers[r];
      if (ringer.bells.length > 5) warnings.push(`${tier} ringer ${r + 1} has ${ringer.bells.length} bells; lanes merged`);
      const seen = new Set();
      for (const n of part.notes.filter((x) => x.ringer === r)) {
        const lane = laneOf(ringer.bells.indexOf(n.bell), ringer.bells.length);
        for (const base of CH_BASE[tier]) {
          const k = `${n.tick}:${base + lane}`;
          if (seen.has(k)) continue;
          seen.add(k);
          events.push(...noteEvents(n.tick, CH_NOTE_LEN, base + lane, 100, 0));
        }
      }
    }
    tracks.push({ name: CH_TRACKS[r], events });
  }
  const beat = beatGrid(score).flatMap((b) => noteEvents(b.tick, score.ppq / 4, b.downbeat ? 12 : 13, 100, 0));
  tracks.push({ name: 'BEAT', events: beat });
  const first = Math.min(...chart.parts.flatMap((p) => p.notes.map((n) => n.tick)));
  tracks.push({ name: 'EVENTS', events: [meta.text(Math.max(0, first - score.ppq), '[music_start]'), meta.text(score.endTick + score.ppq, '[music_end]'), meta.text(score.endTick + 2 * score.ppq, '[end]')] });
  return { midi: writeMidi({ ppq: score.ppq, tracks }), warnings };
}

export function songIni(chart, ringerCount) {
  const hard = chart.parts.find((p) => p.difficulty === 'hard' && p.ringerCount === ringerCount);
  const rating = (r) => Math.max(0, Math.min(6, Math.round(r.stats.strikesPerMinute / 12)));
  const keys = ['diff_guitar', 'diff_bass', 'diff_rhythm', 'diff_keys', 'diff_guitar_coop'];
  const lines = [
    '[song]',
    `name = ${chart.song.title}`,
    `artist = ${chart.song.composer}`,
    'album = Go Go HarmoniYo (S5 spike export)',
    'genre = Holiday',
    `year = ${chart.song.year ?? ''}`,
    'charter = Go Go HarmoniYo S5 chart pipeline',
    `song_length = ${Math.round(chart.timing.durationSec * 1000)}`,
    'delay = 0',
    ...hard.ringers.map((r, i) => `${keys[i]} = ${rating(r)}`),
    `loading_phrase = Ringers (hard): ${hard.ringers.map((r, i) => `${i + 1}=${r.bells.join(' ')}`).join('; ')}. License: ${chart.song.license.id}.`,
  ];
  return lines.join('\r\n') + '\r\n';
}

// General MIDI audition file: one track per ringer (Tubular Bells), for listening in any player.
export function exportAudition(score, part) {
  const tracks = [{ name: 'tempo', events: [...score.tempos.map((t) => meta.tempo(t.tick, t.usPerQuarter)), ...score.timeSigs.map((t) => meta.timeSig(t.tick, t.num, t.den))] }];
  for (const r of part.ringers) {
    const ch = r.index >= 9 ? r.index + 1 : r.index; // skip drum channel 10
    const events = [{ tick: 0, bytes: [0xc0 | ch, 14] }];
    for (const n of part.notes.filter((x) => x.ringer === r.index)) {
      const midi = noteNumber(n.bell);
      events.push(...noteEvents(n.tick, Math.max(n.dur, score.ppq), midi, n.role === 'melody' ? 110 : 80, ch));
    }
    tracks.push({ name: `Ringer ${r.index + 1} (${r.bells.join(' ')})`, events });
  }
  return writeMidi({ ppq: score.ppq, tracks });
}

export function noteNumber(bell) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(bell);
  const pcs = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return pcs.indexOf(m[1]) + 12 * (Number(m[2]) + 1);
}

// ASCII lane preview: one row per eighth-note slot, one column group per ringer.
export function asciiPreview(score, part, measures = 8) {
  const starts = measureStarts(score);
  const endTick = starts[Math.min(measures, starts.length - 1)] ?? score.endTick;
  const step = score.ppq / 2;
  const header = part.ringers.map((r, i) => `R${i + 1}:${r.bells.map((b) => b.padStart(4)).join('')}`);
  const lines = [`bar  | ${header.join(' | ')}`];
  const byTick = new Map();
  for (const n of part.notes) {
    if (n.tick >= endTick) continue;
    const slot = Math.floor(n.tick / step) * step;
    if (!byTick.has(slot)) byTick.set(slot, []);
    byTick.get(slot).push(n);
  }
  for (let t = 0; t < endTick; t += step) {
    const m = starts.filter((s) => s <= t).length;
    const isBar = starts.includes(t);
    const label = isBar ? String(m).padStart(3) + ' ' : '    ';
    const hits = byTick.get(t) || [];
    const cols = part.ringers.map((r, i) => {
      const cells = r.bells.map((b) => {
        const h = hits.find((x) => x.ringer === i && x.bell === b);
        return (h ? (h.role === 'melody' ? 'M' : h.role === 'bass' ? 'B' : 'h') : isBar ? '-' : '.').padStart(4);
      });
      return `${' '.repeat(3)}${cells.join('')}`.padEnd(header[i].length);
    });
    lines.push(`${label} | ${cols.join(' | ')}`);
  }
  return lines.join('\n');
}
