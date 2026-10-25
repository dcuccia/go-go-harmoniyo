// Procedural backing patterns: chord timeline + style preset → a deterministic list of timed
// instrument events (song seconds). Pure logic; synth.ts turns events into sound.
// Layers: drums + sleigh bells, bass line, harmony (pad, lift, stabs, celesta); phrase-level
// fills/flourishes and the ending live in flourishes.ts, phrase structure in phrases.ts, style
// presets in styles.ts.
import { ending, fill, fillBeats, landing } from './flourishes';
import { phraseIndexer, phrases } from './phrases';
import { resolveStyle, type PadTone, type StylePreset } from './styles';
import type { Beat, Chord, Timeline } from './timeline';

export { isStyle, resolveStyle, STYLES, type PadTone, type StyleId, type StylePreset } from './styles';

export type Instrument = 'kick' | 'snare' | 'brush' | 'hat' | 'tom' | 'crash' | 'sleigh' | 'shake' | 'bass' | 'pad' | 'stab' | 'celesta' | 'glock';

export interface BackingEvent {
  time: number;
  inst: Instrument;
  /** 0..1 */
  vel: number;
  /** Seconds (bass, pad, stab, celesta, glock; brush swell). */
  dur?: number;
  /** MIDI pitch (bass, tom, celesta, glock). */
  midi?: number;
  /** MIDI pitches (pad, stab). */
  midis?: number[];
  /** Pad voice. */
  tone?: PadTone;
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
const BASS_HIGH = 57; // A3
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
  const ps = phrases(tl);
  const phraseOf = phraseIndexer(ps);
  const odd = (b: Beat): boolean => (phraseOf(b.bar)?.index ?? 0) % 2 === 1;
  const finalPhrase = ps[ps.length - 1];

  // Phrase-end fills: the last beat(s) of each phrase's last bar, and of the bar before the final
  // bar (a fill into the ending). The groove rests under a fill.
  const fillBars = new Set<number>([...ps.filter((p) => !p.final).map((p) => p.lastBar), lastBar - 1]);
  const barBeats = new Map<number, Beat[]>();
  for (const b of playing) barBeats.set(b.bar, [...(barBeats.get(b.bar) ?? []), b]);
  const inFill = new Set<Beat>();
  for (const bar of fillBars) {
    const bb = barBeats.get(bar);
    if (!bb || bar < playing[0].bar || bar >= lastBar) continue;
    const fb = bb.slice(-fillBeats(style, bb[0].beatsPerBar));
    fb.forEach((b) => inFill.add(b));
    const nextBeat = playing.find((b) => b.bar === bar + 1);
    const glock = style.fill === 'bells' || (phraseOf(bar)?.index ?? 0) % 2 === 1 || bar === lastBar - 1;
    fill(style, fb, nextBeat?.chord ?? null, glock, human, add);
    if (nextBeat && nextBeat.bar !== lastBar) landing(style, nextBeat.time, human, add);
  }

  // Drums, hats + sleigh bells.
  for (const b of playing) {
    const final = b.bar === lastBar;
    if (final) continue; // the last bar is the ending (flourishes.ts)
    if (inFill.has(b)) continue;
    const even = b.beatsPerBar % 2 === 0;
    const backbeat = !b.strong && even;
    const sub = b.dur / b.div;
    if ((style.kick === 'strong' && b.strong) || (style.kick === 'downbeat' && b.beat === 0)) add({ time: b.time, inst: 'kick', vel: human((b.beat === 0 ? 0.9 : 0.75) * L.kick) });
    if (style.snare && backbeat) add({ time: b.time, inst: 'snare', vel: human(0.6 * L.snare) });
    // A ghost note before the backbeat in odd phrases (a little lift).
    if (style.snare && backbeat && odd(b)) add({ time: b.time - sub / 2, inst: 'snare', vel: human(0.2 * L.snare) });
    if (style.brush === 'all' || (style.brush === 'weak' && b.beat !== 0)) add({ time: b.time, inst: 'brush', vel: human(0.6 * L.brush) });
    if (style.hat !== 'none') {
      for (let s = 0; s < b.div; s++) {
        if (style.hat === 'offbeats' && s === 0) continue;
        add({ time: b.time + s * sub, inst: 'hat', vel: human((s === 0 ? 0.6 : 0.45) * L.hat) });
      }
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
  const bassHits: { time: number; midi: number; vel: number; chord: Chord; final: boolean }[] = [];
  let prevBarChord: Chord | null = null;
  playing.forEach((b, i) => {
    const c = b.chord;
    if (!c) return;
    const prev = i > 0 ? playing[i - 1].chord : null;
    const change = prev !== c;
    const final = b.bar === lastBar;
    if (final && b.beat !== 0) return;
    const vary = style.bassVariation && odd(b) && !final;
    let pc: number | null = null;
    let midi: number | null = null;
    if (change || b.beat === 0) pc = c.bass;
    else if (style.bass === 'every-beat') pc = b.strong ? c.bass : fifthOf(c);
    else if ((style.bass === 'root-fifth' || style.bass === 'walking') && b.strong) pc = fifthOf(c);
    else if (vary && (style.bass === 'walking' || style.bass === 'root-fifth')) pc = c.tones[1] ?? null; // walk through the third
    if (style.bass === 'walking' && b.beat === b.beatsPerBar - 1 && b.beatsPerBar >= 4 && !change) {
      const next = playing[i + 1]?.chord;
      if (next && next !== c) {
        // Chromatic approach into the next root (from below, or above at the bottom of the range).
        const target = placeAbove(next.bass, BASS_LOW);
        midi = target - 1 >= BASS_LOW ? target - 1 : target + 1;
      } else if (next) pc = c.tones[1] ?? null;
    }
    if (style.bass === 'downbeat' && !(change || b.beat === 0)) {
      // Variation: a fifth on the middle beat of even bars.
      pc = vary && b.beatsPerBar % 2 === 0 && b.beat === b.beatsPerBar / 2 ? fifthOf(c) : null;
    }
    // Variation: alternating bass — the fifth on the downbeat when the chord carries over the bar line.
    if (vary && style.bass === 'downbeat' && b.beat === 0 && !change && prevBarChord === c) pc = fifthOf(c);
    if (b.beat === 0) prevBarChord = c;
    if (midi === null && pc !== null) midi = placeAbove(pc, BASS_LOW);
    // Variation (march): the root an octave up on the third beat.
    if (vary && style.bass === 'every-beat' && b.strong && b.beat !== 0 && midi !== null && midi + 12 <= BASS_HIGH) midi = placeAbove(c.bass, BASS_LOW) + 12;
    if (midi === null) return;
    const vel = (b.beat === 0 ? 0.85 : 0.7) * L.bass;
    bassHits.push({ time: b.time, midi, vel, chord: c, final });
  });
  bassHits.forEach((h, i) => {
    const nextT = bassHits[i + 1]?.time ?? tl.end;
    // Final note: held through the ending (fermata).
    const end = h.final ? h.time + FERMATA * finalBarDur(tl) : Math.min(nextT, Math.max(h.chord.end, h.time + 0.1), tl.end);
    const dur = Math.max(0.08, (end - h.time) * 0.92);
    if (ex.bass.some((s) => overlaps(h.time, h.time + (h.final ? Math.min(dur, 1) : dur), s.start, s.end))) return;
    add({ time: h.time, inst: 'bass', vel: human(h.vel), dur, midi: h.midi });
  });

  // Harmony: one sustained pad chord per chord symbol (voice-led), a lift voice in the last
  // phrase, waltz stabs, celesta broken chords.
  let center = 58;
  const padFrom = playing[0].time;
  const lastChord = tl.chords[tl.chords.length - 1];
  for (const c of tl.chords) {
    const start = Math.max(c.time, padFrom);
    if (c.end <= start + 0.05) continue;
    const held = new Set(ex.inner.filter((s) => overlaps(start, c.end, s.start, s.end)).map((s) => s.pc));
    let pcs = c.tones.filter((pc) => !held.has(pc));
    if (!pcs.length) pcs = [c.root];
    const midis = voice(pcs, center);
    center = midis.reduce((a, m) => a + m, 0) / midis.length;
    const isFinal = c === lastChord;
    const dur = isFinal ? Math.max(c.end - start, FERMATA * finalBarDur(tl)) + 1 : c.end - start;
    add({ time: start, inst: 'pad', vel: (style.stabs ? 0.4 : 1) * 0.7 * L.pad, dur, midis, tone: style.pad });
    if (style.lift && finalPhrase && start >= finalPhrase.start - 1e-6) add({ time: start, inst: 'pad', vel: 0.45 * L.pad, dur, midis, tone: style.lift });
    for (const b of playing) {
      if (b.chord !== c || b.bar === lastBar || inFill.has(b)) continue;
      if (style.stabs && b.beat !== 0) add({ time: b.time, inst: 'stab', vel: human(0.75), dur: b.dur * 0.45, midis, tone: 'organ' });
      if (style.celesta === 'all' || (style.celesta === 'odd-phrases' && odd(b))) {
        const arp = midis.map((m) => m + 12);
        const order = b.beatsPerBar === 3 ? [0, 1, 2] : [0, 1, 2, 1];
        const m = arp[order[b.beat % order.length] % arp.length];
        add({ time: b.time, inst: 'celesta', vel: human((b.beat === 0 ? 0.6 : 0.45) * L.celesta), dur: b.dur, midi: m });
      }
    }
  }

  // Ending: the last bar's downbeat rings with the bells, then the ritardando tag.
  const finalDown = playing.find((b) => b.bar === lastBar && b.beat === 0);
  if (finalDown?.chord) ending(style, finalDown, finalDown.chord, human, add);

  const order: Instrument[] = ['kick', 'snare', 'tom', 'brush', 'hat', 'crash', 'sleigh', 'shake', 'bass', 'pad', 'stab', 'celesta', 'glock'];
  return out.sort((a, b) => a.time - b.time || order.indexOf(a.inst) - order.indexOf(b.inst));
}

/** Fermata: the final chord and bass are held this many bars from the last downbeat. */
export const FERMATA = 1.6;
const finalBarDur = (tl: Timeline): number => {
  const b = tl.beats[tl.beats.length - 1];
  return b.dur * b.beatsPerBar;
};

/** Practice speed: event times and lengths for a song played at `speed` × tempo (0.5 = half speed). */
export function scaleEvents(events: BackingEvent[], speed: number): BackingEvent[] {
  if (!(speed > 0) || speed === 1) return events;
  return events.map((e) => ({ ...e, time: r4(e.time / speed), ...(e.dur !== undefined ? { dur: r4(e.dur / speed) } : {}) }));
}
/** Short description for the lobby, e.g. "Sleigh ride · chords from the lead sheet". */
export function describe(tl: Timeline | null, style?: StylePreset): string {
  if (!tl) return 'no chord data in this chart';
  const s = style ?? resolveStyle(tl);
  return `${s.label} · ${tl.source === 'lead-sheet' ? 'chords from the lead sheet' : 'chords inferred from the score'}`;
}
