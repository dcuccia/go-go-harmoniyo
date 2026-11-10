/**
 * HGP host session: the device registry, hello/newest-wins, clock-sync replies, gesture relay
 * (with dual-send de-duplication), lobby `parts`, bell assignment and the game's (dashboard's)
 * commands. Transport-neutral and browser-safe (no node imports), so one implementation serves the
 * Node host (src/host/server.ts, WebSocket + werift) and the in-page host of S9 (ADR-0014,
 * Proposed: the TV/tablet page is the host; phones connect over WebRTC data channels).
 *
 * The caller owns the transports: it wraps each connection in a {@link HostConn}, feeds received
 * text to {@link HostSession.connect}'s handler, and can add a second, fast path for a device
 * (e.g. an unreliable data channel) via {@link HostSession.deviceMessage}. Node-only features
 * (YARG sidecar, latency tests, file logs, werift answers) plug in through {@link HostHooks}.
 */
import { GestureDedupe } from './gesture-dedupe.ts';
import { bellBlock, DEFAULT_BELLS, HGP_CLOSE_REPLACED, HGP_VERSION, parseMessage, type Bell, type PartCard, type SoundMode } from './hgp.ts';
import { isSensitivity, type Sensitivity } from './ring-detector.ts';

export type Msg = Record<string, unknown> & { type: string };

/** One reliable, ordered text connection (a WebSocket, or a reliable WebRTC data channel). */
export interface HostConn {
  readonly open: boolean;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  /** Abort a connection that never opened (WebSocket `terminate`); defaults to `close`. */
  terminate?(): void;
  /** Still opening (WebSocket CONNECTING): replaced connections in this state are terminated. */
  readonly connecting?: boolean;
}

export interface HostDevice {
  id: string;
  name: string;
  kind: string;
  ua: string;
  hello: Record<string, unknown>;
  status: Record<string, unknown>;
  conn: HostConn | null;
  /** How the connection reached the host (Node: tunnel/lan/local; page host: direct). */
  route?: string;
  bells: Bell[];
  /** Ringer seat shown on the phone (HGP `assign.ringer`, shared with I1's YARG mode). */
  ringer?: { slot: number; title: string; song?: string };
  /** Ring detection hints from the game (HGP `assign.ring`). */
  ring?: { sens?: Sensitivity; ioi?: number };
  /** Lobby ✓ Ready toggle (HGP `ready`, I2 seating chart). */
  ready: boolean;
  /** Coarse status (api, synced, calibrated, …): a change triggers a device broadcast. */
  statusKey?: string;
  connectedAt: number;
  lastSeen: number;
  events: number;
}

export interface GestureInfo {
  deviceId: string;
  g: string;
  seq: number;
  /** Source timestamp on the host clock (phone-side sync), NaN if unsynced. */
  th: number;
  rx: number;
  det?: number;
  via: string;
  bell: string;
  lead?: number;
}

export interface HostHooks<D extends HostDevice> {
  /** Host clock, ms (performance.now()). */
  now(): number;
  /** Structured event log (Node: events.ndjson). */
  log?(o: Record<string, unknown>): void;
  /** Host info for the game (`welcome.info`). */
  info?(): Record<string, unknown>;
  /** Extra fields for each device in the `devices` broadcast (e.g. rtc/route). */
  summary?(d: D, online: boolean): Record<string, unknown>;
  /** Extra top-level fields of the `devices` broadcast (e.g. running test, YARG). */
  devicesExtra?(): Record<string, unknown>;
  /** Override the ringer seat sent in `assign` (YARG mode). */
  ringerFor?(d: D): HostDevice['ringer'];
  /** Bells come from elsewhere (YARG): ignore the `assign`/`bells` commands. */
  bellsLocked?(): boolean;
  /** A phone said hello (new or returning), before `welcome`. May change `d.bells`. */
  onJoin?(d: D, m: Msg, existing: boolean): void;
  /** Extra `welcome` fields for a device (e.g. `upgrade: 'rtc'`). */
  welcomeExtra?(d: D): Record<string, unknown>;
  /** After welcome/assign/parts went out (e.g. a running test's start). */
  onJoined?(d: D): void;
  /** The device's connection was replaced by a newer one or closed (drop side channels). */
  onDetach?(d: D, why: 'replaced' | 'closed'): void;
  /** A first-copy gesture (after de-duplication), before it is relayed to the game. */
  onGesture?(d: D, g: GestureInfo, m: Msg): void;
  /** Device messages the session doesn't handle (raw, result, rtc, …). */
  onMessage?(d: D, m: Msg, rx: number, reply: (o: unknown) => void, via: string): void;
  /** Game commands the session doesn't handle (test, stop, yarg-*). */
  onCommand?(m: Msg): void;
}

export interface Lobby {
  phase: 'lobby' | 'play';
  song?: string;
  parts: PartCard[];
  waiting: string[];
}

export interface ConnHandler<D> {
  /** Text received on the connection at host time `rx`. */
  message(text: string, rx: number): void;
  closed(): void;
  readonly device: D | null;
  readonly isGame: boolean;
}

const HEARTBEAT_MS = 3000;
const BROADCAST_MIN_MS = 200;

/** Coarse status fields whose change is worth a broadcast (not rtt/rate jitter). */
export function statusKey(st: Record<string, unknown>): string {
  return JSON.stringify([st.api ?? null, typeof st.syncN === 'number' && st.syncN > 0, !!st.axis, st.visible ?? null, st.mode ?? null, st.transport ?? null, st.rtc ?? null, st.sens ?? null]);
}

export class HostSession<D extends HostDevice = HostDevice> {
  readonly devices = new Map<string, D>();
  /** Game/dashboard connections (`hello.kind === 'dashboard'`). */
  readonly games = new Set<HostConn>();
  readonly dedupe = new GestureDedupe();
  soundMode: SoundMode = 'device';
  bellsPerPhone = 1;
  /** Last lobby state from the game (HGP `parts`), re-sent to phones that join later. */
  lobby: Lobby | null = null;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastBroadcast = -Infinity;

  constructor(
    readonly sessionId: string,
    readonly hooks: HostHooks<D>,
  ) {}

  now(): number {
    return this.hooks.now();
  }

  /** Start the slow `devices` heartbeat (diagnostics: rtt, rates). */
  start(): void {
    this.heartbeat ??= setInterval(() => this.broadcastDevices(), HEARTBEAT_MS);
    (this.heartbeat as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.heartbeat = this.broadcastTimer = null;
  }

  // ── sending ───────────────────────────────────────────────────────────────

  send(d: D | null | undefined, o: unknown): void {
    const c = d?.conn;
    if (c?.open) c.send(JSON.stringify(o));
  }

  toGame(o: unknown): void {
    const s = JSON.stringify(o);
    for (const g of this.games) if (g.open) g.send(s);
  }

  online(d: D): boolean {
    return !!d.conn?.open;
  }

  /** Phones (not the game, not meters) that are online. */
  phones(): D[] {
    return [...this.devices.values()].filter((d) => d.kind !== 'dashboard' && d.kind !== 'meter' && this.online(d));
  }

  deviceSummary(d: D): Record<string, unknown> {
    const online = this.online(d);
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      ua: d.ua,
      online,
      bells: d.bells,
      status: d.status,
      ready: d.ready,
      events: d.events,
      lastSeen: d.lastSeen,
      ...this.hooks.summary?.(d, online),
    };
  }

  /**
   * Device list to the game. Sent when something meaningful changes (join, leave, rename,
   * assignment, Ready, sync/sensor state) plus a slow heartbeat for the diagnostics (rtt, rates):
   * a game must not rebuild its lobby on every frame of this. Bursts (a phone reconnecting, a lobby
   * update touching every phone) are coalesced: the first change goes out at once, later ones within
   * BROADCAST_MIN_MS are sent together at the end of that window.
   */
  broadcastDevices(): void {
    if (this.broadcastTimer) return;
    const wait = this.lastBroadcast + BROADCAST_MIN_MS - this.now();
    if (wait <= 0) {
      this.flushDevices();
      return;
    }
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.flushDevices();
    }, wait);
  }

  private flushDevices(): void {
    this.lastBroadcast = this.now();
    this.toGame({ type: 'devices', hostTime: this.now(), devices: [...this.devices.values()].map((d) => this.deviceSummary(d)), soundMode: this.soundMode, bellsPerPhone: this.bellsPerPhone, ...this.hooks.devicesExtra?.() });
  }

  /** HGP `parts`: the game's lobby state, with this device's own part index and Ready state. */
  sendParts(d: D): void {
    const lobby = this.lobby;
    if (!lobby || !d.conn || d.kind === 'dashboard' || d.kind === 'meter') return;
    const you = lobby.parts.findIndex((p) => p.player?.kind === 'phone' && p.player.id === d.id);
    this.send(d, { type: 'parts', phase: lobby.phase, song: lobby.song, parts: lobby.parts, you, ready: d.ready, next: lobby.waiting.includes(d.id) });
  }

  /** Next free block of `bellsPerPhone` consecutive bells. */
  nextBells(): Bell[] {
    const used = new Set([...this.devices.values()].flatMap((d) => d.bells.map((b) => b.id)));
    for (let start = 0; start < DEFAULT_BELLS.length; start += this.bellsPerPhone) {
      const block = bellBlock(start, this.bellsPerPhone);
      if (block.every((b) => !used.has(b.id))) return block;
    }
    return bellBlock(this.devices.size * this.bellsPerPhone, this.bellsPerPhone);
  }

  sendAssign(d: D): void {
    const ringer = this.hooks.ringerFor ? this.hooks.ringerFor(d) : d.ringer;
    this.send(d, { type: 'assign', bells: d.bells, sound: this.soundMode, select: d.bells.length > 1 ? 'zones' : 'single', ringer, ring: d.ring });
  }

  // ── connections ───────────────────────────────────────────────────────────

  /** A new connection; `route` is recorded on the device that says hello on it, `via` labels its messages. */
  connect(conn: HostConn, route?: string, via = 'ws'): ConnHandler<D> {
    let dev: D | null = null;
    let isGame = false;
    const self = this;
    return {
      get device() {
        return dev;
      },
      get isGame() {
        return isGame;
      },
      message(text: string, rx: number) {
        const m = parseMessage(text);
        if (!m) return;
        if (m.type === 'hello') {
          if (String(m.kind ?? 'phone') === 'dashboard') {
            isGame = true;
            self.games.add(conn);
            conn.send(JSON.stringify({ type: 'welcome', v: HGP_VERSION, deviceId: 'dashboard', session: self.sessionId, hostTime: self.now(), info: self.hooks.info?.() ?? {} }));
            self.broadcastDevices();
            return;
          }
          dev = self.hello(conn, m, rx, route, via);
          return;
        }
        if (isGame) {
          if (m.type === 'cmd') self.command(m);
          else if (m.type === 'sync') conn.send(JSON.stringify({ type: 'sync', id: m.id, t0: m.t0, t1: rx, t2: self.now() }));
          return;
        }
        if (dev) self.deviceMessage(dev, m, rx, (o) => conn.open && conn.send(JSON.stringify(o)), via);
      },
      closed() {
        if (isGame) {
          self.games.delete(conn);
          return;
        }
        // A connection replaced by a newer one with the same deviceId: the device never went offline.
        if (!dev || dev.conn !== conn) return;
        dev.conn = null;
        self.hooks.onDetach?.(dev, 'closed');
        self.hooks.log?.({ type: 'disconnect', at: self.now(), deviceId: dev.id });
        self.broadcastDevices();
      },
    };
  }

  private hello(conn: HostConn, m: Msg, rx: number, route: string | undefined, via: string): D {
    const kind = String(m.kind ?? 'phone');
    const id = String(m.deviceId ?? `dev-${Math.random().toString(36).slice(2, 8)}`);
    const existing = this.devices.get(id);
    // Newest connection wins. Tell the old one first so its client goes to standby ("Use this
    // tab") instead of reconnecting and kicking this one back (the 2026-10-25 ping-pong).
    const wasOnline = !!existing?.conn?.open;
    if (existing?.conn && existing.conn !== conn) {
      const old = existing.conn;
      if (old.open) {
        old.send(JSON.stringify({ type: 'replaced', reason: 'This phone connected again (another tab or page)', hostTime: this.now() }));
        old.close(HGP_CLOSE_REPLACED, 'replaced');
      } else if (old.connecting) (old.terminate ?? old.close).call(old);
      this.hooks.log?.({ type: 'replaced', at: rx, deviceId: id, oldTab: existing.hello.tab, tab: m.tab, takeover: m.takeover === true });
    }
    const prevName = existing?.name;
    const prevRoute = existing?.route;
    const prevBells = existing ? JSON.stringify(existing.bells) : '';
    const dev: D =
      existing ??
      ({
        id,
        name: String(m.name ?? id),
        kind,
        ua: String(m.ua ?? ''),
        hello: m,
        status: {},
        conn,
        bells: this.nextBells(),
        ready: false,
        connectedAt: rx,
        lastSeen: rx,
        events: 0,
      } as HostDevice as D);
    dev.conn = conn;
    dev.route = route;
    // A new connection starts on its own path; side channels of the old one are dropped.
    if (existing) this.hooks.onDetach?.(dev, 'replaced');
    // Duplicates only happen within one connection (dual-send); a reloaded page restarts seq.
    this.dedupe.forget(id);
    dev.hello = m;
    dev.name = String(m.name ?? dev.name);
    dev.ua = String(m.ua ?? dev.ua);
    this.devices.set(id, dev);
    this.hooks.onJoin?.(dev, m, !!existing);
    this.hooks.log?.({ dir: 'in', via, rx, deviceId: id, wsRoute: route, msg: m });
    this.send(dev, { type: 'welcome', v: HGP_VERSION, deviceId: id, session: this.sessionId, hostTime: this.now(), route, ...this.hooks.welcomeExtra?.(dev) });
    this.sendAssign(dev);
    this.sendParts(dev);
    this.hooks.onJoined?.(dev);
    // A reconnect/takeover of a phone that was online with the same name and bells changes
    // nothing the game (TV) cares about: skip the device broadcast so its lobby doesn't churn.
    if (!existing || !wasOnline || prevName !== dev.name || prevRoute !== route || prevBells !== JSON.stringify(dev.bells)) this.broadcastDevices();
    return dev;
  }

  /** Handle a device message from any of its transports. `reply` answers on the same transport. */
  deviceMessage(d: D, m: Msg, rx: number, reply: (o: unknown) => void, via: string): void {
    d.lastSeen = rx;
    const log = this.hooks.log;
    switch (m.type) {
      case 'sync':
        reply({ type: 'sync', id: m.id, t0: m.t0, t1: rx, t2: this.now() });
        return;
      case 'gesture': {
        // Sent on both the fast and the reliable path while both are open: keep the first.
        if (!this.dedupe.first(d.id, m.seq, m.th, rx)) {
          log?.({ dir: 'in', via, rx, deviceId: d.id, dup: true, seq: m.seq });
          return;
        }
        d.events++;
        const th = typeof m.th === 'number' ? m.th : NaN;
        const lead = typeof m.t === 'number' && typeof m.sel === 'number' ? m.t - m.sel : undefined;
        const bellId = typeof m.bell === 'string' ? m.bell : d.bells[0].id;
        const g: GestureInfo = { deviceId: d.id, g: String(m.g), seq: Number(m.seq), th, rx, det: typeof m.det === 'number' ? m.det : undefined, via, bell: bellId, lead };
        log?.({ dir: 'in', via, rx, deviceId: d.id, msg: m });
        this.hooks.onGesture?.(d, g, m);
        const bell = d.bells.find((b) => b.id === bellId) ?? DEFAULT_BELLS.find((b) => b.id === bellId) ?? d.bells[0];
        this.toGame({ type: 'event', deviceId: d.id, name: d.name, bell, msg: m, rx, via, soundMode: this.soundMode });
        return;
      }
      case 'status': {
        d.status = m;
        const key = statusKey(m);
        if (key !== d.statusKey) {
          d.statusKey = key;
          this.broadcastDevices();
        }
        return;
      }
      case 'claim': {
        // Lobby: relay to the game, which owns the seating chart (and answers with a new `parts`).
        const part = Number(m.part);
        if (!Number.isInteger(part) || part < -1) return;
        log?.({ dir: 'in', via, rx, deviceId: d.id, msg: m });
        this.toGame({ type: 'claim', deviceId: d.id, name: d.name, part });
        return;
      }
      case 'ready': {
        const ready = m.ready === true;
        log?.({ dir: 'in', via, rx, deviceId: d.id, msg: m });
        if (ready === d.ready) return;
        d.ready = ready;
        this.sendParts(d);
        this.broadcastDevices();
        return;
      }
      default:
        if (this.hooks.onMessage) this.hooks.onMessage(d, m, rx, reply, via);
        else log?.({ dir: 'in', via, rx, deviceId: d.id, msg: m });
    }
  }

  /** A game (dashboard) command (`{type:'cmd', cmd, …}`). */
  command(m: Msg): void {
    const locked = this.hooks.bellsLocked?.() ?? false;
    switch (m.cmd) {
      case 'sound':
        this.soundMode = String(m.sound) as SoundMode;
        for (const d of this.devices.values()) this.sendAssign(d);
        break;
      case 'assign': {
        if (locked) break;
        // Give this phone the block of bells starting at `bellId`.
        const d = this.devices.get(String(m.deviceId));
        const start = DEFAULT_BELLS.findIndex((x) => x.id === m.bellId);
        if (d && start >= 0) {
          d.bells = bellBlock(start, this.bellsPerPhone);
          this.sendAssign(d);
        }
        break;
      }
      case 'bells': {
        if (locked) break;
        // Re-deal consecutive blocks of n bells to every phone.
        this.bellsPerPhone = Math.max(1, Math.min(4, Number(m.n) || 1));
        [...this.devices.values()]
          .filter((d) => d.kind === 'phone')
          .forEach((d, i) => {
            d.bells = bellBlock(i * this.bellsPerPhone, this.bellsPerPhone);
            this.sendAssign(d);
          });
        break;
      }
      case 'assign-bells': {
        // Explicit bell list for one phone (e.g. a ringer's part from a chart, I2), 1–5 bells, plus
        // an optional ringer seat label (same `assign.ringer` shape as I1's YARG mode).
        const d = this.devices.get(String(m.deviceId));
        const bells = Array.isArray(m.bells) ? (m.bells as Bell[]).filter((b) => b && typeof b.id === 'string' && typeof b.midi === 'number').slice(0, 5) : [];
        if (d && bells.length) {
          d.bells = bells.map((b) => ({ id: b.id, label: String(b.label ?? b.id), midi: b.midi, color: String(b.color ?? '#888') }));
          const r = m.ringer as { slot?: unknown; title?: unknown; song?: unknown } | undefined;
          d.ringer = r && typeof r.title === 'string' ? { slot: Number(r.slot ?? 0), title: r.title, song: typeof r.song === 'string' ? r.song : undefined } : undefined;
          const rg = m.ring as { sens?: unknown; ioi?: unknown } | undefined;
          d.ring = rg && typeof rg === 'object' ? { sens: isSensitivity(rg.sens) ? rg.sens : undefined, ioi: typeof rg.ioi === 'number' && rg.ioi > 0 ? rg.ioi : undefined } : undefined;
          this.sendAssign(d);
        }
        break;
      }
      case 'cues': {
        // Upcoming notes for one phone (host time + bell id) so it can glow the next zone.
        const d = this.devices.get(String(m.deviceId));
        if (d) this.send(d, { type: 'cues', at: Array.isArray(m.at) ? m.at : [], bells: Array.isArray(m.bells) ? m.bells : [] });
        return; // high volume: skip event log + device broadcast
      }
      case 'parts': {
        // Lobby state from the game (I2 seating chart) → every phone (HGP `parts`). Starting a song
        // clears everyone's Ready. `waiting`: phones that joined mid-round (each gets `next: true`).
        const phase = m.phase === 'play' ? 'play' : 'lobby';
        if (phase === 'play' && this.lobby?.phase !== 'play') for (const d of this.devices.values()) d.ready = false;
        const parts = Array.isArray(m.parts) ? (m.parts as PartCard[]).filter((p) => p && typeof p.name === 'string').slice(0, 8) : [];
        const waiting = Array.isArray(m.waiting) ? m.waiting.filter((x): x is string => typeof x === 'string') : [];
        this.lobby = { phase, song: typeof m.song === 'string' ? m.song : undefined, parts, waiting };
        for (const d of this.devices.values()) this.sendParts(d);
        break;
      }
      case 'config': {
        const targets = m.deviceId === 'all' ? this.phones() : [this.devices.get(String(m.deviceId))].filter((d): d is D => !!d);
        for (const d of targets) this.send(d, { type: 'config', ...(m.config as object) });
        break;
      }
      default:
        this.hooks.onCommand?.(m);
    }
    this.hooks.log?.({ type: 'cmd', at: this.now(), m });
    this.broadcastDevices();
  }
}
