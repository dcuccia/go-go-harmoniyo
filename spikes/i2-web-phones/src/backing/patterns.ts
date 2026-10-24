// Procedural backing patterns: chord timeline + style preset → a deterministic list of timed
// instrument events (song seconds). Pure logic; synth.ts turns events into sound.
import type { Chord, Timeline } from './timeline';

export type Instrument = 'kick' | 'snare' | 'brush' | 'sleigh' | 'shake' | 'bass' | 'pad' | 'stab';

export interface BackingEvent {
  time: number;
  inst: Instrument;
  /** 0..1 */
  vel: number;
  /** Seconds (bass, pad, stab). */
  dur?: number;
  /** MIDI pitch (bass). */
  midi?: number;
  /** MIDI pitches (pad, stab). */
  midis?: number[];
  /** Pad voice: drawbar organ or slow warm pad. */
  tone?: 'organ' | 'warm';
}

export type StyleId = 'sleigh-ride' | 'march' | 'waltz' | 'gentle';

export interface StylePreset {
  id: StyleId;
  label: string;
  kick: 'strong' | 'downbeat' | 'none';
  snare: boolean;
  brush: 'weak' | 'all' | 'none';
  sleigh: 'subdivisions' | 'beats' | 'weak' | 'downbeat';
  /** Long sleigh shake on the backbeat (weak beats in even meters). */
  shake: boolean;
  bass: 'walking' | 'root-fifth' | 'every-beat' | 'downbeat';
  pad: 'organ' | 'warm';
  /** Short "pah pah" chords on weak beats (waltz). */
  stabs: boolean;
  /** Per-instrument level multipliers. */
  level: { kick: number; snare: number; brush: number; sleigh: number; bass: number; pad: number };
}

export const STYLES: Record<StyleId, StylePreset> = {
  'sleigh-ride': {
    id: 'sleigh-ride',
    label: 'Sleigh ride',
    kick: 'strong',
    snare: true,
    brush: 'none',
    sleigh: 'subdivisions',
    shake: true,
    bass: 'walking',
    pad: 'organ',
    stabs: false,
    level: { kick: 0.85, snare: 0.55, brush: 0, sleigh: 0.75, bass: 0.9, pad: 0.6 },
  },
  march: {
    id: 'march',
    label: 'March',
    kick: 'strong',
    snare: true,
    brush: 'none',
    sleigh: 'beats',
    shake: false,
    bass: 'every-beat',
    pad: 'organ',
    stabs: false,
    level: { kick: 0.75, snare: 0.4, brush: 0, sleigh: 0.55, bass: 0.85, pad: 0.65 },
  },
  waltz: {
    id: 'waltz',
    label: 'Waltz',
    kick: 'downbeat',
    snare: false,
    brush: 'weak',
    sleigh: 'weak',
    shake: false,
    bass: 'downbeat',
    pad: 'organ',
    stabs: true,
    level: { kick: 0.6, snare: 0, brush: 0.5, sleigh: 0.55, bass: 0.9, pad: 0.35 },
  },
  gentle: {
    id: 'gentle',
    label: 'Gentle',
    kick: 'none',
    snare: false,
    brush: 'all',
    sleigh: 'downbeat',
    shake: false,
    bass: 'downbeat',
    pad: 'warm',
    stabs: false,
    level: { kick: 0, snare: 0, brush: 0.3, sleigh: 0.35, bass: 0.75, pad: 0.85 },
  },
};

export const isStyle = (s: unknown): s is StyleId => typeof s === 'string' && s in STYLES;

/** Chart style if known; otherwise a default from the meter and tempo. */
export function resolveStyle(tl: Timeline, override?: string): StylePreset {
  if (isStyle(override)) return STYLES[override];
  if (isStyle(tl.style)) return STYLES[tl.style];
  const b = tl.beats.find((x) => x.chord) ?? tl.beats[0];
  if (b.div === 3 || b.dur > 0.85) return STYLES.gentle;
  if (b.beatsPerBar === 3) return STYLES.waltz;
  return STYLES.march;
}

// ── bell-part exclusions (don't double what the bells play) ─────────────────────
export interface BellNote {
  time: number;
  dur: number;
  midi: number;
  role?: 'melody' | 'bass' | 'inner';
}
export interface Exclusions {
  /** Spans where a bass bell sounds: the backing bass rests there. */
  bass: { start: number; end: number }[];
  /** Inner (harmony) bells: their pitch classes are left out of the pad while they sound. */
  inner: { start: number; end: number; pc: number }[];
}

/** Bass/inner bell notes of the selected part (rung by players or by the host) → exclusions. */
export function exclusionsFrom(notes: BellNote[]): Exclusions {
  const bass: Exclusions['bass'] = [];
  const inner: Exclusions['inner'] = [];
  for (const n of notes) {
    const span = { start: n.time, end: n.time + Math.max(0.1, n.dur) };
    if (n.role === 'bass') bass.push(span);
    else if (n.role === 'inner') inner.push({ ...span, pc: ((n.midi % 12) + 12) % 12 });
  }
  return { bass, inner };
}

const OVERLAP = 0.02;
const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => Math.min(a1, b1) - Math.max(a0, b0) > OVERLAP;

// ── generation ──────────────────────────────────────────────────────────────────
export interface GenerateOptions {
  style?: string;
  exclusions?: Exclusions;
  /** Seed for the small velocity humanisation (same seed → same events). */
  seed?: string;
}

const BASS_LOW = 40; // E2: audible on TV speakers, an octave+ below the lowest sounding bell
const PAD_LOW = 50; // D3
const PAD_HIGH = 67; // G4

const placeAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Closest-position voicing in the pad register, moving as little as possible from `prev`. */
export function voice(pcs: number[], prevCenter: number): number[] {
  const out = pcs.map((pc) => {
    let best = placeAbove(pc, PAD_LOW);
    for (let m = best; m <= PAD_HIGH; m += 12) if (Math.abs(m - prevCenter) < Math.abs(best - prevCenter)) best = m;
    return best;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

const fifthOf = (c: Chord): number => (c.tones.length >= 3 ? c.tones[2] : (c.root + 7) % 12);
const r4 = (x: number): number => Math.round(x * 10000) / 10000;

export function generateBacking(tl: Timeline, opts: GenerateOptions = {}): BackingEvent[] {
  const style = resolveStyle(tl, opts.style);
  const L = style.level;
  const ex = opts.exclusions ?? { bass: [], inner: [] };
  const rand = mulberry32(hash(opts.seed ?? 'go-go-harmoniyo'));
  const human = (v: number): number => Math.max(0, Math.min(1, v * (0.94 + rand() * 0.12)));
  const out: BackingEvent[] = [];
  const add = (e: BackingEvent): void => {
    if (e.vel > 0) out.push({ ...e, time: r4(e.time), ...(e.dur !== undefined ? { dur: r4(e.dur) } : {}) });
  };

  const beats = tl.beats;
  const first = beats.findIndex((b) => b.chord);
  if (first < 0) return [];
  const lastBar = beats[beats.length - 1].bar;
  const playing = beats.slice(first);

  // Drums + sleigh bells.
  for (const b of playing) {
    const final = b.bar === lastBar;
    if (final && b.beat !== 0) continue; // the last bar is one ringing downbeat
    const even = b.beatsPerBar % 2 === 0;
    const backbeat = !b.strong && even;
    if ((style.kick === 'strong' && b.strong) || ((style.kick === 'downbeat' || final) && style.kick !== 'none' && b.beat === 0)) add({ time: b.time, inst: 'kick', vel: human((b.beat === 0 ? 0.9 : 0.75) * L.kick) });
    if (style.snare && backbeat && !final) add({ time: b.time, inst: 'snare', vel: human(0.6 * L.snare) });
    if ((style.brush === 'all' || (style.brush === 'weak' && b.beat !== 0)) && !final) add({ time: b.time, inst: 'brush', vel: human(0.6 * L.brush) });
    const sub = b.dur / b.div;
    if (final) {
      add({ time: b.time, inst: 'shake', vel: human(0.8 * L.sleigh) });
      continue;
    }
    if (style.sleigh === 'subdivisions') {
      for (let s = 0; s < b.div; s++) {
        if (s === 0 && style.shake && backbeat) add({ time: b.time, inst: 'shake', vel: human(0.75 * L.sleigh) });
        else add({ time: b.time + s * sub, inst: 'sleigh', vel: human((s === 0 ? (b.beat === 0 ? 0.7 : 0.55) : 0.35) * L.sleigh) });
      }
    } else if (style.sleigh === 'beats') add({ time: b.time, inst: 'sleigh', vel: human((b.beat === 0 ? 0.7 : 0.5) * L.sleigh) });
    else if (style.sleigh === 'weak' && b.beat !== 0) {
      add({ time: b.time, inst: 'sleigh', vel: human(0.6 * L.sleigh) });
      add({ time: b.time + sub, inst: 'sleigh', vel: human(0.25 * L.sleigh) });
    } else if (style.sleigh === 'downbeat' && b.beat === 0) add({ time: b.time, inst: 'shake', vel: human(0.5 * L.sleigh) });
  }

  // Bass line.
  const bassHits: { time: number; midi: number; vel: number; chord: Chord }[] = [];
  playing.forEach((b, i) => {
    const c = b.chord;
    if (!c) return;
    const prev = i > 0 ? playing[i - 1].chord : null;
    const change = prev !== c;
    const final = b.bar === lastBar;
    if (final && b.beat !== 0) return;
    let pc: number | null = null;
    let midi: number | null = null;
    if (change || b.beat === 0) pc = c.bass;
    else if (style.bass === 'every-beat') pc = b.strong ? c.bass : fifthOf(c);
    else if ((style.bass === 'root-fifth' || style.bass === 'walking') && b.strong) pc = fifthOf(c);
    if (style.bass === 'walking' && b.beat === b.beatsPerBar - 1 && b.beatsPerBar >= 4 && !change) {
      const next = playing[i + 1]?.chord;
      if (next && next !== c) {
        // Chromatic approach into the next root (from below, or above at the bottom of the range).
        const target = placeAbove(next.bass, BASS_LOW);
        midi = target - 1 >= BASS_LOW ? target - 1 : target + 1;
      } else if (next) pc = c.tones[1] ?? null;
    }
    if (style.bass === 'downbeat' && !(change || b.beat === 0)) pc = null;
    if (midi === null && pc !== null) midi = placeAbove(pc, BASS_LOW);
    if (midi === null) return;
    const vel = (b.beat === 0 ? 0.85 : 0.7) * L.bass;
    bassHits.push({ time: b.time, midi, vel, chord: c });
  });
  bassHits.forEach((h, i) => {
    const nextT = bassHits[i + 1]?.time ?? tl.end;
    const end = Math.min(nextT, Math.max(h.chord.end, h.time + 0.1), tl.end);
    const dur = Math.max(0.08, (end - h.time) * 0.92);
    if (ex.bass.some((s) => overlaps(h.time, h.time + dur, s.start, s.end))) return;
    add({ time: h.time, inst: 'bass', vel: human(h.vel), dur, midi: h.midi });
  });

  // Pad: one sustained chord per chord symbol (from the first played beat), voice-led.
  let center = 58;
  const padFrom = playing[0].time;
  for (const c of tl.chords) {
    const start = Math.max(c.time, padFrom);
    if (c.end <= start + 0.05) continue;
    const held = new Set(ex.inner.filter((s) => overlaps(start, c.end, s.start, s.end)).map((s) => s.pc));
    let pcs = c.tones.filter((pc) => !held.has(pc));
    if (!pcs.length) pcs = [c.root];
    const midis = voice(pcs, center);
    center = midis.reduce((a, m) => a + m, 0) / midis.length;
    const isFinal = c === tl.chords[tl.chords.length - 1];
    add({ time: start, inst: 'pad', vel: (style.stabs ? 0.4 : 1) * 0.7 * L.pad, dur: c.end - start + (isFinal ? 1.5 : 0), midis, tone: style.pad });
    if (style.stabs) {
      for (const b of playing) {
        if (b.chord !== c || b.beat === 0 || b.bar === lastBar) continue;
        add({ time: b.time, inst: 'stab', vel: human(0.75), dur: b.dur * 0.45, midis, tone: 'organ' });
      }
    }
  }

  const order: Instrument[] = ['kick', 'snare', 'brush', 'sleigh', 'shake', 'bass', 'pad', 'stab'];
  return out.sort((a, b) => a.time - b.time || order.indexOf(a.inst) - order.indexOf(b.inst));
}

/** Short description for the lobby, e.g. "Sleigh ride · chords from the lead sheet". */
export function describe(tl: Timeline | null, style?: StylePreset): string {
  if (!tl) return 'no chord data in this chart';
  const s = style ?? resolveStyle(tl);
  return `${s.label} · ${tl.source === 'lead-sheet' ? 'chords from the lead sheet' : 'chords inferred from the score'}`;
}
