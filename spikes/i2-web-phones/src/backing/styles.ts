// Backing style presets: which instruments play what, per style. Pure data + lookup; the
// pattern generators (patterns.ts, flourishes.ts) read these, the synth (synth.ts) voices them.
// Adding a style = adding a preset here (and, if it needs new sounds, a voice in synth.ts).
import type { Timeline } from './timeline';

export type StyleId = 'sleigh-ride' | 'march' | 'waltz' | 'gentle';

/** Sustained chord voices (synth.ts): drawbar organ, slow warm pad, bowed strings. */
export type PadTone = 'organ' | 'warm' | 'strings';

export interface StylePreset {
  id: StyleId;
  label: string;
  kick: 'strong' | 'downbeat' | 'none';
  snare: boolean;
  brush: 'weak' | 'all' | 'none';
  /** Closed hi-hat: on every subdivision, off-beats only, or none. */
  hat: 'subdivisions' | 'offbeats' | 'none';
  sleigh: 'subdivisions' | 'beats' | 'weak' | 'downbeat';
  /** Long sleigh shake on the backbeat (weak beats in even meters). */
  shake: boolean;
  bass: 'walking' | 'root-fifth' | 'every-beat' | 'downbeat';
  /** Odd phrases vary the bass line (approach notes, octave leaps, fifths). */
  bassVariation: boolean;
  pad: PadTone;
  /** A second pad voice that joins for the last phrase (a lift into the ending). */
  lift: PadTone | null;
  /** Short "pah pah" chords on weak beats (waltz). */
  stabs: boolean;
  /** Celesta broken chords: none, in odd phrases, or throughout. */
  celesta: 'none' | 'odd-phrases' | 'all';
  /** Phrase-end fill: drum fill (snare/toms), brush swell, or bells only (sleigh roll + glock). */
  fill: 'snare' | 'toms' | 'brush' | 'bells';
  /** Per-instrument level multipliers. */
  level: { kick: number; snare: number; brush: number; hat: number; sleigh: number; bass: number; pad: number; celesta: number; glock: number };
}

export const STYLES: Record<StyleId, StylePreset> = {
  'sleigh-ride': {
    id: 'sleigh-ride',
    label: 'Sleigh ride',
    kick: 'strong',
    snare: true,
    brush: 'none',
    hat: 'none',
    sleigh: 'subdivisions',
    shake: true,
    bass: 'walking',
    bassVariation: true,
    pad: 'organ',
    lift: 'strings',
    stabs: false,
    celesta: 'odd-phrases',
    fill: 'snare',
    level: { kick: 0.85, snare: 0.55, brush: 0, hat: 0, sleigh: 0.75, bass: 0.9, pad: 0.6, celesta: 0.5, glock: 0.55 },
  },
  march: {
    id: 'march',
    label: 'March',
    kick: 'strong',
    snare: true,
    brush: 'none',
    hat: 'offbeats',
    sleigh: 'beats',
    shake: false,
    bass: 'every-beat',
    bassVariation: true,
    pad: 'organ',
    lift: 'strings',
    stabs: false,
    celesta: 'none',
    fill: 'toms',
    level: { kick: 0.75, snare: 0.4, brush: 0, hat: 0.4, sleigh: 0.55, bass: 0.85, pad: 0.65, celesta: 0, glock: 0.5 },
  },
  waltz: {
    id: 'waltz',
    label: 'Waltz',
    kick: 'downbeat',
    snare: false,
    brush: 'weak',
    hat: 'none',
    sleigh: 'weak',
    shake: false,
    bass: 'downbeat',
    bassVariation: true,
    pad: 'strings',
    lift: null,
    stabs: true,
    celesta: 'odd-phrases',
    fill: 'brush',
    level: { kick: 0.6, snare: 0, brush: 0.5, hat: 0, sleigh: 0.55, bass: 0.9, pad: 0.4, celesta: 0.45, glock: 0.5 },
  },
  gentle: {
    id: 'gentle',
    label: 'Gentle',
    kick: 'none',
    snare: false,
    brush: 'all',
    hat: 'none',
    sleigh: 'downbeat',
    shake: false,
    bass: 'downbeat',
    bassVariation: true,
    pad: 'warm',
    lift: 'strings',
    stabs: false,
    celesta: 'all',
    fill: 'bells',
    level: { kick: 0, snare: 0, brush: 0.3, hat: 0, sleigh: 0.35, bass: 0.75, pad: 0.85, celesta: 0.4, glock: 0.4 },
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
