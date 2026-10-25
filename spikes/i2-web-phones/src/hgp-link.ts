// Game page ↔ S1 host link. The game connects to the S1 Node host as a `dashboard` client over
// WebSocket (same PC, so RTT ≈ 0.2 ms), runs S1's ClockSync against the host clock, receives
// every phone's HGP gesture (relayed by the host with its source timestamp `th` in host time)
// and sends bell assignments + note cues back through the host.
import { ClockSync } from '../../s1-phone-bell/src/core/clock-sync.ts';
import { HGP_VERSION, type Bell, type PartCard, type SoundMode } from '../../s1-phone-bell/src/core/hgp.ts';

export interface PhoneInfo {
  id: string;
  name: string;
  kind: string;
  online: boolean;
  bells: Bell[];
  status: { api?: string; rateHz?: number; rttP50?: number; rttMin?: number; syncN?: number; visible?: boolean; mode?: string; axis?: unknown };
  /** Lobby ✓ Ready (HGP `ready`). */
  ready?: boolean;
  events: number;
}

/** Lobby state for the phones (HGP `parts`; the S1 host adds each phone's `you`/`ready`). */
export interface LobbyParts {
  phase: 'lobby' | 'play';
  song?: string;
  parts: PartCard[];
  /** Phones that joined during a round and get a part at the next one (each phone sees `next`). */
  waiting?: string[];
}

export interface HostInfo {
  session?: string;
  joinUrl?: string;
  tlsMode?: string;
  lanIp?: string;
  soundMode?: SoundMode;
}

export interface RingEvent {
  deviceId: string;
  name: string;
  /** HGP gesture type ('ring', 'impact', 'tap', …). */
  g: string;
  bell: string;
  /** Gesture time on the S1 host clock (device-side clock sync), ms. Undefined if the phone was not synced. */
  th?: number;
  /** Gesture time on the device clock, ms. */
  t?: number;
  /** When the S1 host received it (host clock), ms. */
  rx: number;
  seq?: number;
  vel?: number;
  det?: number;
  /** performance.now() when this page received it. */
  receivedAtMs: number;
}

export class HgpLink {
  readonly sync = new ClockSync();
  /** Host clock sync restarts (a good exchange disagreed with the fit by > 50 ms): when, and by how much. */
  readonly syncJumps: { perf: number; deltaMs: number }[] = [];
  phones: PhoneInfo[] = [];
  info: HostInfo = {};
  state: 'connecting' | 'open' | 'closed' = 'closed';
  onDevices: (phones: PhoneInfo[]) => void = () => {};
  onInfo: (info: HostInfo) => void = () => {};
  onState: (s: string) => void = () => {};
  /** A phone asked for a part in the lobby (HGP `claim`, relayed by the host); -1 = sit out. */
  onClaim: (deviceId: string, part: number) => void = () => {};
  /** Every gesture from any phone (lobby practice + gameplay). Multiple listeners. */
  readonly ringListeners = new Set<(e: RingEvent) => void>();
  private ws: WebSocket | null = null;
  private syncId = 0;
  private syncTimer: number | undefined;
  private retryMs = 500;

  constructor(readonly url: string) {}

  /** http(s) origin of the S1 host's loopback listener (for /qr.svg, /api/info). */
  get httpOrigin(): string {
    const u = new URL(this.url);
    return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`;
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.setState('connecting');
    ws.onopen = () => {
      this.retryMs = 500;
      this.sync.reset();
      ws.send(JSON.stringify({ type: 'hello', v: HGP_VERSION, kind: 'dashboard', deviceId: 'i2-game', name: 'I2 game', app: 'go-go-harmoniyo/i2-web-phones' }));
      this.setState('open');
      let burst = 0;
      const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'sync', id: ++this.syncId, t0: performance.now() }));
      const b = window.setInterval(() => {
        ping();
        if (++burst >= 10) window.clearInterval(b);
      }, 30);
      window.clearInterval(this.syncTimer);
      this.syncTimer = window.setInterval(ping, 500);
    };
    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onclose = () => {
      window.clearInterval(this.syncTimer);
      this.setState('closed');
      window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(4000, this.retryMs * 2);
    };
    ws.onerror = () => ws.close();
  }

  private setState(s: 'connecting' | 'open' | 'closed'): void {
    this.state = s;
    this.onState(s);
  }

  private receive(data: string): void {
    const t3 = performance.now();
    let m: Record<string, any>;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    switch (m.type) {
      case 'sync':
        if (typeof m.t0 === 'number' && typeof m.t1 === 'number' && typeof m.t2 === 'number') {
          const resets = this.sync.resets;
          const before = this.sync.offsetAt((m.t0 + t3) / 2);
          this.sync.add({ t0: m.t0, t1: m.t1, t2: m.t2, t3 });
          if (this.sync.resets !== resets && this.syncJumps.length < 32) this.syncJumps.push({ perf: Math.round(t3), deltaMs: Math.round(((this.sync.estimate?.offset ?? NaN) - before) * 100) / 100 });
        }
        return;
      case 'welcome':
        if (m.info) this.setInfo(m.info);
        return;
      case 'info':
        this.setInfo(m.info);
        return;
      case 'devices':
        this.phones = (m.devices as PhoneInfo[]).filter((d) => d.kind !== 'dashboard' && d.kind !== 'meter');
        this.onDevices(this.phones);
        return;
      case 'claim':
        if (typeof m.deviceId === 'string' && Number.isInteger(m.part)) this.onClaim(m.deviceId, m.part as number);
        return;
      case 'event': {
        const g = m.msg ?? {};
        const ev: RingEvent = {
          deviceId: String(m.deviceId),
          name: String(m.name ?? m.deviceId),
          g: String(g.g ?? 'ring'),
          bell: String(g.bell ?? m.bell?.id ?? ''),
          th: typeof g.th === 'number' && Number.isFinite(g.th) ? g.th : undefined,
          t: typeof g.t === 'number' ? g.t : undefined,
          rx: Number(m.rx),
          seq: typeof g.seq === 'number' ? g.seq : undefined,
          vel: typeof g.vel === 'number' ? g.vel : undefined,
          det: typeof g.det === 'number' ? g.det : undefined,
          receivedAtMs: t3,
        };
        for (const l of this.ringListeners) l(ev);
        return;
      }
    }
  }

  private setInfo(info: HostInfo): void {
    this.info = { ...this.info, ...info };
    this.onInfo(this.info);
  }

  /** S1 host time (ms) → this page's performance.now() timeline. NaN until synced. */
  hostToPerf(hostMs: number): number {
    return this.sync.ready ? this.sync.toLocal(hostMs) : NaN;
  }

  /** performance.now() → S1 host time (ms). NaN until synced. */
  perfToHost(perfMs: number): number {
    return this.sync.ready ? this.sync.toHost(perfMs) : NaN;
  }

  private cmd(o: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'cmd', ...o }));
  }

  /**
   * Give one phone an explicit bell list (HGP `assign`, zones when > 1 bell) and a ringer label
   * (`assign.ringer`, the field I1's YARG mode also uses; the phone then lays zones out as lanes).
   */
  assign(deviceId: string, bells: Bell[], ringer?: { slot: number; title: string; song?: string }): void {
    this.cmd({ cmd: 'assign-bells', deviceId, bells, ringer });
  }

  /** Upcoming notes for one phone so it can glow the next zone; empty arrays clear. */
  cues(deviceId: string, at: number[], bells: string[]): void {
    this.cmd({ cmd: 'cues', deviceId, at, bells });
  }

  /** HGP sound mode for every phone: 'device' (phone rings itself) | 'host' | 'both' | 'none'. */
  setSound(sound: SoundMode): void {
    this.cmd({ cmd: 'sound', sound });
  }

  /** Lobby state (seating chart) for every phone's "Pick your part" list. */
  parts(lobby: LobbyParts): void {
    this.cmd({ cmd: 'parts', ...lobby });
  }
}

/** Where the S1 host is: same origin when the game is served by it (/game/), else the default port. */
export function defaultHgpUrl(params: URLSearchParams): string {
  const explicit = params.get('hgp');
  if (explicit) return explicit;
  if (location.pathname.startsWith('/game')) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/hgp`;
  return 'ws://127.0.0.1:8080/hgp';
}
