import { Backoff } from '../core/backoff.ts';
import { ClockSync } from '../core/clock-sync.ts';
import { HGP_CLOSE_REPLACED, HGP_VERSION, parseMessage, type DeviceKind } from '../core/hgp.ts';

type Msg = Record<string, unknown> & { type: string };

export interface ClientOptions {
  kind: DeviceKind;
  deviceId: string;
  name: string;
  hello?: Record<string, unknown>;
  /** steady-state sync ping interval */
  syncIntervalMs?: number;
}

/**
 * Browser HGP client: WebSocket with auto-reconnect, device-initiated clock sync (burst then
 * steady pings, which also keep the Wi-Fi radio out of power-save), optional WebRTC data
 * channel (unordered, maxRetransmits 0) for the timing-critical messages.
 *
 * Reconnects: one socket at a time (a pending retry is cancelled by any newer connect), events from
 * an old socket are ignored, and the back-off only resets after a connection stayed up 5 s. When
 * the host says `replaced` (another tab/page connected with this deviceId) the client goes to
 * standby and does not reconnect until {@link takeover} — otherwise two tabs kick each other off
 * forever.
 */
export class HgpClient {
  readonly sync = new ClockSync();
  readonly rtcSync = new ClockSync();
  readonly backoff = new Backoff();
  ws: WebSocket | null = null;
  dc: RTCDataChannel | null = null;
  pc: RTCPeerConnection | null = null;
  transport: 'ws' | 'rtc' = 'ws';
  onMessage: (m: Msg) => void = () => {};
  onState: (s: string) => void = () => {};
  /** The host handed this deviceId to a newer connection (another tab); the client is in standby. */
  onReplaced: (reason: string) => void = () => {};
  /** Standby: replaced by another tab, no auto-reconnect until `takeover()`. */
  standby = false;
  private syncId = 0;
  private pending = new Map<number, number>();
  private syncTimer: number | undefined;
  private retryTimer: number | undefined;
  private seq = 0;
  private closedByUser = false;
  private takeoverNext = false;

  constructor(private opts: ClientOptions) {}


  setName(name: string): void {
    this.opts.name = name;
  }

  get url(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/hgp`;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Active clock (the one on the transport used for gestures). */
  get clock(): ClockSync {
    return this.transport === 'rtc' && this.rtcSync.ready ? this.rtcSync : this.sync;
  }

  connect(): void {
    this.closedByUser = false;
    this.standby = false;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    // One socket at a time: a second chain would kick this one off at the host (same deviceId).
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.onState('connecting');
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.backoff.opened(performance.now());
      this.sync.reset();
      const takeover = this.takeoverNext;
      this.takeoverNext = false;
      ws.send(
        JSON.stringify({ type: 'hello', v: HGP_VERSION, deviceId: this.opts.deviceId, kind: this.opts.kind, name: this.opts.name, ua: navigator.userAgent, ...this.opts.hello, ...(takeover ? { takeover: true } : {}) }),
      );
      this.onState('open');
      this.startSync();
    };
    ws.onmessage = (e) => {
      if (ws === this.ws) this.receive(typeof e.data === 'string' ? e.data : '', 'ws');
    };
    ws.onclose = (e) => {
      if (ws !== this.ws) return; // an old socket: a newer one already took over
      this.backoff.closed(performance.now());
      window.clearInterval(this.syncTimer);
      if (e.code === HGP_CLOSE_REPLACED && !this.standby) this.enterStandby(e.reason || 'replaced');
      this.onState(this.standby ? 'replaced' : 'closed');
      if (!this.closedByUser && !this.standby) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /** Take the deviceId back from another tab (the user tapped "Use this tab"). */
  takeover(): void {
    this.takeoverNext = true;
    this.backoff.reset();
    const old = this.ws;
    if (old && old.readyState <= WebSocket.OPEN) {
      // Still open (the host's close may be in flight): drop it so its close can't re-enter standby.
      this.ws = null;
      window.clearInterval(this.syncTimer);
      old.close();
    }
    this.connect();
  }

  /** Stop using the connection without reconnecting (another tab of this browser took over). */
  goStandby(reason: string): void {
    if (this.standby) return;
    this.enterStandby(reason);
  }

  private enterStandby(reason: string): void {
    this.standby = true;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.onReplaced(reason);
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.retryTimer);
    const delay = this.backoff.next();
    this.onState(`retry in ${(delay / 1000).toFixed(1)} s`);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  /** Page visible again: retry now instead of waiting out the back-off (never in standby). */
  reconnectNow(): void {
    if (this.closedByUser || this.standby) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.connect();
  }

  close(): void {
    this.closedByUser = true;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.ws?.close();
  }

  send(o: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  /** Send on the timing transport (data channel if active, else WebSocket). */
  sendFast(o: unknown): void {
    if (this.transport === 'rtc' && this.dc?.readyState === 'open') this.dc.send(JSON.stringify(o));
    else this.send(o);
  }

  nextSeq(): number {
    return ++this.seq;
  }

  private startSync(): void {
    window.clearInterval(this.syncTimer);
    let burst = 0;
    const ping = () => {
      const id = ++this.syncId;
      const t0 = performance.now();
      this.pending.set(id, t0);
      if (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value as number);
      this.send({ type: 'sync', id, t0 });
      if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ type: 'sync', id: -id, t0 }));
    };
    const burstTimer = window.setInterval(() => {
      ping();
      if (++burst >= 10) window.clearInterval(burstTimer);
    }, 50);
    this.syncTimer = window.setInterval(ping, this.opts.syncIntervalMs ?? 250);
  }

  private receive(data: string, via: 'ws' | 'rtc'): void {
    const t3 = performance.now();
    const m = parseMessage(data);
    if (!m) return;
    if (m.type === 'sync' && typeof m.t1 === 'number' && typeof m.t2 === 'number' && typeof m.t0 === 'number') {
      const target = via === 'rtc' ? this.rtcSync : this.sync;
      target.add({ t0: m.t0, t1: m.t1, t2: m.t2, t3 });
      return;
    }
    if (m.type === 'rtc') {
      void this.onRtcSignal(m);
      return;
    }
    if (m.type === 'replaced') {
      // The host closes this socket next (HGP_CLOSE_REPLACED); don't reconnect when it does.
      this.goStandby(typeof m.reason === 'string' ? m.reason : 'replaced');
      return;
    }
    this.onMessage(m);
  }

  /** Experimental: open an unordered, unreliable data channel to the host (signalled over the WebSocket). */
  async startRtc(): Promise<void> {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    const dc = pc.createDataChannel('hgp', { ordered: false, maxRetransmits: 0 });
    this.dc = dc;
    dc.onopen = () => {
      this.rtcSync.reset();
      this.transport = 'rtc';
      this.onState('rtc-open');
    };
    dc.onclose = () => {
      this.transport = 'ws';
      this.onState('rtc-closed');
    };
    dc.onmessage = (e) => this.receive(typeof e.data === 'string' ? e.data : '', 'rtc');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const t = window.setTimeout(resolve, 2000);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          window.clearTimeout(t);
          resolve();
        }
      });
    });
    this.send({ type: 'rtc', kind: 'offer', sdp: pc.localDescription?.sdp ?? '' });
  }

  private async onRtcSignal(m: Msg): Promise<void> {
    if (m.kind === 'answer' && this.pc && typeof m.sdp === 'string') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    } else if (m.kind === 'error') {
      this.onState(`rtc-error: ${String(m.error)}`);
    }
  }
}

export function deviceId(): string {
  const k = 'hgp-device-id';
  let id = localStorage.getItem(k);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, id);
  }
  return id;
}
