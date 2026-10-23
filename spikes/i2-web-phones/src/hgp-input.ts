// S4 InputSource for phones: HGP ring events (relayed by the S1 host) → GestureEvents on this
// page's performance.now() timeline, using the phone's *source* timestamp mapped through two
// clock syncs (phone→host on the phone, host→page here). Arrival time is never used for judging
// (ADR-0002); unsynced rings are counted and dropped.
import type { GestureSink, InputSource } from '../../s4-web-host/src/input/types';
import type { HgpLink, RingEvent } from './hgp-link';

export interface HgpInputStats {
  rings: number;
  unsynced: number;
  unmapped: number;
  nonRing: number;
  /** Phone gesture → this page received it (ms), via source timestamps. */
  latencyMs: number[];
}

export class HgpInputSource implements InputSource {
  readonly id = 'hgp';
  readonly stats: HgpInputStats = { rings: 0, unsynced: 0, unmapped: 0, nonRing: 0, latencyMs: [] };
  private listener: ((e: RingEvent) => void) | null = null;

  /** `laneOf(deviceId, bellId)` → global lane, or undefined if that phone/bell is not in the song. */
  constructor(
    private readonly link: HgpLink,
    private readonly laneOf: (deviceId: string, bellId: string) => number | undefined,
  ) {}

  start(sink: GestureSink): void {
    this.listener = (e) => {
      if (e.g !== 'ring' && e.g !== 'tap') {
        this.stats.nonRing++;
        return;
      }
      const lane = this.laneOf(e.deviceId, e.bell);
      if (lane === undefined) {
        this.stats.unmapped++;
        return;
      }
      const perf = e.th === undefined ? NaN : this.link.hostToPerf(e.th);
      if (!Number.isFinite(perf)) {
        this.stats.unsynced++;
        return;
      }
      this.stats.rings++;
      this.stats.latencyMs.push(e.receivedAtMs - perf);
      sink({ source: this.id, deviceId: e.deviceId, gesture: 'ring', lane, hostTimeMs: perf, receivedAtMs: e.receivedAtMs, sourceTimeMs: e.t, seq: e.seq, intensity: e.vel });
    };
    this.link.ringListeners.add(this.listener);
  }

  stop(): void {
    if (this.listener) this.link.ringListeners.delete(this.listener);
    this.listener = null;
  }
}
