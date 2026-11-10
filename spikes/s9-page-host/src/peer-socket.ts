// S9 phone side: a WebSocket-shaped HGP connection to the host in the TV page, over WebRTC data
// channels negotiated through the signalling relay. HgpClient (s1 controller) uses it unchanged via
// setHgpSocketFactory; `fast` (the unreliable channel) is adopted as its direct link on open.
import type { HgpSocket } from '../../s1-phone-bell/src/web/hgp-client.ts';
import { wsUrl } from './config.ts';
import { iceConfig, routeOf } from './ice.ts';

export interface PeerSocketOptions {
  signalOrigin: string;
  room: string;
  peer: string;
  params?: URLSearchParams;
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
        this.signalSend({ type: 'signal', data: { kind: 'bye' } });
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

  private async run(): Promise<void> {
    const { signalOrigin, room, peer } = this.o;
    const params = this.o.params ?? new URLSearchParams();
    this.timers.push(
      setTimeout(() => {
        if (this.readyState === CONNECTING) this.finish(this.hostSeen ? CLOSE_NO_PATH : CLOSE_NO_HOST, this.hostSeen ? 'no network path to the TV' : 'no TV in this room');
      }, this.o.timeoutMs ?? 20_000),
    );
    const icePromise = iceConfig(signalOrigin, params).then((c) => {
      this.mark('ice');
      this.t.iceSource = c.source;
      return c;
    });
    const sig = new WebSocket(wsUrl(signalOrigin, `/signal/${room}?role=phone&peer=${encodeURIComponent(peer)}`));
    this.sig = sig;
    sig.onopen = () => this.mark('signalOpen');
    sig.onclose = (e) => {
      if (this.sig === sig && this.readyState === CONNECTING && e.code >= 4000) this.finish(e.code, e.reason || 'signalling closed');
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
        void icePromise.then((c) => this.offer(c.iceServers, c.iceTransportPolicy));
      } else if (m.type === 'signal' && m.data) this.onSignal(m.data);
    };
  }

  private async offer(iceServers: RTCIceServer[], iceTransportPolicy: RTCIceTransportPolicy): Promise<void> {
    if (this.offered || this.readyState !== CONNECTING) return;
    this.offered = true;
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
    this.pc = pc;
    this.mark('pcCreated');
    const rel = pc.createDataChannel('hgp', { ordered: true });
    const fast = pc.createDataChannel('hgp-fast', { ordered: false, maxRetransmits: 0 });
    this.rel = rel;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signalSend({ type: 'signal', data: { kind: 'ice', c: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        if (this.readyState === CONNECTING) this.finish(CLOSE_NO_PATH, 'no network path to the TV');
        else this.finish(CLOSE_LOST, 'link to the TV lost');
      }
    };
    rel.onopen = () => {
      this.mark('relOpen');
      // Prefer opening with the fast channel ready (HgpClient adopts it on open); don't wait long.
      if (fast.readyState === 'open') this.opened(fast);
      else this.timers.push(setTimeout(() => this.opened(fast.readyState === 'open' ? fast : null), 500));
    };
    fast.onopen = () => {
      this.mark('fastOpen');
      if (rel.readyState === 'open') this.opened(fast);
    };
    rel.onmessage = (e) => {
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
      if (this.readyState === OPEN) this.onmessage?.({ data: text });
    };
    rel.onclose = () => this.finish(CLOSE_LOST, 'link to the TV lost');
    const offer = await pc.createOffer();
    this.mark('offerCreated');
    await pc.setLocalDescription(offer);
    this.signalSend({ type: 'signal', data: { kind: 'offer', sdp: pc.localDescription?.sdp ?? '' } });
    this.mark('offerSent');
  }

  private onSignal(data: any): void {
    const pc = this.pc;
    if (!pc) return;
    if (data.kind === 'answer' && typeof data.sdp === 'string') {
      this.mark('answer');
      this.chain = this.chain.then(() => pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })).catch(() => this.finish(CLOSE_NO_PATH, 'bad answer'));
    } else if (data.kind === 'ice' && data.c) this.chain = this.chain.then(() => pc.addIceCandidate(data.c)).catch(() => {});
  }

  private opened(fast: RTCDataChannel | null): void {
    if (this.readyState !== CONNECTING) return;
    this.fast = fast;
    this.readyState = OPEN;
    this.mark('open');
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
