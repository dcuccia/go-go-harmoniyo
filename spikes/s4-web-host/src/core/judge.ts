// Timing judgement + scoring. Pure logic on song-time seconds; no clocks, DOM, or rendering.
import type { ChartNote } from './chart';

export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export type HitGrade = Exclude<Grade, 'miss'>;

/** Half-widths (± seconds) of each timing window. */
export interface TimingWindows {
  perfect: number;
  great: number;
  good: number;
}

export const DEFAULT_WINDOWS: TimingWindows = { perfect: 0.045, great: 0.09, good: 0.14 };
export const GRADE_POINTS: Record<HitGrade, number> = { perfect: 100, great: 70, good: 40 };

export interface Judgement {
  noteId: number;
  lane: number;
  grade: Grade;
  /** Seconds; positive = late. */
  offset: number;
  time: number;
}

export interface StrayRing {
  lane: number;
  time: number;
}

export function isJudgement(r: Judgement | StrayRing): r is Judgement {
  return 'grade' in r;
}

export interface ScoreState {
  score: number;
  streak: number;
  maxStreak: number;
  multiplier: number;
  counts: Record<Grade, number>;
  strays: number;
  judged: number;
  total: number;
}

export class Judge {
  streakPerMultiplier = 8;
  maxMultiplier = 4;
  strayBreaksStreak = false;
  readonly state: ScoreState;
  private readonly byLane: ChartNote[][];
  private readonly cursor: number[];
  private readonly done: Uint8Array;

  constructor(notes: readonly ChartNote[], laneCount: number, readonly windows: TimingWindows = DEFAULT_WINDOWS) {
    this.byLane = Array.from({ length: laneCount }, () => [] as ChartNote[]);
    for (const n of notes) this.byLane[n.lane]?.push(n);
    for (const l of this.byLane) l.sort((a, b) => a.time - b.time);
    this.cursor = new Array<number>(laneCount).fill(0);
    let maxId = -1;
    for (const n of notes) maxId = Math.max(maxId, n.id);
    this.done = new Uint8Array(maxId + 1);
    this.state = {
      score: 0,
      streak: 0,
      maxStreak: 0,
      multiplier: 1,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      strays: 0,
      judged: 0,
      total: notes.length,
    };
  }

  /** Judge a ring on `lane` at song time `t` (s). Picks the closest unjudged note within the good window. */
  ring(lane: number, t: number): Judgement | StrayRing {
    const list = this.byLane[lane];
    if (!list) return { lane, time: t };
    const w = this.windows.good;
    let best: ChartNote | undefined;
    let bestAbs = Infinity;
    for (let i = this.cursor[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.time > t + w) break;
      if (this.done[n.id]) continue;
      const d = Math.abs(t - n.time);
      if (d <= w && d < bestAbs) {
        best = n;
        bestAbs = d;
      }
    }
    if (!best) {
      this.state.strays++;
      if (this.strayBreaksStreak) this.breakStreak();
      return { lane, time: t };
    }
    const offset = t - best.time;
    const grade: HitGrade = bestAbs <= this.windows.perfect ? 'perfect' : bestAbs <= this.windows.great ? 'great' : 'good';
    this.done[best.id] = 1;
    this.advance(lane);
    this.apply(grade);
    return { noteId: best.id, lane, grade, offset, time: t };
  }

  /** Marks notes that can no longer be hit at song time `t` as misses. */
  sweep(t: number): Judgement[] {
    const out: Judgement[] = [];
    for (let lane = 0; lane < this.byLane.length; lane++) {
      const list = this.byLane[lane];
      for (let i = this.cursor[lane]; i < list.length; i++) {
        const n = list[i];
        if (n.time >= t - this.windows.good) break;
        if (this.done[n.id]) continue;
        this.done[n.id] = 1;
        this.apply('miss');
        out.push({ noteId: n.id, lane, grade: 'miss', offset: t - n.time, time: t });
      }
      this.advance(lane);
    }
    return out;
  }

  accuracy(): number {
    const c = this.state.counts;
    return this.state.total ? (c.perfect + 0.7 * c.great + 0.4 * c.good) / this.state.total : 0;
  }

  /** Accuracy over notes judged so far. */
  accuracySoFar(): number {
    const c = this.state.counts;
    return this.state.judged ? (c.perfect + 0.7 * c.great + 0.4 * c.good) / this.state.judged : 0;
  }

  get finished(): boolean {
    return this.state.judged >= this.state.total;
  }

  private advance(lane: number): void {
    const list = this.byLane[lane];
    while (this.cursor[lane] < list.length && this.done[list[this.cursor[lane]].id]) this.cursor[lane]++;
  }

  private apply(grade: Grade): void {
    const s = this.state;
    s.counts[grade]++;
    s.judged++;
    if (grade === 'miss') return this.breakStreak();
    s.streak++;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.multiplier = Math.min(this.maxMultiplier, 1 + Math.floor(s.streak / this.streakPerMultiplier));
    s.score += GRADE_POINTS[grade] * s.multiplier;
  }

  private breakStreak(): void {
    this.state.streak = 0;
    this.state.multiplier = 1;
  }
}
