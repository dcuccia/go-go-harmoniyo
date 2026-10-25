import { describe, expect, it } from 'vitest';
import { Judge } from '../../s4-web-host/src/core/judge';
import { backingTimeline, countIn } from '../src/backing/timeline';
import { generateBacking } from '../src/backing/patterns';
import { clampSpeed, DEFAULT_SPEED, parseSpeedPercent, scaleChart, scaledScroll, SPEED_MIN, speedNote, speedPercent } from '../src/speed';
import { buildTeamChart, findPart, type S5Chart } from '../src/team-chart';

/** 4/4 at 120 bpm (0.5 s beats), one ringer, two bars of C | G with a harmony block. */
function fixture(): S5Chart {
  const bells = [
    { id: 'C4', midi: 60 },
    { id: 'E4', midi: 64 },
    { id: 'G4', midi: 67 },
  ];
  const seq = ['C4', 'E4', 'G4', 'E4', 'C4', 'G4', 'E4', 'C4'];
  const notes = seq.map((bell, i) => ({ tick: i * 480, time: i * 0.5, durSec: 0.5, bell, ringer: 0, role: 'melody' as const }));
  const beats = Array.from({ length: 8 }, (_, i) => ({ tick: i * 480, time: i * 0.5, bar: 1 + (i >> 2), beat: i % 4, div: 2, strong: i % 4 === 0, chord: i >> 2 }));
  return {
    format: 'go-go-harmoniyo.chart',
    formatVersion: '0.2.0',
    song: { id: 'fixture', title: 'Fixture', license: { id: 'CC0-1.0' } },
    timing: { tempos: [{ tick: 0, time: 0, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }], durationSec: 4 },
    bells,
    harmony: {
      source: 'lead-sheet',
      style: 'sleigh-ride',
      chords: [
        { tick: 0, time: 0, dur: 4, durSec: 2, symbol: 'C', root: 0, tones: [0, 4, 7] },
        { tick: 1920, time: 2, dur: 4, durSec: 2, symbol: 'G', root: 7, tones: [7, 11, 2] },
      ],
      beats,
    },
    parts: [{ difficulty: 'easy', ringerCount: 1, ringers: [{ index: 0, bells: ['C4', 'E4', 'G4'] }], notes }],
  };
}

describe('practice speed: settings', () => {
  it('snaps to 5 % steps between 50 % and 100 %', () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(0.5)).toBe(0.5);
    expect(clampSpeed(0.74)).toBe(0.75);
    expect(clampSpeed(0.726)).toBe(0.75);
    expect(clampSpeed(0.72)).toBe(0.7);
    expect(clampSpeed(0.2)).toBe(SPEED_MIN);
    expect(clampSpeed(1.5)).toBe(1);
    expect(clampSpeed(NaN)).toBe(DEFAULT_SPEED);
    // Every step is a clean two-decimal fraction (no 0.6500000001 in labels or storage).
    for (let p = 50; p <= 100; p += 5) expect(clampSpeed(p / 100)).toBe(p / 100);
  });

  it('reads percentages from the URL / storage and labels only slowed-down play', () => {
    expect(parseSpeedPercent('50')).toBe(0.5);
    expect(parseSpeedPercent('85 %')).toBe(0.85);
    expect(parseSpeedPercent('30')).toBe(0.5);
    expect(parseSpeedPercent(null)).toBeUndefined();
    expect(parseSpeedPercent('fast')).toBeUndefined();
    expect(speedPercent(0.65)).toBe(65);
    expect(speedNote(0.65)).toBe('65% speed');
    expect(speedNote(1)).toBe('');
  });
});

describe('practice speed: chart scaling', () => {
  it('stretches every song time and duration by 1/speed and slows the tempo map', () => {
    const c = fixture();
    const s = scaleChart(c, 0.5);
    expect(s.parts[0].notes.map((n) => n.time)).toEqual(c.parts[0].notes.map((n) => n.time * 2));
    expect(s.parts[0].notes.every((n) => n.durSec === 1)).toBe(true);
    expect(s.timing.tempos[0]).toEqual({ tick: 0, time: 0, bpm: 60 });
    expect(s.timing.durationSec).toBe(8);
    expect(s.harmony!.chords.map((x) => [x.time, x.durSec, x.dur])).toEqual([
      [0, 4, 4],
      [4, 4, 4],
    ]);
    expect(s.harmony!.beats.map((b) => b.time)).toEqual(c.harmony!.beats.map((b) => b.time * 2));
    // Musical positions, pitches and metadata are untouched.
    expect(s.parts[0].notes.map((n) => [n.tick, n.bell, n.ringer])).toEqual(c.parts[0].notes.map((n) => [n.tick, n.bell, n.ringer]));
    expect(s.harmony!.chords[1].tones).toEqual([7, 11, 2]);
    expect(s.harmony!.beats.map((b) => [b.bar, b.beat, b.chord])).toEqual(c.harmony!.beats.map((b) => [b.bar, b.beat, b.chord]));
    expect(s.timing.timeSignatures).toEqual(c.timing.timeSignatures);
    expect(s.bells).toEqual(c.bells);
    expect(s.song).toEqual(c.song);
  });

  it('is the identity at full speed and never mutates the source chart', () => {
    const c = fixture();
    const before = JSON.stringify(c);
    expect(scaleChart(c, 1)).toBe(c);
    const s = scaleChart(c, 0.75);
    expect(JSON.stringify(c)).toBe(before);
    expect(s).not.toBe(c);
    expect(s.parts[0].notes[1].time).toBeCloseTo(0.5 / 0.75, 12);
  });

  it('keeps the judging windows in real time: the same ring offset gets the same grade at any speed', () => {
    for (const speed of [1, 0.75, 0.5]) {
      const c = scaleChart(fixture(), speed);
      const t = buildTeamChart(c, findPart(c, 'easy', 1)!);
      expect(t.chart.notes[3].time).toBeCloseTo(1.5 / speed, 9);
      expect(t.chart.bpm).toBeCloseTo(120 * speed, 9);
      const j = new Judge(t.chart.notes, t.chart.lanes.length);
      const n = t.chart.notes;
      // Real-time offsets: +30 ms perfect, −70 ms great, +120 ms good, +200 ms stray (outside ±140 ms).
      const grade = (i: number, off: number) => {
        const r = j.ring(n[i].lane, n[i].time + off);
        return 'grade' in r ? r.grade : 'stray';
      };
      expect([grade(0, 0.03), grade(1, -0.07), grade(2, 0.12), grade(3, 0.2)]).toEqual(['perfect', 'great', 'good', 'stray']);
      // A note is a miss once the good window has passed, 140 ms after it in real time.
      expect(j.sweep(n[4].time + 0.139).length).toBe(1); // note 3 (unhit) only
      expect(j.sweep(n[4].time + 0.141).map((m) => m.noteId)).toEqual([4]);
    }
  });

  it('slows the backing groove and the count-in with the song (same beat grid as the notes)', () => {
    const full = fixture();
    const half = scaleChart(full, 0.5);
    const tl = backingTimeline(half)!;
    expect(tl.beats.every((b) => b.dur === 1)).toBe(true);
    expect(tl.end).toBe(8);
    const clicksFull = countIn(full);
    const clicksHalf = countIn(half);
    expect(clicksHalf.length).toBe(clicksFull.length);
    expect(clicksHalf.map((k) => k.time)).toEqual(clicksFull.map((k) => k.time * 2));
    expect(clicksHalf.map((k) => k.accent)).toEqual(clicksFull.map((k) => k.accent));
    expect(clicksHalf.at(-1)!.time).toBe(-1); // last click one (slow) beat before the first note
    // The generated groove is the same pattern, on the stretched grid.
    const evFull = generateBacking(backingTimeline(full)!, { seed: 'x' });
    const evHalf = generateBacking(tl, { seed: 'x' });
    expect(evHalf.length).toBe(evFull.length);
    evHalf.forEach((e, i) => {
      expect(e.inst).toBe(evFull[i].inst);
      // Event times are rounded to 0.1 ms (patterns.ts), e.g. glissando steps of beat/6.
      expect(e.time).toBeCloseTo(evFull[i].time * 2, 3);
    });
  });

  it('scrolls the highway in slow motion: same note spacing and notes in view', () => {
    const base = { speed: 13, lookAhead: 3.2 };
    const s = scaledScroll(base, 0.5);
    expect(s).toEqual({ speed: 6.5, lookAhead: 6.4 });
    // Two notes 0.5 s apart at full speed are 1 s apart at half speed: same distance on the highway.
    expect(0.5 * base.speed).toBe(1 * s.speed);
    expect(s.speed * s.lookAhead).toBeCloseTo(base.speed * base.lookAhead, 9);
    expect(scaledScroll(base, 1)).toEqual(base);
  });

  const charts = import.meta.glob('../public/charts/*.json', { eager: true, import: 'default' }) as Record<string, S5Chart | { songs: unknown[] }>;
  const songs = Object.entries(charts).filter(([k]) => !k.endsWith('index.json')) as [string, S5Chart][];
  it.skipIf(songs.length === 0)('composes with every generated tier and ringer count (run "npm run charts" first)', () => {
    for (const [, c] of songs) {
      for (const speed of [0.5, 0.65, 0.8]) {
        const s = scaleChart(c, speed);
        expect(s.timing.durationSec).toBeCloseTo(c.timing.durationSec / speed, 6);
        expect(s.parts.map((p) => [p.difficulty, p.ringerCount, p.notes.length])).toEqual(c.parts.map((p) => [p.difficulty, p.ringerCount, p.notes.length]));
        for (let k = 0; k < s.parts.length; k++) {
          const t = buildTeamChart(s, s.parts[k]);
          const t1 = buildTeamChart(c, c.parts[k]);
          expect(t.chart.notes.length).toBe(t1.chart.notes.length);
          t.chart.notes.forEach((n, i) => expect(n.time).toBeCloseTo(t1.chart.notes[i].time / speed, 6));
        }
        const tl = backingTimeline(s);
        if (tl) expect(tl.beats.length).toBe(c.harmony!.beats.length);
      }
    }
  });
});
