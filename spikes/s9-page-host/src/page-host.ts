// S9: the HGP host running in the TV/tablet page (ADR-0014, Proposed). The same HostSession as the
// Node host (spikes/s1-phone-bell/src/core/host-session.ts); phones reach it over WebRTC data
// channels instead of a WebSocket, introduced by a tiny signalling relay (signal/relay.mjs, a
// Cloudflare Worker + Durable Object in production, server/dev-server.ts locally).
//
// Per phone: one RTCPeerConnection with two data channels the phone creates:
//   'hgp'       reliable, ordered: the HGP "WebSocket" (hello/welcome, assign, parts, sync, gestures)
//   'hgp-fast'  unordered, maxRetransmits 0: gestures + clock sync, exactly like S1's direct link
// The game in this page talks to the session through an in-page loopback (loopback.ts).
import { HostSession, type GestureInfo, type HostConn, type HostDevice } from '../../s1-phone-bell/src/core/host-session.ts';
import { parseMessage } from '../../s1-phone-bell/src/core/hgp.ts';
import { wsUrl } from './config.ts';
import { iceConfig, routeOf, type IceConfig } from './ice.ts';
import { loopback, type LoopbackSocket } from './loopback.ts';
import { openTrialRoom, trialIce, trialProtocols, type TrialRoom } from './turn-trial.ts';
import { demoIce, demoProtocols, openDemoRoom } from './turn-demo.ts';

export type SignalState = 'no-service' | 'connecting' | 'open' | 'closed' | 'replaced';

export interface PageDevice extends HostDevice {
  /** Selected ICE candidate types, e.g. 'host/udp → host/udp'. */
  path?: string;
  /** Signalling offer → reliable channel open, ms (host clock). */
  joinMs?: number;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  rel?: RTCDataChannel;
  fast?: RTCDataChannel;
  handler?: ReturnType<HostSession<PageDevice>['connect']>;
  conn?: HostConn;
  attempt?: number;
  offerAt: number;
  openAt?: number;
  route: string;
  path?: string;
}

export interface PageHostOptions {
  signalOrigin: string;
  room: string;
  params?: URLSearchParams;
  demo?: boolean;
  /** URL params passed on to phones in the join link (ICE test switches). */
  forward?: string[];
}

export interface PageHostStats {
  offers: number;
  open: number;
  failed: number;
  /** Offer → reliable channel open, per phone, ms. */
  joinMs: number[];
  routes: Record<string, number>;
}

const PING = '{"type":"ping"}';

export class PageHost {
  readonly session: HostSession<PageDevice>;
  readonly peers = new Map<string, Peer>();
  readonly stats: PageHostStats = { offers: 0, open: 0, failed: 0, joinMs: [], routes: {} };
  /** Recent first-copy gestures (diagnostics, e2e and measurements). */
  readonly gestures: GestureInfo[] = [];
  signalState: SignalState = 'connecting';
  signalReason = '';
  ice: IceConfig | null = null;
  onChange: () => void = () => {};
  private ws: WebSocket | null = null;
  private retryMs = 1000;
  private iceAt = -Infinity;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private readonly params: URLSearchParams;
  private readonly hostPeer = `tv-${Math.random().toString(36).slice(2, 10)}`;
  private trial?: TrialRoom;
  private demo?: TrialRoom;
  private running = false;
  private readonly signals = new Map<string, Promise<void>>();
  private trialTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly o: PageHostOptions) {
    this.params = o.params ?? new URLSearchParams();
    if (!o.signalOrigin) this.signalState = 'no-service';
    this.session = new HostSession<PageDevice>(`s9-${o.room}`, {
      now: () => performance.now(),
      info: () => this.info(),
      summary: (d, online) => ({ route: online ? d.route : undefined, path: d.path, joinMs: d.joinMs }),
      onGesture: (_d, g) => {
        this.gestures.push(g);
        if (this.gestures.length > 500) this.gestures.shift();
      },
    });
  }

  get room(): string { return this.trial?.room ?? this.demo?.room ?? this.o.room; }
  get trialState(): 'off' | 'ready' | 'expired' {
    return !this.trial ? 'off' : this.trial.expiresAt > Date.now() ? 'ready' : 'expired';
  }

  async enableRelayTrial(secret: string): Promise<void> {
    if (this.trialState === 'ready' || this.session.phones().length) throw new Error('Start the relay trial from an empty lobby.');
    const trial = await openTrialRoom(this.o.signalOrigin, secret);
    if (this.session.phones().length) throw new Error('A phone joined. Start the trial from an empty lobby.');
    const old = this.ws;
    this.ws = null;
    old?.close();
    for (const p of this.peers.values()) this.dropPeer(p);
    this.signals.clear();
    this.trial = trial;
    clearTimeout(this.trialTimer);
    this.trialTimer = setTimeout(() => this.changed(), trial.expiresAt - Date.now());
    this.connectSignal();
  }

  get joinUrl(): string {
    if (!this.o.signalOrigin) return '';
    const u = new URL(`${this.o.signalOrigin}/c/`);
    u.searchParams.set('r', this.room);
    if (this.trial) {
      if (this.trialState === 'expired') return '';
      u.searchParams.set('trial', '1');
      u.hash = new URLSearchParams({ invite: this.trial.invite }).toString();
      return u.toString();
    }
    if (this.demo) {
      u.searchParams.set('demo', '1');
      u.hash = new URLSearchParams({ invite: this.demo.invite }).toString();
      return u.toString();
    }
    for (const k of this.o.forward ?? []) {
      const v = this.params.get(k);
      if (v !== null) u.searchParams.set(k, v);
    }
    return u.toString();
  }

  info(): Record<string, unknown> {
    const s = this.signalState;
    const where = this.o.signalOrigin ? new URL(this.o.signalOrigin).host : 'no signalling service set';
    const state = s === 'open' ? `room ${this.room} via ${where}` : s === 'replaced' ? `room ${this.room} is hosted by another screen` : s === 'no-service' ? where : `connecting to ${where}…`;
    return {
      session: this.session.sessionId,
      // Only offer the QR once phones can actually be introduced.
      joinUrl: s === 'open' ? this.joinUrl : '',
      tlsMode: state,
      lanIp: '',
      transport: { mode: 'page', signal: this.o.signalOrigin, room: this.room, state: s, ice: this.ice?.source },
    };
  }

  start(): void {
    this.running = true;
    this.session.start();
    if (this.o.demo) void this.prepareDemo();
    else if (this.o.signalOrigin) this.connectSignal();
  }

  private async prepareDemo(): Promise<void> {
    let demo: TrialRoom | undefined;
    try {
      demo = await openDemoRoom(this.o.signalOrigin);
    } catch (error) {
      // Older Workers and network failures still get an ordinary direct room.
      if (this.running) console.debug('S9 demo room unavailable; using ordinary signalling.', error instanceof Error ? error.name : '');
    }
    if (!this.running || this.trial) return;
    this.demo = demo;
    this.connectSignal();
  }

  stop(): void {
    this.running = false;
    this.session.stop();
    clearInterval(this.pingTimer);
    clearTimeout(this.trialTimer);
    this.ws?.close();
    this.ws = null;
    for (const p of this.peers.values()) this.dropPeer(p);
  }

  /** The game's HGP link (HgpLink's socket factory). */
  gameSocket(): LoopbackSocket {
    return loopback({ accept: (conn) => this.session.connect(conn, 'local', 'loop'), now: () => performance.now() });
  }

  private changed(): void {
    this.session.toGame({ type: 'info', info: this.info() });
    this.onChange();
  }

  // ── signalling ────────────────────────────────────────────────────────────

  private connectSignal(): void {
    const mode = this.trial ? '&trial=1' : this.demo ? '&demo=1' : '';
    const protocols = this.trial ? trialProtocols(this.trial.hostTicket) : this.demo ? demoProtocols(this.demo.hostTicket) : [];
    const ws = new WebSocket(wsUrl(this.o.signalOrigin, `/signal/${this.room}?role=host&peer=${this.hostPeer}${mode}`), protocols);
    this.ws = ws;
    this.signalState = 'connecting';
    this.changed();
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      let m: any;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === 'joined') {
        this.retryMs = 1000;
        this.signalState = 'open';
        this.signalReason = '';
        if (!this.trial && !this.demo) void this.refreshIce();
        this.changed();
      } else if (m.type === 'signal' && typeof m.from === 'string') this.queueSignal(ws, m.from, m.data);
    };
    // Keep NATs/proxies from idling the socket out; the Durable Object answers without waking up.
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING), 30_000);
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      clearInterval(this.pingTimer);
      if (e.code === 4001) {
        // Another screen opened this room (or this page was reloaded elsewhere): don't fight over it.
        this.signalState = 'replaced';
        this.signalReason = e.reason;
        this.changed();
        return;
      }
      this.signalState = 'closed';
      this.signalReason = e.reason || `code ${e.code}`;
      this.changed();
      setTimeout(() => {
        if (ws === this.ws && this.trialState !== 'expired') this.connectSignal();
      }, this.retryMs);
      this.retryMs = Math.min(15_000, this.retryMs * 2);
    };
  }

  private signal(to: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'signal', to, data }));
  }

  private async refreshIce(): Promise<IceConfig> {
    // Public STUN configuration is safe to cache.
    if (!this.ice || performance.now() - this.iceAt > 3600_000) {
      this.ice = await iceConfig(this.o.signalOrigin, this.params);
      this.iceAt = performance.now();
    }
    return this.ice;
  }

  private queueSignal(ws: WebSocket, from: string, data: unknown): void {
    // Offers may wait for ICE configuration. Don't drop candidates arriving while they wait.
    const work = (this.signals.get(from) ?? Promise.resolve())
      .then(() => ws === this.ws ? this.onSignal(from, data) : undefined)
      .catch(() => {});
    this.signals.set(from, work);
    void work.then(() => { if (this.signals.get(from) === work) this.signals.delete(from); });
  }

  private async onSignal(from: string, data: any): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const ticketed = this.trial || this.demo;
    const attempt = ticketed ? data.attempt : undefined;
    if (ticketed && attempt !== 1 && attempt !== 2) return;
    if (data.kind === 'offer' && typeof data.sdp === 'string') {
      const old = this.peers.get(from);
      if (old) this.dropPeer(old);
      await this.answer(from, data.sdp, attempt);
      return;
    }
    const p = this.peers.get(from);
    if (!p || p.attempt !== attempt) return;
    if (data.kind === 'ice' && data.c) await p.pc.addIceCandidate(data.c);
    else if (data.kind === 'bye') this.dropPeer(p);
  }

  private async answer(id: string, sdp: string, attempt?: number): Promise<void> {
    this.stats.offers++;
    const offerAt = performance.now();
    const ws = this.ws;
    const ice = await this.answerIce(attempt);
    if (ws !== this.ws) return;
    if (!ice) {
      this.signal(id, { kind: 'relay-unavailable', attempt });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy });
    const p: Peer = { id, pc, attempt, offerAt, route: '' };
    this.peers.set(id, p);
    const pendingIce: RTCIceCandidateInit[] = [];
    let sentAnswer = false;
    const sendIce = (c: RTCIceCandidateInit) => this.signal(id, { kind: 'ice', c, attempt });
    pc.onicecandidate = (e) => {
      if (!e.candidate || this.peers.get(id) !== p || ws !== this.ws) return;
      if (sentAnswer) sendIce(e.candidate.toJSON());
      else pendingIce.push(e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        if (!p.openAt) this.stats.failed++;
        this.dropPeer(p);
      } else if (pc.connectionState === 'connected') void this.updateRoute(p);
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'hgp') this.attachReliable(p, e.channel);
      else if (e.channel.label === 'hgp-fast') this.attachFast(p, e.channel);
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      if (this.peers.get(id) === p && ws === this.ws) {
        this.signal(id, { kind: 'answer', sdp: pc.localDescription?.sdp ?? '', attempt });
        sentAnswer = true;
        for (const c of pendingIce) sendIce(c);
      }
    } catch {
      this.stats.failed++;
      this.dropPeer(p);
    }
  }

  private async answerIce(attempt?: number): Promise<RTCConfiguration | null> {
    if (!this.trial && !this.demo) return this.refreshIce();
    if (attempt === 1) return iceConfig(this.o.signalOrigin, new URLSearchParams());
    try {
      const { signalOrigin } = this.o;
      const iceServers = this.trial
        ? await trialIce(signalOrigin, this.trial.room, this.trial.hostTicket)
        : await demoIce(signalOrigin, this.demo!.room, 'host', this.demo!.hostTicket);
      return { iceServers, iceTransportPolicy: 'relay' };
    } catch {
      return null;
    }
  }

  private async updateRoute(p: Peer): Promise<void> {
    const r = await routeOf(p.pc);
    if (!r.route) return;
    p.route = r.route;
    p.path = `${r.local} → ${r.remote}`;
    const d = p.handler?.device;
    if (d && d.conn && this.peers.get(p.id) === p && (d.route !== r.route || d.path !== p.path)) {
      d.route = r.route;
      d.path = p.path;
      this.session.broadcastDevices();
    }
  }

  private attachReliable(p: Peer, dc: RTCDataChannel): void {
    p.rel = dc;
    const conn: HostConn = {
      get open() {
        return dc.readyState === 'open';
      },
      send(text) {
        try {
          dc.send(text);
        } catch {
          /* closing */
        }
      },
      close: (code = 1000, reason = '') => {
        // A data channel has no close code: tell the phone first (PeerSocket maps it to onclose).
        try {
          dc.send(JSON.stringify({ $close: code, reason }));
        } catch {
          /* closing */
        }
        setTimeout(() => this.dropPeer(p), 100);
      },
    };
    p.conn = conn;
    const pending: [string, number][] = [];
    dc.onmessage = (e) => {
      const rx = performance.now();
      if (p.handler) p.handler.message(String(e.data), rx);
      else pending.push([String(e.data), rx]);
    };
    dc.onopen = async () => {
      p.openAt = performance.now();
      this.stats.open++;
      this.stats.joinMs.push(p.openAt - p.offerAt);
      await this.updateRoute(p);
      if (this.peers.get(p.id) !== p) return;
      this.stats.routes[p.route || '?'] = (this.stats.routes[p.route || '?'] ?? 0) + 1;
      p.handler = this.session.connect(conn, p.route || 'direct', 'dc');
      for (const [text, rx] of pending.splice(0)) p.handler.message(text, rx);
      const d = p.handler.device;
      if (d) {
        d.path = p.path;
        d.joinMs = Math.round(p.openAt - p.offerAt);
      }
    };
    dc.onclose = () => {
      p.handler?.closed();
      p.handler = undefined;
      if (this.peers.get(p.id) === p) this.dropPeer(p);
    };
  }

  private attachFast(p: Peer, dc: RTCDataChannel): void {
    p.fast = dc;
    dc.onmessage = (e) => {
      const rx = performance.now();
      const d = p.handler?.device;
      const m = parseMessage(String(e.data));
      // Only the phone's current connection (a reconnect replaces the device's conn).
      if (!d || !m || d.conn !== p.conn) return;
      this.session.deviceMessage(d, m, rx, (o) => dc.readyState === 'open' && dc.send(JSON.stringify(o)), 'dc-fast');
    };
  }

  private dropPeer(p: Peer): void {
    if (this.peers.get(p.id) === p) this.peers.delete(p.id);
    try {
      p.rel?.close();
      p.fast?.close();
      p.pc.close();
    } catch {
      /* already closed */
    }
    // dc.onclose may not fire after pc.close() in every browser.
    p.handler?.closed();
    p.handler = undefined;
  }
}
