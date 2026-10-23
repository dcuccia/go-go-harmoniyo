// Arrangement: label notes with roles (melody / bass / inner), realize lead-sheet chord symbols,
// and derive difficulty tiers.
import { beatGrid, measureStarts } from './score.mjs';

export const ROLE_PRIORITY = { melody: 3, bass: 2, inner: 1 };

// Outer line of a (possibly polyphonic) voice: a note is on the top line if no other note in the
// voice that is sounding at its onset is higher (bottom line: lower).
function outerLine(notes, top) {
  const out = new Set();
  for (const n of notes) {
    const beaten = notes.some((o) => o !== n && o.tick <= n.tick && o.tick + o.dur > n.tick && (top ? o.midi > n.midi : o.midi < n.midi));
    if (!beaten) out.add(n);
  }
  return out;
}

function meanPitch(ns) {
  return ns.reduce((s, n) => s + n.midi, 0) / ns.length;
}

// Returns a new notes array with `role` set. opts.melodyVoice / opts.bassVoice override heuristics.
export function assignRoles(score, opts = {}) {
  const byVoice = new Map();
  for (const n of score.notes) {
    if (!byVoice.has(n.voice)) byVoice.set(n.voice, []);
    byVoice.get(n.voice).push({ ...n });
  }
  const voices = [...byVoice.entries()].map(([id, notes]) => ({ id, notes, mean: meanPitch(notes) }));
  voices.sort((a, b) => b.mean - a.mean);
  const melodyV = voices.find((v) => v.id === opts.melodyVoice) || voices[0];
  const others = voices.filter((v) => v !== melodyV);
  const bassV = voices.find((v) => v.id === opts.bassVoice) || (others.length ? others[others.length - 1] : melodyV);

  const top = outerLine(melodyV.notes, true);
  for (const n of melodyV.notes) n.role = top.has(n) ? 'melody' : 'inner';
  const bassPool = bassV.notes.filter((n) => n.role !== 'melody');
  const bottom = outerLine(bassPool, false);
  for (const n of bassPool) n.role = bottom.has(n) ? 'bass' : 'inner';
  for (const v of voices) for (const n of v.notes) n.role ||= 'inner';

  return dedupe(voices.flatMap((v) => v.notes));
}

// Same pitch struck at the same tick by two voices -> one strike, keeping the highest-priority role.
export function dedupe(notes) {
  const map = new Map();
  for (const n of notes) {
    const k = `${n.tick}:${n.midi}`;
    const prev = map.get(k);
    if (!prev || ROLE_PRIORITY[n.role] > ROLE_PRIORITY[prev.role]) map.set(k, n);
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick || a.midi - b.midi);
}

function placeInWindow(pc, low) {
  let m = low + ((pc - low) % 12 + 12) % 12;
  return m;
}

// Lead sheet (melody + chord symbols) -> melody + bass + inner notes.
// Bass: chord root (or slash bass) in a 12-semitone window well below the melody, struck at each
// chord change and each strong beat. Inner ("pad"): the 3rd plus the 5th (or 7th for 7th chords),
// in a window just under the lowest melody note, struck at the same times, dropped if it would
// sound at or above the current melody note.
export function realizeLeadSheet(score, melody) {
  if (!score.chords.length) return melody;
  const melodyLow = Math.min(...melody.map((n) => n.midi));
  // Windows keep the whole arrangement within (melody span + 19) semitones, so melodies spanning
  // up to 17 semitones fit a 3-octave (36-semitone) handbell set.
  const padLow = melodyLow - 7;
  const bassLow = melodyLow - 19;
  const strong = beatGrid(score).filter((b) => b.strong).map((b) => b.tick);
  const out = [...melody];
  for (const c of score.chords) {
    const end = c.tick + c.dur;
    const hits = [...new Set([c.tick, ...strong.filter((t) => t > c.tick && t < end)])].sort((a, b) => a - b);
    const third = c.tones[1];
    const color = c.tones.length >= 4 ? c.tones[3] : c.tones[2];
    hits.forEach((t, i) => {
      const dur = (i + 1 < hits.length ? hits[i + 1] : end) - t;
      out.push({ tick: t, dur, midi: placeInWindow(c.bass, bassLow), vel: 80, voice: 'bass', role: 'bass', chord: c.symbol });
      const mel = melody.find((m) => m.tick <= t && m.tick + m.dur > t);
      for (const pc of [third, color]) {
        if (pc === undefined || pc === c.bass) continue;
        const midi = placeInWindow(pc, padLow);
        if (mel && midi >= mel.midi) continue;
        out.push({ tick: t, dur, midi, vel: 70, voice: 'inner', role: 'inner', chord: c.symbol });
      }
    });
  }
  return dedupe(out);
}

export const TIERS = ['easy', 'medium', 'hard'];

// easy: melody only. medium: melody + bass on strong beats (or the first bass note of a measure
// without one). hard: everything.
export function tierNotes(score, notes, tier) {
  if (tier === 'easy') return notes.filter((n) => n.role === 'melody');
  if (tier === 'hard') return notes.slice();
  const strong = new Set(beatGrid(score).filter((b) => b.strong).map((b) => b.tick));
  const starts = measureStarts(score);
  const measureOf = (t) => { let k = 0; for (let i = 0; i < starts.length; i++) if (starts[i] <= t) k = i; return k; };
  const bass = notes.filter((n) => n.role === 'bass');
  const keep = new Set(bass.filter((n) => strong.has(n.tick)));
  const seen = new Set([...keep].map((n) => measureOf(n.tick)));
  for (const n of bass) {
    const m = measureOf(n.tick);
    if (!seen.has(m)) { keep.add(n); seen.add(m); }
  }
  return notes.filter((n) => n.role === 'melody' || keep.has(n));
}
