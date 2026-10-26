// Chord timeline for the chart's optional `harmony` block (chart format 0.2): the chord symbols
// and the beat grid a game needs to generate a backing track (tempo/meter changes included).
// Lead sheets carry chord symbols; scores without them (Mutopia MIDI) get chords inferred from
// their notes, one chord per strong-beat segment.
import { beatGrid, makeTimeMap, timeSigAt } from './score.mjs';

// Backing style presets understood by the I2 web game (spikes/i2-web-phones/src/backing).
export const BACKING_STYLES = ['sleigh-ride', 'march', 'waltz', 'gentle'];

const r3 = (x) => Math.round(x * 1000) / 1000;
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUALITIES = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// Diatonic triads in a major key (degree -> quality suffix) plus V7.
const DIATONIC_MAJOR = { 0: [''], 2: ['m'], 4: ['m'], 5: [''], 7: ['', '7'], 9: ['m'] };
const DIATONIC_MINOR = { 0: ['m'], 3: [''], 5: ['m'], 7: ['', '7', 'm'], 8: [''], 10: [''] };

// Style from metadata (manifest `options.backingStyle` or ABC `%%hh-backing-style`), else a
// default from the meter and tempo.
export function backingStyle(score) {
  const s = score.meta?.['backing-style'];
  if (s) {
    if (!BACKING_STYLES.includes(s)) throw new Error(`Unknown backing style "${s}" (known: ${BACKING_STYLES.join(', ')})`);
    return s;
  }
  const ts = timeSigAt(score, 0);
  const qpm = 60e6 / (score.tempos[0]?.usPerQuarter ?? 500000);
  if (ts.den === 8 || qpm < 72) return 'gentle';
  if (ts.num === 3) return 'waltz';
  return 'march';
}

export function keyOf(score, notes) {
  if (Number.isInteger(score.meta?.fifths)) {
    const majorTonic = (((score.meta.fifths * 7) % 12) + 12) % 12;
    return score.meta.mode === 'minor' ? { tonic: (majorTonic + 9) % 12, mode: 'minor' } : { tonic: majorTonic, mode: 'major' };
  }
  // Fallback: the major scale covering the most note time.
  const w = new Array(12).fill(0);
  for (const n of notes) w[n.midi % 12] += n.dur;
  let best = 0;
  let bestScore = -1;
  for (let t = 0; t < 12; t++) {
    const s = MAJOR_SCALE.reduce((a, i) => a + w[(t + i) % 12], 0) + w[t] * 0.5;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return { tonic: best, mode: 'major' };
}

function isDiatonic(key, root, suffix) {
  const table = key.mode === 'minor' ? DIATONIC_MINOR : DIATONIC_MAJOR;
  return (table[(root - key.tonic + 12) % 12] || []).includes(suffix);
}

// One chord per strong-beat segment, chosen by template matching (duration-weighted pitch
// classes, root salience, a bass-root bonus when the score has a bass line, diatonic and tonic
// bonuses — strongest on the final segment — and a small stay-on-the-same-chord bonus), then
// merged where consecutive segments agree.
export function inferChords(score, notes) {
  if (!notes.length) return [];
  const key = keyOf(score, notes);
  const hasBass = notes.some((n) => n.role === 'bass');
  const bounds = [...new Set([0, ...beatGrid(score).filter((b) => b.strong).map((b) => b.tick)])].filter((t) => t < score.endTick).sort((a, b) => a - b);
  const segs = bounds.map((t, i) => ({ tick: t, end: i + 1 < bounds.length ? bounds[i + 1] : score.endTick }));
  const out = [];
  let prev = null;
  for (const seg of segs) {
    const w = new Array(12).fill(0);
    let total = 0;
    let bassNote = null;
    for (const n of notes) {
      const overlap = Math.min(n.tick + n.dur, seg.end) - Math.max(n.tick, seg.tick);
      if (overlap <= 0) continue;
      const weight = overlap * (n.tick === seg.tick ? 1.5 : 1);
      w[n.midi % 12] += weight;
      total += weight;
      if ((n.role === 'bass' || !hasBass) && (!bassNote || n.tick < bassNote.tick || (n.tick === bassNote.tick && n.midi < bassNote.midi))) bassNote = n;
    }
    if (total === 0) continue; // rest: keep the previous chord sounding
    let best = null;
    for (let root = 0; root < 12; root++) {
      for (const q of QUALITIES) {
        const tones = q.intervals.map((i) => (root + i) % 12);
        let s = 0;
        for (let pc = 0; pc < 12; pc++) s += tones.includes(pc) ? w[pc] : -0.6 * w[pc];
        if (q.suffix === '7') s -= 0.25 * total + (w[(root + 10) % 12] > 0 ? 0 : total);
        if (hasBass && bassNote) {
          if (bassNote.midi % 12 === root) s += 0.35 * total;
          else if (tones.includes(bassNote.midi % 12)) s += 0.1 * total;
        }
        if (isDiatonic(key, root, q.suffix)) s += 0.3 * total;
        s += 0.25 * w[root];
        if (root === key.tonic && q.suffix === (key.mode === 'minor' ? 'm' : '')) s += (seg === segs[segs.length - 1] ? 0.5 : 0.08) * total;
        if (prev && prev.root === root && prev.suffix === q.suffix) s += 0.12 * total;
        if (!best || s > best.s + 1e-9) best = { s, root, suffix: q.suffix, intervals: q.intervals };
      }
    }
    if (prev && prev.root === best.root && prev.suffix === best.suffix) {
      prev.end = seg.end;
      continue;
    }
    prev = { tick: seg.tick, end: seg.end, root: best.root, suffix: best.suffix, intervals: best.intervals };
    out.push(prev);
  }
  if (out.length) out[0].tick = 0;
  for (let i = 0; i + 1 < out.length; i++) out[i].end = out[i + 1].tick;
  if (out.length) out[out.length - 1].end = score.endTick;
  return out.map((c) => ({
    tick: c.tick,
    dur: c.end - c.tick,
    symbol: PC_NAMES[c.root] + c.suffix,
    root: c.root,
    tones: c.intervals.map((i) => (c.root + i) % 12),
    bass: c.root,
  }));
}

// The chart's `harmony` block: { source, style, chords[], beats[] } with times from the tempo map.
// Returns null when no chords can be found (e.g. an empty score); readers then play no backing.
// opts.chords/opts.source: a chord timeline already built (song form: transposed copies of the
// lead-sheet or inferred chords); opts.sectionAt(tick): form section index stored on each beat.
export function buildHarmony(score, roleNotes, opts = {}) {
  const toSec = makeTimeMap(score);
  const source = opts.source ?? (score.chords.length ? 'lead-sheet' : 'inferred');
  const raw = opts.chords ?? (source === 'lead-sheet' ? score.chords : inferChords(score, roleNotes));
  if (!raw.length) return null;
  const chords = raw.map((c) => ({
    tick: c.tick,
    time: r3(toSec(c.tick)),
    dur: c.dur,
    durSec: r3(toSec(c.tick + c.dur) - toSec(c.tick)),
    symbol: c.symbol,
    root: c.root,
    bass: c.bass,
    tones: c.tones,
  }));
  const chordAt = (tick) => {
    let k = null;
    for (let i = 0; i < chords.length; i++) if (chords[i].tick <= tick) k = i;
    return k !== null && tick < chords[k].tick + chords[k].dur ? k : null;
  };
  const beats = beatGrid(score).map((b) => ({
    tick: b.tick,
    time: r3(toSec(b.tick)),
    bar: b.measure + 1,
    beat: b.beat,
    div: b.div,
    strong: b.strong,
    chord: chordAt(b.tick),
    ...(opts.sectionAt ? { section: opts.sectionAt(b.tick) } : {}),
  }));
  return { source, style: backingStyle(score), chords, beats };
}
