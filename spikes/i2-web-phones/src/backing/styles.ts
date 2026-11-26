import type { Timeline } from './timeline';

export type StyleId = 'sleigh-ride' | 'march' | 'waltz' | 'gentle';
export type PadTone = 'felt' | 'nylon';

export interface StylePreset {
  id: StyleId;
  label: string;
  tone: PadTone;
  bassPulse: boolean;
  offbeatKeys: boolean;
}

export const STYLES: Record<StyleId, StylePreset> = {
  'sleigh-ride': { id: 'sleigh-ride', label: 'Sleigh ride', tone: 'felt', bassPulse: true, offbeatKeys: false },
  march: { id: 'march', label: 'March', tone: 'felt', bassPulse: true, offbeatKeys: false },
  waltz: { id: 'waltz', label: 'Waltz', tone: 'nylon', bassPulse: false, offbeatKeys: true },
  gentle: { id: 'gentle', label: 'Gentle', tone: 'felt', bassPulse: false, offbeatKeys: false },
};

export const isStyle = (s: unknown): s is StyleId => typeof s === 'string' && Object.hasOwn(STYLES, s);

export function resolveStyle(tl: Timeline, override?: string): StylePreset {
  if (isStyle(override)) return STYLES[override];
  if (isStyle(tl.style)) return STYLES[tl.style];
  const b = tl.beats.find((x) => x.chord) ?? tl.beats[0];
  if (b.div === 3 || b.dur > 0.85) return STYLES.gentle;
  if (b.beatsPerBar === 3) return STYLES.waltz;
  return STYLES.march;
}
