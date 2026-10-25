import { describe, expect, it } from 'vitest';
import { applauseShape, isMilestone, PerformanceDirector } from '../src/sfx/director';

/** 3 phrases of 4 notes, one note per second. */
const phrases = [
  { index: 0, start: 0, end: 4 },
  { index: 1, start: 4, end: 8 },
  { index: 2, start: 8, end: 12 },
];
const noteTimes = Array.from({ length: 12 }, (_, i) => i);
const mk = (): PerformanceDirector => new PerformanceDirector({ phrases, noteTimes });

describe('performance SFX director', () => {
  it('streak milestones at 10, 25, 50, then every 50', () => {
    const ms = [10, 25, 50];
    expect([9, 10, 25, 49, 50, 100, 120, 150].map((s) => isMilestone(s, ms))).toEqual([false, true, true, false, true, true, false, true]);
    const d = new PerformanceDirector({ phrases: [], noteTimes: [] });
    const kinds: string[] = [];
    for (let s = 1; s <= 30; s++) kinds.push(...d.judge(undefined, 'perfect', s, 1, s * 1000).map((c) => `${c.kind}:${c.value}`));
    expect(kinds).toEqual(['streak:10', 'streak:25']);
  });

  it('a whoosh when the multiplier goes up, not when it resets', () => {
    const d = new PerformanceDirector({ phrases: [], noteTimes: [] });
    expect(d.judge(undefined, 'great', 8, 2, 0).map((c) => c.kind)).toEqual(['multiplier']);
    expect(d.judge(undefined, 'miss', 0, 1, 5000).map((c) => c.kind)).toEqual(['miss']);
    expect(d.judge(undefined, 'great', 8, 2, 9000).map((c) => c.kind)).toEqual(['multiplier']);
  });

  it('misses get a gentle cue at most once every 3 s; strays get none', () => {
    const d = mk();
    const at = (ms: number) => d.judge(undefined, 'miss', 0, 1, ms).length;
    expect([at(0), at(1000), at(2999), at(3000), at(3500)]).toEqual([1, 0, 0, 1, 0]);
    expect(d.judge(undefined, 'stray', 0, 1, 10_000)).toEqual([]);
  });

  it('a fanfare when every note of a phrase is Perfect or Great — not with a Good or a miss', () => {
    const d = mk();
    const out: string[] = [];
    const grades = ['perfect', 'great', 'perfect', 'perfect', 'perfect', 'good', 'perfect', 'perfect', 'perfect', 'miss', 'perfect', 'perfect'] as const;
    grades.forEach((g, id) => out.push(...d.judge(id, g, 0, 1, id * 1000).filter((c) => c.kind === 'phrase').map((c) => `${c.phrase}`)));
    expect(out).toEqual(['0']);
    expect(d.counts().phrase).toBe(1);
  });

  it('the fanfare fires once the phrase\'s last note is judged, whatever the order', () => {
    const d = mk();
    for (const id of [3, 1, 0]) expect(d.judge(id, 'perfect', 1, 1, id).filter((c) => c.kind === 'phrase')).toEqual([]);
    expect(d.judge(2, 'great', 4, 1, 10).map((c) => c.kind)).toContain('phrase');
  });

  it('applause for everyone, bigger and with cheers for a great run', () => {
    const d = mk();
    expect(d.finish(1.4, 0)).toEqual({ kind: 'applause', value: 1 });
    const low = applauseShape(0.3);
    const high = applauseShape(0.95);
    expect(low.claps).toBeGreaterThan(0);
    expect(high.claps).toBeGreaterThan(low.claps);
    expect(high.seconds).toBeGreaterThan(low.seconds);
    expect([low.cheer, high.cheer]).toEqual([false, true]);
  });
});
