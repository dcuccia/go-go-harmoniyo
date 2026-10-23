// Engine-neutral chart model + MIDI → chart conversion. No DOM / renderer dependencies.
import type { MidiFile } from './midi';

export interface Lane {
  index: number;
  pitch: number;
  name: string;
}

export interface ChartNote {
  id: number;
  /** Seconds from song start. */
  time: number;
  lane: number;
  pitch: number;
  velocity: number;
}

export interface BackingNote {
  time: number;
  pitch: number;
  velocity: number;
  duration: number;
}

export interface Chart {
  title: string;
  lanes: Lane[];
  notes: ChartNote[];
  /** Auto-played accompaniment, scheduled on the audio clock. */
  backing: BackingNote[];
  beatTimes: number[];
  beatsPerBar: number;
  bpm: number;
  duration: number;
  /** Melody pitches that did not fit in the lane budget (auto-played instead). */
  droppedPitches: number[];
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function pitchName(p: number): string {
  return NAMES[((p % 12) + 12) % 12] + String(Math.floor(p / 12) - 1);
}

export function pitchToHz(p: number): number {
  return 440 * Math.pow(2, (p - 69) / 12);
}

export interface ChartOptions {
  title: string;
  maxLanes?: number;
  playableTrack?: number;
}

const isBackingName = (name: string): boolean => /backing|accomp|bass|harmony|chord/i.test(name);

export function chartFromMidi(midi: MidiFile, opts: ChartOptions): Chart {
  const maxLanes = Math.max(1, Math.min(8, opts.maxLanes ?? 8));
  let playable = opts.playableTrack ?? midi.tracks.findIndex((t) => t.notes.length > 0 && !isBackingName(t.name));
  if (playable < 0) playable = midi.tracks.findIndex((t) => t.notes.length > 0);
  if (playable < 0) throw new Error('MIDI file contains no notes');

  const counts = new Map<number, number>();
  for (const n of midi.tracks[playable].notes) if (n.channel !== 9) counts.set(n.pitch, (counts.get(n.pitch) ?? 0) + 1);
  const kept = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, maxLanes)
    .map((e) => e[0])
    .sort((a, b) => a - b);
  const laneOf = new Map(kept.map((p, i) => [p, i] as const));
  const droppedPitches = [...counts.keys()].filter((p) => !laneOf.has(p)).sort((a, b) => a - b);

  const notes: ChartNote[] = [];
  const backing: BackingNote[] = [];
  let end = 0;
  midi.tracks.forEach((track, ti) => {
    for (const n of track.notes) {
      end = Math.max(end, n.time + n.duration);
      if (n.channel === 9) continue;
      const lane = ti === playable ? laneOf.get(n.pitch) : undefined;
      if (lane !== undefined) notes.push({ id: 0, time: n.time, lane, pitch: n.pitch, velocity: n.velocity });
      else backing.push({ time: n.time, pitch: n.pitch, velocity: n.velocity, duration: n.duration });
    }
  });
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((n, i) => (n.id = i));
  backing.sort((a, b) => a.time - b.time);

  const duration = Math.max(midi.ticksToSeconds(midi.durationTicks), end);
  const beatTimes: number[] = [];
  for (let tick = 0; ; tick += midi.ppq) {
    const s = midi.ticksToSeconds(tick);
    if (s > duration + 4) break;
    beatTimes.push(s);
  }

  return {
    title: opts.title,
    lanes: kept.map((pitch, index) => ({ index, pitch, name: pitchName(pitch) })),
    notes,
    backing,
    beatTimes,
    beatsPerBar: midi.timeSignature.numerator,
    bpm: 60_000_000 / midi.tempos[0].usPerQuarter,
    duration,
    droppedPitches,
  };
}

/** One-lane click track used by the calibration screen. */
export function calibrationChart(beats = 16, bpm = 100): Chart {
  const spb = 60 / bpm;
  const times = Array.from({ length: beats }, (_, i) => (i + 4) * spb);
  return {
    title: 'Calibration',
    lanes: [{ index: 0, pitch: 84, name: 'Tap' }],
    notes: times.map((time, id) => ({ id, time, lane: 0, pitch: 84, velocity: 100 })),
    backing: [],
    beatTimes: Array.from({ length: beats + 8 }, (_, i) => i * spb),
    beatsPerBar: 4,
    bpm,
    duration: times[times.length - 1] + 1,
    droppedPitches: [],
  };
}
