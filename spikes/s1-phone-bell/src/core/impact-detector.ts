import type { MotionSample } from './ring-detector.ts';

/**
 * Impact ("clink" / table-knock / tap) detector on linear-acceleration magnitude.
 * Used for the two-phone clink test (clock-sync + sampling error) and the sound-latency test,
 * because an impact is a sharp physical event both phones (and a microphone) observe at once.
 *
 * Threshold adapts to the noise floor: thr = max(minJump, mean + k * meanAbsDev).
 * The impact happened somewhere in (prev.t, cur.t]; we report the midpoint (unbiased for a
 * uniformly random sampling phase).
 */

export interface ImpactParams {
  /** m/s², absolute floor for the threshold. */
  minJump: number;
  /** Noise multiples above the running mean. */
  k: number;
  refractoryMs: number;
  /** EMA coefficient for the noise floor. */
  alpha: number;
  timeOffsetMs: number;
}

export const DEFAULT_IMPACT_PARAMS: ImpactParams = {
  minJump: 4,
  k: 10,
  refractoryMs: 250,
  alpha: 0.05,
  timeOffsetMs: 0,
};

export interface ImpactEvent {
  t: number;
  firedAt: number;
  peak: number;
  threshold: number;
}

export class ImpactDetector {
  params: ImpactParams;
  private mean = NaN;
  private dev = 0;
  private prev: { t: number; a: number } | null = null;
  private lastFire = -Infinity;
  private pending: ImpactEvent | null = null;

  constructor(params: Partial<ImpactParams> = {}) {
    this.params = { ...DEFAULT_IMPACT_PARAMS, ...params };
  }

  reset(): void {
    this.mean = NaN;
    this.dev = 0;
    this.prev = null;
    this.lastFire = -Infinity;
    this.pending = null;
  }

  push(s: MotionSample): ImpactEvent | null {
    const p = this.params;
    if (!Number.isFinite(s.ax)) return null;
    const a = Math.hypot(s.ax, s.ay, s.az);
    const prev = this.prev;
    this.prev = { t: s.t, a };
    if (!Number.isFinite(this.mean)) {
      this.mean = a;
      return null;
    }
    const thr = Math.max(p.minJump, this.mean + p.k * this.dev);
    let out: ImpactEvent | null = null;
    if (a > thr && prev && prev.a <= thr && s.t - this.lastFire >= p.refractoryMs) {
      this.lastFire = s.t;
      out = { t: (prev.t + s.t) / 2 + p.timeOffsetMs, firedAt: s.t, peak: a, threshold: thr };
      this.pending = out;
    } else if (this.pending && a > this.pending.peak && s.t - this.pending.firedAt < p.refractoryMs) {
      this.pending.peak = a;
    }
    // Only learn the noise floor outside impacts.
    if (s.t - this.lastFire >= p.refractoryMs && a <= thr) {
      this.mean += p.alpha * (a - this.mean);
      this.dev += p.alpha * (Math.abs(a - this.mean) - this.dev);
    }
    return out;
  }
}
