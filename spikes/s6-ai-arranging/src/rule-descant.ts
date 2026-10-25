// Rule-based descant: one held chord tone per strong-beat segment, a 3rd–6th above the tune.
// Used as the offline mock "model" and as a non-AI baseline in the descant metrics.
import { chordAt, beats } from './theory.ts';
import type { Chord, Note, Score } from './abc-io.ts';

export function ruleDescant(score: Score, melody: Note[], chords: Chord[], low: number, high: number): Note[] {
  const strong = beats(score).filter((b) => b.strong).map((b) => b.tick);
  const bounds = [...new Set([0, ...strong])].filter((t) => t < score.endTick).sort((a, b) => a - b);
  const out: Note[] = [];
  let prev: number | null = null;
  bounds.forEach((t, i) => {
    const end = i + 1 < bounds.length ? bounds[i + 1] : score.endTick;
    const c = chordAt(chords, t);
    const m = melody.find((n) => n.tick <= t && n.tick + n.dur > t) ?? melody.find((n) => n.tick >= t && n.tick < end);
    if (!c || !m) return;
    const cands: number[] = [];
    for (let p = low; p <= high; p++) if (c.tones.includes(p % 12) && p - m.midi >= 3 && p - m.midi <= 9) cands.push(p);
    if (!cands.length) return;
    const target = prev ?? m.midi + 7;
    cands.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    prev = cands[0];
    out.push({ tick: t, dur: end - t, midi: cands[0], vel: 75, voice: '2' });
  });
  return out;
}
