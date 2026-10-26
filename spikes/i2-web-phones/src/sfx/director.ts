// Performance sound effects: which cue to play when. Pure logic (unit-tested); sfx/synth.ts makes
// the sounds. Fed every judgement of a play-through plus the team's streak and multiplier.
//  - streak milestones (10, 25, 50, then every 50): sparkle/chime, bigger for bigger streaks;
//  - multiplier up: whoosh;
//  - a miss: a soft, friendly "boop" — at most one every few seconds, never a buzzer;
//  - a phrase with every note hit and nothing worse than Great: a short fanfare on its chord;
//  - the end of the song: applause, scaled by team accuracy (cheers for a great run).
// Celebrations are spaced out so they never pile up on top of the bells.

export type SfxKind = 'streak' | 'multiplier' | 'miss' | 'phrase' | 'applause';

export interface SfxCue {
  kind: SfxKind;
  /** streak: the milestone reached; multiplier: the new multiplier; phrase: its note count; applause: accuracy 0..1. */
  value: number;
  /** phrase: index of the phrase. */
  phrase?: number;
}

export interface SfxSettings {
  enabled: boolean;
  /** 0..1 (lobby slider / 100). */
  volume: number;
}

export const DEFAULT_SFX: SfxSettings = { enabled: true, volume: 0.5 };

export interface PhraseSpan {
  index: number;
  /** Song seconds. */
  start: number;
  end: number;
}

export interface DirectorOptions {
  /** Phrases (song seconds); a note belongs to the phrase its time falls in. */
  phrases: PhraseSpan[];
  /** Song time (s) of every note, indexed by note id. */
  noteTimes: ArrayLike<number>;
  milestones?: number[];
  /** Minimum ms between two misses that get a cue. */
  missCooldownMs?: number;
  /** Minimum ms between celebratory cues (multiplier after another celebration). */
  celebrateGapMs?: number;
  /** A phrase needs at least this many notes for a fanfare. */
  minPhraseNotes?: number;
}

export type Grade = 'perfect' | 'great' | 'good' | 'miss';

export function isMilestone(streak: number, milestones: number[]): boolean {
  return milestones.includes(streak) || (streak > milestones[milestones.length - 1] && streak % 50 === 0);
}

export class PerformanceDirector {
  readonly milestones: number[];
  private readonly phraseOfNote = new Map<number, number>();
  private readonly phraseTotal = new Map<number, number>();
  private readonly phraseJudged = new Map<number, number>();
  private readonly phraseClean = new Map<number, boolean>();
  private lastMiss = -Infinity;
  private lastCelebrate = -Infinity;
  private multiplier = 1;
  /** Every cue issued (for the results JSON and tests). */
  readonly log: (SfxCue & { atMs: number })[] = [];

  constructor(private readonly opts: DirectorOptions) {
    this.milestones = opts.milestones ?? [10, 25, 50];
    const ps = [...opts.phrases].sort((a, b) => a.start - b.start);
    const last = ps[ps.length - 1];
    for (let id = 0; id < opts.noteTimes.length; id++) {
      const t = opts.noteTimes[id];
      const p = ps.find((x) => t >= x.start - 1e-6 && t < x.end - 1e-6) ?? (last && t >= last.end - 1e-6 ? last : undefined);
      if (!p) continue;
      this.phraseOfNote.set(id, p.index);
      this.phraseTotal.set(p.index, (this.phraseTotal.get(p.index) ?? 0) + 1);
    }
  }

  /**
   * A judged note (hit or miss) or a stray ring (`grade` 'stray'). `streak`/`multiplier` are the
   * team's state after it; `nowMs` is wall-clock ms (performance.now()).
   */
  judge(noteId: number | undefined, grade: Grade | 'stray', streak: number, multiplier: number, nowMs: number): SfxCue[] {
    const out: SfxCue[] = [];
    const celebrate = (c: SfxCue, force = false): void => {
      if (!force && nowMs - this.lastCelebrate < (this.opts.celebrateGapMs ?? 700)) return;
      this.lastCelebrate = nowMs;
      out.push(c);
    };
    if (grade === 'stray') return out;
    if (grade === 'miss') {
      if (nowMs - this.lastMiss >= (this.opts.missCooldownMs ?? 3000)) {
        this.lastMiss = nowMs;
        out.push({ kind: 'miss', value: 0 });
      }
    } else if (isMilestone(streak, this.milestones)) celebrate({ kind: 'streak', value: streak }, true);
    else if (multiplier > this.multiplier) celebrate({ kind: 'multiplier', value: multiplier });
    this.multiplier = multiplier;

    if (noteId !== undefined) {
      const p = this.phraseOfNote.get(noteId);
      if (p !== undefined) {
        const judged = (this.phraseJudged.get(p) ?? 0) + 1;
        this.phraseJudged.set(p, judged);
        const clean = (this.phraseClean.get(p) ?? true) && (grade === 'perfect' || grade === 'great');
        this.phraseClean.set(p, clean);
        const total = this.phraseTotal.get(p) ?? 0;
        if (judged === total && clean && total >= (this.opts.minPhraseNotes ?? 4)) celebrate({ kind: 'phrase', value: total, phrase: p }, true);
      }
    }
    for (const c of out) this.log.push({ ...c, atMs: nowMs });
    return out;
  }

  /** End of the song: applause scaled by team accuracy (0..1). */
  finish(accuracy: number, nowMs: number): SfxCue {
    const c: SfxCue = { kind: 'applause', value: Math.max(0, Math.min(1, accuracy)) };
    this.log.push({ ...c, atMs: nowMs });
    return c;
  }

  counts(): Record<SfxKind, number> {
    const r: Record<SfxKind, number> = { streak: 0, multiplier: 0, miss: 0, phrase: 0, applause: 0 };
    for (const c of this.log) r[c.kind]++;
    return r;
  }
}

/** Applause for an accuracy: claps per second, length (s), cheers, level. Everyone gets applause. */
export function applauseShape(accuracy: number): { claps: number; seconds: number; cheer: boolean; gain: number } {
  const a = Math.max(0, Math.min(1, accuracy));
  return { claps: Math.round(12 + 48 * a), seconds: 2 + 2.5 * a, cheer: a >= 0.8, gain: 0.55 + 0.45 * a };
}
