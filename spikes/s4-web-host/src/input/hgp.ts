// Placeholder HGP adapter showing where networked bells plug in. The wire format is owned by
// spike S1 (docs/protocol/hgp-v0.md); the JSON shape below is illustrative only.
import type { GestureSink, InputSource } from './types';

/** Maps a device's clock to the host performance.now() timeline (filled in by clock sync). */
export interface ClockMapper {
  toHostMs(deviceId: string, deviceTimeMs: number): number | undefined;
}

/**
 * NTP-style offset estimate per device: keep the sample with the smallest round-trip time from
 * a sliding window (min-RTT filter). offset = deviceTime - hostMidpoint.
 */
export class MinRttClockMapper implements ClockMapper {
  private readonly samples = new Map<string, { rtt: number; offset: number; at: number }[]>();
  constructor(private readonly windowSize = 32) {}

  addSample(deviceId: string, hostSendMs: number, deviceTimeMs: number, hostRecvMs: number): void {
    const rtt = hostRecvMs - hostSendMs;
    const offset = deviceTimeMs - (hostSendMs + hostRecvMs) / 2;
    const list = this.samples.get(deviceId) ?? [];
    list.push({ rtt, offset, at: hostRecvMs });
    if (list.length > this.windowSize) list.shift();
    this.samples.set(deviceId, list);
  }

  toHostMs(deviceId: string, deviceTimeMs: number): number | undefined {
    const list = this.samples.get(deviceId);
    if (!list?.length) return undefined;
    let best = list[0];
    for (const s of list) if (s.rtt < best.rtt) best = s;
    return deviceTimeMs - best.offset;
  }
}

interface WireRing {
  t: 'ring' | 'damp';
  dev: string;
  bell: number; // MIDI pitch
  ts: number; // device clock, ms
  seq?: number;
  v?: number;
}

/** Connects to a relay/host WebSocket that forwards HGP gesture messages as JSON. Untested stub. */
export class HgpWebSocketSource implements InputSource {
  readonly id = 'hgp-ws';
  private ws: WebSocket | null = null;

  constructor(private readonly url: string, private readonly clock: ClockMapper) {}

  start(sink: GestureSink): void {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (msg) => {
      const receivedAtMs = performance.now();
      let m: WireRing;
      try {
        m = JSON.parse(String(msg.data)) as WireRing;
      } catch {
        return;
      }
      if (m.t !== 'ring' && m.t !== 'damp') return;
      const hostTimeMs = this.clock.toHostMs(m.dev, m.ts);
      if (hostTimeMs === undefined) return; // not yet synced: drop rather than judge by arrival
      sink({ source: this.id, deviceId: m.dev, gesture: m.t, pitch: m.bell, hostTimeMs, receivedAtMs, sourceTimeMs: m.ts, seq: m.seq, intensity: m.v });
    };
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
  }
}
