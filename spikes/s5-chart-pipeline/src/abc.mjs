// ABC notation (v2.1 subset) -> Score.
// Supported: header fields X T C O S Z N L M Q K V, %%hh-* metadata directives, notes with
// accidentals/octave marks/lengths, rests (z/x), ties (-), bar lines (repeats are NOT expanded:
// write music out in full), chord symbols ("G7"), [CEG] chords, (3 triplets, multiple voices (V:).
// Unsupported constructs throw so encoding mistakes are caught early.
import { PPQ, parseChordSymbol } from './score.mjs';

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };

function keySignature(k) {
  const m = /^\s*([A-G][#b]?)\s*(m|min|minor|maj|major)?\b/i.exec(k || 'C');
  if (!m) throw new Error(`Unsupported key: ${k}`);
  let tonic = m[1][0].toUpperCase() + m[1].slice(1);
  const minor = m[2] && /^m(in(or)?)?$/i.test(m[2]);
  let fifths;
  if (minor) {
    // relative major is a minor third up
    const pcs = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const pc = (LETTER_PC[tonic[0]] + (tonic[1] === '#' ? 1 : tonic[1] === 'b' ? -1 : 0) + 3 + 12) % 12;
    fifths = MAJOR_FIFTHS[pcs[pc]];
  } else fifths = MAJOR_FIFTHS[tonic];
  if (fifths === undefined) throw new Error(`Unsupported key: ${k}`);
  const acc = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (acc[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (acc[l] = -1));
  return { fifths, mode: minor ? 'minor' : 'major', acc, name: k.trim() };
}

function parseFraction(s, def) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2])] : def;
}

function parseTempo(q) {
  // "1/4=120", "3/8=56", "120"
  const m = /(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/.exec(q);
  if (!m) return null;
  const beatFrac = m[1] ? Number(m[1]) / Number(m[2]) : 0.25;
  const qpm = Number(m[3]) * beatFrac * 4;
  return Math.round(60e6 / qpm);
}

export function parseAbc(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const meta = {};
  const header = {};
  const score = { title: '', composer: '', meta, ppq: PPQ, tempos: [], timeSigs: [], barTicks: [], notes: [], chords: [], endTick: 0 };
  let unitLen = null; // [num, den] of whole note
  let key = keySignature('C');
  const voices = new Map();
  let voice = null;
  let inBody = false;

  const getVoice = (id) => {
    if (!voices.has(id)) voices.set(id, { id, tick: 0, barAcc: {}, lastNotes: [], tuplet: null, order: voices.size });
    return voices.get(id);
  };

  const body = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^%%hh-([\w-]+)\s+(.*)$/.test(line)) {
      const [, k, v] = /^%%hh-([\w-]+)\s+(.*)$/.exec(line);
      meta[k] = v.trim();
      continue;
    }
    if (/^%/.test(line) || line.trim() === '') continue;
    const f = /^([A-Za-z]):(.*)$/.exec(line);
    if (f) {
      body.push({ field: f[1], value: f[2].trim() });
      continue;
    }
    body.push({ music: line });
  }

  for (const item of body) {
    if (item.field) {
      const { field, value } = item;
      switch (field) {
        case 'X': break;
        case 'T': if (!score.title) score.title = value; else (header.subtitles ||= []).push(value); break;
        case 'C': score.composer = score.composer ? `${score.composer}; ${value}` : value; break;
        case 'O': header.origin = value; break;
        case 'S': header.source = value; break;
        case 'Z': header.transcription = value; break;
        case 'N': (header.notes ||= []).push(value); break;
        case 'L': unitLen = parseFraction(value, [1, 8]); break;
        case 'M': {
          const ts = value === 'C' ? [4, 4] : value === 'C|' ? [2, 2] : parseFraction(value, [4, 4]);
          const tick = voice ? voice.tick : 0;
          score.timeSigs = score.timeSigs.filter((t) => t.tick !== tick);
          score.timeSigs.push({ tick, num: ts[0], den: ts[1] });
          if (!unitLen) unitLen = ts[0] / ts[1] < 0.75 ? [1, 16] : [1, 8];
          break;
        }
        case 'Q': {
          const us = parseTempo(value);
          const tick = voice ? voice.tick : 0;
          if (us) { score.tempos = score.tempos.filter((t) => t.tick !== tick); score.tempos.push({ tick, usPerQuarter: us }); }
          break;
        }
        case 'K': key = keySignature(value); score.meta.key ||= key.name; score.meta.fifths ??= key.fifths; score.meta.mode ||= key.mode; inBody = true; if (!voice) voice = getVoice('1'); break;
        case 'V': voice = getVoice(value.split(/\s+/)[0]); inBody = true; break;
        case 'R': case 'B': case 'D': case 'F': case 'G': case 'H': case 'I': case 'P': case 'W': case 'w': case 'r': case 'U': case 's': break;
        default: break;
      }
      continue;
    }
    if (!inBody) throw new Error('Music before K: field');
    parseMusicLine(item.music, voice, key, unitLen || [1, 8], score);
  }

  for (const k of ['source', 'origin', 'transcription', 'notes', 'subtitles']) if (header[k]) meta[k] = header[k];
  if (!score.tempos.length) score.tempos.push({ tick: 0, usPerQuarter: 500000 });
  if (!score.timeSigs.length) score.timeSigs.push({ tick: 0, num: 4, den: 4 });
  score.endTick = Math.max(0, ...[...voices.values()].map((v) => v.tick));
  // measure starts from the first voice's bar lines
  const first = [...voices.values()].sort((a, b) => a.order - b.order)[0];
  score.barTicks = [...new Set((first?.bars || []).filter((t) => t > 0 && t < score.endTick))].sort((a, b) => a - b);
  // chord symbol durations
  score.chords.sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < score.chords.length; i++) {
    const next = i + 1 < score.chords.length ? score.chords[i + 1].tick : score.endTick;
    score.chords[i].dur = next - score.chords[i].tick;
  }
  score.chords = score.chords.filter((c) => c.dur > 0);
  score.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return score;
}

function parseMusicLine(s, voice, key, unitLen, score) {
  let i = 0;
  const wholeTicks = PPQ * 4;
  const unitTicks = (wholeTicks * unitLen[0]) / unitLen[1];
  voice.bars ||= [];
  let pendingTie = voice.pendingTie || null;

  const readLength = () => {
    let num = 1;
    let den = 1;
    const d = /^\d+/.exec(s.slice(i));
    if (d) { num = Number(d[0]); i += d[0].length; }
    while (s[i] === '/') {
      i++;
      const dd = /^\d+/.exec(s.slice(i));
      if (dd) { den *= Number(dd[0]); i += dd[0].length; } else den *= 2;
    }
    return num / den;
  };

  const readPitch = () => {
    let accStr = '';
    while ('^_='.includes(s[i]) && s[i]) accStr += s[i++];
    const letter = s[i];
    if (!/[A-Ga-g]/.test(letter || '')) throw new Error(`Expected note at "${s.slice(i, i + 10)}"`);
    i++;
    let octave = letter === letter.toUpperCase() ? 0 : 1;
    while (s[i] === "'" || s[i] === ',') { octave += s[i] === "'" ? 1 : -1; i++; }
    const L = letter.toUpperCase();
    const barKey = `${L}${octave}`;
    let alter;
    if (accStr) {
      alter = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[accStr];
      if (alter === undefined) throw new Error(`Bad accidental ${accStr}`);
      voice.barAcc[barKey] = alter;
    } else if (barKey in voice.barAcc) alter = voice.barAcc[barKey];
    else alter = key.acc[L] || 0;
    return 60 + 12 * octave + LETTER_PC[L] + alter;
  };

  const addNote = (midi, dur, tick) => {
    if (pendingTie && pendingTie.some((n) => n.midi === midi && n.tick + n.dur === tick)) {
      const prev = pendingTie.find((n) => n.midi === midi && n.tick + n.dur === tick);
      prev.dur += dur;
      return prev;
    }
    const n = { tick, dur, midi, vel: 90, voice: voice.id };
    score.notes.push(n);
    return n;
  };

  const tupletScale = () => {
    if (!voice.tuplet) return 1;
    const scale = voice.tuplet.q / voice.tuplet.p;
    voice.tuplet.r--;
    if (voice.tuplet.r <= 0) voice.tuplet = null;
    return scale;
  };

  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\\' || c === '`') { i++; continue; }
    if (c === '%') break;
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) throw new Error('Unterminated chord symbol');
      const txt = s.slice(i + 1, end);
      i = end + 1;
      if (/^[\^_<>@]/.test(txt)) continue; // annotation
      const parsed = parseChordSymbol(txt);
      if (!parsed) throw new Error(`Unsupported chord symbol "${txt}"`);
      if (voice.order === 0) score.chords.push({ tick: voice.tick, dur: 0, symbol: txt, ...parsed });
      continue;
    }
    if (c === '!' || c === '+') { const end = s.indexOf(c, i + 1); i = end < 0 ? s.length : end + 1; continue; }
    if (c === '{') { const end = s.indexOf('}', i); i = end + 1; continue; }
    if (c === '(' && /\d/.test(s[i + 1])) {
      const p = Number(s[i + 1]);
      i += 2;
      const q = { 2: 3, 3: 2, 4: 3, 6: 2 }[p];
      if (!q) throw new Error(`Unsupported tuplet (${p}`);
      voice.tuplet = { p, q, r: p };
      continue;
    }
    if (c === '(' || c === ')' || c === '.' || c === '~' || c === 'H' || c === 'T') { i++; continue; }
    if (c === '>' || c === '<') throw new Error('Broken rhythm (> <) not supported; write durations explicitly');
    if (c === '[' && /[A-Za-z]:/.test(s.slice(i + 1, i + 3))) throw new Error('Inline fields not supported');
    if (c === '|' || c === ':' || (c === '[' && (s[i + 1] === '|' || /\d/.test(s[i + 1]))) || c === ']') {
      let j = i;
      while (j < s.length && '|:[]'.includes(s[j])) j++;
      const bar = s.slice(i, j);
      if (bar.includes(':')) throw new Error('Repeat signs not supported; write music out in full');
      i = j;
      while (/\d/.test(s[i] || '')) i++; // ending numbers
      voice.bars.push(voice.tick);
      voice.barAcc = {};
      continue;
    }
    if (c === '-') {
      pendingTie = voice.lastNotes;
      i++;
      continue;
    }
    if (c === 'z' || c === 'x') {
      i++;
      const len = readLength() * tupletScale();
      voice.tick += Math.round(len * unitTicks);
      pendingTie = null;
      voice.lastNotes = [];
      continue;
    }
    if (c === '[') {
      i++;
      const pitches = [];
      let innerLen = null;
      while (s[i] !== ']') {
        if (i >= s.length) throw new Error('Unterminated chord');
        pitches.push(readPitch());
        const l = readLength();
        if (innerLen === null) innerLen = l;
      }
      i++;
      const len = (innerLen ?? 1) * readLength() * tupletScale();
      const dur = Math.round(len * unitTicks);
      const tied = pendingTie;
      pendingTie = tied;
      const ns = pitches.map((m) => addNote(m, dur, voice.tick));
      pendingTie = null;
      voice.lastNotes = ns;
      voice.tick += dur;
      continue;
    }
    if (/[\^_=A-Ga-g]/.test(c)) {
      const midi = readPitch();
      const len = readLength() * tupletScale();
      const dur = Math.round(len * unitTicks);
      const n = addNote(midi, dur, voice.tick);
      pendingTie = null;
      voice.lastNotes = [n];
      voice.tick += dur;
      continue;
    }
    throw new Error(`Unexpected "${c}" at "${s.slice(i, i + 12)}"`);
  }
  voice.pendingTie = pendingTie;
}
