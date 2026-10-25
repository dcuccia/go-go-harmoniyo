// S5 corpus access for the S6 experiments: load a song, its melody, the "reference" chords
// (from the full SATB texture where the source has one), and convert between chord timelines
// and the bar-by-bar chord lists the LLM reads and writes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- S5 JS modules
import { loadSong } from '../../s5-chart-pipeline/src/pipeline.mjs';
// @ts-ignore
import { inferChords } from '../../s5-chart-pipeline/src/harmony.mjs';
import { measureStarts, keyName, keyAccidentals, scoreToAbc, tonicPc, type Chord, type Note, type Score } from './abc-io.ts';
import { beats, parseChordSymbol } from './theory.ts';

export const S5_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 's5-chart-pipeline');

export interface SongEntry { id: string; file: string; format: string; title?: string; composer?: string; license: { id: string }; source: Record<string, unknown>; options?: Record<string, unknown> }

export function manifest(): SongEntry[] {
  return JSON.parse(readFileSync(join(S5_DIR, 'songs', 'manifest.json'), 'utf8')).songs;
}

export interface Song {
  entry: SongEntry;
  score: Score;
  roleNotes: Note[];
  melody: Note[];
  /** Chords as the S5 pipeline has them today (lead sheet, or inferred from all voices). */
  current: Chord[];
  currentSource: 'lead-sheet' | 'inferred';
  /** Chords inferred by S5 from the melody alone (the fair baseline for melody-only input). */
  melodyOnlyInferred: Chord[];
  /** True when `current` was inferred from a multi-voice (SATB) texture: usable as a reference. */
  hasSatbReference: boolean;
}

export function loadS5Song(id: string): Song {
  const entry = manifest().find((e) => e.id === id);
  if (!entry) throw new Error(`unknown song ${id}`);
  const { score, roleNotes } = loadSong(entry, join(S5_DIR, 'songs')) as { score: Score; roleNotes: Note[] };
  const melody = roleNotes.filter((n) => n.role === 'melody').map((n) => ({ ...n, voice: '1' }));
  const leadSheet = score.chords.length > 0;
  const current: Chord[] = leadSheet ? score.chords : inferChords(score, roleNotes);
  const melodyOnlyInferred: Chord[] = inferChords(score, melody);
  const voices = new Set(roleNotes.map((n) => n.voice));
  return { entry, score, roleNotes, melody, current, currentSource: leadSheet ? 'lead-sheet' : 'inferred', melodyOnlyInferred, hasSatbReference: !leadSheet && voices.size > 1 && roleNotes.some((n) => n.role === 'bass') };
}

const SPELL_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SPELL_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export function spell(midi: number, fifths: number): string {
  const names = fifths < 0 ? SPELL_FLAT : SPELL_SHARP;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface BarInfo { index: number; start: number; end: number; beats: number[]; pickup: boolean }

/** Bars with the ticks of their beats (pickup bar first if any). */
export function bars(score: Score): BarInfo[] {
  const starts: number[] = measureStarts(score);
  const bts = beats(score);
  return starts.map((t, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : score.endTick;
    const b = bts.filter((x) => x.tick >= t && x.tick < end);
    const full = (score.ppq * 4 * score.timeSigs[0].num) / score.timeSigs[0].den;
    return { index: i, start: t, end, beats: b.map((x) => x.tick), pickup: i === 0 && end - t < full && starts.length > 1 };
  });
}

/** "Bar 3 [3 beats]: 1:F4 2:F4 2.5:G4 3:A4" — onsets with beat positions (1-based, fractional). */
export function melodyListing(score: Score, melody: Note[]): string {
  const fifths = Number(score.meta.fifths ?? 0);
  const out: string[] = [];
  for (const b of bars(score)) {
    const step = b.beats.length > 1 ? b.beats[1] - b.beats[0] : (score.ppq * 4) / score.timeSigs[0].den;
    const firstBeatIdx = beats(score).find((x) => x.tick === b.beats[0])?.beat ?? 0;
    const ns = melody.filter((n) => n.tick >= b.start && n.tick < b.end);
    const items = ns.map((n) => {
      const pos = firstBeatIdx + 1 + (n.tick - b.beats[0]) / step;
      return `${Math.round(pos * 100) / 100}:${spell(n.midi, fifths)}`;
    });
    out.push(`Bar ${b.index + 1}${b.pickup ? ' (pickup)' : ''} [${b.beats.length} beat${b.beats.length === 1 ? '' : 's'}]: ${items.join(' ') || 'rest'}`);
  }
  return out.join('\n');
}

/**
 * Chord timeline → one list of symbols per bar: the fewest equal beat-groups per bar (1, then
 * strong-beat halves, then every beat) that represent the timeline exactly. "N" = no chord.
 */
export function chordsPerBar(score: Score, chords: Chord[]): string[][] {
  const at = (t: number) => {
    let c: Chord | null = null;
    for (const x of chords) if (x.tick <= t) c = x;
    return c?.symbol ?? 'N';
  };
  return bars(score).map((b) => {
    const n = b.beats.length || 1;
    const changes = chords.filter((c) => c.tick > b.start && c.tick < b.end).map((c) => c.tick);
    for (let k = 1; k <= n; k++) {
      if (n % k) continue;
      const per = n / k;
      const bounds = Array.from({ length: k }, (_, i) => (i === 0 ? b.start : b.beats[i * per]));
      if (changes.every((t) => bounds.includes(t))) return bounds.map(at);
    }
    return b.beats.map((t, i) => at(i === 0 ? b.start : t));
  });
}

/**
 * Bar-by-bar chord lists → chord timeline. A bar with k symbols is split into k equal groups
 * of beats (k must divide the bar's beat count, or be 1). Consecutive equal symbols merge.
 */
export function chordsFromBars(score: Score, perBar: string[][]): { chords: Chord[]; errors: string[] } {
  const bs = bars(score);
  const errors: string[] = [];
  if (perBar.length !== bs.length) errors.push(`expected ${bs.length} bars, got ${perBar.length}`);
  const raw: { tick: number; symbol: string }[] = [];
  bs.forEach((b, i) => {
    const syms = (perBar[i] ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!syms.length) return errors.push(`bar ${i + 1}: no chord`);
    const n = b.beats.length || 1;
    if (syms.length > 1 && n % syms.length !== 0) return errors.push(`bar ${i + 1}: ${syms.length} chords do not divide ${n} beats`);
    const per = syms.length === 1 ? n : n / syms.length;
    syms.forEach((s, k) => {
      if (s === 'N') return;
      if (!parseChordSymbol(s)) errors.push(`bar ${i + 1}: unknown chord "${s}"`);
      raw.push({ tick: k === 0 ? b.start : b.beats[k * per], symbol: s });
    });
  });
  const chords: Chord[] = [];
  for (const r of raw) {
    const p = parseChordSymbol(r.symbol);
    if (!p) continue;
    const last = chords[chords.length - 1];
    if (last && last.symbol === r.symbol) continue;
    chords.push({ tick: r.tick, dur: 0, symbol: r.symbol, ...p });
  }
  for (let i = 0; i < chords.length; i++) chords[i].dur = (i + 1 < chords.length ? chords[i + 1].tick : score.endTick) - chords[i].tick;
  return { chords, errors };
}

export function melodyAbc(song: Song, chords: Chord[] = []): string {
  return scoreToAbc(song.score, [{ id: '1', notes: song.melody, chords }], { title: song.entry.title ?? song.score.title });
}

export function keyLabel(score: Score): string {
  const f = Number(score.meta.fifths ?? 0);
  return `${keyName(f, String(score.meta.mode ?? 'major'))} ${score.meta.mode ?? 'major'}`;
}

export { keyAccidentals };

export function splitHint(meter: string): string {
  return { '4/4': '2 chords (beats 1 and 3) or 4 (one per beat)', '3/4': '3 chords (one per beat)', '2/4': '2 chords (one per beat)', '6/8': '2 chords (one per dotted quarter)' }[meter] ?? 'one chord per beat';
}

export function promptVars(s: Song) {
  const ts = s.score.timeSigs[0];
  const meter = `${ts.num}/${ts.den}`;
  const bs = bars(s.score);
  const pickup = bs[0].pickup;
  const f = Number(s.score.meta.fifths ?? 0);
  const t = tonicPc(s.score);
  const flat = f < 0;
  const name = (pc: number) => (flat ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])[pc % 12];
  return {
    title: s.entry.title ?? s.score.title,
    key: keyLabel(s.score),
    keyAbc: keyName(f),
    meter,
    pickupNote: pickup ? ' The tune starts with a pickup (upbeat): bar 1 is that short pickup bar.' : '',
    pickupRule: pickup ? ' Bar 1 is the short pickup bar: give it exactly 1 chord.' : '',
    barCount: bs.length,
    splitHint: splitHint(meter),
    tonic: name(t),
    dominant: name(t + 7),
  };
}
