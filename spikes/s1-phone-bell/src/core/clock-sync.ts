import { quantile } from './stats.ts';

/**
 * NTP-style clock synchronisation between a device ("local" clock) and the host.
 *
 *   device            host
 *   t0 ── sync ──▶ t1
 *   t3 ◀── sync ── t2
 *
 * offset = host - local ≈ ((t1 - t0) + (t2 - t3)) / 2, error bounded by rtt / 2.
 * We keep a sliding window, take the minimum-RTT exchange in each time bucket (min-RTT
 * filtering rejects Wi-Fi power-save/retransmit spikes), and fit offset + drift.
 */

export interface SyncSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface SyncPoint {
  /** Local time at the midpoint of the exchange. */
  local: number;
  offset: number;
  rtt: number;
}

export function samplePoint(s: SyncSample): SyncPoint {
  return {
    local: (s.t0 + s.t3) / 2,
    offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2,
    rtt: s.t3 - s.t0 - (s.t2 - s.t1),
  };
}

export interface ClockSyncOptions {
  windowMs: number;
  bucketMs: number;
  /** Minimum time span of good samples before a drift term is fitted. */
  minDriftSpanMs: number;
  maxDriftPpm: number;
  /** A low-RTT sample this far from prediction means the device clock jumped: start over. */
  jumpResetMs: number;
}

export const DEFAULT_SYNC_OPTIONS: ClockSyncOptions = {
  windowMs: 60_000,
  bucketMs: 5_000,
  minDriftSpanMs: 20_000,
  maxDriftPpm: 300,
  jumpResetMs: 50,
};

export interface ClockEstimate {
  /** Local time the estimate is referenced to (latest sample). */
  ref: number;
  /** host - local at `ref`, ms. */
  offset: number;
  /** d(offset)/d(local), dimensionless (1e-6 = 1 ppm). */
  drift: number;
  n: number;
  used: number;
  rttMin: number;
  rttP50: number;
  /** Hard bound on the offset error of the best exchange (rttMin / 2). */
  errBound: number;
}

export class ClockSync {
  readonly opts: ClockSyncOptions;
  private points: SyncPoint[] = [];
  private est: ClockEstimate | null = null;
  /** How many times a clock jump restarted the fit. */
  resets = 0;

  constructor(opts: Partial<ClockSyncOptions> = {}) {
    this.opts = { ...DEFAULT_SYNC_OPTIONS, ...opts };
  }

  reset(): void {
    this.points = [];
    this.est = null;
  }

  get estimate(): ClockEstimate | null {
    return this.est;
  }

  get ready(): boolean {
    return this.est !== null;
  }

  add(sample: SyncSample): SyncPoint | null {
    const p = samplePoint(sample);
    if (!Number.isFinite(p.rtt) || !Number.isFinite(p.offset) || p.rtt < 0) return null;
    if (this.est) {
      const tol = Math.max(3, this.est.rttMin);
      const predicted = this.offsetAt(p.local);
      if (p.rtt <= this.est.rttMin + tol && Math.abs(p.offset - predicted) > this.opts.jumpResetMs + p.rtt / 2) {
        this.points = [];
        this.resets++;
      }
    }
    this.points.push(p);
    const cutoff = p.local - this.opts.windowMs;
    while (this.points.length > 0 && this.points[0].local < cutoff) this.points.shift();
    this.est = this.compute();
    return p;
  }

  offsetAt(local: number): number {
    const e = this.est;
    if (!e) return NaN;
    return e.offset + e.drift * (local - e.ref);
  }

  toHost(local: number): number {
    return local + this.offsetAt(local);
  }

  toLocal(host: number): number {
    const e = this.est;
    if (!e) return NaN;
    return (host - e.offset + e.drift * e.ref) / (1 + e.drift);
  }

  private compute(): ClockEstimate | null {
    const pts = this.points;
    if (pts.length === 0) return null;
    const rtts = pts.map((p) => p.rtt).sort((a, b) => a - b);
    const rttMin = rtts[0];
    const rttP50 = quantile(rtts, 0.5);
    const tol = Math.max(3, rttMin);

    const buckets = new Map<number, SyncPoint>();
    for (const p of pts) {
      const k = Math.floor(p.local / this.opts.bucketMs);
      const cur = buckets.get(k);
      if (!cur || p.rtt < cur.rtt) buckets.set(k, p);
    }
    const cand = [...buckets.values()].filter((p) => p.rtt <= rttMin + tol).sort((a, b) => a.local - b.local);
    const ref = pts[pts.length - 1].local;
    const span = cand.length > 0 ? cand[cand.length - 1].local - cand[0].local : 0;

    let offset = NaN;
    let drift = 0;
    if (cand.length >= 4 && span >= this.opts.minDriftSpanMs) {
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const p of cand) {
        const w = 1 / (1 + p.rtt - rttMin);
        const x = p.local - ref;
        sw += w;
        sx += w * x;
        sy += w * p.offset;
        sxx += w * x * x;
        sxy += w * x * p.offset;
      }
      const den = sw * sxx - sx * sx;
      if (den > 0) {
        const maxD = this.opts.maxDriftPpm * 1e-6;
        drift = Math.max(-maxD, Math.min(maxD, (sw * sxy - sx * sy) / den));
        offset = (sy - drift * sx) / sw;
      }
    }
    if (!Number.isFinite(offset)) {
      drift = 0;
      const best = [...cand]
        .sort((a, b) => a.rtt - b.rtt)
        .slice(0, 3)
        .map((p) => p.offset)
        .sort((a, b) => a - b);
      offset = best[Math.floor(best.length / 2)];
    }
    return { ref, offset, drift, n: pts.length, used: cand.length, rttMin, rttP50, errBound: rttMin / 2 };
  }
}
