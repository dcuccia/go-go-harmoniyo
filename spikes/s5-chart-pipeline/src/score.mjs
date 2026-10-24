// Shared score model + music utilities. Zero dependencies.
//
// Score = {
//   title, composer, meta: {},
//   ppq,                                  // ticks per quarter note
//   tempos: [{ tick, usPerQuarter }],     // sorted, first at tick 0
//   timeSigs: [{ tick, num, den }],       // sorted, first at tick 0
//   barTicks: [tick],                     // optional explicit measure starts (handles pickups)
//   notes: [{ tick, dur, midi, vel, voice }],
//   chords: [{ tick, dur, symbol, root, tones, bass }],   // lead-sheet chord symbols (pitch classes)
//   endTick,
// }

export const PPQ = 480;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchName(midi) {
  return SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function isNatural(midi) {
  return !SHARP_NAMES[((midi % 12) + 12) % 12].includes('#');
}

// Handbell convention: an accidental belongs with the natural a semitone below it
// (C# with C, D#/Eb with D, F# with F, G# with G, A#/Bb with A).
export function naturalSlot(midi) {
  return isNatural(midi) ? midi : midi - 1;
}

export function parsePitchClass(name) {
  const m = /^([A-Ga-g])([#b]?)/.exec(name);
  if (!m) throw new Error(`bad pitch name ${name}`);
  let pc = NATURAL_PC[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

const CHORD_QUALITIES = {
  '': [0, 4, 7], M: [0, 4, 7], maj: [0, 4, 7],
  m: [0, 3, 7], min: [0, 3, 7], '-': [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], o: [0, 3, 6],
  aug: [0, 4, 8], '+': [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  '9': [0, 4, 7, 10, 2],
};

// Chord symbol -> pitch classes. Returns null for unknown symbols.
export function parseChordSymbol(symbol) {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(symbol.trim());
  if (!m) return null;
  const intervals = CHORD_QUALITIES[m[2]];
  if (!intervals) return null;
  const root = parsePitchClass(m[1]);
  const tones = intervals.map((i) => (root + i) % 12);
  const bass = m[3] ? parsePitchClass(m[3]) : root;
  return { root, tones, bass };
}

export function chordFromIntervals(root, intervals, bass = root) {
  return { root, tones: intervals.map((i) => (root + i) % 12), bass };
}

export function sortNotes(notes) {
  return notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
}

// Tick -> seconds using the tempo map.
export function makeTimeMap(score) {
  const tempos = [...score.tempos].sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick !== 0) tempos.unshift({ tick: 0, usPerQuarter: 500000 });
  const segs = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    segs.push({ tick: tempos[i].tick, sec, usPerQuarter: tempos[i].usPerQuarter });
    if (i + 1 < tempos.length) {
      sec += ((tempos[i + 1].tick - tempos[i].tick) / score.ppq) * (tempos[i].usPerQuarter / 1e6);
    }
  }
  return (tick) => {
    let s = segs[0];
    for (const seg of segs) {
      if (seg.tick <= tick) s = seg;
      else break;
    }
    return s.sec + ((tick - s.tick) / score.ppq) * (s.usPerQuarter / 1e6);
  };
}

export function timeSigAt(score, tick) {
  let ts = score.timeSigs[0] || { tick: 0, num: 4, den: 4 };
  for (const t of score.timeSigs) if (t.tick <= tick) ts = t;
  return ts;
}

export function measureLength(score, ts) {
  return (score.ppq * 4 * ts.num) / ts.den;
}

// Measure start ticks. Uses explicit barTicks if present (handles pickups), else the meter grid.
export function measureStarts(score) {
  if (score.barTicks && score.barTicks.length) {
    const s = new Set([0, ...score.barTicks.filter((t) => t < score.endTick)]);
    return [...s].sort((a, b) => a - b);
  }
  const out = [];
  let t = 0;
  while (t < score.endTick) {
    out.push(t);
    t += measureLength(score, timeSigAt(score, t));
  }
  return out;
}

// Beat grid: [{ tick, downbeat, strong, measure, beat, div }].
// Strong beats: beat 1 always; 4/4 adds beat 3; compound meters (6/8, 9/8, 12/8) count each
// dotted-quarter pulse as a beat, and 6/8 / 12/8 add the mid-bar pulse as strong.
// A short first measure is treated as a pickup aligned to its end.
// measure = index into measureStarts(), beat = position in the bar (0-based, pickups keep their
// bar position), div = subdivisions per beat (2 simple, 3 compound).
export function beatGrid(score) {
  const starts = measureStarts(score);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : score.endTick;
    const ts = timeSigAt(score, start);
    const full = measureLength(score, ts);
    const anchor = i === 0 && end - start < full ? end - full : start;
    const compound = ts.den === 8 && ts.num % 3 === 0 && ts.num > 3;
    const step = compound ? (score.ppq * 3) / 2 : (score.ppq * 4) / ts.den;
    const beatsPerBar = Math.round(full / step);
    for (let b = 0; b < beatsPerBar; b++) {
      const t = anchor + b * step;
      if (t < start || t >= end) continue;
      const strong = b === 0 || (beatsPerBar === 4 && b === 2) || (compound && beatsPerBar % 2 === 0 && b === beatsPerBar / 2);
      out.push({ tick: t, downbeat: b === 0, strong, measure: i, beat: b, div: compound ? 3 : 2 });
    }
  }
  return out;
}

export function cloneScore(score) {
  return JSON.parse(JSON.stringify(score));
}
