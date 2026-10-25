// Song form: one pass of a carol → a longer piece that develops (deterministic, rule-based).
//
//   full:  intro (last phrase, accompaniment only) · verse × N · [interlude + key change] · final
//          verse · coda (tag of the last phrase + a held final bar, gentle ritardando)
//   short: the song once (what the S5 charts were before format 0.3)
//
// Each verse has a "development" that caps what the arrangement may add in it (v1 light bass and
// harmony, v2 fuller, v3 adds a descant, a quieter verse for contrast, the last verse up a step).
// N is chosen so the whole piece lands near `targetSec` (default 150 s).
import { beatGrid, makeTimeMap, measureLength, measureStarts, timeSigAt } from './score.mjs';

export const FORM_IDS = ['full', 'short'];

export const FORM_DEFAULTS = {
  targetSec: 150,
  minVerses: 2,
  maxVerses: 6,
  intro: true,
  /** Bars of the last phrase used for the intro and the coda tag ('auto': 4 if the song has ≥ 16 bars, else 2). */
  introBars: 'auto',
  codaBars: 'auto',
  /** 'auto': up a step for the last verse when there are ≥ 3 verses; true: always (≥ 2); false: never. */
  keyChange: 'auto',
  keyChangeSemitones: 2,
  /** Rule-based descant (countermelody above the tune) in the developed verses. */
  descant: true,
  coda: true,
  ritardando: true,
};

// Caps per development (0 = layer absent). bass/harmony levels: 1 = chord changes + downbeats,
// 2 = + strong beats, 3 = every beat. energy (0..1) drives the backing groove.
export const DEVELOPMENT = {
  intro: { melody: false, bass: 1, harmony: 1, descant: false, energy: 0.45 },
  light: { melody: true, bass: 1, harmony: 1, descant: false, energy: 0.55 },
  full: { melody: true, bass: 2, harmony: 2, descant: false, energy: 0.8 },
  descant: { melody: true, bass: 3, harmony: 3, descant: true, energy: 0.9 },
  quiet: { melody: true, bass: 1, harmony: 2, descant: false, energy: 0.4 },
  finale: { melody: true, bass: 3, harmony: 3, descant: true, energy: 1 },
  interlude: { melody: false, bass: 1, harmony: 1, descant: false, energy: 0.65 },
  coda: { melody: true, bass: 3, harmony: 3, descant: true, energy: 1 },
  once: { melody: true, bass: 3, harmony: 3, descant: false, energy: 0.8 },
};

const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Development id per verse: light, full, then descant/quiet alternating, finale last. */
export function verseSchedule(n) {
  if (n <= 1) return ['once'];
  const out = ['light'];
  for (let k = 2; k < n; k++) out.push(k === 2 ? 'full' : k % 2 === 1 ? 'descant' : 'quiet');
  out.push('finale');
  return out;
}

export function transposeSymbol(symbol, t) {
  if (!t) return symbol;
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(symbol);
  if (!m) return symbol;
  const name = (l, acc) => PC_NAMES[mod12(NAT[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + t)];
  return name(m[1], m[2]) + m[3] + (m[4] ? `/${name(m[4], m[5])}` : '');
}

export function resolveForm(form) {
  if (form && typeof form === 'object') return { id: form.id ?? 'full', ...FORM_DEFAULTS, ...form };
  if (form === 'short') return { ...FORM_DEFAULTS, id: 'short' };
  if (form === undefined || form === 'full') return { ...FORM_DEFAULTS, id: 'full' };
  throw new Error(`Unknown form "${form}" (known: ${FORM_IDS.join(', ')})`);
}

// Natural pitch at or below `m` (window bounds sit on naturals so an accidental always shares a
// window with the natural below it — the handbell convention used for bell ownership).
const naturalAtOrBelow = (m) => ([1, 3, 6, 8, 10].includes(mod12(m)) ? m - 1 : m);

/**
 * Pitch windows (written MIDI) for the realized parts, fixed for the whole piece so a key change
 * moves notes within a role's region instead of into another role's: bass and harmony are 12
 * semitones each, directly below the tune; the descant's octave starts on the first natural
 * above the tune's highest note (after the key change, `up` semitones).
 */
export function windowsFor(melody, up = 0) {
  const low = Math.min(...melody.map((n) => n.midi));
  const high = Math.max(...melody.map((n) => n.midi));
  const harmonyLow = naturalAtOrBelow(low - 12);
  const topNatural = naturalAtOrBelow(high + up);
  const descantLow = topNatural + ([4, 11].includes(mod12(topNatural)) ? 1 : 2);
  return {
    melody: [low, high],
    harmony: [harmonyLow, harmonyLow + 11],
    bass: [harmonyLow - 12, harmonyLow - 1],
    descant: [descantLow, descantLow + 11],
  };
}

/**
 * material: { melody[], sourceBass[] (score bass line, may be empty), chords[] (raw, source ticks),
 *             chordSource: 'lead-sheet' | 'inferred', key: { tonic, mode } }
 * Returns { id, score (expanded: ppq, tempos, timeSigs, barTicks, endTick, meta, chords),
 *           sections[], segments[], melody[], sourceBass[], descant[], windows, beats, toSec }.
 * Every note carries `seg` (segment index); sections are the segments with times.
 */
export function expandForm(score, material, formOpt) {
  const opts = resolveForm(formOpt);
  const starts = measureStarts(score);
  const ts0 = timeSigAt(score, 0);
  const full = measureLength(score, ts0);
  const pickup = starts.length > 1 && starts[1] - starts[0] < full ? starts[1] : 0;
  const lastStart = starts[starts.length - 1];
  const verseEnd = lastStart + full; // source tick where the next verse's downbeat falls
  const advance = verseEnd - pickup;
  const bodyBars = starts.length - (pickup ? 1 : 0);
  const phraseBars = (v) => Math.max(1, Math.min(bodyBars, v === 'auto' ? (bodyBars >= 16 ? 4 : 2) : v));
  const srcSec = makeTimeMap(score);
  const verseSec = srcSec(verseEnd) - srcSec(pickup);
  const tonic = material.key.tonic;

  // ── plan ──
  const plan = [];
  if (opts.id === 'short') {
    plan.push({ kind: 'verse', dev: 'once', verse: 1, t: 0 });
  } else {
    const introBars = phraseBars(opts.introBars);
    const codaBars = phraseBars(opts.codaBars);
    const barSec = srcSec(full) - srcSec(0);
    const extra = (opts.intro ? introBars : 0) * barSec + (opts.coda ? (codaBars + 1) * barSec : 0);
    let n = Math.round((opts.targetSec - extra) / verseSec);
    n = Math.max(opts.minVerses, Math.min(opts.maxVerses, n));
    const keyChange = opts.keyChange === true ? n >= 2 : opts.keyChange === 'auto' ? n >= 3 : false;
    if (opts.intro) plan.push({ kind: 'intro', dev: 'intro', t: 0, bars: introBars });
    const devs = verseSchedule(n);
    devs.forEach((dev, i) => {
      const last = i === n - 1;
      const t = last && keyChange ? opts.keyChangeSemitones : 0;
      if (last && keyChange) plan.push({ kind: 'interlude', dev: 'interlude', t: 0, to: t });
      plan.push({ kind: 'verse', dev: opts.descant || !DEVELOPMENT[dev].descant ? dev : dev === 'descant' ? 'full' : dev, verse: i + 1, t });
    });
    if (opts.coda) plan.push({ kind: 'coda', dev: 'coda', t: keyChange ? opts.keyChangeSemitones : 0, bars: codaBars });
  }

  // ── lay out segments on the expanded tick line ──
  const segments = [];
  let cursor = plan[0].kind === 'verse' ? pickup : 0; // next downbeat
  for (const p of plan) {
    const seg = { index: segments.length, kind: p.kind, dev: p.dev, transpose: p.t, verse: p.verse ?? null };
    if (p.kind === 'verse') {
      seg.offset = cursor - pickup;
      seg.srcFrom = 0;
      seg.srcTo = verseEnd;
      seg.start = seg.offset; // includes the pickup, which overlaps the previous segment's last bar
      seg.downbeat = cursor;
      seg.end = seg.offset + verseEnd;
      seg.bars = starts.filter((s) => s >= pickup).map((s) => s + seg.offset);
    } else if (p.kind === 'intro' || p.kind === 'coda') {
      const from = starts[starts.length - p.bars];
      seg.srcFrom = from;
      seg.srcTo = verseEnd;
      seg.offset = cursor - from;
      seg.start = seg.downbeat = cursor;
      seg.end = cursor + (verseEnd - from);
      seg.bars = starts.filter((s) => s >= from).map((s) => s + seg.offset);
      if (p.kind === 'coda') {
        // Held final bar (fermata): one more bar after the tag.
        seg.bars.push(seg.end);
        seg.holdFrom = seg.end;
        seg.end += full;
      }
    } else {
      // Interlude: two bars, old tonic then the dominant seventh of the new key.
      seg.start = seg.downbeat = cursor;
      seg.end = cursor + 2 * full;
      seg.bars = [cursor, cursor + full];
      seg.to = p.to;
      seg.chords = [
        { tick: cursor, dur: full, ...chordOf(mod12(tonic + p.t), material.key.mode === 'minor' ? [0, 3, 7] : [0, 4, 7]) },
        { tick: cursor + full, dur: full, ...chordOf(mod12(tonic + p.to + 7), [0, 4, 7, 10]) },
      ];
    }
    cursor = seg.end;
    segments.push(seg);
  }
  const endTick = cursor;
  const clipAt = (i) => (i + 1 < segments.length ? segments[i + 1].start : endTick);

  // ── notes ──
  const place = (seg, n, role) => ({ ...n, tick: n.tick + seg.offset, midi: n.midi + seg.transpose, role, seg: seg.index });
  const copyLine = (src, role, want) => {
    const out = [];
    for (const seg of segments) {
      if (seg.offset === undefined || !want(seg)) continue;
      const clip = clipAt(seg.index);
      for (const n of src) {
        if (n.tick < seg.srcFrom || n.tick >= seg.srcTo) continue;
        const m = place(seg, n, role);
        if (m.tick >= clip) continue;
        m.dur = Math.max(1, Math.min(m.dur, clip - m.tick));
        if (seg.holdFrom !== undefined && m.tick + m.dur >= seg.holdFrom) m.dur = seg.end - m.tick;
        out.push(m);
      }
    }
    return out.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  };
  const melody = copyLine(material.melody, 'melody', (s) => DEVELOPMENT[s.dev].melody);
  const sourceBass = copyLine(material.sourceBass, 'bass', () => true);

  // ── chords (contiguous: a chord lasts until the next one) ──
  let chords = [];
  for (const seg of segments) {
    if (seg.chords) {
      chords.push(...seg.chords.map((c) => ({ ...c, seg: seg.index })));
      continue;
    }
    for (const c of material.chords) {
      const a = Math.max(c.tick, seg.srcFrom);
      const b = Math.min(c.tick + c.dur, seg.srcTo);
      if (b <= a) continue;
      chords.push({
        tick: a + seg.offset,
        dur: b - a,
        symbol: transposeSymbol(c.symbol, seg.transpose),
        root: mod12(c.root + seg.transpose),
        bass: mod12((c.bass ?? c.root) + seg.transpose),
        tones: c.tones.map((x) => mod12(x + seg.transpose)),
        seg: seg.index,
      });
    }
  }
  chords.sort((a, b) => a.tick - b.tick);
  chords = chords.filter((c, i) => !(i + 1 < chords.length && chords[i + 1].tick <= c.tick));
  chords.forEach((c, i) => (c.dur = (i + 1 < chords.length ? chords[i + 1].tick : endTick) - c.tick));

  // ── expanded score: bars, meter, tempo (+ ritardando into the held final bar) ──
  const barTicks = [...new Set(segments.flatMap((s) => s.bars))].filter((t) => t > 0 && t < endTick).sort((a, b) => a - b);
  const tempos = [];
  for (const seg of segments) {
    if (seg.offset === undefined) continue; // interlude: the tempo carries on
    tempos.push({ tick: seg.start, usPerQuarter: tempoAt(score, seg.srcFrom).usPerQuarter });
    for (const t of score.tempos) {
      if (t.tick > seg.srcFrom && t.tick < seg.srcTo && t.tick + seg.offset < seg.end) tempos.push({ tick: t.tick + seg.offset, usPerQuarter: t.usPerQuarter });
    }
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const merged = [];
  for (const t of tempos) {
    if (merged.length && merged[merged.length - 1].tick === t.tick) merged[merged.length - 1] = t;
    else if (!merged.length || merged[merged.length - 1].usPerQuarter !== t.usPerQuarter) merged.push(t);
  }
  if (!merged.length || merged[0].tick !== 0) merged.unshift({ tick: 0, usPerQuarter: score.tempos[0]?.usPerQuarter ?? 500000 });
  const coda = segments.find((s) => s.kind === 'coda');
  if (coda && opts.ritardando) {
    const us = tempoAt({ tempos: merged }, coda.holdFrom).usPerQuarter;
    const ritFrom = Math.max(coda.start, coda.holdFrom - full);
    [[ritFrom, 1.08], [ritFrom + full / 2, 1.18], [coda.holdFrom, 1.3]].forEach(([tick, f]) => merged.push({ tick, usPerQuarter: Math.round(us * f) }));
    merged.sort((a, b) => a.tick - b.tick);
  }
  const timeSigs = score.timeSigs.length > 1 ? segments.flatMap((s) => score.timeSigs.map((t) => ({ ...t, tick: Math.max(s.start, t.tick + (s.offset ?? s.start)) }))) : score.timeSigs.slice();
  const exp = {
    title: score.title,
    composer: score.composer,
    meta: { ...score.meta },
    ppq: score.ppq,
    tempos: merged,
    timeSigs: dedupeSigs(timeSigs),
    barTicks,
    notes: melody,
    chords,
    endTick,
  };
  const toSec = makeTimeMap(exp);
  const beats = beatGrid(exp);
  const windows = windowsFor(material.melody, Math.max(0, ...segments.map((s) => s.transpose)));
  // Sections: segments from their downbeat (a pickup belongs to the previous section's last bar).
  const sections = segments.map((s, i) => ({
    index: i,
    kind: s.kind,
    label: s.kind === 'verse' ? (opts.id === 'short' ? 'Song' : `Verse ${s.verse}`) : s.kind[0].toUpperCase() + s.kind.slice(1),
    ...(s.verse ? { verse: s.verse } : {}),
    tick: i === 0 ? 0 : s.downbeat,
    endTick: i + 1 < segments.length ? segments[i + 1].downbeat : endTick,
    transpose: s.transpose,
    key: mod12(tonic + s.transpose),
    development: s.dev,
    energy: DEVELOPMENT[s.dev].energy,
  }));
  const sectionAt = (tick) => {
    let k = 0;
    for (let i = 0; i < sections.length; i++) if (sections[i].tick <= tick) k = i;
    return k;
  };
  const descant = segments.some((s) => DEVELOPMENT[s.dev].descant) ? buildDescant(melody, chords, beats, segments, windows, material.key) : [];
  return { id: opts.id, opts, score: exp, segments, sections, sectionAt, melody, sourceBass, descant, windows, beats, toSec, chordSource: material.chordSource };
}

function chordOf(root, intervals) {
  const suffix = intervals.length === 4 ? '7' : intervals[1] === 3 ? 'm' : '';
  const tones = intervals.map((i) => mod12(root + i));
  return { symbol: PC_NAMES[root] + suffix, root, bass: root, tones };
}

function tempoAt(score, tick) {
  let t = score.tempos[0];
  for (const x of score.tempos) if (x.tick <= tick) t = x;
  return t;
}

function dedupeSigs(sigs) {
  const out = [];
  for (const t of [...sigs].sort((a, b) => a.tick - b.tick)) {
    const last = out[out.length - 1];
    if (last && last.tick === t.tick) out[out.length - 1] = t;
    else if (!last || last.num !== t.num || last.den !== t.den) out.push(t);
  }
  return out;
}

/**
 * Rule-based descant: one long note per chord change / downbeat (strong beats in 4/4 when the
 * chord changes there), chosen from the chord's tones in a window above the tune. Rules: stay at
 * least a minor third above the melody sounding under it, prefer small steps and common tones,
 * prefer thirds/sixths over the melody, avoid parallel fifths/octaves with it, avoid the melody's
 * own pitch class, and end each verse on the tonic or its third. Deterministic.
 */
export function buildDescant(melody, chords, beats, segments, windows, key) {
  const out = [];
  const melodyAt = (t0, t1) => melody.filter((n) => n.tick < t1 && n.tick + n.dur > t0);
  for (const seg of segments) {
    if (!DEVELOPMENT[seg.dev].descant) continue;
    const t = seg.transpose;
    const [lo, hi] = windows.descant;
    const segStart = seg.downbeat;
    const segEnd = seg.holdFrom ?? seg.end;
    const slots = [];
    for (const b of beats) {
      if (b.tick < segStart || b.tick >= segEnd) continue;
      const c = chords.find((x) => x.tick <= b.tick && b.tick < x.tick + x.dur);
      if (!c) continue;
      const change = c.tick === b.tick;
      if (b.downbeat || (b.strong && change)) slots.push({ tick: b.tick, chord: c });
    }
    let prev = null;
    let prevMel = null;
    slots.forEach((s, i) => {
      const end = i + 1 < slots.length ? slots[i + 1].tick : seg.end;
      const under = melodyAt(s.tick, end);
      const top = under.length ? Math.max(...under.map((n) => n.midi)) : -Infinity;
      const mel = under.find((n) => n.tick <= s.tick && n.tick + n.dur > s.tick) ?? under[0];
      const last = i === slots.length - 1;
      const cands = [];
      for (let m = lo; m <= hi; m++) {
        const pc = mod12(m);
        if (!s.chord.tones.includes(pc)) continue;
        if (m < top + 3) continue;
        if (mel && pc === mod12(mel.midi)) continue;
        let cost = prev === null ? Math.abs(m - (lo + hi) / 2) * 0.3 : Math.abs(m - prev) * (m === prev ? 0.2 : 1);
        if (prev !== null && Math.abs(m - prev) > 5) cost += 4;
        if (mel) {
          const iv = mod12(m - mel.midi);
          if ([3, 4, 8, 9].includes(iv)) cost -= 1.5;
          if (prev !== null && prevMel !== null && mel.midi !== prevMel) {
            const pv = mod12(prev - prevMel);
            if ((iv === 7 || iv === 0) && pv === iv && m !== prev) cost += 6;
            if (Math.sign(m - prev) === Math.sign(mel.midi - prevMel) && m !== prev) cost += 0.5;
          }
        }
        if (pc === s.chord.root && s.chord.tones.length > 3) cost += 0.5;
        if (last) cost += [mod12(key.tonic + t), mod12(key.tonic + t + (key.mode === 'minor' ? 3 : 4))].includes(pc) ? -3 : 3;
        cands.push({ m, cost });
      }
      if (!cands.length) {
        prev = null;
        return;
      }
      cands.sort((a, b) => a.cost - b.cost || a.m - b.m);
      const m = cands[0].m;
      out.push({ tick: s.tick, dur: end - s.tick, midi: m, vel: 70, voice: 'descant', role: 'descant', seg: seg.index });
      prev = m;
      prevMel = mel ? mel.midi : null;
    });
  }
  return out;
}
