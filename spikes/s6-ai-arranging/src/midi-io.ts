// MIDI helpers for the AMT round trip: melody notes → melody.mid, accompaniment.mid → notes.
// @ts-ignore -- S5 JS modules
import { writeMidi, meta, noteEvents, midiToScore } from '../../s5-chart-pipeline/src/midi.mjs';
import type { Note, Score } from './abc-io.ts';

/** Single-track Type-1 MIDI with tempo/meter from the score. GM program 0 by default. */
export function melodyMidi(score: Score, notes: Note[], program = 0): Uint8Array {
  const events: unknown[] = [
    ...score.tempos.map((t) => meta.tempo(t.tick, t.usPerQuarter)),
    ...score.timeSigs.map((t) => meta.timeSig(t.tick, t.num, t.den)),
    { tick: 0, bytes: [0xc0, program] },
  ];
  for (const n of notes) events.push(...noteEvents(n.tick, n.dur, n.midi, n.vel ?? 90, 0));
  return writeMidi({ ppq: score.ppq, tracks: [{ name: 'melody', events }] });
}

export interface TimedNote { time: number; dur: number; midi: number; vel: number; program: number }

/** Notes of a MIDI file in seconds, with the GM program of their channel (drums = 128). */
export function midiNotesSeconds(bytes: Uint8Array): TimedNote[] {
  const score = midiToScore(Buffer.from(bytes)) as Score & { meta: { programs?: Record<string, number> } };
  const tempos = [...score.tempos].sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick !== 0) tempos.unshift({ tick: 0, usPerQuarter: 500000 });
  const toSec = (tick: number) => {
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      const a = tempos[i];
      const b = tempos[i + 1];
      const end = b ? Math.min(b.tick, tick) : tick;
      if (end > a.tick) sec += ((end - a.tick) / score.ppq) * (a.usPerQuarter / 1e6);
      if (!b || b.tick >= tick) break;
    }
    return sec;
  };
  const programs = programMap(bytes);
  return score.notes.map((n) => {
    const ch = Number(/c(\d+)$/.exec(n.voice)?.[1] ?? 0);
    const tr = Number(/^t(\d+)/.exec(n.voice)?.[1] ?? 0);
    return { time: toSec(n.tick), dur: toSec(n.tick + n.dur) - toSec(n.tick), midi: n.midi, vel: n.vel ?? 80, program: ch === 9 ? 128 : (programs.get(`${tr}:${ch}`) ?? programs.get(`*:${ch}`) ?? 0) };
  });
}

/** Program changes per track:channel (first one wins), parsed directly from the SMF bytes. */
function programMap(bytes: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  let p = 14;
  let track = 0;
  while (p + 8 <= bytes.length) {
    const len = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7];
    const end = p + 8 + len;
    let i = p + 8;
    let status = 0;
    while (i < end) {
      while (bytes[i] & 0x80) i++;
      i++; // delta
      let b = bytes[i];
      if (b & 0x80) {
        status = b;
        i++;
      }
      const type = status & 0xf0;
      if (status === 0xff) {
        i++;
        let l = 0;
        while (bytes[i] & 0x80) l = (l << 7) | (bytes[i++] & 0x7f);
        l = (l << 7) | bytes[i++];
        i += l;
        status = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        let l = 0;
        while (bytes[i] & 0x80) l = (l << 7) | (bytes[i++] & 0x7f);
        l = (l << 7) | bytes[i++];
        i += l;
      } else if (type === 0xc0 || type === 0xd0) {
        if (type === 0xc0) {
          const ch = status & 0x0f;
          if (!out.has(`${track}:${ch}`)) out.set(`${track}:${ch}`, bytes[i]);
          if (!out.has(`*:${ch}`)) out.set(`*:${ch}`, bytes[i]);
        }
        i += 1;
      } else i += 2;
    }
    p = end;
    track++;
  }
  return out;
}
