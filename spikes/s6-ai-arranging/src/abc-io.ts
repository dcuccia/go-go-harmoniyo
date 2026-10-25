// ABC in/out for the S6 experiments: write an S5 Score (or a subset of its notes) as ABC that
// the S5 parser reads back exactly, parse ABC fragments returned by the LLM, and pull the code
// block out of a chat reply.
// @ts-ignore -- S5 modules are plain JS (no type declarations); Node runs them as-is.
import { parseAbc } from '../../s5-chart-pipeline/src/abc.mjs';
// @ts-ignore
import { measureStarts, timeSigAt, measureLength, PPQ } from '../../s5-chart-pipeline/src/score.mjs';

export interface Note { tick: number; dur: number; midi: number; vel?: number; voice: string; role?: string; chord?: string }
export interface Chord { tick: number; dur: number; symbol: string; root: number; tones: number[]; bass: number }
export interface Score {
  title: string;
  composer: string;
  meta: Record<string, unknown> & { key?: string; fifths?: number; mode?: string };
  ppq: number;
  tempos: { tick: number; usPerQuarter: number }[];
  timeSigs: { tick: number; num: number; den: number }[];
  barTicks: number[];
  notes: Note[];
  chords: Chord[];
  endTick: number;
}

export { parseAbc, measureStarts, timeSigAt, measureLength, PPQ };

const MAJOR_BY_FIFTHS: Record<number, string> = { [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const MINOR_BY_FIFTHS: Record<number, string> = { [-7]: 'Abm', [-6]: 'Ebm', [-5]: 'Bbm', [-4]: 'Fm', [-3]: 'Cm', [-2]: 'Gm', [-1]: 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m' };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Spelling per pitch class: [letter, alter] for sharp-side and flat-side keys.
const SPELL_SHARP: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const SPELL_FLAT: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

export function keyName(fifths: number, mode = 'major'): string {
  return (mode === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[fifths] ?? 'C';
}

export function keyAccidentals(fifths: number): Record<string, number> {
  const acc: Record<string, number> = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (acc[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (acc[l] = -1));
  return acc;
}

/** Tonic pitch class of the score's key (major or minor). */
export function tonicPc(score: Pick<Score, 'meta'>): number {
  const f = Number(score.meta.fifths ?? 0);
  const major = (((f * 7) % 12) + 12) % 12;
  return score.meta.mode === 'minor' ? (major + 9) % 12 : major;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Length suffix for `ticks` at a unit of `unit` ticks ("", "2", "/2", "3/2", "2/3"). */
export function lengthStr(ticks: number, unit: number): string {
  const g = gcd(ticks, unit);
  const num = ticks / g;
  const den = unit / g;
  if (den === 1) return num === 1 ? '' : String(num);
  if (num === 1) return den === 2 ? '/' : `/${den}`;
  return `${num}/${den}`;
}

function pitchStr(midi: number, fifths: number, barAcc: Record<string, number>, keyAcc: Record<string, number>): string {
  const pc = ((midi % 12) + 12) % 12;
  let [letter, alter] = (fifths < 0 ? SPELL_FLAT : SPELL_SHARP)[pc];
  // Prefer the key's own spelling (e.g. Bb in F, F# in G, even when the other side would differ).
  for (const [l, a] of Object.entries(keyAcc)) if ((LETTER_PC[l] + a + 12) % 12 === pc) [letter, alter] = [l, a];
  const octave = Math.floor((midi - alter - LETTER_PC[letter]) / 12) - 5; // 0 => C4..B4 written uppercase
  const k = `${letter}${octave}`;
  const expected = k in barAcc ? barAcc[k] : (keyAcc[letter] ?? 0);
  let acc = '';
  if (alter !== expected) {
    acc = alter === 1 ? '^' : alter === -1 ? '_' : alter === 2 ? '^^' : alter === -2 ? '__' : '=';
    barAcc[k] = alter;
  }
  let s = octave >= 1 ? letter.toLowerCase() : letter;
  if (octave >= 2) s += "'".repeat(octave - 1);
  if (octave < 0) s += ','.repeat(-octave);
  return acc + s;
}

interface WriteVoice {
  id: string;
  notes: Note[];
  /** Chord symbols to attach (normally only on the first voice). */
  chords?: Chord[];
  name?: string;
}

/**
 * Score → ABC text. Monophonic voices only (overlaps are truncated). Bar lines come from the
 * score's measure starts (pickups kept); notes and rests split at bar lines with ties; chord
 * symbols split a sounding note with a tie when they fall inside it.
 */
export function scoreToAbc(score: Score, voices: WriteVoice[], header: { title?: string; extra?: string[]; unit?: [number, number] } = {}): string {
  const unitFrac = header.unit ?? [1, 8];
  const unit = (score.ppq * 4 * unitFrac[0]) / unitFrac[1];
  const fifths = Number(score.meta.fifths ?? 0);
  const mode = String(score.meta.mode ?? 'major');
  const keyAcc = keyAccidentals(fifths);
  const ts = score.timeSigs[0] ?? { num: 4, den: 4 };
  const qpm = Math.round(60e6 / (score.tempos[0]?.usPerQuarter ?? 500000));
  const starts: number[] = measureStarts(score);
  const end = score.endTick;
  const lines = [
    'X:1',
    `T:${header.title ?? score.title ?? 'Untitled'}`,
    ...(score.composer ? [`C:${score.composer}`] : []),
    ...(header.extra ?? []),
    `L:${unitFrac[0]}/${unitFrac[1]}`,
    `M:${ts.num}/${ts.den}`,
    `Q:1/4=${qpm}`,
    `K:${keyName(fifths, mode)}`,
  ];
  for (const v of voices) {
    if (voices.length > 1) lines.push(`V:${v.id}${v.name ? ` name="${v.name}"` : ''}`);
    const ns = [...v.notes].sort((a, b) => a.tick - b.tick || b.midi - a.midi);
    const mono: Note[] = [];
    for (const n of ns) {
      const prev = mono[mono.length - 1];
      if (prev && prev.tick === n.tick) continue; // keep the highest note of a chord
      if (prev && prev.tick + prev.dur > n.tick) prev.dur = n.tick - prev.tick;
      mono.push({ ...n });
    }
    const chordTicks = new Map((v.chords ?? []).map((c) => [c.tick, c.symbol]));
    // Segment boundaries: bar lines, note on/offs, chord ticks.
    const cuts = new Set<number>([0, end, ...starts, ...mono.flatMap((n) => [n.tick, Math.min(end, n.tick + n.dur)]), ...chordTicks.keys()]);
    const sorted = [...cuts].filter((t) => t >= 0 && t <= end).sort((a, b) => a - b);
    const barSet = new Set(starts.filter((t) => t > 0));
    let barAcc: Record<string, number> = {};
    let out = '';
    let barsOnLine = 0;
    const bodyLines: string[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const t = sorted[i];
      const t2 = sorted[i + 1];
      if (barSet.has(t)) {
        out += ' |';
        barAcc = {};
        if (++barsOnLine % 4 === 0) {
          bodyLines.push(out.trim());
          out = '';
        }
        out += ' ';
      }
      const chord = chordTicks.get(t);
      if (chord) out += `"${chord}"`;
      const n = mono.find((x) => x.tick <= t && x.tick + x.dur > t);
      const len = lengthStr(t2 - t, unit);
      if (!n) out += `z${len} `;
      else {
        const tieOn = n.tick + n.dur > t2;
        out += `${pitchStr(n.midi, fifths, barAcc, keyAcc)}${len}${tieOn ? '-' : ''} `;
      }
    }
    out += ' |]';
    bodyLines.push(out.trim());
    lines.push(...bodyLines);
  }
  return lines.join('\n') + '\n';
}

/** Strip qwen3 <think> blocks and return the first fenced block of `lang` (or any fence, or the raw text). */
export function extractBlock(reply: string, lang: string): string {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = new RegExp('```\\s*' + lang + '\\s*\\n([\\s\\S]*?)```', 'i').exec(text) ?? /```[a-z]*\s*\n([\s\S]*?)```/i.exec(text);
  return (fence ? fence[1] : text).trim();
}

/** First JSON object in a reply (fenced or bare). */
export function extractJson<T = unknown>(reply: string): T {
  const block = extractBlock(reply, 'json');
  const start = block.indexOf('{');
  const end = block.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in reply');
  return JSON.parse(block.slice(start, end + 1)) as T;
}

/** Keep only ABC music lines from an LLM fragment (drop headers it may have repeated). */
export function abcBodyOnly(fragment: string): string {
  return fragment
    .split(/\r?\n/)
    .map((l) => l.replace(/%.*$/, '').trimEnd())
    .filter((l) => l.trim() && !/^[A-Za-z]:/.test(l.trim()) && !/^%%/.test(l.trim()))
    .join('\n');
}

/** Parse an ABC music fragment under a given header (L, M, K, Q). Throws on unsupported syntax. */
export function parseFragment(body: string, h: { unit?: string; meter: string; key: string; qpm?: number }): Score {
  return parseAbc(`X:1\nT:fragment\nL:${h.unit ?? '1/8'}\nM:${h.meter}\nQ:1/4=${h.qpm ?? 100}\nK:${h.key}\n${body}\n`) as Score;
}

/** Header fields of an ABC text (first occurrence). */
export function abcHeader(text: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]):\s*(.*)$/.exec(line.trim());
    if (m && !(m[1] in h)) h[m[1]] = m[2].trim();
  }
  return h;
}

/** Bar lengths of a parsed (single-voice) score, using its bar lines. */
export function barLengths(score: Score): number[] {
  const starts = [0, ...score.barTicks.filter((t) => t > 0 && t < score.endTick)];
  return starts.map((t, i) => (i + 1 < starts.length ? starts[i + 1] : score.endTick) - t);
}

export function fullBar(score: Pick<Score, 'ppq' | 'timeSigs'>): number {
  const ts = score.timeSigs[0] ?? { num: 4, den: 4 };
  return (score.ppq * 4 * ts.num) / ts.den;
}

/** A single pitch in ABC under the key signature (no bar context). */
export function abcPitch(midi: number, fifths: number): string {
  return pitchStr(midi, fifths, {}, keyAccidentals(fifths));
}

/** Music lines only (no header) for one voice of `score`. */
export function abcBody(score: Score, notes: Note[], chords: Chord[] = []): string {
  return scoreToAbc(score, [{ id: '1', notes, chords }]).split('\n').filter((l) => l.trim() && !/^[A-Za-z]:/.test(l)).join('\n');
}
