// S9 phone side: a WebSocket-shaped HGP connection to the host in the TV page, over WebRTC data
// channels negotiated through the signalling relay. HgpClient (s1 controller) uses it unchanged via
// setHgpSocketFactory; `fast` (the unreliable channel) is adopted as its direct link on open.
import type { HgpSocket } from '../../s1-phone-bell/src/web/hgp-client.ts';
import { parseMessage } from '../../s1-phone-bell/src/core/hgp.ts';
import { wsUrl } from './config.ts';
import { iceConfig, routeOf } from './ice.ts';
import { trialIce, trialProtocols } from './turn-trial.ts';
import { demoIce, demoProtocols } from './turn-demo.ts';

export type PhoneStatus =
  | 'looking-for-tv' | 'no-tv' | 'connecting' | 'no-network-path' | 'trying-relay'
  | 'relay-unavailable' | 'invalid-invite' | 'waiting-for-assignment' | 'connected' | 'reconnecting';

export interface PeerSocketOptions {
  signalOrigin: string;
  room: string;
  peer: string;
  params?: URLSearchParams;
  trial?: boolean;
  demo?: boolean;
  invite?: string;
  reconnecting?: boolean;
  onStatus?: (status: PhoneStatus) => void;
  /** Give up if the link isn't open by then (no TV in the room, or no network path). */
  timeoutMs?: number;
}

/** Join-time breakdown (ms since the socket was created), exposed on window.__s9 for measurements. */
export interface PeerTimings {
  start: number;
  ice?: number;
  signalOpen?: number;
  hostSeen?: number;
  pcCreated?: number;
  offerCreated?: number;
  offerSent?: number;
  answer?: number;
  relOpen?: number;
  fastOpen?: number;
  open?: number;
  route?: string;
  path?: string;
  iceSource?: string;
  closed?: { code: number; reason: string; at: number };
}

/** Closed before opening: no TV hosting this room. */
export const CLOSE_NO_HOST = 4404;
/** Closed before opening: a TV is there but no WebRTC path was found in time. */
export const CLOSE_NO_PATH = 4408;
/** The channel to the TV dropped. */
export const CLOSE_LOST = 4006;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export class PeerSocket implements HgpSocket {
  readyState = CONNECTING;
  fast: RTCDataChannel | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readonly t: PeerTimings;
  private sig: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private rel: RTCDataChannel | null = null;
  private chain: Promise<void> = Promise.resolve();
  private offered = false;
  private hostSeen = false;
  private attemptingRelay = false;
  private relayDenied = false;
  private attempt?: number;
  private directTimer?: ReturnType<typeof setTimeout>;
  private assigned = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly t0 = performance.now();

  constructor(private readonly o: PeerSocketOptions) {
    this.t = { start: this.t0 };
    (window as { __s9?: unknown }).__s9 = this.t;
    void this.run();
  }

  private mark(k: keyof PeerTimings): void {
    (this.t as any)[k] ??= Math.round((performance.now() - this.t0) * 10) / 10;
  }

  send(text: string): void {
    if (this.readyState !== OPEN || this.rel?.readyState !== 'open') return;
    this.rel.send(text);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === CLOSED) return;
    if (code === 1000 && this.rel?.readyState === 'open') {
      try {
        this.signalSend({ type: 'signal', data: { kind: 'bye', attempt: this.attempt } });
      } catch {
        /* best effort */
      }
    }
    this.finish(code, reason);
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.t.closed = { code, reason, at: Math.round(performance.now() - this.t0) };
    for (const t of this.timers) clearTimeout(t);
    clearTimeout(this.directTimer);
    try {
      this.fast?.close();
      this.rel?.close();
      this.pc?.close();
      this.sig?.close();
    } catch {
      /* already closed */
    }
    // Async, like a WebSocket's close event.
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  private signalSend(o: unknown): void {
    if (this.sig?.readyState === WebSocket.OPEN) this.sig.send(JSON.stringify(o));
  }

  private status(state: PhoneStatus): void {
    this.o.onStatus?.(state);
  }

  private noPath(state: 'no-network-path' | 'relay-unavailable' | 'invalid-invite', reason: string): void {
    this.status(state);
    this.finish(CLOSE_NO_PATH, reason);
  }

  private async run(): Promise<void> {
    const { signalOrigin, room, peer, invite, trial, demo } = this.o;
    const ticketed = trial || demo;
    const params = ticketed ? new URLSearchParams() : this.o.params ?? new URLSearchParams();
    this.status(this.o.reconnecting ? 'reconnecting' : 'looking-for-tv');
    if (ticketed && !invite) {
      this.noPath('invalid-invite', 'missing room invitation');
      return;
    }
    this.timers.push(
      setTimeout(() => {
        if (this.readyState !== CONNECTING) return;
        if (this.relayDenied) this.noPath('relay-unavailable', 'TURN credentials unavailable');
        else if (this.hostSeen) this.noPath('no-network-path', 'no network path to the TV');
        else {
          this.status('no-tv');
          this.finish(CLOSE_NO_HOST, 'no TV in this room');
        }
      }, this.o.timeoutMs ?? (ticketed ? 30_000 : 20_000)),
    );
    const icePromise = iceConfig(signalOrigin, params).then((c) => {
      this.mark('ice');
      this.t.iceSource = c.source;
      return c;
    });
    let sig: WebSocket;
    try {
      const mode = trial ? '&trial=1' : demo ? '&demo=1' : '';
      const protocols = invite && ticketed ? (demo ? demoProtocols(invite) : trialProtocols(invite)) : [];
      sig = new WebSocket(wsUrl(signalOrigin, `/signal/${room}?role=phone&peer=${encodeURIComponent(peer)}${mode}`), protocols);
    } catch {
      this.status('no-tv');
      this.finish(CLOSE_NO_HOST, 'signalling service is unavailable');
      return;
    }
    this.sig = sig;
    sig.onopen = () => this.mark('signalOpen');
    sig.onclose = (e) => {
      if (this.sig !== sig || this.readyState !== CONNECTING) return;
      if (ticketed && this.t.signalOpen === undefined) {
        this.noPath('invalid-invite', 'room invitation unavailable');
      } else if (e.code >= 4000 || ticketed) {
        this.status(this.hostSeen ? 'no-network-path' : 'no-tv');
        this.finish(e.code, 'signalling closed');
      }
    };
    sig.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if ((m.type === 'joined' && m.host) || (m.type === 'host' && m.online)) {
        this.hostSeen = true;
        this.mark('hostSeen');
        if (this.offered || this.readyState !== CONNECTING) return;
        this.offered = true;
        this.status('connecting');
        void icePromise.then((c) => this.offer(c.iceServers, c.iceTransportPolicy, ticketed ? 1 : undefined))
          .catch(() => this.failedAttempt());
      } else if (m.type === 'joined' && !this.hostSeen) {
        this.status('looking-for-tv');
      } else if (m.type === 'signal' && m.data) this.onSignal(m.data);
    };
  }

  private failedAttempt(): void {
    if (this.readyState !== CONNECTING) return;
    if (this.o.demo && this.attemptingRelay && this.attempt === 1) {
      if (this.relayDenied) this.noPath('relay-unavailable', 'TURN credentials unavailable');
      return;
    }
    if (this.o.invite && !this.attemptingRelay) void this.retryWithRelay(this.o.invite);
    else this.noPath('no-network-path', this.attemptingRelay ? 'TURN could not connect' : 'no network path to the TV');
  }

  private async retryWithRelay(invite: string): Promise<void> {
    this.attemptingRelay = true;
    clearTimeout(this.directTimer);
    if (!this.o.demo) this.dropConnection();
    this.status('trying-relay');
    let servers: RTCIceServer[];
    try {
      servers = await (this.o.demo
        ? demoIce(this.o.signalOrigin, this.o.room, 'phone', invite)
        : trialIce(this.o.signalOrigin, this.o.room, invite));
    } catch {
      if (this.readyState !== CONNECTING) return;
      this.relayDenied = true;
      // The direct timer might have fired just before a slow LAN link connected.
      if (this.o.demo && this.pc && this.pc.connectionState !== 'failed' && this.rel?.readyState !== 'closed') this.status('connecting');
      else this.noPath('relay-unavailable', 'TURN credentials unavailable');
      return;
    }
    if (this.readyState !== CONNECTING || this.rel?.readyState === 'open') return;
    this.dropConnection();
    this.attempt = 2;
    try {
      await this.offer(servers, 'relay', 2);
    } catch {
      this.failedAttempt();
    }
  }

  private dropConnection(): void {
    const old = this.pc;
    this.pc = null;
    this.rel = null;
    old?.close();
  }

  private async offer(iceServers: RTCIceServer[], iceTransportPolicy: RTCIceTransportPolicy, attempt?: number): Promise<void> {
    if (this.readyState !== CONNECTING) return;
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
    this.attempt = attempt;
    this.chain = Promise.resolve();
    this.pc = pc;
    this.mark('pcCreated');
    const rel = pc.createDataChannel('hgp', { ordered: true });
    const fast = pc.createDataChannel('hgp-fast', { ordered: false, maxRetransmits: 0 });
    this.rel = rel;
    const pendingIce: RTCIceCandidateInit[] = [];
    let sentOffer = false;
    const sendIce = (c: RTCIceCandidateInit) => this.signalSend({ type: 'signal', data: { kind: 'ice', c, attempt } });
    pc.onicecandidate = (e) => {
      if (this.pc !== pc || !e.candidate) return;
      if (sentOffer) sendIce(e.candidate.toJSON());
      else pendingIce.push(e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (this.pc === pc && pc.connectionState === 'failed') {
        if (this.readyState === CONNECTING) this.failedAttempt();
        else this.finish(CLOSE_LOST, 'link to the TV lost');
      }
    };
    rel.onopen = () => {
      if (this.pc !== pc) return;
      clearTimeout(this.directTimer);
      this.mark('relOpen');
      // Prefer opening with the fast channel ready (HgpClient adopts it on open); don't wait long.
      if (fast.readyState === 'open') this.opened(fast);
      else this.timers.push(setTimeout(() => {
        if (this.pc === pc) this.opened(fast.readyState === 'open' ? fast : null);
      }, 500));
    };
    fast.onopen = () => {
      if (this.pc !== pc) return;
      this.mark('fastOpen');
      if (rel.readyState === 'open') this.opened(fast);
    };
    rel.onmessage = (e) => {
      if (this.pc !== pc) return;
      const text = String(e.data);
      if (text.startsWith('{"$close"')) {
        try {
          const c = JSON.parse(text) as { $close: number; reason?: string };
          this.finish(c.$close, c.reason ?? '');
        } catch {
          this.finish(CLOSE_LOST, 'closed by the TV');
        }
        return;
      }
      if (this.readyState === OPEN) {
        this.onmessage?.({ data: text });
        if (!this.assigned) {
          const m = parseMessage(text);
          if (m?.type === 'assign' && Array.isArray(m.bells) && m.bells.length > 0) {
            this.assigned = true;
            this.status('connected');
          }
        }
      }
    };
    rel.onclose = () => {
      if (this.pc !== pc || this.readyState === CLOSED) return;
      if (this.readyState === CONNECTING) this.failedAttempt();
      else this.finish(CLOSE_LOST, 'link to the TV lost');
    };
    const offer = await pc.createOffer();
    this.mark('offerCreated');
    await pc.setLocalDescription(offer);
    if (this.pc !== pc || this.readyState !== CONNECTING) return;
    this.signalSend({ type: 'signal', data: { kind: 'offer', sdp: pc.localDescription?.sdp ?? '', attempt } });
    sentOffer = true;
    for (const c of pendingIce) sendIce(c);
    this.mark('offerSent');
    if (attempt === 1) this.directTimer = setTimeout(() => this.failedAttempt(), 6000);
  }

  private onSignal(data: any): void {
    const pc = this.pc;
    if (!pc || data.attempt !== this.attempt) return;
    if (data.kind === 'answer' && typeof data.sdp === 'string') {
      this.mark('answer');
      this.chain = this.chain.then(() => pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })).catch(() => {
        if (this.pc === pc) this.failedAttempt();
      });
    } else if (data.kind === 'ice' && data.c) this.chain = this.chain.then(() => pc.addIceCandidate(data.c)).catch(() => {});
    else if (data.kind === 'relay-unavailable' && this.attempt === 2) this.noPath('relay-unavailable', 'TURN unavailable on the TV');
  }

  private opened(fast: RTCDataChannel | null): void {
    if (this.readyState !== CONNECTING) return;
    this.fast = fast;
    this.readyState = OPEN;
    this.mark('open');
    this.status('waiting-for-assignment');
    this.onopen?.({});
    void routeOf(this.pc!).then((r) => {
      this.t.route = r.route;
      this.t.path = r.route ? `${r.local} → ${r.remote}` : undefined;
    });
    // The signalling relay's job is done; keep it a little longer for late ICE candidates.
    this.timers.push(
      setTimeout(() => {
        const s = this.sig;
        this.sig = null;
        s?.close(1000, 'connected');
      }, 5000),
    );
  }
}
