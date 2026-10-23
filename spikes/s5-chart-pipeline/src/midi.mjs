// Standard MIDI File (SMF) reader and writer. Zero dependencies.
import { PPQ } from './score.mjs';

// ---------- reader ----------

export function readMidi(buf) {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let p = 0;
  const u32 = () => ((data[p++] << 24) | (data[p++] << 16) | (data[p++] << 8) | data[p++]) >>> 0;
  const u16 = () => (data[p++] << 8) | data[p++];
  const str = (n) => { let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(data[p++]); return s; };
  const vlq = () => { let v = 0; let b; do { b = data[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32();
  const format = u16();
  const ntracks = u16();
  const division = u16();
  p += hlen - 6;
  if (division & 0x8000) throw new Error('SMPTE time division not supported');

  const tracks = [];
  for (let t = 0; t < ntracks; t++) {
    while (str(4) !== 'MTrk') { const len = u32(); p += len; }
    const len = u32();
    const end = p + len;
    let tick = 0;
    let status = 0;
    const events = [];
    while (p < end) {
      tick += vlq();
      let b = data[p];
      if (b & 0x80) { status = b; p++; } else if (!status) throw new Error('Running status without status');
      b = status;
      if (b === 0xff) {
        const type = data[p++];
        const l = vlq();
        const bytes = data.slice(p, p + l);
        p += l;
        events.push({ tick, meta: type, bytes });
        status = 0;
      } else if (b === 0xf0 || b === 0xf7) {
        const l = vlq();
        events.push({ tick, sysex: data.slice(p, p + l) });
        p += l;
        status = 0;
      } else {
        const type = b & 0xf0;
        const ch = b & 0x0f;
        const d1 = data[p++];
        const d2 = type === 0xc0 || type === 0xd0 ? 0 : data[p++];
        events.push({ tick, type, ch, d1, d2 });
      }
    }
    p = end;
    tracks.push(events);
  }
  return { format, division, tracks };
}

// MIDI -> Score. Voices are "t<track>c<channel>" (track name kept in meta.voiceNames).
export function midiToScore(buf, opts = {}) {
  const midi = readMidi(buf);
  const scale = PPQ / midi.division;
  const score = { title: opts.title || '', composer: opts.composer || '', meta: { voiceNames: {} }, ppq: PPQ, tempos: [], timeSigs: [], barTicks: [], notes: [], chords: [], endTick: 0 };
  const decoder = new TextDecoder('latin1');
  midi.tracks.forEach((events, ti) => {
    let trackName = '';
    const open = new Map();
    for (const e of events) {
      const tick = Math.round(e.tick * scale);
      score.endTick = Math.max(score.endTick, tick);
      if (e.meta === 0x51) score.tempos.push({ tick, usPerQuarter: (e.bytes[0] << 16) | (e.bytes[1] << 8) | e.bytes[2] });
      else if (e.meta === 0x58) score.timeSigs.push({ tick, num: e.bytes[0], den: 2 ** e.bytes[1] });
      else if (e.meta === 0x03) trackName = decoder.decode(e.bytes).trim();
      else if (e.meta === 0x59) { score.meta.fifths ??= (e.bytes[0] << 24) >> 24; score.meta.mode ??= e.bytes[1] ? 'minor' : 'major'; }
      else if (e.type === 0x90 && e.d2 > 0) {
        const k = `${e.ch}:${e.d1}`;
        if (open.has(k)) closeNote(open, k, tick, score);
        open.set(k, { tick, midi: e.d1, vel: e.d2, voice: `t${ti}c${e.ch}` });
      } else if (e.type === 0x80 || (e.type === 0x90 && e.d2 === 0)) {
        const k = `${e.ch}:${e.d1}`;
        if (open.has(k)) closeNote(open, k, tick, score);
      }
    }
    for (const k of [...open.keys()]) closeNote(open, k, score.endTick, score);
    if (trackName) for (const v of new Set(score.notes.filter((n) => n.voice.startsWith(`t${ti}c`)).map((n) => n.voice))) score.meta.voiceNames[v] = trackName;
    if (ti === 0 && trackName && !score.title) score.title = trackName;
  });
  dedupeByTick(score.tempos);
  dedupeByTick(score.timeSigs);
  if (!score.tempos.length || score.tempos[0].tick > 0) score.tempos.unshift({ tick: 0, usPerQuarter: 500000 });
  if (!score.timeSigs.length || score.timeSigs[0].tick > 0) score.timeSigs.unshift({ tick: 0, num: 4, den: 4 });
  score.notes = score.notes.filter((n) => n.dur > 0).sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  score.endTick = Math.max(score.endTick, ...score.notes.map((n) => n.tick + n.dur));
  return score;
}

function closeNote(open, k, tick, score) {
  const n = open.get(k);
  open.delete(k);
  score.notes.push({ ...n, dur: tick - n.tick });
}

function dedupeByTick(arr) {
  arr.sort((a, b) => a.tick - b.tick);
  for (let i = arr.length - 1; i > 0; i--) if (arr[i].tick === arr[i - 1].tick) arr.splice(i - 1, 1);
}

// ---------- writer ----------

function vlqBytes(v) {
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return out;
}

const textBytes = (s) => [...Buffer.from(s, 'latin1')];

// tracks: [{ name, events: [{ tick, bytes:[...] } | { tick, meta, data:[...] }] }]
export function writeMidi({ ppq = PPQ, tracks }) {
  const chunks = [];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (ppq >> 8) & 0xff, ppq & 0xff];
  chunks.push(...header);
  for (const tr of tracks) {
    const evs = [];
    if (tr.name !== undefined) evs.push({ tick: 0, order: -1, meta: 0x03, data: textBytes(tr.name) });
    evs.push(...tr.events);
    // stable sort: tick, then note-offs before note-ons at the same tick
    evs.sort((a, b) => a.tick - b.tick || (a.order ?? orderOf(a)) - (b.order ?? orderOf(b)));
    const body = [];
    let last = 0;
    for (const e of evs) {
      body.push(...vlqBytes(e.tick - last));
      last = e.tick;
      if (e.meta !== undefined) body.push(0xff, e.meta, ...vlqBytes(e.data.length), ...e.data);
      else body.push(...e.bytes);
    }
    body.push(0, 0xff, 0x2f, 0);
    const len = body.length;
    chunks.push(0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...body);
  }
  return Uint8Array.from(chunks);
}

function orderOf(e) {
  if (e.meta !== undefined) return 0;
  const type = e.bytes[0] & 0xf0;
  if (type === 0x80 || (type === 0x90 && e.bytes[2] === 0)) return 1;
  return 2;
}

export const meta = {
  tempo: (tick, usPerQuarter) => ({ tick, meta: 0x51, data: [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] }),
  timeSig: (tick, num, den) => ({ tick, meta: 0x58, data: [num, Math.log2(den), 24, 8] }),
  text: (tick, s) => ({ tick, meta: 0x01, data: textBytes(s) }),
};

export function noteEvents(tick, dur, note, vel = 100, ch = 0) {
  return [
    { tick, bytes: [0x90 | ch, note, vel] },
    { tick: tick + dur, bytes: [0x80 | ch, note, 0] },
  ];
}
