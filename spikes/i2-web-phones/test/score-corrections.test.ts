import { describe, expect, it } from 'vitest';
import canonicalWenceslas from '../../s5-chart-pipeline/charts/good-king-wenceslas.json';
import { generateBacking } from '../src/backing/patterns';
import { backingTimeline, type Chord, type Timeline } from '../src/backing/timeline';
import { buildTeamChart, GUIDE_VELOCITY, partBellNotes, type S5Chart } from '../src/team-chart';

const generated = import.meta.glob<S5Chart>([
  '../public/charts/good-king-wenceslas.json',
  '../public/charts/short/good-king-wenceslas.json',
  '../public/charts/short/the-holly-and-the-ivy.json',
], { eager: true, import: 'default' });
const wenceslasShort = '../public/charts/short/good-king-wenceslas.json';
const hollyShort = '../public/charts/short/the-holly-and-the-ivy.json';
const wenceslasFull = '../public/charts/good-king-wenceslas.json';

type Harmony = Pick<Chord, 'symbol' | 'root' | 'bass' | 'tones'>;
const wenceslasEdits = [
  { tick: 1440, from: 'F#m', to: { symbol: 'E/G#', root: 4, bass: 8, tones: [4, 8, 11] } },
  { tick: 2400, from: 'A', to: { symbol: 'D', root: 2, bass: 2, tones: [2, 6, 9] } },
  { tick: 4320, from: 'D', to: { symbol: 'A/C#', root: 9, bass: 1, tones: [9, 1, 4] } },
  // The score has no sounding E here: keep the root for harmonic identity, not for voicing.
  { tick: 5280, from: 'D', to: { symbol: 'E7/B', root: 4, bass: 11, tones: [8, 11, 2] } },
];
const repeatedPhrase = 7680;

function timelines(c: S5Chart) {
  return {
    corrected: backingTimeline(c)!,
    original: backingTimeline(c, { scoreCorrections: false })!,
  };
}

function beatIndex(c: S5Chart, tick: number): number {
  const index = c.harmony!.beats.findIndex((b) => b.tick === tick);
  expect(index, `source beat at tick ${tick}`).toBeGreaterThanOrEqual(0);
  return index;
}

function sounding(c: Chord | null): Harmony | null {
  return c && { symbol: c.symbol, root: c.root, bass: c.bass, tones: c.tones };
}

function expectOneBeatEdit(
  c: S5Chart, { corrected, original }: ReturnType<typeof timelines>, tick: number, expected: Partial<Harmony>,
) {
  const i = beatIndex(c, tick);
  const start = c.harmony!.beats[i].time;
  const end = c.harmony!.beats[i + 1].time;
  const [before, beat, after] = corrected.beats.slice(i - 1, i + 2);
  const msg = `tick ${tick}`;
  expect(beat.chord, msg).toMatchObject({ ...expected, time: start });
  expect(beat.chord!.end - beat.chord!.time, msg).toBeCloseTo(end - start, 8);
  const midpoint = (start + end) / 2;
  expect(corrected.chords.filter((chord) => chord.time <= midpoint && midpoint < chord.end), msg)
    .toEqual([beat.chord]);
  expect(sounding(before.chord), `before ${msg}`).toEqual(sounding(original.beats[i - 1].chord));
  expect(sounding(after.chord), `after ${msg}`).toEqual(sounding(original.beats[i + 1].chord));
  expect(before.chord!.end, `before ${msg}`).toBeCloseTo(start, 8);
  expect(after.chord!.time, `after ${msg}`).toBe(end);
}

function changedTicks(c: S5Chart, { corrected, original }: ReturnType<typeof timelines>): number[] {
  return c.harmony!.beats.flatMap(({ tick }, i) => {
    const before = sounding(original.beats[i].chord);
    const after = sounding(corrected.beats[i].chord);
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [tick];
  });
}

function expectFullWenceslas(c: S5Chart) {
  const comparison = timelines(c);
  const sections = c.form!.sections.filter((s) => s.kind === 'verse');
  expect(sections.length).toBeGreaterThan(1);
  const expectedTicks: number[] = [];
  for (const section of sections) {
    const shift = section.transpose ?? 0;
    const transpose = (pc: number) => (pc + shift + 12) % 12;
    for (const phrase of [0, repeatedPhrase]) {
      for (const { tick, to } of wenceslasEdits) {
        const absoluteTick = section.tick + phrase + tick;
        expectedTicks.push(absoluteTick);
        expectOneBeatEdit(c, comparison, absoluteTick, {
          ...(!shift ? { symbol: to.symbol } : {}),
          root: transpose(to.root),
          bass: transpose(to.bass),
          tones: to.tones.map(transpose),
        });
      }
    }
  }
  // No extra corrections in the surrounding verse material, intro, interlude, or coda.
  expect(changedTicks(c, comparison)).toEqual(expectedTicks);
}

describe('score corrections on generated charts (run "npm run charts" first)', () => {
  const generatedIt = it.skipIf(Object.keys(generated).length === 0);

  generatedIt('corrects exactly eight Wenceslas Short beats, with an opt-out to inferred harmony', () => {
    const c = generated[wenceslasShort];
    const comparison = timelines(c);
    const expectedTicks: number[] = [];
    for (const phrase of [0, repeatedPhrase]) {
      for (const { tick, from, to } of wenceslasEdits) {
        const absoluteTick = phrase + tick;
        expectedTicks.push(absoluteTick);
        const i = beatIndex(c, absoluteTick);
        expect(comparison.original.beats[i].chord?.symbol, `opt-out at tick ${absoluteTick}`).toBe(from);
        expectOneBeatEdit(c, comparison, absoluteTick, to);
      }
    }
    expect(changedTicks(c, comparison)).toEqual(expectedTicks);
  });

  generatedIt('corrects both Wenceslas phrases relative to every generated Full verse', () => {
    expectFullWenceslas(generated[wenceslasFull]);
  });

  generatedIt('voices the written inversions in the backing bass events', () => {
    const c = generated[wenceslasShort];
    const { corrected } = timelines(c);
    const bassAt = (tl: Timeline, time: number) => generateBacking(tl)
      .filter((e) => e.inst === 'bass' && e.time === time)
      .map((e) => e.midi! % 12);
    for (const [tick, pitch] of [[1440, 8], [4320, 1], [5280, 11]]) {
      const time = c.harmony!.beats[beatIndex(c, tick)].time;
      expect(bassAt(corrected, time), `tick ${tick}`).toEqual([pitch]);
    }
    expect(backingTimeline(c, { scoreCorrections: true })).toEqual(corrected);

    const holly = generated[hollyShort];
    const hollyTimelines = timelines(holly);
    const time = holly.harmony!.beats[beatIndex(holly, 5760)].time;
    expect(bassAt(hollyTimelines.original, time)).toEqual([0]); // C7
    expect(bassAt(hollyTimelines.corrected, time)).toEqual([4]); // C7/E
  });

  generatedIt('inverts only the C7 following C in Holly Short, not C7 following F/C or Bb/D', () => {
    const c = generated[hollyShort];
    const comparison = timelines(c);
    const { corrected, original } = comparison;
    for (const tick of [5760, 17280]) {
      const i = beatIndex(c, tick);
      expect(sounding(original.beats[i - 1].chord)).toMatchObject({ symbol: 'C', bass: 0 });
      expect(sounding(original.beats[i].chord)).toEqual({ symbol: 'C7', root: 0, bass: 0, tones: [0, 4, 7, 10] });
      expectOneBeatEdit(c, comparison, tick, { symbol: 'C7/E', root: 0, bass: 4, tones: [0, 4, 7, 10] });
    }
    for (const tick of [10080, 21600]) {
      const i = beatIndex(c, tick);
      expect(sounding(corrected.beats[i - 1].chord)).toMatchObject({ symbol: 'F/C', bass: 0 });
      expect(corrected.beats[i].chord, `tick ${tick}`).toEqual(original.beats[i].chord);
      expect(sounding(corrected.beats[i].chord)).toEqual({ symbol: 'C7', root: 0, bass: 0, tones: [0, 4, 7, 10] });
    }
    for (const tick of [6720, 18240]) {
      const i = beatIndex(c, tick);
      expect(corrected.beats[i].chord, `tick ${tick}`).toEqual(original.beats[i].chord);
      expect(sounding(corrected.beats[i].chord)).toEqual({ symbol: 'Bb/D', root: 10, bass: 2, tones: [10, 2, 5] });
    }
    expect(changedTicks(c, comparison)).toEqual([5760, 17280]);
  });

  generatedIt.each([
    ['Wenceslas', wenceslasShort, 1440, 'E/G#'],
    ['Holly', hollyShort, 5760, 'C7/E'],
  ] as const)('leaves %s chart data, player cues and guide bells untouched', (_song, path, tick, symbol) => {
    const c = structuredClone(generated[path]);
    const serialized = JSON.stringify(c);
    const part = c.parts.find((p) => p.difficulty === 'super-easy' && p.arrangement === 'balanced')!;
    const teamBefore = buildTeamChart(c, part);
    const bellsBefore = partBellNotes(c, part);
    const guideCount = part.guide?.length ?? 0;
    expect(guideCount).toBeGreaterThan(0);
    expect(teamBefore.chart.backing.filter((n) => n.velocity === GUIDE_VELOCITY)).toHaveLength(guideCount);
    expect(teamBefore.chart.notes.length).toBeGreaterThan(0);
    expect(bellsBefore).toHaveLength(part.notes.length);
    expect(bellsBefore.length).toBeGreaterThan(0);

    const audio = backingTimeline(c)!;
    expect(audio.beats[beatIndex(c, tick)].chord?.symbol).toBe(symbol);
    expect(generateBacking(audio).length).toBeGreaterThan(0);

    expect(JSON.stringify(c)).toBe(serialized);
    expect(buildTeamChart(c, part)).toEqual(teamBefore);
    expect(partBellNotes(c, part)).toEqual(bellsBefore);
  });
});

it('transposes both Wenceslas phrases in the key-changed verse of the canonical S5 Full chart', () => {
  const c = canonicalWenceslas as S5Chart;
  expect(c.form!.sections.filter((s) => s.kind === 'verse').map((s) => s.transpose)).toContain(2);
  expectFullWenceslas(c);
});

it('does not apply the inferred Wenceslas corrections to another song or harmony source', () => {
  const c = canonicalWenceslas as S5Chart;
  const { corrected, original } = timelines(c);
  expect(corrected.chords).not.toEqual(original.chords);
  const otherSong: S5Chart = { ...c, song: { ...c.song, id: 'another-song' } };
  const otherSource: S5Chart = { ...c, harmony: { ...c.harmony!, source: 'lead-sheet' } };
  for (const candidate of [otherSong, otherSource]) {
    const comparison = timelines(candidate);
    expect(comparison.corrected).toEqual(comparison.original);
  }
});
