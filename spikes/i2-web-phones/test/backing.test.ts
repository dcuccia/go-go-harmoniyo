import { describe, expect, it } from 'vitest';
import { backingTimeline, countIn, type HarmonyChart, type S5Beat, type S5Chord } from '../src/backing/timeline';
import { exclusionsFrom, generateBacking, resolveStyle, STYLES, voice, type BackingEvent } from '../src/backing/patterns';
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
    expect(a.every((e) => e.vel > 0 && e.vel <= 1 && e.time >= 0 && e.time <= tl.end + 1e-9)).toBe(true);
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
    // Last bar is one ringing downbeat.
    expect(ev.filter((e) => e.time > 6 && e.inst !== 'pad')).toEqual([]);
    expect(of(ev, 'pad').map((e) => e.midis!.length)).toEqual([3, 3, 4, 3]);
  });

  it('gentle: no kick or snare, warm pad, bass on downbeats', () => {
    const ev = generateBacking(backingTimeline(chart({ style: 'gentle', beatsPerBar: 2, div: 3, beatSec: 1 }))!);
    expect(of(ev, 'kick').length + of(ev, 'snare').length).toBe(0);
    expect(of(ev, 'pad').every((e) => e.tone === 'warm')).toBe(true);
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
    const pads = of(ev, 'pad');
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

const charts = import.meta.glob('../public/charts/*.json', { eager: true, import: 'default' }) as Record<string, S5Chart | { songs: unknown[] }>;
const songs = Object.entries(charts).filter(([k]) => !k.endsWith('index.json')) as [string, S5Chart][];
describe.skipIf(songs.length === 0)('generated carol charts (run "npm run charts" first)', () => {
  it('every carol carries chords, a beat grid and a style; every part gets a groove and a count-in', () => {
    const expected: Record<string, string> = { 'jingle-bells': 'sleigh-ride', 'silent-night': 'gentle', 'we-wish-you-a-merry-christmas': 'waltz', 'joy-to-the-world': 'march' };
    expect(songs.length).toBe(8);
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
        expect(ev.every((e) => Number.isFinite(e.time) && e.time >= 0 && e.time <= tl!.end + 0.01)).toBe(true);
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
