// S5 chart `harmony` block (format 0.2) → a timed chord/beat timeline, plus count-in clicks.
// Pure logic: no DOM or audio. Times are song seconds (0 = first note of the chart), the same
// timeline the judge and the highways use.

/** Chord symbol as written by the S5 pipeline (pitch classes, 0 = C). */
export interface S5Chord {
  tick: number;
  time: number;
  dur: number;
  durSec?: number;
  symbol: string;
  root: number;
  bass?: number;
  tones: number[];
}
export interface S5Beat {
  tick: number;
  time: number;
  bar: number;
  beat: number;
  div?: number;
  strong?: boolean;
  chord: number | null;
  /** Format 0.3+: index into the chart's form sections. */
  section?: number;
}
export interface S5Harmony {
  source: 'lead-sheet' | 'inferred';
  style?: string;
  chords: S5Chord[];
  beats: S5Beat[];
}
/** The parts of an S5 chart the backing reads (structurally compatible with team-chart's S5Chart). */
export interface HarmonyChart {
  timing: { tempos: { time: number; bpm: number }[]; timeSignatures: { numerator: number; denominator: number }[]; durationSec: number };
  harmony?: S5Harmony;
  /** Format 0.3+: song form; each section's energy (0..1) shapes the groove. */
  form?: { sections: { energy?: number; label?: string; time?: number; durSec?: number }[] };
}

export interface Chord {
  time: number;
  end: number;
  symbol: string;
  root: number;
  bass: number;
  tones: number[];
}
export interface Beat {
  time: number;
  /** Seconds to the next beat (follows tempo changes). */
  dur: number;
  bar: number;
  /** Position in the bar, 0 = downbeat. */
  beat: number;
  beatsPerBar: number;
  /** Subdivisions per beat: 2 simple meters, 3 compound. */
  div: number;
  strong: boolean;
  chord: Chord | null;
  /** Groove intensity from the song form (intro and quiet verses lighter), 0..1; 1 without a form. */
  energy: number;
}
export interface Timeline {
  style: string | undefined;
  source: S5Harmony['source'];
  chords: Chord[];
  beats: Beat[];
  /** Song end, seconds. */
  end: number;
}

/** Null when the chart has no harmony block (pre-0.2 charts): no backing, the song still plays. */
export function backingTimeline(c: HarmonyChart): Timeline | null {
  const h = c.harmony;
  if (!h || !h.chords?.length || !h.beats?.length) return null;
  const end = Math.max(c.timing.durationSec, ...h.chords.map((x) => x.time + (x.durSec ?? 0)));
  const chords: Chord[] = h.chords.map((x, i) => ({
    time: x.time,
    end: x.durSec !== undefined ? x.time + x.durSec : (h.chords[i + 1]?.time ?? end),
    symbol: x.symbol,
    root: x.root,
    bass: x.bass ?? x.root,
    tones: x.tones,
  }));
  const perBar = new Map<number, number>();
  for (const b of h.beats) perBar.set(b.bar, Math.max(perBar.get(b.bar) ?? 0, b.beat + 1));
  const beats: Beat[] = h.beats.map((b, i) => {
    const next = h.beats[i + 1]?.time;
    const prevDur = i > 0 ? b.time - h.beats[i - 1].time : 0.5;
    return {
      time: b.time,
      dur: next !== undefined ? next - b.time : Math.max(0.05, Math.min(prevDur, end - b.time) || prevDur),
      bar: b.bar,
      beat: b.beat,
      beatsPerBar: perBar.get(b.bar) ?? 4,
      div: b.div ?? 2,
      strong: b.strong ?? b.beat === 0,
      chord: b.chord === null || b.chord === undefined ? null : (chords[b.chord] ?? null),
      energy: Math.max(0, Math.min(1, (b.section !== undefined ? c.form?.sections[b.section]?.energy : undefined) ?? 1)),
    };
  });
  return { style: h.style, source: h.source, chords, beats, end };
}

export interface Click {
  time: number;
  accent: boolean;
}

/**
 * Count-in clicks before song time 0, on the song's own beat grid: they start on a downbeat and
 * stop before the first note, so a pickup comes in on its beat ("1 2 3 1 2 | pickup").
 * At least `minClicks` clicks (two bars in 2-beat meters). Charts without harmony fall back to
 * the first tempo and time signature.
 */
export function countIn(c: HarmonyChart, minClicks = 3): Click[] {
  const tl = backingTimeline(c);
  let t0 = 0;
  let pos0 = 0;
  let dur: number;
  let bpb: number;
  if (tl) {
    const b = tl.beats[0];
    t0 = b.time;
    pos0 = b.beat;
    dur = b.dur;
    bpb = b.beatsPerBar;
  } else {
    const ts = c.timing.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
    const compound = ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
    const quarter = 60 / (c.timing.tempos[0]?.bpm ?? 100);
    dur = compound ? quarter * 1.5 : (quarter * 4) / ts.denominator;
    bpb = compound ? ts.numerator / 3 : ts.numerator;
  }
  const posOf = (k: number): number => (((pos0 - k) % bpb) + bpb) % bpb;
  const before = (k: number): boolean => t0 - k * dur < -0.02;
  let kMax = 1;
  for (let k = 1; k < 4 * bpb + 8; k++) {
    if (posOf(k) !== 0 || !before(k)) continue;
    kMax = k;
    let n = 0;
    for (let j = 1; j <= k; j++) if (before(j)) n++;
    if (n >= minClicks) break;
  }
  const out: Click[] = [];
  for (let k = kMax; k >= 1; k--) if (before(k)) out.push({ time: t0 - k * dur, accent: posOf(k) === 0 });
  return out;
}
