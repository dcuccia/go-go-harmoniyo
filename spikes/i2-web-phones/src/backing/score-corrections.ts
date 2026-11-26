import type { Chord, HarmonyChart, S5Beat, S5Harmony } from './timeline';

type Harmony = Pick<Chord, 'symbol' | 'root' | 'bass' | 'tones'>;
const pc = (n: number): number => ((n % 12) + 12) % 12;
const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

function harmony(root: number, bass: number, intervals: number[], quality: string, shift: number): Harmony {
  const r = pc(root + shift);
  const b = pc(bass + shift);
  return { symbol: `${names[r]}${quality}${b === r ? '' : `/${names[b]}`}`, root: r, bass: b, tones: intervals.map((i) => pc(r + i)) };
}

// Hutchins #415 (Mutopia #905, in sources/mutopia/GoodKingWenceslas.ly), mm. 1–3 and 5–7.
// The two phrases have the same pitch classes; only these beats contradict the chart's inference.
const WENCESLAS = [
  { bar: 0, beat: 3, from: 6, fromThird: 3, root: 4, bass: 8, tones: [0, 4, 7], quality: '' },
  { bar: 1, beat: 1, from: 9, fromThird: 4, root: 2, bass: 2, tones: [0, 4, 7], quality: '' },
  { bar: 2, beat: 1, from: 2, fromThird: 4, root: 9, bass: 1, tones: [0, 4, 7], quality: '' },
  { bar: 2, beat: 3, from: 2, fromThird: 4, root: 4, bass: 11, tones: [4, 7, 10], quality: '7' },
];

type Edit = { start: number; end: number; chord: Harmony };

/**
 * Overlay only reviewed beat spans on the backing timeline. S5's timing, harmony, and parts
 * remain unchanged; its generated and guide bells may still reflect the original chord data.
 */
export function scoreCorrections(
  chart: HarmonyChart, h: S5Harmony, original: Chord[],
): { chords: Chord[]; forBeat: (b: S5Beat) => Chord | null } | undefined {
  const id = chart.song?.id;
  const wenceslas = id === 'good-king-wenceslas' && h.source === 'inferred';
  const holly = id === 'the-holly-and-the-ivy' && h.source === 'lead-sheet';
  if ((!wenceslas && !holly) || !chart.form) return;
  const edits = new Map<number, Edit[]>();
  const firstBar = new Map<number, number>();
  for (const [i, b] of h.beats.entries()) {
    if (b.section === undefined || b.chord == null) continue;
    const section = chart.form.sections[b.section];
    if (!section || section.transpose === undefined) continue;
    const shift = section.transpose;
    const c = original[b.chord];
    if (!c) continue;
    let change: Harmony | undefined;
    if (wenceslas && section.kind === 'verse') {
      if (!firstBar.has(b.section)) firstBar.set(b.section, b.bar);
      const bar = b.bar - firstBar.get(b.section)!;
      const edit = WENCESLAS.find((e) => e.beat === b.beat && (e.bar === bar || e.bar + 4 === bar));
      if (edit && c.root === pc(edit.from + shift) && c.bass === c.root && c.tones.includes(pc(c.root + edit.fromThird))) {
        change = harmony(edit.root, edit.bass, edit.tones, edit.quality, shift);
      }
    } else if (holly && ['intro', 'verse', 'coda'].includes(section.kind ?? '')) {
      // The ABC's m. 4/12 beat 3 has E in the bass under G and Bb. Its other C7
      // (after F/C, mm. 7/15) really is root-position. The previous chord distinguishes them.
      const prev = h.beats[i - 1]?.chord;
      const prior = prev != null ? original[prev] : undefined;
      if (b.beat === 2 && b.time === c.time && c.root === pc(shift) && c.bass === c.root &&
          c.tones.includes(pc(c.root + 10)) && prior?.root === c.root && prior.tones.length === 3) {
        change = harmony(0, 4, [0, 4, 7, 10], '7', shift);
      }
    }
    if (!change) continue;
    const start = Math.max(b.time, c.time);
    const end = Math.min(h.beats[i + 1]?.time ?? c.end, c.end);
    if (end > start) {
      const spans = edits.get(b.chord) ?? [];
      spans.push({ start, end, chord: change });
      edits.set(b.chord, spans);
    }
  }
  if (!edits.size) return;

  const split = original.map((c, i) => {
    const spans = edits.get(i);
    if (!spans) return [c];
    const out: Chord[] = [];
    let time = c.time;
    for (const e of spans) {
      if (time < e.start) out.push({ ...c, time, end: e.start });
      out.push({ ...e.chord, time: e.start, end: e.end });
      time = e.end;
    }
    if (time < c.end) out.push({ ...c, time, end: c.end });
    return out;
  });
  return {
    chords: split.flat(),
    forBeat: (b) => b.chord == null ? null : split[b.chord]?.find((c) => b.time < c.end - 1e-8) ?? split[b.chord]?.at(-1) ?? null,
  };
}
