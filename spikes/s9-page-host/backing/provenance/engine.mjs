// Chart-aware backing realizer for the whole catalog; not used by the game build.
// One compact phrase plan per song (specs.mjs) -> note lines in source ticks (the song once),
// always inside the harmony the chart itself carries: every pitch is taken from the pitch
// classes the song's own source voices / lead-sheet chords sound at that moment.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = process.env.GGH_REPO ?? fileURLToPath(new URL('../../../..', import.meta.url));
export const S5 = join(REPO, 'spikes', 's5-chart-pipeline');
export const CHARTS = join(REPO, 'spikes', 'i2-web-phones', 'public', 'charts');
const { loadSong } = await import(pathToFileURL(join(S5, 'src', 'pipeline.mjs')).href);
const manifest = JSON.parse(readFileSync(join(S5, 'songs', 'manifest.json'), 'utf8'));

export const UNIT = 240; // eighth note
export const pc = (n) => ((n % 12) + 12) % 12;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const nm = (m) => `${NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midiOf = (s) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(s);
  return STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
};
const ic = (a, b) => Math.min(pc(a - b), pc(b - a));

const DYN = { pp: [0.44, 0.32], p: [0.5, 0.36], mp: [0.58, 0.42], mf: [0.66, 0.48], f: [0.74, 0.54] };
const BASS_LO = 38, BASS_HI = 55, INNER_LO = 52, INNER_HI = 67, HEADROOM = 5;

export function loadModel(id) {
  const entry = manifest.songs.find((s) => s.id === id);
  const { score, roleNotes } = loadSong(entry, join(S5, 'songs'));
  const chart = JSON.parse(readFileSync(join(CHARTS, 'short', `${id}.json`), 'utf8'));
  const ms = chart.timing.measures;
  const pickup = ms[0].pickup ? ms[1].tick : 0;
  const body = ms.filter((m) => !m.pickup);
  const barLen = body[1].tick - body[0].tick;
  const endTick = chart.form.sections.at(-1).endTick;
  const bars = body.map((m, i) => ({ n: i + 1, tick: m.tick, end: body[i + 1]?.tick ?? endTick }));
  const beats = chart.harmony.beats.map((b) => ({ tick: b.tick, strong: !!b.strong, beat: b.beat }));
  const fb = beats.filter((b) => b.tick >= bars[0].tick);
  const beatLen = fb[1].tick - fb[0].tick;
  const lead = score.chords.length > 0;
  const chords = chart.harmony.chords;
  const chordAt = (t) => {
    let c = null;
    for (const x of chords) if (x.tick <= t) c = x; else break;
    return c;
  };
  const sounding = (t, role) => roleNotes.filter((n) => n.tick <= t && t < n.tick + n.dur && (!role || n.role === role));
  let lastAllowed = new Set();
  const allowedAt = (t) => {
    const s = new Set(sounding(t).map((n) => pc(n.midi)));
    if (lead) for (const p of chordAt(t)?.tones ?? []) s.add(p);
    if (s.size) lastAllowed = s;
    return s.size ? s : lastAllowed;
  };
  const bassPcAt = (t) => {
    const b = sounding(t, 'bass').sort((a, c) => a.midi - c.midi)[0];
    if (b) return pc(b.midi);
    if (lead && chordAt(t)) return chordAt(t).bass ?? chordAt(t).root;
    const any = sounding(t).sort((a, c) => a.midi - c.midi)[0];
    return any ? pc(any.midi) : null;
  };
  const melody = roleNotes.filter((n) => n.role === 'melody');
  const shift = chart.handbellSet?.transposeSemitones ?? 12;
  const melOver = (a, b) => melody.filter((n) => n.tick < b && n.tick + n.dur > a);
  const tonic = bassPcAt(bars.at(-1).tick);
  const fifths = score.meta?.fifths ?? 0;
  const majorTonic = pc(fifths * 7);
  const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((i) => pc(majorTonic + i)));
  const minor = allowedAt(bars.at(-1).tick).has(pc(tonic + 3));
  return { id, title: chart.song.title, entry, score, chart, roleNotes, melody, shift, pickup, bars, barLen, beatLen, beats, endTick, lead, chordAt, allowedAt, bassPcAt, melOver, tonic, minor, scale, meter: `${chart.timing.timeSignatures[0].numerator}/${chart.timing.timeSignatures[0].denominator}`, bpm: chart.timing.tempos[0].bpm, style: chart.harmony.style, harmonySource: chart.harmony.source };
}

const place = (p, lo, hi, near) => {
  let best = null;
  for (let m = lo; m <= hi; m++) if (pc(m) === p && (best === null || Math.abs(m - near) < Math.abs(best - near))) best = m;
  return best;
};

/** Parse "Name@offset+dur" tokens (offset/dur in ticks inside the bar). */
const parseNotes = (text, barTick) => text.split(/\s+/).filter(Boolean).map((tok) => {
  const m = /^([A-G][#b]?\d)@(\d+)\+(\d+)(~?)(?:\*([\d.]+))?$/.exec(tok);
  if (!m) throw new Error(`bad note ${tok}`);
  return { tick: barTick + Number(m[2]), dur: Number(m[3]), midi: midiOf(m[1]), pass: m[4] === '~', gain: m[5] ? Number(m[5]) : 1 };
});

export function realize(M, spec) {
  const notes = [];
  const flags = [];
  const flag = (bar, msg) => flags.push({ bar, msg });
  const barOf = (t) => M.bars.find((b) => t >= b.tick && t < b.end);
  const beatsIn = (a, b) => M.beats.filter((x) => x.tick >= a && x.tick < b);
  const lastBar = M.bars.at(-1);
  const melClash = (p, a, b) => M.melOver(a, b).some((n) => ic(n.midi, p) === 1);
  // A note may sound only while its pitch class belongs to the harmony; cut it where that stops.
  const validEnd = (p, from, to) => {
    for (let t = from + UNIT; t < to; t += UNIT) {
      const al = M.allowedAt(t);
      if (!al.has(p) && [...al].some((q) => ic(q, p) === 1)) return t;
      if (!al.has(p) && (t - from) % M.beatLen === 0) return t;
    }
    return to;
  };
  let prevBass = 45;
  let prevLine = 60;
  let prevSecond = 55;

  for (const [pi, ph] of spec.phrases.entries()) {
    const first = M.bars[ph.bars[0] - 1];
    const last = M.bars[ph.bars[1] - 1];
    if (!first || !last) throw new Error(`${M.id}: phrase ${ph.bars} outside the song (${M.bars.length} bars)`);
    const [bv, iv] = DYN[ph.dyn ?? 'mp'];
    const A = first.tick, B = last.end;
    const isFinal = last === lastBar;
    const out = [];
    const push = (voice, tick, dur, midi, vel, extra = {}) => out.push({ voice, tick, dur, midi, vel: Math.round(vel * 100) / 100, phrase: pi, ...extra });

    // ── bass ──
    const bassMode = ph.bass ?? 'chord';
    const strikes = [];
    if (bassMode !== 'rest') {
      let cur = null;
      const pedalPc = M.tonic;
      const pedalMidi = place(pedalPc, 38, 49, 43);
      for (const b of beatsIn(A, B)) {
        const t = b.tick;
        const barStart = barOf(t).tick === t;
        const al = M.allowedAt(t);
        let want = M.bassPcAt(t);
        if (want === null) continue;
        if (bassMode === 'pedal' && al.has(pedalPc) && ![...al].some((q) => ic(q, pedalPc) === 1)) want = pedalPc;
        if (cur && validEnd(cur.p, cur.t, t + UNIT) <= t) cur = null; // the held note had to stop: strike again when allowed
        let strike = barStart || !cur || want !== cur.p;
        if (bassMode === 'bar' && !b.strong && !barStart) strike = false;
        if (bassMode === 'pulse' && b.strong && !barStart && cur && want === cur.p) {
          const fifth = pc(want + 7);
          strikes.push({ t, p: al.has(fifth) ? fifth : want, alt: true });
          cur = { p: want, t };
          continue;
        }
        if (!strike) continue;
        strikes.push({ t, p: want, pedal: bassMode === 'pedal' && want === pedalPc ? pedalMidi : null });
        cur = { p: want, t };
      }
      for (const [i, s] of strikes.entries()) {
        const next = strikes[i + 1]?.t ?? B;
        const finalBass = isFinal && s.t === lastBar.tick;
        let midi = s.pedal ?? (finalBass ? place(s.p, 38, 49, 41) : place(s.p, BASS_LO, BASS_HI, prevBass));
        if (!s.pedal && !finalBass && midi > 52 && midi - 12 >= BASS_LO && Math.abs(midi - 12 - prevBass) <= 8) midi -= 12;
        const end = validEnd(s.p, s.t, next);
        s.midi = midi; s.end = end;
        prevBass = midi;
      }
      // Stepwise links into the next bass note (lead-sheet songs: the chords leave the bass still).
      if (bassMode === 'walk') {
        for (let i = 0; i + 1 < strikes.length; i++) {
          const a = strikes[i], b = strikes[i + 1];
          const linkT = b.t - M.beatLen;
          if (a.end !== b.t || linkT - a.t < M.beatLen) continue;
          const d = b.midi - a.midi;
          const dir = Math.sign(d);
          if (!dir || Math.abs(d) < 3 || Math.abs(d) > 7) continue;
          let cand = null;
          for (let m = b.midi - dir; m !== a.midi; m -= dir) if (M.scale.has(pc(m))) { cand = m; break; }
          if (cand === null || Math.abs(cand - b.midi) > 2) continue;
          const al = M.allowedAt(linkT);
          const rub = !al.has(pc(cand)) && [...al].some((q) => ic(q, cand) === 1);
          const melNow = M.melOver(linkT, b.t), melNext = M.melOver(b.t, b.t + UNIT);
          const octaves = melNow.some((n) => pc(n.midi) === pc(cand)) && melNext.some((n) => pc(n.midi) === pc(b.midi));
          if (rub || octaves || melClash(cand, linkT, b.t)) continue;
          a.end = linkT;
          strikes.splice(i + 1, 0, { t: linkT, p: pc(cand), midi: cand, end: b.t, link: true });
          i++;
        }
      }
      for (const s of strikes) {
        const lastDown = isFinal && s.t === lastBar.tick;
        push('bass', s.t, s.end - s.t, s.midi, bv * (s.link || s.alt ? 0.88 : 1) + (s.t === A ? 0.03 : 0), { ...(s.link ? { opt: true, pass: true, link: true } : {}), ...(!s.link && !s.alt ? { chartBass: true } : {}) });
        if ((s.pedal || lastDown) && M.allowedAt(s.t).has(pc(s.midi + 7))) {
          push('drone', s.t, validEnd(pc(s.midi + 7), s.t, s.end) - s.t, s.midi + 7, bv * 0.55);
        }
      }
    }
    const bassAt = (t) => out.filter((n) => n.voice === 'bass' && n.tick <= t).at(-1)?.midi ?? prevBass;

    // ── inner ──
    const mode = ph.inner ?? 'line';
    const ceiling = (a, b) => {
      const over = M.melOver(a, b);
      return Math.min(INNER_HI, over.length ? Math.min(...over.map((n) => n.midi)) + M.shift - HEADROOM : INNER_HI);
    };
    const candidates = (t, span) => {
      const al = M.allowedAt(t);
      const lo = Math.max(INNER_LO, bassAt(t) + 4);
      const hi = ceiling(t, t + span);
      const c = [];
      for (let m = lo; m <= hi; m++) if (al.has(pc(m)) && !melClash(m, t, t + Math.min(span, M.beatLen))) c.push(m);
      return c;
    };
    if (mode === 'line' || mode === 'pair' || mode === 'after') {
      let cur = null;
      const starts = [];
      for (const b of beatsIn(A, B)) {
        const t = b.tick;
        const bar = barOf(t);
        const barStart = bar.tick === t;
        const ch = M.lead ? M.chordAt(t) : null;
        const before = M.lead ? M.chordAt(t - 1) : null;
        const chordChange = !!ch && ch.tick === t && (!before || before.symbol !== ch.symbol);
        const mustMove = cur && (!M.allowedAt(t).has(pc(cur.midi)) || melClash(cur.midi, t, t + M.beatLen));
        let strike = mustMove || chordChange || (mode === 'after' ? t === bar.tick + M.beatLen : barStart);
        if (mode === 'after' && barStart) { if (cur) cur.end = t; cur = null; strike = false; }
        if (ph.breath && !isFinal && t >= B - M.beatLen) { if (cur) cur.end = t; cur = null; continue; }
        if (!strike) continue;
        const cands = candidates(t, M.beatLen * 2);
        if (cur) cur.end = t;
        if (!cands.length) { cur = null; flag(bar.n, `inner line rests at +${t - bar.tick}: no free chord tone under the tune`); continue; }
        const al = M.allowedAt(t);
        const bassPc = M.bassPcAt(t);
        const melPcs = new Set(M.melOver(t, t + UNIT).map((n) => pc(n.midi)));
        const third = M.lead ? M.chordAt(t)?.tones[1] : null;
        const lt = pc(M.tonic - 1);
        const prevWasLt = cur ? pc(cur.midi) === lt : pc(prevLine) === lt;
        const bPrev = bassAt(t - 1), bNow = bassAt(t);
        let best = null;
        for (const m of cands) {
          let cost = Math.abs(m - prevLine) * (Math.abs(m - prevLine) > 4 ? 1.4 : 1);
          if (m === prevLine) cost += chordChange ? 1.0 : 0.4;
          if (pc(m) === bassPc) cost += 2;
          if (melPcs.has(pc(m))) cost += 1.5;
          if (third !== null && pc(m) === third && !melPcs.has(third)) cost -= 1.5;
          if (pc(m) === lt && melPcs.has(lt)) cost += 3;
          if ([...al].some((q) => ic(q, m) === 1)) cost += 3;
          if (prevWasLt && al.has(M.tonic)) cost += m - prevLine === 1 ? -5 : 3;
          const i0 = pc(prevLine - bPrev), i1 = pc(m - bNow);
          if (i0 === i1 && (i0 === 0 || i0 === 7) && Math.sign(m - prevLine) === Math.sign(bNow - bPrev) && m !== prevLine) cost += 6;
          cost += 0.3 * Math.abs(m - (58 + 5 * Math.sin(Math.PI * (t - A) / (B - A))));
          if (best === null || cost < best.cost) best = { m, cost };
        }
        if (cur && cur.midi === best.m && !barStart && !mustMove) { cur.end = B; continue; } // common tone: tie, do not strike again
        cur = { t, midi: best.m, end: B };
        starts.push(cur);
        prevLine = best.m;
      }
      for (const s of starts) {
        const end = validEnd(pc(s.midi), s.t, s.end);
        push('line', s.t, end - s.t, s.midi, iv + (s.t === A ? 0.03 : 0));
        if (mode === 'pair') {
          const al = M.allowedAt(s.t);
          const bassPc = M.bassPcAt(s.t);
          let best = null;
          for (let m = Math.max(52, bassAt(s.t) + 7); m <= s.midi - 3; m++) {
            if (!al.has(pc(m)) || s.midi - m > 9 || melClash(m, s.t, s.t + M.beatLen)) continue;
            const iv2 = s.midi - m;
            let cost = ([3, 4, 8, 9].includes(iv2) ? 0 : 1.5) + (pc(m) === bassPc ? 2 : 0) + 0.5 * Math.abs(m - prevSecond);
            if (best === null || cost < best.cost) best = { m, cost };
          }
          if (best) {
            push('second', s.t, validEnd(pc(best.m), s.t, end) - s.t, best.m, iv * 0.9, { opt: true });
            prevSecond = best.m;
          }
        }
      }
    } else if (mode === 'roll') {
      const units = M.barLen / UNIT;
      const slots = M.meter === '4/4' ? [2, 4, 6] : Array.from({ length: units - 1 }, (_, i) => i + 1);
      const step = M.meter === '4/4' ? 2 * UNIT : UNIT;
      const arch = slots.map((_, i) => Math.min(i, slots.length - 1 - i));
      let prev = null;
      for (const bar of M.bars.slice(ph.bars[0] - 1, ph.bars[1])) {
        for (const [k, u] of slots.entries()) {
          const t = bar.tick + u * UNIT;
          if (t >= bar.end) continue;
          const offBeat = (t - bar.tick) % M.beatLen !== 0;
          if (offBeat && M.melody.some((n) => n.tick === t)) continue; // leave the ringer's off-beat attacks exposed
          const cands = candidates(t, step).filter((m) => m >= 55);
          if (!cands.length) continue;
          let m = cands[Math.min(arch[k] + (cands.length > 3 ? 1 : 0), cands.length - 1)];
          if (m === prev) m = cands[Math.max(0, cands.indexOf(m) - 1)];
          if (m === prev) continue;
          push('roll', t, validEnd(pc(m), t, Math.min(t + step, bar.end)) - t, m, iv * 0.85);
          prev = m;
        }
      }
      if (prev) prevLine = prev;
    }

    // ── explicit bars written by hand replace the generated notes of that voice in that bar ──
    for (const [barN, voices] of Object.entries(ph.write ?? {})) {
      const bar = M.bars[Number(barN) - 1];
      for (const [voice, text] of Object.entries(voices)) {
        for (let i = out.length - 1; i >= 0; i--) if (out[i].voice === voice && out[i].tick >= bar.tick && out[i].tick < bar.end) out.splice(i, 1);
        for (const n of parseNotes(text, bar.tick)) push(voice, n.tick, n.dur, n.midi, (voice === 'bass' ? bv : voice === 'drone' ? bv * 0.55 : iv) * n.gain, { written: true, ...(n.pass ? { opt: true, pass: true } : {}) });
      }
    }

    // ── ending: only what still sounds at the end of the last bar is the final sonority (held in the coda); a short settling figure under a long last bell ──
    if (isFinal) {
      for (const n of out) if (n.tick + n.dur >= lastBar.end && n.tick >= lastBar.tick) n.fin = true;
      const lastMel = M.melody.at(-1);
      const lineNote = out.filter((n) => n.voice === 'line' && n.tick >= lastBar.tick).at(-1);
      if (lineNote && lastMel.tick <= lineNote.tick && lastMel.dur >= 2 * M.beatLen && lineNote.dur >= 2 * M.beatLen && ph.settle !== false) {
        let p = lineNote.midi;
        const t1 = lineNote.tick + M.beatLen;
        const al = M.allowedAt(t1);
        let down = null;
        for (let m = p - 1; m >= Math.max(INNER_LO, bassAt(t1) + 4); m--) if (al.has(pc(m))) { down = m; break; }
        if (down !== null) push('settle', t1, lastBar.end - t1, down, iv * 0.8, { end: true, fin: true });
      }
    }
    notes.push(...out);
  }

  // Harmony check of everything, including hand-written bars: fail loudly, never ship a guess.
  const errors = [];
  for (const n of notes) {
    const bar = barOf(n.tick);
    const al = M.allowedAt(n.tick);
    const where = `${M.id} bar ${bar?.n} +${n.tick - (bar?.tick ?? 0)} ${n.voice} ${nm(n.midi)}`;
    if (!al.has(pc(n.midi)) && !n.opt) errors.push(`${where}: not in the chart harmony {${[...al].map((p) => NAMES[p]).join(' ')}}`);
    if (!n.pass && !al.has(pc(n.midi)) && [...al].some((q) => ic(q, n.midi) === 1)) errors.push(`${where}: a semitone from the chart harmony`);
    const chartBass = n.voice === 'bass' && !n.link && pc(n.midi) === M.bassPcAt(n.tick);
    if (!chartBass && M.melOver(n.tick, n.tick + Math.min(n.dur, M.beatLen)).some((m) => ic(m.midi, n.midi) === 1 && m.tick <= n.tick)) errors.push(`${where}: a semitone from the bell sounding with it`);
    if (n.voice !== 'bass' && n.voice !== 'drone') {
      const low = M.melOver(n.tick, n.tick + n.dur).map((m) => m.midi + M.shift);
      if (low.length && Math.min(...low) - n.midi < HEADROOM) errors.push(`${where}: under ${HEADROOM} semitones below the bell`);
    }
    if (n.midi < 36 || n.midi > 76 || n.dur <= 0) errors.push(`${where}: out of range`);
  }
  notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return { notes, flags, errors };
}
