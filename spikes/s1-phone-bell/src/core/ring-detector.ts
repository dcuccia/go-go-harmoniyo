/**
 * Ring (forward handbell stroke) detector for phone motion sensors.
 *
 * Approach (informed by, not copied from, GACJ/handbellmanager, which thresholds a single
 * accelerometer axis with handstroke/backstroke hysteresis, a debounce delay and an optional
 * per-stroke strike delay):
 *
 *  - Signal: angular speed from the gyroscope (deg/s). Either |ω| (any direction) or, after
 *    calibration, the signed projection ω·u onto the learned forward-stroke axis u, which
 *    ignores the return swing.
 *  - A stroke arms when the signal exceeds `armOmega`, tracks its peak, and ends when the
 *    signal falls below `releaseRatio * peak`.
 *  - It is a ring only if the peak is high enough AND the stop was abrupt: the maximum angular
 *    deceleration exceeds `minDecel` (a handbell rings when the stroke is stopped sharply;
 *    waving, tilting, picking the phone up are smooth).
 *  - The reported strike time is the moment of maximum deceleration (parabolic sub-sample
 *    interpolation), i.e. it is *back-dated* to the physical ring moment. The detection delay
 *    (`firedAt - t`) only matters for local sound, not for judging.
 *  - Refractory period + re-arm hysteresis prevent double triggers.
 */

export interface MotionSample {
  /** Device timestamp, ms (performance.now() time origin). */
  t: number;
  /** Linear acceleration without gravity, m/s² (NaN if unavailable). */
  ax: number;
  ay: number;
  az: number;
  /** Rotation rate, deg/s, device axes: gx = beta (about X), gy = gamma (about Y), gz = alpha (about Z). */
  gx: number;
  gy: number;
  gz: number;
}

export type Vec3 = [number, number, number];

export interface StrikeEvent {
  /** Estimated ring moment, device ms (includes timeOffsetMs). */
  t: number;
  /** Timestamp of the sample that triggered detection. */
  firedAt: number;
  peakOmega: number;
  maxDecel: number;
  peakAccel: number;
  /** 0..1 */
  intensity: number;
  /** Unit rotation axis at peak angular speed (device frame). */
  axis: Vec3;
}

export interface RingDetectorParams {
  armOmega: number;
  minPeakOmega: number;
  /** deg/s² */
  minDecel: number;
  releaseRatio: number;
  rearmOmega: number;
  refractoryMs: number;
  maxStrokeMs: number;
  timeOffsetMs: number;
  /** Learned forward-stroke rotation axis (unit vector) or null for direction-agnostic |ω|. */
  axis: Vec3 | null;
  interpolate: boolean;
}

export const DEFAULT_RING_PARAMS: RingDetectorParams = {
  armOmega: 150,
  minPeakOmega: 200,
  minDecel: 6000,
  releaseRatio: 0.5,
  rearmOmega: 100,
  refractoryMs: 150,
  maxStrokeMs: 600,
  timeOffsetMs: 0,
  axis: null,
  interpolate: true,
};

type State = 'idle' | 'stroke' | 'cooldown';

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class RingDetector {
  params: RingDetectorParams;
  private state: State = 'idle';
  private prev: { t: number; w: number } | null = null;
  private strokeStart = 0;
  private peakW = 0;
  private peakVec: Vec3 = [0, 0, 0];
  private peakAcc = 0;
  private decels: { t: number; d: number }[] = [];
  private lastFire = -Infinity;

  constructor(params: Partial<RingDetectorParams> = {}) {
    this.params = { ...DEFAULT_RING_PARAMS, ...params };
  }

  reset(): void {
    this.state = 'idle';
    this.prev = null;
    this.decels = [];
    this.lastFire = -Infinity;
  }

  signal(s: MotionSample): number {
    const g: Vec3 = [s.gx, s.gy, s.gz];
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1]) || !Number.isFinite(g[2])) return NaN;
    return this.params.axis ? dot(g, this.params.axis) : norm(g);
  }

  push(s: MotionSample): StrikeEvent | null {
    const p = this.params;
    const w = this.signal(s);
    if (!Number.isFinite(w)) return null;
    const accMag = Number.isFinite(s.ax) ? Math.hypot(s.ax, s.ay, s.az) : 0;
    const prev = this.prev;
    this.prev = { t: s.t, w };
    if (!prev) return null;
    const dt = (s.t - prev.t) / 1000;
    if (!(dt > 0) || dt > 0.2) {
      // Sensor gap: abandon any stroke in progress.
      this.state = 'cooldown';
      return null;
    }
    const decel = (prev.w - w) / dt;
    const tMid = (prev.t + s.t) / 2;

    switch (this.state) {
      case 'idle':
        if (w >= p.armOmega) {
          this.state = 'stroke';
          this.strokeStart = s.t;
          this.peakW = w;
          this.peakVec = [s.gx, s.gy, s.gz];
          this.peakAcc = accMag;
          this.decels = [];
        }
        return null;

      case 'stroke': {
        this.decels.push({ t: tMid, d: decel });
        if (w > this.peakW) {
          this.peakW = w;
          this.peakVec = [s.gx, s.gy, s.gz];
        }
        this.peakAcc = Math.max(this.peakAcc, accMag);
        if (w < p.releaseRatio * this.peakW) {
          this.state = 'cooldown';
          return this.finishStroke(s.t);
        }
        if (s.t - this.strokeStart > p.maxStrokeMs) this.state = 'cooldown';
        return null;
      }

      case 'cooldown':
        if (w < p.rearmOmega && s.t - this.lastFire >= p.refractoryMs) this.state = 'idle';
        return null;
    }
  }

  private finishStroke(now: number): StrikeEvent | null {
    const p = this.params;
    if (this.decels.length === 0) return null;
    let k = 0;
    for (let i = 1; i < this.decels.length; i++) if (this.decels[i].d > this.decels[k].d) k = i;
    const maxDecel = this.decels[k].d;
    if (this.peakW < p.minPeakOmega || maxDecel < p.minDecel || now - this.lastFire < p.refractoryMs) return null;

    let t = this.decels[k].t;
    if (p.interpolate && k > 0 && k < this.decels.length - 1) {
      const a = this.decels[k - 1].d;
      const b = this.decels[k].d;
      const c = this.decels[k + 1].d;
      const den = a - 2 * b + c;
      if (den < 0) {
        const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
        const spacing = delta > 0 ? this.decels[k + 1].t - t : t - this.decels[k - 1].t;
        t += delta * spacing;
      }
    }
    this.lastFire = now;
    return {
      t: t + p.timeOffsetMs,
      firedAt: now,
      peakOmega: this.peakW,
      maxDecel,
      peakAccel: this.peakAcc,
      intensity: Math.max(0, Math.min(1, this.peakW / 1000)),
      axis: normalize(this.peakVec),
    };
  }
}

/**
 * Learn the forward-stroke axis from strikes detected in direction-agnostic mode while the
 * player rings a few times. Strikes are split by sign relative to the most abrupt one; every
 * ring fires but only some return swings do, so the larger group is "forward" (ties: the group
 * with sharper stops). Returns null if too few strikes.
 */
export function learnAxis(strikes: readonly StrikeEvent[], minStrikes = 3): Vec3 | null {
  if (strikes.length < minStrikes) return null;
  let refIdx = 0;
  for (let i = 1; i < strikes.length; i++) if (strikes[i].maxDecel > strikes[refIdx].maxDecel) refIdx = i;
  const r = strikes[refIdx].axis;
  const groups: { sum: Vec3; decel: number; n: number }[] = [
    { sum: [0, 0, 0], decel: 0, n: 0 },
    { sum: [0, 0, 0], decel: 0, n: 0 },
  ];
  for (const s of strikes) {
    const g = dot(s.axis, r) >= 0 ? groups[0] : groups[1];
    const sign = dot(s.axis, r) >= 0 ? 1 : -1;
    g.sum[0] += sign * s.axis[0];
    g.sum[1] += sign * s.axis[1];
    g.sum[2] += sign * s.axis[2];
    g.decel += s.maxDecel;
    g.n++;
  }
  const meanDecel = (g: { decel: number; n: number }) => (g.n > 0 ? g.decel / g.n : 0);
  const fwd = groups[0].n !== groups[1].n ? (groups[0].n > groups[1].n ? 0 : 1) : meanDecel(groups[0]) >= meanDecel(groups[1]) ? 0 : 1;
  const g = groups[fwd];
  if (g.n < minStrikes) return null;
  const axis = normalize(g.sum);
  return fwd === 0 ? axis : [-axis[0], -axis[1], -axis[2]];
}
