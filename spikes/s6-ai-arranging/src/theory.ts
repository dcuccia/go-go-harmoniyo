// Music-theory checks and metrics for LLM/AMT output, on top of the S5 score model:
// key and diatonic fit, bar completeness, range, chord-tone consonance, vertical intervals and
// parallels against the melody, chord agreement on the beat grid, and handbell playability
// (S5 assign/repair via buildPart).
// @ts-ignore -- S5 JS modules
import { beatGrid, makeTimeMap, parseChordSymbol, pitchName } from '../../s5-chart-pipeline/src/score.mjs';
// @ts-ignore
import { buildPart, fitHandbellSet, formSong } from '../../s5-chart-pipeline/src/chart.mjs';
import { tonicPc, type Chord, type Note, type Score } from './abc-io.ts';

export { beatGrid, makeTimeMap, parseChordSymbol, pitchName };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function scalePcs(score: Pick<Score, 'meta'>): Set<number> {
  const t = tonicPc(score);
  const steps = score.meta.mode === 'minor' ? [...NAT_MINOR, 11] : MAJOR; // harmonic-minor leading tone allowed
  return new Set(steps.map((s) => (t + s) % 12));
}

export const pcName = (pc: number) => PC_NAMES[((pc % 12) + 12) % 12];

/** Chord sounding at `tick` (last chord starting at or before it). */
export function chordAt(chords: Chord[], tick: number): Chord | null {
  let c: Chord | null = null;
  for (const x of chords) if (x.tick <= tick) c = x;
  return c;
}

export interface Beat { tick: number; strong: boolean; downbeat: boolean; measure: number; beat: number }
export const beats = (score: Score): Beat[] => beatGrid(score);

/**
 * Chord-tone consonance of `notes` against `chords`, duration-weighted: all notes, and notes
 * that start on a strong beat (where non-chord tones are least acceptable).
 */
export function chordToneFit(score: Score, notes: Note[], chords: Chord[]): { all: number; strong: number; onsets: number } {
  const strong = new Set(beats(score).filter((b) => b.strong).map((b) => b.tick));
  let tot = 0, hit = 0, sTot = 0, sHit = 0, oTot = 0, oHit = 0;
  for (const n of notes) {
    const c = chordAt(chords, n.tick);
    const ok = !!c && c.tones.includes(n.midi % 12);
    tot += n.dur;
    if (ok) hit += n.dur;
    oTot++;
    if (ok) oHit++;
    if (strong.has(n.tick)) {
      sTot += n.dur;
      if (ok) sHit += n.dur;
    }
  }
  return { all: tot ? r3(hit / tot) : 0, strong: sTot ? r3(sHit / sTot) : 0, onsets: oTot ? r3(oHit / oTot) : 0 };
}

/** Fraction of note time on pitch classes outside the key's scale. */
export function nonDiatonic(score: Score, notes: Note[]): number {
  const sc = scalePcs(score);
  const tot = notes.reduce((s, n) => s + n.dur, 0);
  const off = notes.filter((n) => !sc.has(n.midi % 12)).reduce((s, n) => s + n.dur, 0);
  return tot ? r3(off / tot) : 0;
}

/** Chord symbols outside the key (root not in scale, or quality not diatonic for that degree). */
export function chordDiatonic(score: Score, chords: Chord[]): number {
  const sc = scalePcs(score);
  if (!chords.length) return 0;
  const ok = chords.filter((c) => c.tones.every((t) => sc.has(t)) || isSecondaryDominant(score, c)).length;
  return r3(ok / chords.length);
}

function isSecondaryDominant(score: Score, c: Chord): boolean {
  // V/x: a major triad or dominant 7th whose root is a 5th above a scale degree.
  const sc = scalePcs(score);
  const major = c.tones.includes((c.root + 4) % 12) && c.tones.includes((c.root + 7) % 12);
  return major && sc.has((c.root + 5) % 12);
}

/**
 * Descant vs melody at every onset of either voice: dissonant interval classes (2nds, 7ths,
 * tritone; the descant is the upper voice so a 4th counts as consonant here), voice crossings,
 * and parallel perfect 5ths/octaves between consecutive simultaneous onsets.
 */
export function verticals(melody: Note[], upper: Note[]): { onsets: number; dissonant: number; crossings: number; parallels: number; aboveRatio: number; similar: number } {
  const sounding = (ns: Note[], t: number) => ns.find((n) => n.tick <= t && n.tick + n.dur > t);
  const ticks = [...new Set([...melody, ...upper].map((n) => n.tick))].sort((a, b) => a - b);
  let onsets = 0, dissonant = 0, crossings = 0, parallels = 0, above = 0, moves = 0, similar = 0;
  let prev: { m: number; u: number } | null = null;
  for (const t of ticks) {
    const m = sounding(melody, t);
    const u = sounding(upper, t);
    if (!m || !u) {
      prev = null;
      continue;
    }
    onsets++;
    const ic = (((u.midi - m.midi) % 12) + 12) % 12;
    if ([1, 2, 6, 10, 11].includes(ic)) dissonant++;
    if (u.midi < m.midi) crossings++;
    if (u.midi > m.midi) above++;
    if (prev && prev.m !== m.midi && prev.u !== u.midi) {
      moves++;
      if (Math.sign(m.midi - prev.m) === Math.sign(u.midi - prev.u)) similar++;
    }
    if (prev && (prev.m !== m.midi || prev.u !== u.midi)) {
      const pic = (((prev.u - prev.m) % 12) + 12) % 12;
      if ((pic === 7 && ic === 7) || (pic === 0 && ic === 0)) if (Math.sign(u.midi - prev.u) === Math.sign(m.midi - prev.m) && u.midi !== prev.u) parallels++;
    }
    prev = { m: m.midi, u: u.midi };
  }
  return { onsets, dissonant: onsets ? r3(dissonant / onsets) : 0, crossings, parallels, aboveRatio: onsets ? r3(above / onsets) : 0, similar: moves ? r3(similar / moves) : 0 };
}

/** Per-beat agreement of `a` with reference `b` (beats where `b` has a chord): same root, and same root + tones. */
export function chordAgreement(score: Score, a: Chord[], b: Chord[]): { root: number; exact: number; beats: number } {
  const bs = beats(score).filter((bt) => chordAt(b, bt.tick));
  let root = 0, exact = 0;
  for (const bt of bs) {
    const x = chordAt(a, bt.tick);
    const y = chordAt(b, bt.tick);
    if (!x || !y) continue;
    if (x.root === y.root) root++;
    if (x.root === y.root && [...x.tones].sort().join() === [...y.tones].sort().join()) exact++;
  }
  return { root: bs.length ? r3(root / bs.length) : 0, exact: bs.length ? r3(exact / bs.length) : 0, beats: bs.length };
}

export function range(notes: Note[]): { low: number; high: number; lowName: string; highName: string } {
  const low = Math.min(...notes.map((n) => n.midi));
  const high = Math.max(...notes.map((n) => n.midi));
  return { low, high, lowName: pitchName(low), highName: pitchName(high) };
}

/** Handbell playability of an arrangement (S5 buildPart: assignment + repair, profile handbell). */
export function playability(score: Score, roleNotes: Note[], tier = 'hard', ringers = 4, profile = 'handbell') {
  // S5 0.3 (#65): parts are built from a formed song; 'short' = the song once, as before.
  const part = buildPart(formSong(score, roleNotes, 'short'), tier, ringers, profile);
  const set = fitHandbellSet([...new Set(roleNotes.map((n) => n.midi))]);
  return {
    strikes: part.metrics.strikes as number,
    distinctBells: part.metrics.distinctBells as number,
    maxBellsPerRinger: part.metrics.maxBellsPerRinger as number,
    dropped: part.metrics.droppedForPlayability.total as number,
    violations: part.metrics.remainingViolations as number,
    loadBalance: part.metrics.loadBalance as number | null,
    handbellSet: set.set as string | null,
    transpose: set.transposeSemitones as number,
  };
}

/** Parse a list of chord symbols; returns the unparseable ones. */
export function badSymbols(symbols: string[]): string[] {
  return symbols.filter((s) => !parseChordSymbol(String(s)));
}

/** Final chord is the tonic triad (major or minor per key). */
export function endsOnTonic(score: Score, chords: Chord[]): boolean {
  const last = chords[chords.length - 1];
  return !!last && last.root === tonicPc(score);
}
