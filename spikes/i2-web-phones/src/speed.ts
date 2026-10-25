// Practice speed: play a song slower (50–100 %) by stretching the chart's time axis.
// Pure logic: no DOM, audio or network.
//
// Everything downstream reads song seconds from the (scaled) S5 chart, so one stretch makes all of
// it follow: highways, judging, the phones' cues, the backing groove and the count-in (generated
// from the scaled beat grid and chords), the tempo map and the song length. Judging windows are
// fixed in seconds, so they stay the same in real time: a slower song is not judged more loosely
// or more strictly, just slower. Bell pitches and sounds are unchanged (nothing is resampled).

/** Slowest practice speed (fraction of the written tempo). */
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1;
/** Lobby control step. */
export const SPEED_STEP = 0.05;
export const DEFAULT_SPEED = 1;

/** Snap to the 5 % grid within [SPEED_MIN, SPEED_MAX]; anything unreadable is full speed. */
export function clampSpeed(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_SPEED;
  const steps = Math.round((Math.min(SPEED_MAX, Math.max(SPEED_MIN, x)) - SPEED_MIN) / SPEED_STEP);
  return Math.round((SPEED_MIN + steps * SPEED_STEP) * 100) / 100;
}

/** Speed from a percentage string ("50", "75 %"); undefined when absent or not a number. */
export function parseSpeedPercent(s: string | null | undefined): number | undefined {
  if (s === null || s === undefined) return undefined;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? clampSpeed(v / 100) : undefined;
}

export const speedPercent = (speed: number): number => Math.round(speed * 100);

/** "75% speed", or '' at full speed (nothing to show). */
export const speedNote = (speed: number): string => (speed < 1 ? `${speedPercent(speed)}% speed` : '');

/**
 * Keys that hold song seconds in an S5 chart (the schema's `$defs/seconds`: `time`, plus `durSec`,
 * `durationSec` and any other `…Sec` field). Ticks, beats and bars are musical positions and do not
 * change. Matching by name keeps fields added later (e.g. sections of a backing form) in step,
 * as long as they follow the same naming.
 */
const isSecondsKey = (k: string): boolean => k === 'time' || /Sec$/.test(k);
/** Keys that hold a rate per minute (tempo). */
const isRateKey = (k: string): boolean => k === 'bpm';

function scaleValue(v: unknown, k: string, stretch: number): unknown {
  if (typeof v === 'number') return isSecondsKey(k) ? v * stretch : isRateKey(k) ? v / stretch : v;
  if (Array.isArray(v)) return v.map((x) => scaleValue(x, k, stretch));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [kk, vv] of Object.entries(v)) out[kk] = scaleValue(vv, kk, stretch);
    return out;
  }
  return v;
}

/**
 * The chart as heard at `speed` (0.5 = half tempo): every song time and duration × 1/speed, every
 * tempo × speed. Returns the same object at full speed; never mutates the input.
 */
export function scaleChart<T extends object>(chart: T, speed: number): T {
  const s = clampSpeed(speed);
  if (s === 1) return chart;
  return scaleValue(chart, '', 1 / s) as T;
}

/**
 * Highway scroll at `speed`: gems move slower in proportion and appear correspondingly earlier, so
 * the highway looks the same (same spacing between notes, same number of notes in view), just in
 * slow motion. `base` is the renderer's full-speed scroll (world units per second) and look-ahead (s).
 */
export function scaledScroll(base: { speed: number; lookAhead: number }, speed: number): { speed: number; lookAhead: number } {
  const s = clampSpeed(speed);
  return { speed: base.speed * s, lookAhead: base.lookAhead / s };
}
