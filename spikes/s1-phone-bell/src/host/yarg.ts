/**
 * I1 YARG sidecar: forwards phone rings to the YARG fork's HgpBridge (localhost UDP, `hgp0` text
 * format, see the fork's Assets/Script/Integration/Hgp/Core/HgpPacket.cs).
 *
 *  - One phone = one ringer seat (slot 0..maxPhones-1) = one virtual YARG bell device `ringerN`.
 *    The YARG device id is per seat, not per phone, so a phone that drops and rejoins (or a
 *    replacement phone) drives the same YARG profile.
 *  - Each seat gets the bells of its chart part (S5 chart JSON: difficulty × ringer count). Lane k
 *    of the YARG highway = the ringer's k-th bell (low → high), as in S5's notes.mid export.
 *  - YARG reports the song and each bell device's part/difficulty when a chart loads (`song`), so
 *    the phones are re-assigned to match what the players actually picked.
 *  - Ring times are the phones' source timestamps already mapped to host time (`th`), sent on the
 *    host's monotonic clock; the bridge maps that clock to its own from `sync` packets.
 */
import dgram from 'node:dgram';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bell } from '../core/hgp.ts';

export const YARG_DEFAULT_PORT = 47800;
/** YARG five-lane colours, lane order green, red, yellow, blue, orange. */
export const LANE_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#f97316'];
/** Ringer part per slot, matching the fork's HgpRingerSlots and S5's export track order. */
export const PART_NAMES = ['Guitar', 'Bass', 'Rhythm', 'Keys', 'Guitar Co-op'];
export const MAX_LANES = 5;
/** A ring is a press; the release follows this long after the strike (as the S3 harness does). */
export const RELEASE_MS = 60;

export type Tier = 'easy' | 'medium' | 'hard';

export interface ChartRinger {
  index: number;
  label: string;
  bells: string[];
}
export interface ChartPart {
  difficulty: Tier;
  ringerCount: number;
  ringers: ChartRinger[];
}
export interface Chart {
  song: { id: string; title: string };
  parts: ChartPart[];
}

/** YARG difficulty name → S5 tier (S5 exports Expert as a copy of Hard). */
export function tierForDifficulty(d: string | undefined): Tier {
  switch ((d ?? '').toLowerCase()) {
    case 'beginner':
    case 'easy':
      return 'easy';
    case 'medium':
      return 'medium';
    default:
      return 'hard';
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export class ChartLibrary {
  readonly charts: Chart[] = [];
  private readonly index = new Map<string, Chart>();

  add(c: Chart): void {
    this.charts.push(c);
    this.index.set(norm(c.song.id), c);
    this.index.set(norm(c.song.title), c);
  }

  /** By S5 song id ("deck-the-halls"), YARG/song.ini title ("Deck the Halls") or folder name. */
  find(key: string | undefined | null): Chart | undefined {
    return key ? this.index.get(norm(key)) : undefined;
  }

  static load(dir: string): ChartLibrary {
    const lib = new ChartLibrary();
    if (!existsSync(dir)) return lib;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Chart;
        if (c?.song?.id && Array.isArray(c.parts)) lib.add(c);
      } catch {
        // not a chart
      }
    }
    return lib;
  }
}

/** S5 export lane mapping (spikes/s5-chart-pipeline/src/export.mjs `laneOf`). */
export function laneOf(bellIndex: number, bellCount: number): number {
  if (bellCount <= MAX_LANES) return bellIndex;
  return Math.round((bellIndex * (MAX_LANES - 1)) / (bellCount - 1));
}

const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteMidi(bell: string): number {
  const m = /^([A-G]#?)(-?\d+)$/.exec(bell);
  if (!m) return 72;
  return PCS.indexOf(m[1]) + 12 * (Number(m[2]) + 1);
}
const pretty = (b: string) => b.replace(/\d+$/, '').replace('#', '♯');

/**
 * Phone bells for one ringer: one bell per lane. Ringers with more than five bells get adjacent
 * bells merged into one lane (as S5's export does); the merged lane rings its lowest bell.
 */
export function laneBells(bells: string[]): Bell[] {
  const lanes: string[][] = [];
  bells.forEach((b, i) => (lanes[laneOf(i, bells.length)] ??= []).push(b));
  return lanes
    .map((ids, lane) => ({ ids, lane }))
    .filter((x) => x.ids?.length)
    .map(({ ids, lane }) => ({ id: ids.join('+'), label: ids.map(pretty).join('/'), midi: noteMidi(ids[0]), color: LANE_COLORS[lane] }));
}

/** Bells before a song is known: five lanes of a C-major pentatonic, an octave per two seats. */
export function freeLaneBells(slot: number): Bell[] {
  const octave = 4 + (Math.floor(slot / 2) % 2);
  return laneBells(['C', 'D', 'E', 'G', 'A'].map((n) => `${n}${octave + 1}`));
}

export interface Seat {
  slot: number;
  /** YARG bell device id (stable per seat). */
  device: string;
  phoneId: string | null;
  name: string;
  online: boolean;
  /** Ringer part index in the chart (= YARG instrument slot); defaults to `slot`. */
  part: number;
  tier: Tier;
  bells: Bell[];
  rings: number;
  lastRingAt: number;
}

export interface YargRoomOptions {
  maxPhones?: number;
  /** Ringer count of the exported chart part (S5 export used 4). */
  ringerCount?: number;
  charts: ChartLibrary;
  song?: string;
  difficulty?: string;
  /** Sends one bridge datagram. */
  send: (text: string) => void;
  /** Host monotonic clock, ms. */
  now: () => number;
  schedule?: (fn: () => void, ms: number) => void;
  log?: (s: string) => void;
}

/** Seats, bell assignment and packet generation — transport-free so it can be unit tested. */
export class YargRoom {
  readonly seats: (Seat | null)[];
  readonly maxPhones: number;
  readonly ringerCount: number;
  chart: Chart | undefined;
  defaultTier: Tier;
  lastSong: { title: string; at: number } | null = null;
  ringsSent = 0;
  /** Arrival age (host receive − source time) of forwarded rings, ms. */
  readonly ages: number[] = [];
  private seq = 0;
  private readonly lastPhoneSlot = new Map<string, number>();
  private readonly o: YargRoomOptions;

  constructor(o: YargRoomOptions) {
    this.o = o;
    this.maxPhones = Math.max(1, Math.min(MAX_LANES, o.maxPhones ?? 4));
    this.ringerCount = o.ringerCount ?? 4;
    this.seats = Array.from({ length: this.maxPhones }, () => null);
    this.chart = o.charts.find(o.song);
    this.defaultTier = tierForDifficulty(o.difficulty);
  }

  private log(s: string): void {
    this.o.log?.(s);
  }

  bellsFor(seat: Pick<Seat, 'slot' | 'part' | 'tier'>): Bell[] {
    const part = this.chart?.parts.find((p) => p.difficulty === seat.tier && p.ringerCount === this.ringerCount);
    const ringer = part?.ringers[seat.part];
    return ringer && ringer.bells.length > 0 ? laneBells(ringer.bells) : freeLaneBells(seat.slot);
  }

  seatTitle(seat: Seat): string {
    return `Ringer ${seat.slot + 1} · ${PART_NAMES[seat.part] ?? `part ${seat.part + 1}`}${this.chart ? ` · ${seat.tier}` : ''}`;
  }

  hello(seat: Seat): string {
    const name = (seat.name || `Phone ${seat.slot + 1}`).replace(/[\r\n]+/g, ' ').slice(0, 40);
    return `hgp0 hello ${seat.device} ${seat.slot} ${name}`;
  }

  seatOf(phoneId: string): Seat | null {
    return this.seats.find((s) => s?.phoneId === phoneId) ?? null;
  }

  /**
   * Seat a phone: its previous seat if free, else the lowest empty seat, else the lowest seat whose
   * phone is offline (take-over). Returns null when every seat has an online phone.
   */
  join(phoneId: string, name: string): Seat | null {
    let seat = this.seatOf(phoneId);
    if (!seat) {
      const prev = this.lastPhoneSlot.get(phoneId);
      let slot = prev !== undefined && !this.seats[prev]?.online ? prev : -1;
      if (slot < 0) slot = this.seats.findIndex((s) => s === null);
      if (slot < 0) slot = this.seats.findIndex((s) => s !== null && !s.online);
      if (slot < 0) return null;
      const old = this.seats[slot];
      seat = old ?? { slot, device: `ringer${slot + 1}`, phoneId, name, online: true, part: slot, tier: this.defaultTier, bells: [], rings: 0, lastRingAt: 0 };
      seat.phoneId = phoneId;
      this.seats[slot] = seat;
      seat.bells = this.bellsFor(seat);
    }
    seat.name = name;
    seat.online = true;
    this.lastPhoneSlot.set(phoneId, seat.slot);
    this.o.send(this.hello(seat));
    this.log(`YARG: ${name} → ${this.seatTitle(seat)} (${seat.bells.map((b) => b.id).join(' ')})`);
    return seat;
  }

  /** Phone disconnected: keep the seat (and the YARG device) for a rejoin or a replacement phone. */
  leave(phoneId: string): Seat | null {
    const seat = this.seatOf(phoneId);
    if (seat) seat.online = false;
    return seat;
  }

  /** Free a seat and remove its YARG device (dashboard action / shutdown). */
  remove(slot: number): void {
    const seat = this.seats[slot];
    if (!seat) return;
    this.o.send(`hgp0 bye ${seat.device}`);
    this.seats[slot] = null;
  }

  removeAll(): void {
    this.seats.forEach((_, i) => this.remove(i));
  }

  /** Re-announce seats (YARG may have started after the phones joined; the bridge ignores repeats). */
  announce(): void {
    for (const s of this.seats) if (s) this.o.send(this.hello(s));
  }

  /**
   * Forward one ring. `th` = source time on the host clock (ms). Returns the lane, or null if the
   * phone has no seat or the bell is not one of its lanes.
   */
  ring(phoneId: string, bellId: string | undefined, th: number, rx: number): number | null {
    const seat = this.seatOf(phoneId);
    if (!seat) return null;
    const lane = bellId === undefined ? 0 : seat.bells.findIndex((b) => b.id === bellId || b.id.split('+').includes(bellId));
    if (lane < 0) return null;
    const t = Number.isFinite(th) ? Math.min(th, rx) : rx;
    seat.rings++;
    seat.lastRingAt = rx;
    this.ringsSent++;
    this.ages.push(rx - t);
    if (this.ages.length > 2000) this.ages.splice(0, 1000);
    this.o.send(`hgp0 ring ${seat.device} ${lane} 1 ${(t / 1000).toFixed(6)} ${++this.seq}`);
    const up = t + RELEASE_MS;
    const release = () => this.o.send(`hgp0 ring ${seat.device} ${lane} 0 ${(up / 1000).toFixed(6)} ${++this.seq}`);
    const wait = up - this.o.now();
    if (wait > 0 && this.o.schedule) this.o.schedule(release, wait);
    else release();
    return lane;
  }

  /** Pick the chart and tier (dashboard / CLI). Returns seats whose bells changed. */
  setSong(key: string | null, difficulty?: string): Seat[] {
    this.chart = key ? this.o.charts.find(key) : undefined;
    if (difficulty) this.defaultTier = tierForDifficulty(difficulty);
    for (const s of this.seats) if (s) s.tier = this.defaultTier;
    return this.reassign();
  }

  /**
   * YARG's `hgp0 song <device:part:difficulty,...|-> <title>` report. Returns seats whose bells
   * changed, or null if the datagram is not a song report.
   */
  onSongReport(text: string): Seat[] | null {
    const m = /^hgp0 song (\S+) ?(.*)$/.exec(text.trim());
    if (!m) return null;
    const title = m[2] || '?';
    this.lastSong = { title, at: this.o.now() };
    const chart = this.o.charts.find(title);
    if (!chart) this.log(`YARG: song "${title}" has no handbell chart; phones keep their bells`);
    else this.chart = chart;
    if (m[1] !== '-') {
      for (const spec of m[1].split(',')) {
        const [device, part, difficulty] = spec.split(':');
        const seat = this.seats.find((s) => s?.device === device);
        if (!seat) continue;
        const p = Number(part);
        if (Number.isInteger(p) && p >= 0) seat.part = p;
        seat.tier = tierForDifficulty(difficulty);
      }
    }
    return chart ? this.reassign() : [];
  }

  private reassign(): Seat[] {
    const changed: Seat[] = [];
    for (const s of this.seats) {
      if (!s) continue;
      const bells = this.bellsFor(s);
      if (bells.map((b) => b.id).join() !== s.bells.map((b) => b.id).join()) changed.push(s);
      s.bells = bells;
    }
    for (const s of changed) this.log(`YARG: ${s.name} → ${this.seatTitle(s)} (${s.bells.map((b) => b.id).join(' ')})`);
    return changed;
  }

  summary() {
    return {
      song: this.chart ? { id: this.chart.song.id, title: this.chart.song.title } : null,
      tier: this.defaultTier,
      ringerCount: this.ringerCount,
      lastSong: this.lastSong,
      ringsSent: this.ringsSent,
      seats: this.seats.map((s) => (s ? { slot: s.slot, device: s.device, phoneId: s.phoneId, name: s.name, online: s.online, part: s.part, partName: PART_NAMES[s.part], tier: s.tier, title: this.seatTitle(s), bells: s.bells, rings: s.rings } : null)),
    };
  }
}

/** UDP link to the fork's HgpBridge: `sync` at 10 Hz, seat re-announce every 2 s, pong/song in. */
export class YargLink {
  readonly socket: dgram.Socket;
  lastPong = -Infinity;
  /** Round trip of sync→pong on localhost, ms (last). */
  rtt = NaN;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    readonly port: number,
    readonly now: () => number,
    onMessage: (text: string) => void,
    readonly host = '127.0.0.1',
  ) {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (buf) => {
      const text = buf.toString('utf8');
      const pong = /^hgp0 pong (\S+)/.exec(text);
      if (pong) {
        this.lastPong = this.now();
        this.rtt = this.lastPong - Number(pong[1]) * 1000;
        return;
      }
      onMessage(text);
    });
    // Windows reports ICMP port-unreachable (YARG not running yet) as a socket error; ignore it.
    this.socket.on('error', () => undefined);
  }

  get connected(): boolean {
    return this.now() - this.lastPong < 1500;
  }

  async start(announce: () => void): Promise<void> {
    await new Promise<void>((res) => this.socket.bind(0, '127.0.0.1', () => res()));
    this.timers.push(setInterval(() => this.send(`hgp0 sync ${(this.now() / 1000).toFixed(6)}`), 100));
    this.timers.push(setInterval(announce, 2000));
  }

  send(text: string): void {
    this.socket.send(text, this.port, this.host);
  }

  close(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.socket.close();
  }
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
