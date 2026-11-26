import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAbc, scoreToAbc, measureStarts, tonicPc, type Chord, type Note, type Score } from './abc-io.ts';
import { bars, loadS5Song, S5_DIR } from './songs.ts';
import { verticals } from './theory.ts';
// @ts-ignore -- S5 JavaScript modules
import { assignBells, evaluateRinger, PROFILES } from '../../s5-chart-pipeline/src/assign.mjs';

export const SONGS = ['deck-the-halls', 'the-holly-and-the-ivy'] as const;
export type SongId = typeof SONGS[number];
export const RHYTHMS = ['space', 'answer', 'pulse'] as const;
export const CURVES = ['rise', 'arch', 'fall'] as const;
type Rhythm = typeof RHYTHMS[number];
type Curve = typeof CURVES[number];
export interface Phrase { rhythm: Rhythm; curve: Curve }
export type Plan = Phrase[];
export const SECTIONS = ['intro', 'phrase 1', 'phrase 2', 'phrase 3', 'phrase 4', 'coda'];
const LOW = 72;
const HIGH = 84;
const MAX_LEAP = 7;

const BASELINES: Record<SongId, Plan> = {
  'deck-the-halls': [
    { rhythm: 'pulse', curve: 'rise' }, { rhythm: 'answer', curve: 'fall' },
    { rhythm: 'space', curve: 'arch' }, { rhythm: 'pulse', curve: 'rise' },
    { rhythm: 'answer', curve: 'fall' }, { rhythm: 'space', curve: 'fall' },
  ],
  'the-holly-and-the-ivy': [
    { rhythm: 'answer', curve: 'arch' }, { rhythm: 'space', curve: 'fall' },
    { rhythm: 'answer', curve: 'rise' }, { rhythm: 'pulse', curve: 'arch' },
    { rhythm: 'answer', curve: 'fall' }, { rhythm: 'space', curve: 'fall' },
  ],
};

export function baselinePlan(id: SongId): Plan {
  return BASELINES[id].map((p) => ({ ...p }));
}

export function parsePlan(reply: string): Plan {
  if (reply.length > 4096) throw new Error('answer exceeds the 4096-character plan limit');
  let value: unknown;
  try { value = JSON.parse(reply); } catch { throw new Error('answer must be one bare JSON array'); }
  if (!Array.isArray(value) || value.length !== SECTIONS.length) throw new Error('provide exactly six ordered [rhythm, curve] pairs');
  return value.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2 ||
        !RHYTHMS.includes(pair[0]) || !CURVES.includes(pair[1])) {
      throw new Error(`${SECTIONS[i]}: use one allowed rhythm and one allowed curve`);
    }
    return { rhythm: pair[0], curve: pair[1] };
  });
}

const pitchClass = (midi: number) => midi % 12;
const keyOfNote = ({ tick, dur, midi }: Note) => [tick, dur, midi];
const keyOfChord = ({ tick, dur, symbol, root, bass, tones }: Chord) => [tick, dur, symbol, root, bass, tones];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export function loadExcerpt(id: SongId) {
  const song = loadS5Song(id);
  const body = song.score;
  const meter = id === 'deck-the-halls' ? 4 : 3;
  const bodyBars = bars(body);
  const pickup = id === 'the-holly-and-the-ivy' ? 1 : 0;
  const bodyVoices = new Set(song.roleNotes.map((n) => n.voice));
  if (body.timeSigs.length !== 1 || body.timeSigs[0].num !== meter || body.timeSigs[0].den !== 4 ||
      body.tempos.length !== 1 || bodyBars.length !== 16 + pickup ||
      bodyBars[0].pickup !== Boolean(pickup) || song.currentSource !== 'lead-sheet' ||
      (pickup && (bodyVoices.size !== 4 || new Set(body.notes.map((n) => n.voice)).size !== 4))) {
    throw new Error(`${id}: source form changed; re-audit the excerpt and baseline`);
  }
  const bar = body.ppq * meter;
  const offset = bar * 2;
  const tail = offset + body.endTick;
  const home = song.current.at(-1)!;
  const dominant = song.current.find((c) => c.symbol === 'C7');
  if (!dominant || home.symbol !== 'F' || home.root !== tonicPc(body) ||
      song.current[0]?.symbol !== home.symbol) throw new Error(`${id}: unexpected framing harmony`);
  const framing = [
    { ...home, tick: 0, dur: bar },
    { ...dominant, tick: bar, dur: bar },
    { ...home, tick: tail, dur: bar },
  ];
  const move = (n: Note) => ({ ...n, tick: n.tick + offset });
  const melody = song.melody.map(move);
  const fixed = [...song.roleNotes.map(move), ...framing.flatMap((c) =>
    [48 + c.bass, 60 + (c.root + (c.tones.includes((c.root + 4) % 12) ? 4 : 3)) % 12]
      .map((midi, i) => ({ tick: c.tick, dur: c.dur, midi, voice: `frame${i}`, role: i ? 'inner' : 'bass' })))];
  const score: Score = {
    ...body, notes: fixed, endTick: tail + bar,
    chords: [framing[0], framing[1], ...song.current.map((c) => ({ ...c, tick: c.tick + offset })), framing[2]],
    barTicks: [bar, ...bodyBars.map((b) => b.start + offset), tail],
  };
  const sections = [[0, bar],
    ...Array.from({ length: 4 }, (_, i) =>
      bodyBars.slice(i === 0 ? 0 : pickup + i * 4, pickup + (i + 1) * 4).map((b) => b.start + offset)),
    [tail]];
  const sha256 = digest(readFileSync(join(S5_DIR, 'songs', song.entry.file), 'utf8').replace(/\r\n/g, '\n'));
  const inputSha256 = digest(JSON.stringify([score.ppq, score.barTicks, score.tempos, score.timeSigs,
    fixed.map(keyOfNote), score.chords.map(keyOfChord)]));
  return { id, score, fixed, melody, sections, meter, offset, tail, source: song.entry.file, sha256, inputSha256 };
}
export type Excerpt = ReturnType<typeof loadExcerpt>;

function realize(excerpt: Excerpt, plan: Plan) {
  const { score, melody, sections } = excerpt;
  const ends = [...measureStarts(score).slice(1), score.endTick] as number[];
  const barEnd = new Map<number, number>(measureStarts(score).map((tick: number, i: number) => [tick, ends[i]]));
  const line: Note[] = [];
  const phrasing = sections.map((starts, i) => {
    const { rhythm, curve } = plan[i];
    let requested = 0;
    const before = line.length;
    const from = starts[0];
    const to = barEnd.get(starts.at(-1)!)!;
    starts.forEach((start, j) => {
      const end = barEnd.get(start)!;
      const len = (end - start) / score.ppq;
      const slots = len < excerpt.meter && j === 0 && i === 1 ? [] :
        rhythm === 'space' ? [0] : rhythm === 'answer' ? [len - 1] : [0, Math.floor(len / 2)];
      const lastBodyBar = i > 0 && i < 5 && j === starts.length - 1;
      const offsets = [...new Set([...slots, ...(i === 5 ? [len - 1] : [])])].sort((a, b) => a - b);
      offsets.forEach((slot, k) => {
        if (lastBodyBar && slot >= len - 1) return; // Give the tune the end of each phrase.
        const tick = start + slot * score.ppq;
        const chord = score.chords.find((c) => c.tick <= tick && tick < c.tick + c.dur);
        if (!chord) throw new Error(`Missing locked chord at tick ${tick}`);
        const cadence = i === 5 && k === offsets.length - 1;
        const dur = Math.min(end - tick, chord.tick + chord.dur - tick,
          (offsets[k + 1] === undefined ? Infinity : (offsets[k + 1] - slot) * score.ppq),
          (cadence ? 1 : lastBodyBar ? 0.5 : rhythm === 'space' ? 2 : 1) * score.ppq);
        requested++;
        const under = melody.filter((n) => n.tick < tick + dur && n.tick + n.dur > tick);
        const x = (tick - from) / (to - from);
        const shape = curve === 'rise' ? x : curve === 'fall' ? 1 - x : 1 - Math.abs(2 * x - 1);
        const aim = 73 + 10 * shape;
        const prev = line.at(-1);
        const options = Array.from({ length: HIGH - LOW + 1 }, (_, idx) => LOW + idx)
          .filter((midi) => chord.tones.includes(pitchClass(midi)) &&
            (!cadence || pitchClass(midi) === chord.root) &&
            (!prev || Math.abs(midi - prev.midi) <= MAX_LEAP) &&
            under.every((n) => midi > n.midi && ![0, 1, 2, 6, 10, 11].includes(pitchClass(midi - n.midi))))
          .map((midi) => {
            const note = { midi, tick, dur, voice: 'U', role: 'descant' };
            const parallels = prev ? verticals(melody, [prev, note]).parallels : 0;
            return { note, cost: parallels * 20 + Math.abs(midi - aim) + (prev ? 0.35 * Math.abs(midi - prev.midi) : 0) };
          }).sort((a, b) => a.cost - b.cost || a.note.midi - b.note.midi);
        if (options.length) line.push(options[0].note);
      });
    });
    return { section: SECTIONS[i], requested, realized: line.length - before };
  });
  return { line, phrasing };
}

export function preservesScore(excerpt: Excerpt, line: Note[]): boolean {
  const { score, melody } = excerpt;
  const parsed = parseAbc(scoreToAbc(score, [{ id: '1', notes: melody, chords: score.chords }, { id: 'U', notes: line }]));
  return parsed.ppq === score.ppq && parsed.endTick === score.endTick &&
    parsed.meta.key === score.meta.key && equal(parsed.tempos, score.tempos) &&
    equal(parsed.timeSigs, score.timeSigs) && equal(measureStarts(parsed), measureStarts(score)) &&
    equal(parsed.chords.map(keyOfChord), score.chords.map(keyOfChord)) &&
    equal(parsed.notes.filter((n: Note) => n.voice === '1').map(keyOfNote), melody.map(keyOfNote)) &&
    equal(parsed.notes.filter((n: Note) => n.voice === 'U').map(keyOfNote), line.map(keyOfNote));
}

function assessRingers(excerpt: Excerpt, line: Note[]) {
  const { score, fixed } = excerpt;
  const noteByStrike = new Map(fixed.concat(line).map((n) => [`${n.tick}:${n.midi}`, n]));
  const secondsPerTick = score.tempos[0].usPerQuarter / (score.ppq * 1e6);
  const strikes = [...noteByStrike.values()].map((n) => ({ ...n, time: n.tick * secondsPerTick }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi);
  const profile = PROFILES.handbell;
  const { ringers } = assignBells(strikes, 4, profile);
  const loads = ringers.map(({ bells }: { bells: number[] }) => {
    const pitches = new Set(bells);
    return evaluateRinger(strikes.filter((n) => pitches.has(n.midi)), profile) as { strikes: number; violations: number; bells: number };
  });
  return {
    strikes: strikes.length,
    violations: loads.reduce((sum: number, r: typeof loads[number]) => sum + r.violations, 0) as number,
    maxBells: Math.max(...loads.map((r: typeof loads[number]) => r.bells)),
  };
}

export function evaluate(excerpt: Excerpt, plan: Plan) {
  const { score, melody, tail } = excerpt;
  const { line, phrasing } = realize(excerpt, plan);
  const problems: string[] = [];
  const last = line.at(-1);
  const range = new Set(line.map((n) => n.midi)).size;
  const leaps = line.slice(1).map((n, i) => Math.abs(n.midi - line[i].midi));
  const maxLeap = Math.max(0, ...leaps);
  const parallels = verticals(melody, line);
  const chordFit = line.filter((n) => score.chords.some((c) =>
    n.tick >= c.tick && n.tick + n.dur <= c.tick + c.dur && c.tones.includes(pitchClass(n.midi)))).length;
  const roundTrip = preservesScore(excerpt, line);
  const playability = assessRingers(excerpt, line);
  if (!roundTrip) problems.push('ABC round trip changed melody, chord timeline, meter, tempo, or upper line');
  if (chordFit !== line.length || parallels.crossings || parallels.dissonant ||
      line.some((n, i) => n.dur <= 0 || n.midi < LOW || n.midi > HIGH ||
        (i > 0 && line[i - 1].tick + line[i - 1].dur > n.tick)) || maxLeap > MAX_LEAP) {
    problems.push('upper line violates chord fit, consonance, range, or non-overlap');
  }
  if (range < 4 || phrasing.some((p) => p.realized < 2)) problems.push('need four distinct pitches and two strikes per section');
  if (!last || last.tick < tail || pitchClass(last.midi) !== tonicPc(score) ||
      last.tick + last.dur !== score.endTick) problems.push('coda must resolve to a tonic on the last beat');
  const losses = phrasing.reduce((sum, p) => sum + p.requested - p.realized, 0);
  const contrasts = phrasing.slice(2, 5).filter((p, i) =>
    Math.abs(p.realized - phrasing[i + 1].realized) >= 2).length;
  const wideLeaps = leaps.filter((n) => n > 4).length;
  // Fixed heuristic: prefer audible density contrast without buying it with clashes, gaps or leaps.
  const points = 3 * contrasts - losses - wideLeaps - 4 * parallels.parallels - 2 * playability.violations;
  const metrics = { points, contrasts, losses, range, maxLeap, wideLeaps, chordFit, parallels, ...playability };
  return { plan, line, phrasing, problems, metrics, identity: digest(JSON.stringify(line.map(keyOfNote))) };
}
export type Evaluation = ReturnType<typeof evaluate>;
