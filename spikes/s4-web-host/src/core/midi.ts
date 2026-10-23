// Minimal Standard MIDI File (SMF) parser: formats 0/1, PPQ timing, tempo map, note on/off,
// running status. Engine-agnostic (no DOM) — candidate for a shared TypeScript core.

export interface MidiNote {
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
  /** Seconds from file start. */
  time: number;
  /** Seconds. */
  duration: number;
}

export interface MidiTrack {
  name: string;
  notes: MidiNote[];
}

export interface TempoEvent {
  tick: number;
  usPerQuarter: number;
}

export interface MidiFile {
  format: number;
  ppq: number;
  tracks: MidiTrack[];
  tempos: TempoEvent[];
  timeSignature: { numerator: number; denominator: number };
  durationTicks: number;
  ticksToSeconds(tick: number): number;
}

class Reader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get length(): number {
    return this.bytes.length;
  }
  u8(): number {
    if (this.pos >= this.bytes.length) throw new Error('Unexpected end of MIDI data');
    return this.bytes[this.pos++];
  }
  u16(): number {
    const a = this.u8();
    return (a << 8) | this.u8();
  }
  u32(): number {
    const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8();
    return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
  }
  str(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error('Invalid variable-length quantity');
  }
  slice(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error('Unexpected end of MIDI data');
    const s = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

interface RawNote {
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

export function parseMidi(data: ArrayBuffer | Uint8Array): MidiFile {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(bytes);
  if (r.str(4) !== 'MThd') throw new Error('Not a standard MIDI file (missing MThd)');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos += headerLen - 6;
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const ppq = division;

  const tracks: MidiTrack[] = [];
  const tempos: TempoEvent[] = [];
  const raw: RawNote[] = [];
  let timeSignature = { numerator: 4, denominator: 4 };
  let durationTicks = 0;

  while (tracks.length < trackCount && r.pos + 8 <= r.length) {
    const id = r.str(4);
    const len = r.u32();
    const end = Math.min(r.pos + len, r.length);
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    const trackIndex = tracks.length;
    const open = new Map<number, { tick: number; velocity: number }[]>();
    let tick = 0;
    let status = 0;
    let name = '';
    while (r.pos < end) {
      tick += r.vlq();
      const b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const d = r.slice(r.vlq());
        if (type === 0x03 && !name) name = String.fromCharCode(...d).trim();
        else if (type === 0x51 && d.length === 3) tempos.push({ tick, usPerQuarter: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (type === 0x58 && d.length >= 2 && tick === 0) timeSignature = { numerator: d[0], denominator: 1 << d[1] };
        else if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.pos += r.vlq();
        continue;
      }
      if (b & 0x80) status = b;
      else {
        if (!status) throw new Error('Running status without a prior status byte');
        r.pos--;
      }
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (type === 0x90 || type === 0x80) {
        const pitch = r.u8() & 0x7f;
        const vel = r.u8() & 0x7f;
        const key = ch * 128 + pitch;
        if (type === 0x90 && vel > 0) {
          let list = open.get(key);
          if (!list) open.set(key, (list = []));
          list.push({ tick, velocity: vel });
        } else {
          const start = open.get(key)?.shift();
          if (start) raw.push({ track: trackIndex, channel: ch, pitch, velocity: start.velocity, startTick: start.tick, endTick: tick });
        }
      } else if (type === 0xc0 || type === 0xd0) r.pos += 1;
      else r.pos += 2;
    }
    for (const [key, list] of open) {
      for (const s of list) {
        raw.push({ track: trackIndex, channel: Math.floor(key / 128), pitch: key % 128, velocity: s.velocity, startTick: s.tick, endTick: tick });
      }
    }
    durationTicks = Math.max(durationTicks, tick);
    tracks.push({ name, notes: [] });
    r.pos = end;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQuarter: 500_000 });
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i > 0) acc += ((tempos[i].tick - tempos[i - 1].tick) * tempos[i - 1].usPerQuarter) / 1e6 / ppq;
    starts.push(acc);
  }
  const ticksToSeconds = (tick: number): number => {
    let i = tempos.length - 1;
    while (i > 0 && tempos[i].tick > tick) i--;
    return starts[i] + ((tick - tempos[i].tick) * tempos[i].usPerQuarter) / 1e6 / ppq;
  };

  for (const n of raw) {
    const time = ticksToSeconds(n.startTick);
    tracks[n.track].notes.push({ ...n, time, duration: ticksToSeconds(n.endTick) - time });
  }
  for (const t of tracks) t.notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);

  return { format, ppq, tracks, tempos, timeSignature, durationTicks, ticksToSeconds };
}
