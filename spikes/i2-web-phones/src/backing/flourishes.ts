// Phrase-level embellishments of the backing: drum fills at phrase ends, sleigh-bell rolls and
// glockenspiel glissandos into the next phrase, and the ritardando ending tag. Pure logic: returns
// events for patterns.ts to merge. Times are song seconds.
import type { BackingEvent } from './patterns';
import type { StylePreset } from './styles';
import type { Beat, Chord } from './timeline';

type Add = (e: BackingEvent) => void;

const GLOCK_LOW = 79; // G5: above the pad, a bright sparkle that is not a handbell timbre
const placeAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);

/** Chord tones ascending from `low`, `n` notes (wrapping up an octave). */
export function arpeggio(c: Chord, low: number, n: number): number[] {
  const base = [...new Set(c.tones.map((pc) => placeAbove(pc, low)))].sort((a, b) => a - b);
  return Array.from({ length: n }, (_, i) => base[i % base.length] + 12 * Math.floor(i / base.length));
}

/** How many beats at the end of a phrase-end bar the fill replaces. */
export function fillBeats(style: StylePreset, beatsPerBar: number): number {
  return style.fill === 'toms' && beatsPerBar >= 4 ? 2 : 1;
}

/**
 * The fill over `beats` (the last beat(s) of a phrase-end bar), leading into `next` (the chord of
 * the next phrase's downbeat, if any). `glock` adds a glockenspiel glissando (every other phrase).
 */
export function fill(style: StylePreset, beats: Beat[], next: Chord | null, glock: boolean, human: (v: number) => number, add: Add): void {
  if (!beats.length) return;
  const L = style.level;
  const t0 = beats[0].time;
  const span = beats.reduce((a, b) => a + b.dur, 0);
  const hits: number[] = [];
  for (const b of beats) {
    const n = style.fill === 'toms' ? b.div * 2 : b.div;
    for (let k = 0; k < n; k++) hits.push(b.time + (k * b.dur) / n);
  }
  const ramp = (i: number): number => 0.45 + (0.5 * i) / Math.max(1, hits.length - 1);
  switch (style.fill) {
    case 'snare':
      hits.forEach((t, i) => add({ time: t, inst: 'snare', vel: human(ramp(i) * Math.max(0.5, L.snare)) }));
      add({ time: t0, inst: 'kick', vel: human(0.7 * L.kick) });
      break;
    case 'toms':
      // Down the toms, high to low, with a crescendo.
      hits.forEach((t, i) => add({ time: t, inst: 'tom', vel: human(ramp(i) * 0.75), midi: Math.round(57 - (12 * i) / Math.max(1, hits.length - 1)) }));
      add({ time: t0, inst: 'kick', vel: human(0.7 * L.kick) });
      break;
    case 'brush':
      add({ time: t0, inst: 'brush', vel: human(0.8 * Math.max(0.3, L.brush)), dur: span });
      break;
    case 'bells':
      break;
  }
  // Sleigh-bell roll: jingles on every half-subdivision, swelling into the next phrase.
  if (style.fill !== 'snare' || glock) {
    const steps = Math.max(4, Math.round((span / (beats[0].dur / beats[0].div)) * 2));
    for (let k = 0; k < steps; k++) add({ time: t0 + (k * span) / steps, inst: 'sleigh', vel: human((0.25 + (0.5 * k) / steps) * Math.max(0.4, L.sleigh)) });
  }
  if (glock && next) {
    const notes = arpeggio(next, GLOCK_LOW, 5);
    const last = beats[beats.length - 1];
    const step = last.dur / 6; // tempo-relative, so practice speed slows it too
    notes.forEach((m, i) => add({ time: last.time + last.dur - (notes.length - i) * step, inst: 'glock', vel: human((0.45 + 0.1 * i) * L.glock), midi: m, dur: 0.6 }));
  }
}

/** Accent on the downbeat after a fill: a soft crash, or a sleigh shake for the drumless styles. */
export function landing(style: StylePreset, t: number, human: (v: number) => number, add: Add): void {
  if (style.fill === 'snare' || style.fill === 'toms') add({ time: t, inst: 'crash', vel: human(0.5) });
  else add({ time: t, inst: 'shake', vel: human(0.6 * Math.max(0.4, style.level.sleigh)) });
}

/** Ending tag gaps grow by this factor (ritardando). */
export const RIT_RATIO = 1.25;

/**
 * Ritardando ending over the final bar. The bells' last note rings on its downbeat, so the
 * song's own tempo is untouched; after it the backing holds the chord (fermata) while a
 * glockenspiel and sleigh bells step down the final chord with ever longer gaps, closing on a
 * low glock "ding" and a sleigh shake. Returns the time of the closing ding.
 */
export function ending(style: StylePreset, downbeat: Beat, chord: Chord, human: (v: number) => number, add: Add): number {
  const L = style.level;
  const bar = downbeat.dur * downbeat.beatsPerBar;
  const t = downbeat.time;
  if (style.kick !== 'none') add({ time: t, inst: 'kick', vel: human(0.9 * L.kick) });
  landing(style, t, human, add);
  const notes = arpeggio(chord, GLOCK_LOW, 5).reverse();
  let gap = bar / 10;
  let at = t;
  for (const m of notes) {
    at += gap;
    gap *= RIT_RATIO;
    add({ time: at, inst: 'glock', vel: human(0.5 * L.glock), midi: m, dur: 0.8 });
    add({ time: at, inst: 'sleigh', vel: human(0.3 * Math.max(0.4, L.sleigh)) });
  }
  at += gap;
  add({ time: at, inst: 'glock', vel: human(0.6 * L.glock), midi: placeAbove(chord.root, GLOCK_LOW - 12), dur: 2 });
  add({ time: at, inst: 'shake', vel: human(0.55 * Math.max(0.4, L.sleigh)) });
  return at;
}
