import type { S5Chart, S5Part } from '../team-chart';

export type PreviewForm = 'short' | 'full';
export type PreviewVoice = 'harp' | 'bass' | 'pad';
type WrittenEvent = [beat: number, offset: number, length: number, midi: number, voice: PreviewVoice, velocity: number];
export interface PreviewEvent {
  time: number;
  dur: number;
  midi: number;
  voice: PreviewVoice;
  vel: number;
}

export function scoreEvents(input: unknown, chart: S5Chart): PreviewEvent[] {
  const where = `${chart.song.id}/${chart.form?.id}`;
  if (!Array.isArray(input) || !input.length || input.length > 4096) throw new Error(`${where}: expected 1–4096 backing events`);
  const grid = chart.harmony?.beats.map((b) => b.time) ?? [];
  if (!grid.length) throw new Error(`${where}: no chart beat grid`);
  grid.push(chart.timing.durationSec);
  const timeAt = (at: number): number => {
    const i = Math.floor(at);
    return i === grid.length - 1 ? grid[i] : grid[i] + (grid[i + 1] - grid[i]) * (at - i);
  };
  return input.map((row, i) => {
    if (!isWrittenEvent(row)) throw new Error(`${where}: invalid backing event ${i + 1}`);
    const [beat, offset, length, midi, voice, vel] = row;
    const start = beat + offset;
    const end = start + length;
    if (end > grid.length - 1 + 1e-8) throw new Error(`${where}: event ${i + 1} exceeds the chart beat grid`);
    const time = timeAt(start);
    const dur = timeAt(Math.min(end, grid.length - 1)) - time;
    if (!(time >= 0 && dur > 0) || dur > 20) throw new Error(`${where}: event ${i + 1} falls outside playable time`);
    return { time, dur, midi, voice, vel };
  }).sort((a, b) => a.time - b.time);
}

function isWrittenEvent(row: unknown): row is WrittenEvent {
  if (!Array.isArray(row) || row.length !== 6) return false;
  const [beat, offset, length, midi, voice, velocity] = row;
  return Number.isInteger(beat) && beat >= 0 &&
    Number.isFinite(offset) && offset >= 0 && offset < 1 &&
    Number.isFinite(length) && length > 0 && length <= 16 &&
    (voice === 'harp' || voice === 'bass' || voice === 'pad') &&
    Number.isInteger(midi) && (voice === 'harp' ? midi >= 36 && midi <= 76 : midi >= 24 && midi <= 96) &&
    Number.isFinite(velocity) && velocity > 0 && velocity <= 1;
}

/** Keep occupied harmony roles clear without suppressing a consonant bass below the melody. */
export function protectBells(events: PreviewEvent[], chart: S5Chart, part: S5Part): PreviewEvent[] {
  const pitches = new Map(chart.bells.map((b) => [b.id, b.midi]));
  const bells = [...part.notes, ...(part.guide ?? [])].map((n) => ({
    start: n.time,
    end: n.time + (n.durSec ?? 0.5),
    midi: pitches.get(n.bell),
    role: n.role,
  }));
  return events.filter((e) => !bells.some((b) => {
    if (b.midi === undefined || Math.min(e.time + e.dur, b.end) - Math.max(e.time, b.start) <= 0.001) return false;
    const written = Math.abs(b.midi - e.midi);
    const sounding = Math.abs(b.midi + 12 - e.midi);
    return (b.role === 'bass' && (e.voice === 'bass' || e.midi <= 55)) ||
      ((b.role === 'bass' || b.role === 'inner') && written <= 24 && written % 12 === 0) ||
      sounding <= 1 || sounding === 11 || sounding === 13;
  }));
}
