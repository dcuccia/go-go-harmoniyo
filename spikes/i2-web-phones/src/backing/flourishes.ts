import type { BackingEvent } from './patterns';
import type { Beat, Chord } from './timeline';

const placeAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);
export const RIT_RATIO = 1.25;

/** Unchanged closing gesture and grid, now softly plucked below the bell register. */
export function ending(finalBeat: Beat, chord: Chord): BackingEvent[] {
  const base = [...new Set(chord.tones.map((pc) => placeAbove(pc, 55)))].sort((a, b) => a - b);
  if (!base.length) return [];
  const notes = Array.from({ length: 5 }, (_, i) => base[i % base.length] + 12 * Math.floor(i / base.length)).reverse();
  // When the score omits the root, close on the lowest supported chord tone instead.
  notes.push(base.find((m) => m % 12 === chord.root) ?? base[0]);
  let time = finalBeat.time;
  let gap = finalBeat.dur * finalBeat.beatsPerBar / 10;
  return notes.map((midi, i) => {
    time += gap;
    gap *= RIT_RATIO;
    return { time, inst: 'tag', midi, vel: i === notes.length - 1 ? 0.29 : 0.24, dur: i === notes.length - 1 ? 1.4 : 0.45 };
  });
}
