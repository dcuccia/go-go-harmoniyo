import { describe, expect, it } from 'vitest';
import { backingTimeline, countIn, type HarmonyChart, type S5Beat, type S5Chord } from '../src/backing/timeline';
import { exclusionsFrom, FERMATA, generateBacking, resolveStyle, scaleEvents, STYLES, voice, type BackingEvent } from '../src/backing/patterns';
import { RIT_RATIO } from '../src/backing/flourishes';
import { phraseAt, phrases } from '../src/backing/phrases';
import { partBellNotes, type S5Chart } from '../src/team-chart';
import { scaleChart } from '../src/speed';

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
    const sleighTimes = of(ev, 'shake').map((e) => e.time);
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

  it('sleigh-ride: sparse offbeat shakes, steady bass and felt keys', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'sleigh-ride' }))!);
    expect(of(ev, 'shake').filter((e) => e.time < 2).map((e) => e.time)).toEqual([0.25, 1.25]);
    expect(of(ev, 'bass').filter((e) => e.time < 2).map((e) => [e.time, e.midi])).toEqual([[0, 48], [1, 48]]);
    expect(of(ev, 'pad').filter((e) => e.tone === 'felt').map((e) => e.midis!.length)).toEqual([3, 3, 4, 3]);
  });

  it('gentle: downbeat bass and felt keys without a continuous percussion part', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'gentle', beatsPerBar: 2, div: 3, beatSec: 1 }))!);
    expect(ev.filter((e) => ['tap', 'brush', 'shake'].includes(e.inst))).toEqual([]);
    expect(of(ev, 'pad').map((e) => e.tone)).toEqual(['felt', 'felt', 'felt', 'felt']);
    expect(of(ev, 'bass').map((e) => e.time)).toEqual([0, 2, 4, 6]);
  });

  it('waltz: nylon answers on weak beats, but not on an existing chord attack', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'waltz', beatsPerBar: 3 }))!);
    expect(of(ev, 'bass').map((e) => e.time)).toEqual([0, 1.5, 3, 4.5]);
    expect(of(ev, 'stab').filter((e) => e.time < 1.5).map((e) => e.time)).toEqual([0.5, 1]);
    const changed = chart({ style: 'waltz', beatsPerBar: 3 });
    changed.harmony!.chords[0].durSec = 0.5;
    changed.harmony!.chords.splice(1, 0, { ...C(0.5, 1, 'Dm/F', 2, [2, 5, 9]), bass: 5 });
    for (const b of changed.harmony!.beats.slice(1)) b.chord!++;
    const onChange = generateBacking(backingTimeline(changed)!).filter((e) => e.time === 0.5);
    expect(onChange.map((e) => e.inst)).toEqual(['pad', 'bass']);
    expect(of(onChange, 'bass')[0].midi).toBe(41);
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
    const pads = of(ev, 'pad').filter((e) => e.tone === 'felt');
    expect(pads[0].midis!.map((m) => m % 12)).toEqual(expect.not.arrayContaining([4]));
    expect(pads[0].midis!.length).toBe(2);
    expect(pads[3].midis!.map((m) => m % 12)).toContain(4);
    expect(of(ev, 'tap').map((e) => e.time)).toEqual(of(generateBacking(tl), 'tap').map((e) => e.time));
    const occupied = exclusionsFrom([60, 62, 64, 65, 67, 69, 71].map((midi) => ({ midi, role: 'inner', time: 0, dur: 20 })));
    expect(generateBacking(tl, { exclusions: occupied }).filter((e) => ['pad', 'stab', 'tag'].includes(e.inst))).toEqual([]);
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

  it('march: a pulse on each downbeat and a quiet unpitched brush at phrase boundaries', () => {
    const ev = generateBacking(backingTimeline(long('march'))!);
    expect(of(ev, 'tap').map((e) => e.time)).toEqual(Array.from({ length: 15 }, (_, i) => barT(i + 1)));
    expect(of(ev, 'brush').map((e) => e.time)).toEqual([barT(4, 3), barT(8, 3), barT(12, 3)]);
    expect(of(ev, 'tag').every((e) => e.time > barT(16))).toBe(true);
  });

  it('ends with a descending plucked tag on the final chord and growing gaps', () => {
    const tl = backingTimeline(long('sleigh-ride'))!;
    const ev = generateBacking(tl);
    const down = barT(16);
    const tag = of(ev, 'tag');
    expect(tag.length).toBe(6);
    const gaps = tag.slice(1).map((e, i) => e.time - tag[i].time);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i] / gaps[i - 1]).toBeCloseTo(RIT_RATIO, 1);
    expect(tag.slice(0, 5).map((e) => e.midi!)).toEqual([...tag.slice(0, 5).map((e) => e.midi!)].sort((a, b) => b - a));
    const lastPad = of(ev, 'pad').at(-1)!;
    expect(lastPad.time + lastPad.dur!).toBeCloseTo(down + FERMATA * 2, 3);
    expect(of(ev, 'bass').at(-1)!.dur!).toBeGreaterThan(2);
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

describe('song form (chart 0.3)', () => {
  /** 8 bars: bars 1–2 intro (energy 0.45), 3–6 verse (0.8), 7–8 a verse up a step (1). */
  function formChart(): HarmonyChart & { form: { sections: { energy: number; label: string; time: number; durSec: number }[] } } {
    const c = chart({ style: 'march', bars: 8 });
    const sectionOf = (bar: number): number => (bar <= 2 ? 0 : bar <= 6 ? 1 : 2);
    c.harmony!.beats.forEach((b) => (b.section = sectionOf(b.bar)));
    // Last two bars a whole step up (key change): D, A7.
    c.harmony!.chords[6] = C(12, 2, 'D', 2, [2, 6, 9]);
    c.harmony!.chords[7] = C(14, 2, 'A7', 9, [9, 1, 4, 7]);
    return { ...c, form: { sections: [{ energy: 0.45, label: 'Intro', time: 0, durSec: 4 }, { energy: 0.8, label: 'Verse 1', time: 4, durSec: 8 }, { energy: 1, label: 'Verse 2', time: 12, durSec: 4 }] } };
  }

  it('the groove builds with the sections: no march pulse in the intro, softer shakes in lighter sections', () => {
    const tl = backingTimeline(formChart())!;
    expect(tl.beats.map((b) => b.energy).slice(0, 9)).toEqual([0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.8]);
    const ev = generateBacking(tl, { seed: 'x' });
    expect(of(ev, 'tap').every((e) => e.time >= 4)).toBe(true);
    const shakes = of(generateBacking(tl, { seed: 'x', style: 'sleigh-ride' }), 'shake');
    expect(shakes.some((e) => e.time < 4)).toBe(true);
    const mean = (xs: BackingEvent[]): number => xs.reduce((s, e) => s + e.vel, 0) / xs.length;
    expect(mean(shakes.filter((e) => e.time < 4))).toBeLessThan(mean(shakes.filter((e) => e.time >= 12)));
    // Without a form every beat is at full energy (pre-0.3 charts sound as before).
    const plain = chart({ style: 'march' });
    expect(backingTimeline(plain)!.beats.every((b) => b.energy === 1)).toBe(true);
  });

  it('follows a key change: bass and pad use the transposed chords', () => {
    const ev = generateBacking(backingTimeline(formChart())!, { seed: 'x' });
    const lastBass = of(ev, 'bass').filter((e) => e.time >= 12 && e.time < 14);
    expect(lastBass.length).toBeGreaterThan(0);
    expect(lastBass[0].midi! % 12).toBe(2); // D
    const pad = of(ev, 'pad').find((e) => e.time >= 14)!;
    expect(new Set(pad.midis!.map((m) => m % 12))).toEqual(new Set([9, 1, 4, 7]));
  });

  it('at practice speed the whole form stretches: events at 2× the time, sections included', () => {
    const c = formChart();
    const slow = scaleChart(c, 0.5);
    expect(slow.form.sections.map((s) => [s.time, s.durSec])).toEqual([[0, 8], [8, 16], [24, 8]]);
    const a = generateBacking(backingTimeline(c)!, { seed: 'x' });
    const b = generateBacking(backingTimeline(slow)!, { seed: 'x' });
    expect(b.length).toBe(a.length);
    b.forEach((e, i) => {
      expect(e.inst).toBe(a[i].inst);
      expect(e.time).toBeCloseTo(a[i].time * 2, 3);
      expect(e.vel).toBeCloseTo(a[i].vel, 6);
    });
  });
});
