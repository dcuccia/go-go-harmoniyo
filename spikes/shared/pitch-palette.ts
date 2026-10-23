// Pitch-class palette (docs/design/visual-identity.md): a bell's colour follows its pitch class,
// never its lane index. Single source of truth for the S1, S4 and I2 spikes; the hex values live
// only in docs/design/pitch-class-palette.json. Dependency-free (no DOM, no three.js).
import palette from '../../docs/design/pitch-class-palette.json';

export interface PitchClassColor {
  pc: number;
  name: string;
  token: string;
  hex: string;
  oklch: number[];
}

export const PITCH_CLASSES: readonly PitchClassColor[] = palette.pitchClasses;
/** Stage / highway backdrop the palette was checked against. */
export const STAGE_BACKGROUND: string = palette.background;
/** Label text colour on top of a palette fill. */
export const TEXT_ON_FILL: string = palette.textOnFill;

const ACCIDENTALS = new Set([1, 3, 6, 8, 10]);

export const pitchClass = (midi: number): number => ((Math.round(midi) % 12) + 12) % 12;

/** Sharps/flats get a deeper colour and a ring outline (so colour is never the only cue). */
export const isAccidental = (midi: number): boolean => ACCIDENTALS.has(pitchClass(midi));

/** Palette entry for a MIDI pitch (any octave). */
export const pitchClassColor = (midi: number): PitchClassColor => PITCH_CLASSES[pitchClass(midi)];

/** `#rrggbb` colour for a MIDI pitch (any octave). */
export const pitchColor = (midi: number): string => pitchClassColor(midi).hex;
