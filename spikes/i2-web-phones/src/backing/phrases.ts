// Phrase structure of a song for the backing (fills, variations, flourishes) and for performance
// SFX (perfect-phrase fanfare). Pure logic on the chord/beat timeline; carols are built from
// 4-bar phrases, so a phrase is 4 bars counted from the first harmonised bar (the last one may be
// shorter). If the chart ever carries explicit sections (song form), map them here.
import type { Beat, Timeline } from './timeline';

export interface Phrase {
  index: number;
  firstBar: number;
  lastBar: number;
  /** Song seconds: first beat of the phrase → first beat of the next phrase (or song end). */
  start: number;
  end: number;
  /** The song's last phrase (holds the final bar). */
  final: boolean;
}

export const BARS_PER_PHRASE = 4;

export function phrases(tl: Timeline, barsPerPhrase = BARS_PER_PHRASE): Phrase[] {
  const first = tl.beats.find((b) => b.chord);
  if (!first) return [];
  const bars = [...new Set(tl.beats.filter((b) => b.bar >= first.bar).map((b) => b.bar))].sort((a, b) => a - b);
  const startOf = (bar: number): number => tl.beats.find((b) => b.bar === bar)?.time ?? tl.end;
  const out: Phrase[] = [];
  for (let i = 0; i < bars.length; i += barsPerPhrase) {
    const group = bars.slice(i, i + barsPerPhrase);
    const next = bars[i + barsPerPhrase];
    out.push({
      index: out.length,
      firstBar: group[0],
      lastBar: group[group.length - 1],
      start: i === 0 ? first.time : startOf(group[0]),
      end: next !== undefined ? startOf(next) : tl.end,
      final: next === undefined,
    });
  }
  // A one-bar final phrase (e.g. 17 bars) is an ending, not a phrase: fold it into the previous one.
  if (out.length > 1 && out[out.length - 1].firstBar === out[out.length - 1].lastBar) {
    const last = out.pop()!;
    const prev = out[out.length - 1];
    out[out.length - 1] = { ...prev, lastBar: last.lastBar, end: last.end, final: true };
  }
  return out;
}

/** Phrase lookup by bar number. */
export function phraseIndexer(ps: Phrase[]): (bar: number) => Phrase | undefined {
  const byBar = new Map<number, Phrase>();
  for (const p of ps) for (let b = p.firstBar; b <= p.lastBar; b++) byBar.set(b, p);
  return (bar) => byBar.get(bar);
}

/** The phrase that contains song time `t` (seconds). */
export function phraseAt(ps: Phrase[], t: number): Phrase | undefined {
  return ps.find((p) => t >= p.start - 1e-6 && t < p.end - 1e-6) ?? (t >= (ps[ps.length - 1]?.end ?? Infinity) ? ps[ps.length - 1] : undefined);
}

/** The beat that sounds at song time `t`. */
export function beatAt(tl: Timeline, t: number): Beat | undefined {
  let lo = 0;
  let hi = tl.beats.length - 1;
  if (hi < 0 || t < tl.beats[0].time) return tl.beats[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.beats[mid].time <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return tl.beats[lo];
}
