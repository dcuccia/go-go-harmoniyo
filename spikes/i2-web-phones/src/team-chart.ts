// S5 chart part → one S4 `Chart` with every active ringer's lanes side by side (global lanes),
// plus the per-ringer layout used by the multi-highway renderer, the phones and the HUD.
// Pure logic: no DOM, audio or network.
import type { BackingNote, Chart, ChartNote, Lane } from '../../s4-web-host/src/core/chart';
import { isAccidental, pitchColor } from '../../shared/pitch-palette';

// ── S5 chart format (subset we read; see spikes/s5-chart-pipeline/schema/chart.schema.json) ──
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export interface S5Note {
  tick: number;
  time: number;
  durSec?: number;
  bell: string;
  ringer: number;
  role?: 'melody' | 'bass' | 'inner';
}
export interface S5Part {
  difficulty: Difficulty;
  ringerCount: number;
  profile?: string;
  ringers: { index: number; label?: string; bells: string[] }[];
  notes: S5Note[];
}
export interface S5Chart {
  format: 'handbell-hero.chart';
  formatVersion: string;
  song: { id: string; title: string; composer?: string; license: { id: string } };
  timing: { tempos: { tick: number; time: number; bpm: number }[]; timeSignatures: { tick: number; numerator: number; denominator: number }[]; durationSec: number };
  bells: { id: string; midi: number }[];
  parts: S5Part[];
}

export function findPart(c: S5Chart, difficulty: Difficulty, ringerCount: number): S5Part | undefined {
  return c.parts.find((p) => p.difficulty === difficulty && p.ringerCount === ringerCount);
}

// ── team chart ───────────────────────────────────────────────────────────────
export interface TeamBell {
  /** Written pitch id from the chart, e.g. "F#4" (what the phone reports back). */
  id: string;
  /** Display name, e.g. "F♯4". */
  name: string;
  /** Letter (+ accidental) only, e.g. "F♯" — big label on the phone. */
  letter: string;
  /** Written MIDI pitch. */
  midi: number;
  /** Sounding MIDI pitch (handbells sound an octave above written by default). */
  pitch: number;
  /** Pitch-class palette colour (follows the pitch, never the lane). */
  color: string;
  /** Sharp/flat: drawn with a ring outline as well as the deeper colour. */
  accidental: boolean;
  /** Global lane index in the team chart. */
  lane: number;
  strikes: number;
}

export interface TeamRinger {
  index: number;
  /** Bells this ringer plays (≤ maxBellsPerPhone), low → high = lane order. */
  bells: TeamBell[];
  /** Bells of this ringer's part that the host plays because they do not fit on one phone. */
  autoBells: string[];
  laneStart: number;
  /** Notes (global ids) on this ringer's highway, in time order. */
  noteIds: number[];
}

export interface TeamChart {
  chart: Chart;
  /** Active ringers only (ringers without a player are played by the host). */
  ringers: TeamRinger[];
  /** Part ringer indices played entirely by the host. */
  autoRingers: number[];
  /** Global lane → index into `ringers`. */
  laneRinger: number[];
  /** Global note id → index of the note on its ringer's highway. */
  localIndex: number[];
  /** Per active ringer: the sub-chart its highway renders (local lanes / ids). */
  subCharts: Chart[];
}

export interface TeamOptions {
  /** Which part ringers have a player (phone or keyboard). Default: all. */
  active?: boolean[];
  maxBellsPerPhone?: number;
  /** Written → sounding transposition, semitones (handbells: +12). */
  transpose?: number;
  title?: string;
}

const SHARP = '♯';
export const bellName = (id: string): string => id.replace('#', SHARP);
export const bellLetter = (id: string): string => bellName(id).replace(/-?\d+$/, '');

export function buildTeamChart(src: S5Chart, part: S5Part, opts: TeamOptions = {}): TeamChart {
  const maxBells = opts.maxBellsPerPhone ?? 4;
  const transpose = opts.transpose ?? 12;
  const midiOf = new Map(src.bells.map((b) => [b.id, b.midi] as const));
  const active = part.ringers.map((_, i) => opts.active?.[i] ?? true);

  const strikes = new Map<string, number>();
  for (const n of part.notes) strikes.set(n.bell, (strikes.get(n.bell) ?? 0) + 1);

  const ringers: TeamRinger[] = [];
  const autoRingers: number[] = [];
  const laneOfBell = new Map<string, number>();
  const lanes: Lane[] = [];
  const laneRinger: number[] = [];
  for (const r of part.ringers) {
    if (!active[r.index]) {
      autoRingers.push(r.index);
      continue;
    }
    // Keep the most-struck bells that fit on one phone; the host rings the rest.
    const ranked = [...r.bells].sort((a, b) => (strikes.get(b) ?? 0) - (strikes.get(a) ?? 0) || (midiOf.get(a) ?? 0) - (midiOf.get(b) ?? 0));
    const keep = new Set(ranked.slice(0, maxBells));
    const kept = r.bells.filter((b) => keep.has(b)).sort((a, b) => (midiOf.get(a) ?? 0) - (midiOf.get(b) ?? 0));
    const ringer: TeamRinger = { index: r.index, bells: [], autoBells: r.bells.filter((b) => !keep.has(b)), laneStart: lanes.length, noteIds: [] };
    kept.forEach((id) => {
      const midi = midiOf.get(id) ?? 60;
      const lane = lanes.length;
      lanes.push({ index: lane, pitch: midi + transpose, name: bellName(id) });
      laneRinger.push(ringers.length);
      laneOfBell.set(id, lane);
      ringer.bells.push({ id, name: bellName(id), letter: bellLetter(id), midi, pitch: midi + transpose, color: pitchColor(midi), accidental: isAccidental(midi), lane, strikes: strikes.get(id) ?? 0 });
    });
    ringers.push(ringer);
  }

  const notes: ChartNote[] = [];
  const backing: BackingNote[] = [];
  let end = 0;
  for (const n of part.notes) {
    const midi = midiOf.get(n.bell) ?? 60;
    const dur = n.durSec ?? 0.5;
    end = Math.max(end, n.time + dur);
    const lane = laneOfBell.get(n.bell);
    if (lane !== undefined && active[n.ringer]) notes.push({ id: 0, time: n.time, lane, pitch: midi + transpose, velocity: 100 });
    else backing.push({ time: n.time, pitch: midi + transpose, velocity: n.role === 'melody' ? 110 : 80, duration: dur });
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((n, i) => (n.id = i));
  backing.sort((a, b) => a.time - b.time);

  const bpm = src.timing.tempos[0]?.bpm ?? 100;
  const duration = Math.max(src.timing.durationSec, end);
  const beatTimes = beatGrid(src, duration + 4);
  const title = opts.title ?? `${src.song.title} · ${part.difficulty} · ${part.ringerCount} ringer${part.ringerCount === 1 ? '' : 's'}`;
  const chart: Chart = {
    title,
    lanes,
    notes,
    backing,
    beatTimes,
    beatsPerBar: src.timing.timeSignatures[0]?.numerator ?? 4,
    bpm,
    duration,
    droppedPitches: [],
  };

  const localIndex = new Array<number>(notes.length).fill(-1);
  const subCharts = ringers.map((r, ri) => {
    const mine = notes.filter((n) => laneRinger[n.lane] === ri);
    mine.forEach((n, k) => {
      localIndex[n.id] = k;
      r.noteIds.push(n.id);
    });
    const sub: Chart = {
      ...chart,
      title: `${title} — ringer ${r.index + 1}`,
      lanes: r.bells.map((b, k) => ({ index: k, pitch: b.pitch, name: b.name })),
      notes: mine.map((n, k) => ({ ...n, id: k, lane: n.lane - r.laneStart })),
      backing: [],
    };
    return sub;
  });

  return { chart, ringers, autoRingers, laneRinger, localIndex, subCharts };
}

/** Quarter-note beat times from the tempo map (constant tempo between changes). */
function beatGrid(src: S5Chart, until: number): number[] {
  const tempos = [...src.timing.tempos].sort((a, b) => a.time - b.time);
  const out: number[] = [];
  let k = 0;
  let t = 0;
  while (t <= until && out.length < 100_000) {
    while (k + 1 < tempos.length && tempos[k + 1].time <= t + 1e-9) k++;
    out.push(t);
    t += 60 / (tempos[k]?.bpm ?? 100);
  }
  return out;
}

/** Ringer slot label for menus, e.g. "C4 D4 E4 G4 (+F4 host)". */
export function ringerSummary(r: TeamRinger): string {
  const auto = r.autoBells.length ? ` (+${r.autoBells.map(bellName).join(' ')} by host)` : '';
  return r.bells.map((b) => b.name).join(' ') + auto;
}
