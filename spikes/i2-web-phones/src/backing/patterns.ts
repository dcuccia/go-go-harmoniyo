// Deterministic accompaniment on the same beat grid the host schedules with the bells.
import { ending } from './flourishes';
import { phrases } from './phrases';
import { resolveStyle, type PadTone, type StylePreset } from './styles';
import type { Chord, Timeline } from './timeline';

export { isStyle, resolveStyle, STYLES, type PadTone, type StyleId, type StylePreset } from './styles';

export type Instrument = 'tap' | 'brush' | 'shake' | 'bass' | 'pad' | 'stab' | 'tag';

export interface BackingEvent {
  time: number;
  inst: Instrument;
  vel: number;
  dur?: number;
  midi?: number;
  midis?: number[];
  tone?: PadTone;
}

export interface BellNote {
  time: number;
  dur: number;
  midi: number;
  role?: 'melody' | 'bass' | 'inner';
}
export interface Exclusions {
  bass: { start: number; end: number }[];
  inner: { start: number; end: number; pc: number }[];
}

export function exclusionsFrom(notes: BellNote[]): Exclusions {
  const bass: Exclusions['bass'] = [];
  const inner: Exclusions['inner'] = [];
  for (const n of notes) {
    const span = { start: n.time, end: n.time + Math.max(0.1, n.dur) };
    if (n.role === 'bass') bass.push(span);
    else if (n.role === 'inner') inner.push({ ...span, pc: n.midi % 12 });
  }
  return { bass, inner };
}

const overlaps = (a: number, b: number, span: { start: number; end: number }): boolean =>
  Math.min(b, span.end) - Math.max(a, span.start) > 0.02;
const placeAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);
const r4 = (x: number): number => Math.round(x * 10000) / 10000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Close voicing in the mid-low register, staying close to the previous center. */
export function voice(pcs: number[], prevCenter: number): number[] {
  const out = pcs.map((pc) => {
    const low = placeAbove(pc, 50);
    const up = low + 12;
    return up <= 67 && Math.abs(up - prevCenter) < Math.abs(low - prevCenter) ? up : low;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface GenerateOptions {
  style?: string;
  exclusions?: Exclusions;
  seed?: string;
}

export const FERMATA = 1.6;

export function generateBacking(tl: Timeline, opts: GenerateOptions = {}): BackingEvent[] {
  const style = resolveStyle(tl, opts.style);
  const ex = opts.exclusions ?? { bass: [], inner: [] };
  const first = tl.beats.find((b) => b.chord);
  if (!first) return [];
  const out: BackingEvent[] = [];
  let seed = hash(opts.seed ?? 'go-go-harmoniyo');
  const add = (e: BackingEvent): void => {
    // Vary velocity only. Onsets, including sparse phrase accents, stay on the grid.
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.push({ ...e, vel: e.vel * (0.95 + seed * (0.1 / 4294967296)), time: r4(e.time), ...(e.dur !== undefined ? { dur: r4(e.dur) } : {}) });
  };
  const last = tl.beats.at(-1)!;
  const finalDown = tl.beats.find((b) => b.bar === last.bar && b.beat === 0) ?? last;
  const finalChord = tl.chords.at(-1);
  const finalSpan = finalDown.dur * finalDown.beatsPerBar;
  const phraseEnds = new Set(phrases(tl).filter((p) => !p.final).map((p) => p.lastBar));
  const pitches = new Map<Chord, number[]>();
  const free = (midi: number, time: number, end: number): boolean =>
    !ex.inner.some((span) => span.pc === midi % 12 && overlaps(time, end, span));
  let center = 58;
  for (const c of tl.chords) {
    const time = Math.max(c.time, first.time);
    const end = c === finalChord ? Math.max(c.end, finalDown.time + FERMATA * finalSpan) : c.end;
    if (end - time < 0.045) continue;
    const midis = voice(c.tones, center);
    if (!midis.length) continue;
    center = midis.reduce((a, m) => a + m, 0) / midis.length;
    pitches.set(c, midis);
    const playable = midis.filter((m) => free(m, time, end));
    if (playable.length) add({ time, inst: 'pad', vel: 0.64, dur: end - time, midis: playable, tone: style.tone });
  }

  for (const [i, b] of tl.beats.entries()) {
    const c = b.chord;
    if (!c) continue;
    const change = tl.beats[i - 1]?.chord !== c;
    const final = b.bar === last.bar;
    if (change || b.beat === 0 || (!final && style.bassPulse && b.strong)) {
      // Reinforce the written inversion, not an automatic fifth or chromatic approach.
      const end = final && c === finalChord ? Math.max(c.end, finalDown.time + finalSpan * FERMATA)
        : Math.min(b.time + b.dur * (style.bassPulse ? 1.6 : b.beatsPerBar), c.end);
      if (end - b.time > 0.04 && !ex.bass.some((s) => overlaps(b.time, end, s))) {
        add({ time: b.time, inst: 'bass', vel: b.beat === 0 || change ? 0.67 : 0.44, dur: (end - b.time) * 0.92, midi: placeAbove(c.bass, 40) });
      }
    }
    if (final) continue;
    const closingBeat = b.beat === b.beatsPerBar - 1;
    if (closingBeat && phraseEnds.has(b.bar)) {
      add({ time: b.time, inst: 'brush', vel: 0.38 * b.energy, dur: b.dur });
    } else if (style.id === 'march' && b.beat === 0 && b.energy >= 0.5) {
      add({ time: b.time, inst: 'tap', vel: 0.38 * b.energy });
    } else if (style.id === 'sleigh-ride' && b.strong) {
      add({ time: b.time + b.dur / b.div, inst: 'shake', vel: 0.38 * b.energy });
    } else if (style.id === 'waltz' && closingBeat && b.energy >= 0.5) {
      add({ time: b.time, inst: 'brush', vel: 0.23 * b.energy });
    }
    // A soft waltz answer only when there's no new chord at that beat. No double strike.
    const time = b.time;
    const dur = Math.min(b.dur * 0.48, c.end - time);
    if (style.offbeatKeys && b.beat !== 0 && !change && dur > 0.045) {
      const midis = pitches.get(c)?.filter((m) => free(m, time, time + dur));
      if (midis?.length) add({ time, inst: 'stab', vel: 0.40, dur, midis: midis.slice(-2), tone: style.tone });
    }
  }
  // Don't anticipate a later chord in a multi-chord final bar.
  if (finalChord && finalDown.chord === finalChord) {
    for (const e of ending(finalDown, finalChord)) if (free(e.midi!, e.time, e.time + e.dur!)) add(e);
  }
  return out.sort((a, b) => a.time - b.time);
}

export function scaleEvents(events: BackingEvent[], speed: number): BackingEvent[] {
  if (!(speed > 0) || speed === 1) return events;
  return events.map((e) => ({ ...e, time: r4(e.time / speed), ...(e.dur !== undefined ? { dur: r4(e.dur / speed) } : {}) }));
}

export function describe(tl: Timeline | null, style?: StylePreset): string {
  if (!tl) return 'no chord data in this chart';
  const s = style ?? resolveStyle(tl);
  return `${s.label} · ${tl.source === 'lead-sheet' ? 'chords from the lead sheet' : 'chords inferred from the score'}`;
}
