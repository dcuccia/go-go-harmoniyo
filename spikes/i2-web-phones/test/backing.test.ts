import { describe, expect, it } from 'vitest';
import { backingTimeline, countIn, type HarmonyChart, type S5Beat, type S5Chord } from '../src/backing/timeline';
import { exclusionsFrom, FERMATA, generateBacking, resolveStyle, scaleEvents, STYLES, voice, type BackingEvent } from '../src/backing/patterns';
import { RIT_RATIO } from '../src/backing/flourishes';
import { phraseAt, phrases } from '../src/backing/phrases';
import { partBellNotes, type S5Chart } from '../src/team-chart';

const C = (time: number, durSec: number, symbol: string, root: number, tones: number[]): S5Chord => ({ tick: 0, time, dur: 1, durSec, symbol, root, bass: root, tones });

/** 4/4 at 120 (0.5 s beats), bars C | F | G7 | C, or a custom meter/pickup. */
function chart(opts: { style?: string; beatsPerBar?: number; pickup?: number; div?: number; beatSec?: number; bars?: number } = {}): HarmonyChart {
  const n = opts.beatsPerBar ?? 4;
  const bs = opts.beatSec ?? 0.5;
  const pickup = opts.pickup ?? 0;
  const bars = opts.bars ?? 4;
  const prog: [string, number, number[]][] = [['C', 0, [0, 4, 7]], ['F', 5, [5, 9, 0]], ['G7', 7, [7, 11, 2, 5]], ['C', 0, [0, 4, 7]]];
  const chords = Array.from({ length: bars }, (_, i) => {
    const [s, r, t] = prog[i % prog.length];
    return C(pickup * bs + i * n * bs, n * bs, s, r, t);
  });
  const beats: S5Beat[] = [];
  for (let k = 0; k < pickup; k++) beats.push({ tick: 0, time: k * bs, bar: 1, beat: n - pickup + k, div: opts.div ?? 2, strong: false, chord: null });
  for (let i = 0; i < bars; i++)
    for (let b = 0; b < n; b++) beats.push({ tick: 0, time: (pickup + i * n + b) * bs, bar: i + 1 + (pickup ? 1 : 0), beat: b, div: opts.div ?? 2, strong: b === 0 || (n === 4 && b === 2), chord: i });
  return {
    timing: { tempos: [{ time: 0, bpm: 60 / bs }], timeSignatures: [{ numerator: n, denominator: 4 }], durationSec: (pickup + bars * n) * bs },
    harmony: { source: 'lead-sheet', style: opts.style, chords, beats },
  };
}

const of = (ev: BackingEvent[], inst: BackingEvent['inst']): BackingEvent[] => ev.filter((e) => e.inst === inst);

describe('chord timeline', () => {
  it('reads chords and beats, with beat lengths, bar sizes and the sounding chord', () => {
    const tl = backingTimeline(chart())!;
    expect(tl.chords.map((c) => [c.symbol, c.time, c.end])).toEqual([['C', 0, 2], ['F', 2, 4], ['G7', 4, 6], ['C', 6, 8]]);
    expect(tl.beats.length).toBe(16);
    expect(tl.beats.every((b) => b.dur === 0.5 && b.beatsPerBar === 4 && b.div === 2)).toBe(true);
    expect(tl.beats[5].chord?.symbol).toBe('F');
    expect(tl.end).toBe(8);
  });

  it('is null for charts without a harmony block (pre-0.2): no backing', () => {
    const c = chart();
    delete c.harmony;
    expect(backingTimeline(c)).toBeNull();
    expect(generateBacking).toBeTypeOf('function');
  });

  it('follows tempo changes: beat lengths come from the beat times', () => {
    const c = chart();
    // Slow down to 60 bpm from bar 3: beats 8.. are 1 s apart.
    c.harmony!.beats.forEach((b, i) => (b.time = i < 8 ? i * 0.5 : 4 + (i - 8)));
    const tl = backingTimeline(c)!;
    expect(tl.beats[7].dur).toBe(0.5);
    expect(tl.beats[8].dur).toBe(1);
    const ev = generateBacking(tl, { style: 'sleigh-ride' });
    // Off-beat sleigh jingles sit halfway between beats, before and after the change.
    const sleighTimes = of(ev, 'sleigh').map((e) => e.time);
    expect(sleighTimes).toContain(0.25);
    expect(sleighTimes).toContain(4.5);
    expect(sleighTimes).not.toContain(4.25);
  });
});

describe('count-in', () => {
  it('one bar of clicks before a downbeat start, accent on 1', () => {
    expect(countIn(chart())).toEqual([
      { time: -2, accent: true },
      { time: -1.5, accent: false },
      { time: -1, accent: false },
      { time: -0.5, accent: false },
    ]);
  });

  it('lets a pickup come in on its beat (3/4, one-beat pickup: 1 2 3 1 2)', () => {
    const clicks = countIn(chart({ beatsPerBar: 3, pickup: 1 }));
    expect(clicks.map((c) => c.time)).toEqual([-2.5, -2, -1.5, -1, -0.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, true, false]);
  });

  it('two bars in two-beat meters, and falls back to the tempo map without harmony', () => {
    expect(countIn(chart({ beatsPerBar: 2, div: 3, beatSec: 1 })).map((c) => c.time)).toEqual([-4, -3, -2, -1]);
    const c = chart();
    delete c.harmony;
    expect(countIn(c).map((x) => x.time)).toEqual([-2, -1.5, -1, -0.5]);
  });
});

describe('pattern generation', () => {
  it('is deterministic for a seed and sorted in time', () => {
    const tl = backingTimeline(chart({ style: 'sleigh-ride' }))!;
    const a = generateBacking(tl, { seed: 'jingle-bells' });
    expect(generateBacking(tl, { seed: 'jingle-bells' })).toEqual(a);
    expect(generateBacking(tl, { seed: 'other' })).not.toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i].time).toBeGreaterThanOrEqual(a[i - 1].time);
    // The ritardando tag may ring a little past the last bar (fermata).
    expect(a.every((e) => e.vel > 0 && e.vel <= 1 && e.time >= 0 && e.time <= tl.end + 1.5)).toBe(true);
  });

  it('sleigh-ride: jingles on every eighth, kick on 1 and 3, snare + shake on 2 and 4, walking bass', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'sleigh-ride' }))!);
    expect(of(ev, 'kick').map((e) => e.time).slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(of(ev, 'snare').map((e) => e.time).slice(0, 2)).toEqual([0.5, 1.5]);
    expect(of(ev, 'shake').map((e) => e.time).slice(0, 2)).toEqual([0.5, 1.5]);
    expect(of(ev, 'sleigh').filter((e) => e.time < 2).map((e) => e.time)).toEqual([0, 0.25, 0.75, 1, 1.25, 1.75]);
    const bass = of(ev, 'bass');
    // Bar 1 (C → F next): C, G, then E as a chromatic approach into F.
    expect(bass.filter((e) => e.time < 2).map((e) => e.midi)).toEqual([48, 43, 40]);
    expect(bass.every((e) => e.midi! >= 40 && e.midi! <= 52)).toBe(true);
    // Last bar: one ringing downbeat, then only the ending tag (glockenspiel + sleigh bells).
    expect(ev.filter((e) => e.time > 6 && !['pad', 'glock', 'sleigh', 'shake'].includes(e.inst))).toEqual([]);
    expect(of(ev, 'pad').filter((e) => e.tone === 'organ').map((e) => e.midis!.length)).toEqual([3, 3, 4, 3]);
  });

  it('gentle: no kick or snare, warm pad, bass on downbeats', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'gentle', beatsPerBar: 2, div: 3, beatSec: 1 }))!);
    expect(of(ev, 'kick').length + of(ev, 'snare').length).toBe(0);
    // Warm pad; strings join it in the last phrase (here the whole 4-bar song).
    expect(of(ev, 'pad').every((e) => e.tone === 'warm' || e.tone === 'strings')).toBe(true);
    expect(of(ev, 'pad').filter((e) => e.tone === 'warm').length).toBe(4);
    expect(of(ev, 'bass').map((e) => e.time)).toEqual([0, 2, 4, 6]);
  });

  it('waltz: oom-pah-pah (bass on 1, organ stabs on 2 and 3)', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'waltz', beatsPerBar: 3 }))!);
    expect(of(ev, 'bass').map((e) => e.time)).toEqual([0, 1.5, 3, 4.5]);
    expect(of(ev, 'stab').filter((e) => e.time < 1.5).map((e) => e.time)).toEqual([0.5, 1]);
  });

  it('defaults a style from the meter when the chart has none', () => {
    expect(resolveStyle(backingTimeline(chart({ beatsPerBar: 3 }))!).id).toBe('waltz');
    expect(resolveStyle(backingTimeline(chart({ beatsPerBar: 2, div: 3, beatSec: 1 }))!).id).toBe('gentle');
    expect(resolveStyle(backingTimeline(chart())!).id).toBe('march');
    expect(resolveStyle(backingTimeline(chart({ style: 'disco' }))!).id).toBe('march');
    expect(Object.keys(STYLES)).toEqual(['sleigh-ride', 'march', 'waltz', 'gentle']);
  });

  it('starts with the first chord (no groove under an unharmonised pickup)', () => {
    const ev = generateBacking(backingTimeline(chart({ beatsPerBar: 3, pickup: 1, style: 'waltz' }))!);
    expect(Math.min(...ev.map((e) => e.time))).toBe(0.5);
  });

  it('keeps bass and inner bells out of the backing: no doubled bass, held tones left out of the pad', () => {
    const tl = backingTimeline(chart({ style: 'march' }))!;
    // Bass bells in bars 1–2; an inner E (pc 4) bell held through bar 1.
    const ex = exclusionsFrom([
      { time: 0, dur: 2, midi: 48, role: 'bass' },
      { time: 2, dur: 2, midi: 53, role: 'bass' },
      { time: 0, dur: 2, midi: 64, role: 'inner' },
      { time: 0, dur: 0.5, midi: 72, role: 'melody' },
    ]);
    const ev = generateBacking(tl, { exclusions: ex });
    const bass = of(ev, 'bass');
    expect(bass.length).toBeGreaterThan(0);
    expect(bass.every((e) => e.time >= 4)).toBe(true);
    const pads = of(ev, 'pad').filter((e) => e.tone === 'organ');
    expect(pads[0].midis!.map((m) => m % 12)).toEqual(expect.not.arrayContaining([4]));
    expect(pads[0].midis!.length).toBe(2);
    expect(pads[3].midis!.map((m) => m % 12)).toContain(4);
    // Drums and sleigh bells are unaffected.
    expect(of(ev, 'kick').length).toBe(of(generateBacking(tl), 'kick').length);
  });

  it('voices pads in the pad register with small moves', () => {
    const a = voice([0, 4, 7], 58);
    const b = voice([5, 9, 0], a.reduce((s, m) => s + m, 0) / a.length);
    expect([...a, ...b].every((m) => m >= 50 && m <= 67)).toBe(true);
    expect(Math.abs(b[0] - a[0])).toBeLessThanOrEqual(5);
  });
});

/** A 16-bar 4/4 chart at 120 bpm (four 4-bar phrases), C F G7 C per phrase. */
const long = (style: string, bars = 16): HarmonyChart => chart({ style, bars });
const barT = (bar: number, beat = 0): number => (bar - 1) * 2 + beat * 0.5;

describe('phrases, fills, variations and the ending', () => {
  it('splits a song into 4-bar phrases from the first harmonised bar; a lone last bar folds into the previous phrase', () => {
    const tl = backingTimeline(long('march'))!;
    expect(phrases(tl).map((p) => [p.firstBar, p.lastBar, p.start, p.end, p.final])).toEqual([
      [1, 4, 0, 8, false],
      [5, 8, 8, 16, false],
      [9, 12, 16, 24, false],
      [13, 16, 24, 32, true],
    ]);
    expect(phrases(backingTimeline(long('march', 17))!).map((p) => [p.firstBar, p.lastBar])).toEqual([[1, 4], [5, 8], [9, 12], [13, 17]]);
    expect(phraseAt(phrases(tl), 9)?.index).toBe(1);
    // A pickup bar is not part of a phrase.
    expect(phrases(backingTimeline(chart({ beatsPerBar: 3, pickup: 1, bars: 8 }))!)[0]).toMatchObject({ firstBar: 2, start: 0.5 });
  });

  it('sleigh-ride: a snare fill with a crescendo on the last beat of each phrase, then a soft crash', () => {
    const ev = generateBacking(backingTimeline(long('sleigh-ride'))!);
    const fill = of(ev, 'snare').filter((e) => e.time >= barT(4, 3) && e.time < barT(5));
    expect(fill.map((e) => e.time)).toEqual([barT(4, 3), barT(4, 3) + 0.25]);
    expect(fill[1].vel).toBeGreaterThan(fill[0].vel);
    // The groove rests under the fill: no sleigh jingles on that beat in phrase 1 (snare fill, no glock).
    expect(of(ev, 'sleigh').filter((e) => e.time >= barT(4, 3) && e.time < barT(5))).toEqual([]);
    expect(of(ev, 'crash').map((e) => e.time)).toEqual([barT(5), barT(9), barT(13), barT(16)]); // + the final downbeat
    // Odd phrases (2nd, 4th) end with a sleigh roll + glockenspiel glissando up into the next chord.
    const gliss = of(ev, 'glock').filter((e) => e.time > barT(8, 3) && e.time < barT(9));
    expect(gliss.length).toBe(5);
    expect(gliss.map((e) => e.midi!)).toEqual([...gliss.map((e) => e.midi!)].sort((a, b) => a - b));
  });

  it('march: hi-hat on the off-beats and a tom fill down the toms over the last two beats', () => {
    const ev = generateBacking(backingTimeline(long('march'))!);
    expect(of(ev, 'hat').filter((e) => e.time < 2).map((e) => e.time)).toEqual([0.25, 0.75, 1.25, 1.75]);
    const toms = of(ev, 'tom').filter((e) => e.time < barT(5));
    expect(toms.length).toBe(8);
    expect(toms[0].time).toBe(barT(4, 2));
    expect(toms[0].midi!).toBeGreaterThan(toms[7].midi!);
  });

  it('varies the bass in odd phrases: the walking bass walks through the third', () => {
    const ev = generateBacking(backingTimeline(long('sleigh-ride'))!);
    const beat1 = (bar: number) => of(ev, 'bass').find((e) => e.time === barT(bar, 1));
    expect(beat1(1)).toBeUndefined(); // phrase 1: root – fifth – approach
    expect(beat1(5)?.midi! % 12).toBe(4); // phrase 2, C chord: E
    const waltz = generateBacking(backingTimeline(chart({ style: 'waltz', beatsPerBar: 3, bars: 8 }))!);
    expect(of(waltz, 'bass').every((e) => (e.time * 2) % 3 === 0)).toBe(true); // still "oom" on 1
  });

  it('celesta broken chords only in odd phrases for sleigh-ride, throughout for gentle', () => {
    const ev = generateBacking(backingTimeline(long('sleigh-ride'))!);
    const cel = of(ev, 'celesta');
    expect(cel.length).toBeGreaterThan(0);
    expect(cel.every((e) => (e.time >= 8 && e.time < 16) || (e.time >= 24 && e.time < 32))).toBe(true);
    const gentle = of(generateBacking(backingTimeline(long('gentle'))!), 'celesta');
    expect(gentle.some((e) => e.time < 8)).toBe(true);
  });

  it('ends with a ritardando tag: glock steps down the final chord with growing gaps, over a held fermata', () => {
    const tl = backingTimeline(long('sleigh-ride'))!;
    const ev = generateBacking(tl);
    const down = barT(16);
    const tag = of(ev, 'glock').filter((e) => e.time > down);
    expect(tag.length).toBe(6);
    const gaps = tag.slice(1).map((e, i) => e.time - tag[i].time);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i] / gaps[i - 1]).toBeCloseTo(RIT_RATIO, 1);
    expect(tag.slice(0, 5).map((e) => e.midi!)).toEqual([...tag.slice(0, 5).map((e) => e.midi!)].sort((a, b) => b - a));
    // Fermata: the last pad and bass are held well past the final downbeat.
    const lastPad = of(ev, 'pad').filter((e) => e.tone === 'organ').at(-1)!;
    expect(lastPad.time + lastPad.dur!).toBeGreaterThan(down + FERMATA * 2);
    expect(of(ev, 'bass').at(-1)!.dur!).toBeGreaterThan(2);
    // A drum fill leads into the final bar.
    expect(of(ev, 'snare').filter((e) => e.time >= barT(15, 3) && e.time < down).length).toBe(2);
  });

  it('practice speed scales event times and lengths', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'march' }))!);
    const half = scaleEvents(ev, 0.5);
    expect(half[5].time).toBeCloseTo(ev[5].time * 2, 3);
    expect(of(half, 'pad')[0].dur).toBeCloseTo(of(ev, 'pad')[0].dur! * 2, 3);
    expect(scaleEvents(ev, 1)).toBe(ev);
  });
});
const charts = import.meta.glob('../public/charts/*.json', { eager: true, import: 'default' }) as Record<string, S5Chart | { songs: unknown[] }>;
const songs = Object.entries(charts).filter(([k]) => !k.endsWith('index.json')) as [string, S5Chart][];
describe.skipIf(songs.length === 0)('generated carol charts (run "npm run charts" first)', () => {
  it('every carol carries chords, a beat grid and a style; every part gets a groove and a count-in', () => {
    const expected: Record<string, string> = { 'jingle-bells': 'sleigh-ride', 'silent-night': 'gentle', 'we-wish-you-a-merry-christmas': 'waltz', 'joy-to-the-world': 'march' };
    const index = Object.entries(charts).find(([k]) => k.endsWith('index.json'))?.[1] as { songs: unknown[] } | undefined;
    expect(songs.length).toBe(index?.songs.length);
    expect(songs.length).toBeGreaterThanOrEqual(16);
    for (const [, c] of songs) {
      const tl = backingTimeline(c);
      expect(tl, c.song.id).not.toBeNull();
      if (expected[c.song.id]) expect(resolveStyle(tl!).id).toBe(expected[c.song.id]);
      const clicks = countIn(c);
      expect(clicks.length).toBeGreaterThanOrEqual(3);
      expect(clicks.every((k) => k.time < 0) && clicks[0].accent).toBe(true);
      for (const p of c.parts.filter((x) => x.ringerCount === 2)) {
        const ev = generateBacking(tl!, { exclusions: exclusionsFrom(partBellNotes(c, p)), seed: c.song.id });
        expect(ev.length).toBeGreaterThan(20);
        // The ritardando tag ends ~1/8 bar after the final bar.
        const down = tl!.beats.find((b) => b.bar === tl!.beats.at(-1)!.bar && b.beat === 0)!;
        expect(ev.every((e) => Number.isFinite(e.time) && e.time >= 0 && e.time <= Math.max(tl!.end, down.time + 1.2 * down.dur * down.beatsPerBar))).toBe(true);
        // Easy (melody only) gets a backing bass line; hard (with bass bells) mostly does not.
        if (p.difficulty === 'easy') expect(of(ev, 'bass').length).toBeGreaterThan(4);
      }
      const easy = c.parts.find((x) => x.difficulty === 'easy' && x.ringerCount === 2)!;
      const hard = c.parts.find((x) => x.difficulty === 'hard' && x.ringerCount === 2)!;
      const bassOf = (p: typeof easy): number => of(generateBacking(tl!, { exclusions: exclusionsFrom(partBellNotes(c, p)) }), 'bass').length;
      expect(bassOf(hard)).toBeLessThanOrEqual(bassOf(easy));
    }
  });
});
