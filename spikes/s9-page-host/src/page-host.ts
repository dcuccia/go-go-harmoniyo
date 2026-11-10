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
  /** Signalling serialises SDP and candidates; this keeps their application in order. */
  chain: Promise<void>;
  offerAt: number;
  openAt?: number;
  route: string;
  path?: string;
}

export interface PageHostOptions {
  signalOrigin: string;
  room: string;
  params?: URLSearchParams;
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

  get joinUrl(): string {
    if (!this.o.signalOrigin) return '';
    const u = new URL(`${this.o.signalOrigin}/c/`);
    u.searchParams.set('r', this.o.room);
    for (const k of this.o.forward ?? []) {
      const v = this.params.get(k);
      if (v !== null) u.searchParams.set(k, v);
    }
    return u.toString();
  }

  info(): Record<string, unknown> {
    const s = this.signalState;
    const where = this.o.signalOrigin ? new URL(this.o.signalOrigin).host : 'no signalling service set';
    const state = s === 'open' ? `room ${this.o.room} via ${where}` : s === 'replaced' ? `room ${this.o.room} is hosted by another screen` : s === 'no-service' ? where : `connecting to ${where}…`;
    return {
      session: this.session.sessionId,
      // Only offer the QR once phones can actually be introduced.
      joinUrl: s === 'open' ? this.joinUrl : '',
      tlsMode: state,
      lanIp: '',
      transport: { mode: 'page', signal: this.o.signalOrigin, room: this.o.room, state: s, ice: this.ice?.source },
    };
  }

  start(): void {
    this.session.start();
    if (this.o.signalOrigin) this.connectSignal();
  }

  stop(): void {
    this.session.stop();
    clearInterval(this.pingTimer);
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
    const ws = new WebSocket(wsUrl(this.o.signalOrigin, `/signal/${this.o.room}?role=host&peer=${this.hostPeer}`));
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
        void this.refreshIce();
        this.changed();
      } else if (m.type === 'signal' && typeof m.from === 'string') this.onSignal(m.from, m.data);
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
      setTimeout(() => this.connectSignal(), this.retryMs);
      this.retryMs = Math.min(15_000, this.retryMs * 2);
    };
  }

  private signal(to: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'signal', to, data }));
  }

  private async refreshIce(): Promise<IceConfig> {
    // TURN credentials (if any) last 4 h; refresh hourly.
    if (!this.ice || performance.now() - this.iceAt > 3600_000) {
      this.ice = await iceConfig(this.o.signalOrigin, this.params);
      this.iceAt = performance.now();
    }
    return this.ice;
  }

  private onSignal(from: string, data: any): void {
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'offer' && typeof data.sdp === 'string') {
      const old = this.peers.get(from);
      if (old) this.dropPeer(old);
      void this.answer(from, data.sdp);
      return;
    }
    const p = this.peers.get(from);
    if (!p) return;
    if (data.kind === 'ice' && data.c) p.chain = p.chain.then(() => p.pc.addIceCandidate(data.c)).catch(() => {});
    else if (data.kind === 'bye') this.dropPeer(p);
  }

  private async answer(id: string, sdp: string): Promise<void> {
    this.stats.offers++;
    const offerAt = performance.now();
    const ice = await this.refreshIce();
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy });
    const p: Peer = { id, pc, chain: Promise.resolve(), offerAt, route: '' };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { kind: 'ice', c: e.candidate.toJSON() });
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
    p.chain = p.chain.then(async () => {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      this.signal(id, { kind: 'answer', sdp: pc.localDescription?.sdp ?? '' });
    });
    p.chain = p.chain.catch(() => {
      this.stats.failed++;
      this.dropPeer(p);
    });
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
