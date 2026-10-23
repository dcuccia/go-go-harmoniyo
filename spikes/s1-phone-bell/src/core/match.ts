export interface MatchPair {
  refIndex: number;
  evIndex: number;
  ref: number;
  ev: number;
  /** ev - ref */
  diff: number;
}

export interface MatchResult {
  pairs: MatchPair[];
  /** Indices of reference times with no event within the window. */
  missed: number[];
  /** Indices of events not matched to any reference. */
  extra: number[];
}

/**
 * One-to-one matching of events to reference times, closest pairs first, within ±windowMs.
 * Used for metronome scoring (refs = beats) and clink pairing (refs = phone A, events = phone B).
 */
export function matchNearest(refs: readonly number[], events: readonly number[], windowMs: number): MatchResult {
  const ev = events.map((t, j) => ({ t, j })).sort((a, b) => a.t - b.t);
  const cands: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t < r - windowMs) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < ev.length && ev[k].t <= r + windowMs; k++) {
      cands.push({ i, j: ev[k].j, d: ev[k].t - r });
    }
  }
  cands.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const usedR = new Set<number>();
  const usedE = new Set<number>();
  const pairs: MatchPair[] = [];
  for (const c of cands) {
    if (usedR.has(c.i) || usedE.has(c.j)) continue;
    usedR.add(c.i);
    usedE.add(c.j);
    pairs.push({ refIndex: c.i, evIndex: c.j, ref: refs[c.i], ev: events[c.j], diff: c.d });
  }
  pairs.sort((a, b) => a.refIndex - b.refIndex);
  const missed: number[] = [];
  for (let i = 0; i < refs.length; i++) if (!usedR.has(i)) missed.push(i);
  const extra: number[] = [];
  for (let j = 0; j < events.length; j++) if (!usedE.has(j)) extra.push(j);
  return { pairs, missed, extra };
}
