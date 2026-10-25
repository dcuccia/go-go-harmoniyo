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
 *  - Fast passages (eighth/sixteenth notes): `adaptParams` derives the effective thresholds from a
 *    context — the player's sensitivity (Normal / Quick) and the expected inter-onset interval
 *    (IOI) of the notes around now. In a fast passage the refractory period follows the IOI,
 *    smaller "flick" strokes count, and with a calibrated axis both directions of a back-and-forth
 *    shake ring (`bidirectional`); a small rebound right after a ring is rejected as a bounce.
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
  /**
   * With a calibrated axis, also ring on strokes against it (both halves of a back-and-forth
   * shake). Off by default: the return swing must not ring in normal play.
   */
  bidirectional: boolean;
  /**
   * Bidirectional only: an opposite-direction stroke that arms within `bounceMs` of the last ring
   * and peaks below `bounceRatio` × that ring's peak is the bell's rebound, not a new ring.
   */
  bounceMs: number;
  bounceRatio: number;
  /**
   * Bidirectional only: a backward (against-the-axis) stroke within `reverseWindowMs` of the last
   * ring must peak at ≥ `reverseRatio` × that ring's peak (capped at `reverseRefMax` deg/s, so a big
   * full ring before a run doesn't set the bar). A deliberate backward ring in a shake is a full
   * stroke; a relaxed return swing between forward flicks is smaller.
   */
  reverseRatio: number;
  reverseWindowMs: number;
  reverseRefMax: number;
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
  bidirectional: false,
  bounceMs: 90,
  bounceRatio: 0.45,
  reverseRatio: 0.55,
  reverseWindowMs: 600,
  reverseRefMax: 450,
};

/** Per-phone ring sensitivity, set from the game lobby (HGP `assign.ring.sens`). */
export type Sensitivity = 'normal' | 'quick';
export const isSensitivity = (s: unknown): s is Sensitivity => s === 'normal' || s === 'quick';

/** What the detector knows about the music around now (see adaptParams). */
export interface RingContext {
  sensitivity?: Sensitivity;
  /** Expected inter-onset interval of this player's notes around now, ms (null/undefined = unknown). */
  ioiMs?: number | null;
}

/** A passage is "fast" when the expected IOI is at most this (ms): Normal ≈ 8ths at ≥ 75 bpm, Quick ≈ 8ths at ≥ 67 bpm (and quarters at ≥ 134 bpm). */
export const FAST_IOI_MS: Record<Sensitivity, number> = { normal: 400, quick: 450 };

/** Threshold ceilings for Quick sensitivity everywhere, and for fast passages (per sensitivity). */
export const QUICK_PARAMS = { armOmega: 130, minPeakOmega: 170, minDecel: 4500, refractoryMs: 120 } as const;
export const FAST_PARAMS: Record<Sensitivity, { armOmega: number; minPeakOmega: number; minDecel: number; rearmOmega: number }> = {
  normal: { armOmega: 110, minPeakOmega: 140, minDecel: 3500, rearmOmega: 80 },
  quick: { armOmega: 100, minPeakOmega: 120, minDecel: 3000, rearmOmega: 70 },
};
/** Fast-passage refractory = clamp(ratio × IOI, min, base refractory). */
export const FAST_REFRACTORY = { ratio: 0.6, minMs: 65 } as const;

/**
 * Effective detector parameters for a context. Normal sensitivity outside fast passages returns
 * `base` unchanged (the S1-tuned defaults). Thresholds only ever go down from `base`, so a
 * stricter manual override (URL / `config.detector`) still wins.
 */
export function adaptParams(base: RingDetectorParams, ctx: RingContext = {}): RingDetectorParams {
  const sens: Sensitivity = ctx.sensitivity ?? 'normal';
  const ioi = typeof ctx.ioiMs === 'number' && Number.isFinite(ctx.ioiMs) && ctx.ioiMs > 0 ? ctx.ioiMs : null;
  const fast = ioi !== null && ioi <= FAST_IOI_MS[sens];
  if (sens === 'normal' && !fast) return base;
  const p = { ...base };
  if (sens === 'quick') {
    p.armOmega = Math.min(p.armOmega, QUICK_PARAMS.armOmega);
    p.minPeakOmega = Math.min(p.minPeakOmega, QUICK_PARAMS.minPeakOmega);
    p.minDecel = Math.min(p.minDecel, QUICK_PARAMS.minDecel);
    p.refractoryMs = Math.min(p.refractoryMs, QUICK_PARAMS.refractoryMs);
  }
  if (fast) {
    const f = FAST_PARAMS[sens];
    p.armOmega = Math.min(p.armOmega, f.armOmega);
    p.minPeakOmega = Math.min(p.minPeakOmega, f.minPeakOmega);
    p.minDecel = Math.min(p.minDecel, f.minDecel);
    p.rearmOmega = Math.min(p.rearmOmega, f.rearmOmega);
    p.refractoryMs = Math.min(p.refractoryMs, Math.max(FAST_REFRACTORY.minMs, FAST_REFRACTORY.ratio * ioi));
    p.maxStrokeMs = Math.min(p.maxStrokeMs, Math.max(250, 2 * ioi));
    p.bidirectional = p.axis !== null;
  }
  return p;
}

/**
 * Expected IOI at `now` from this player's upcoming note times (sorted, same clock as `now`): the
 * shortest gap between consecutive notes whose span [t_i − leadMs, t_{i+1} + tailMs] contains
 * `now`. Notes closer than `minGapMs` (chords, merged lanes) count as one. Null outside any span.
 */
export function expectedIoi(times: readonly number[], now: number, leadMs = 250, tailMs = 150, minGapMs = 40): number | null {
  // First note at or after now - (largest gap we care about) - tail; gaps over 2 s never matter.
  let lo = 0;
  let hi = times.length;
  const from = now - 2000 - tailMs;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  let best: number | null = null;
  let prev = lo > 0 ? times[lo - 1] : NaN;
  for (let i = lo; i < times.length; i++) {
    const t = times[i];
    if (t - leadMs > now + 2000) break;
    if (Number.isFinite(prev)) {
      const gap = t - prev;
      if (gap >= minGapMs && now >= prev - leadMs && now <= t + tailMs && (best === null || gap < best)) best = gap;
      if (gap < minGapMs) continue; // keep the chord's first note as `prev`
    }
    prev = t;
  }
  return best;
}

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
  /** Base parameters (S1 defaults + overrides, calibrated axis). The context adapts them per sample. */
  params: RingDetectorParams;
  private ctx: RingContext = {};
  private state: State = 'idle';
  private prev: { t: number; w: number } | null = null;
  /** Direction of the current/last stroke along the signal: +1, or −1 (bidirectional only). */
  private dir: 1 | -1 = 1;
  private strokeStart = 0;
  private peakW = 0;
  private peakVec: Vec3 = [0, 0, 0];
  private peakAcc = 0;
  private decels: { t: number; d: number }[] = [];
  private lastFire = -Infinity;
  private lastPeak = 0;
  private bounceCandidate = false;
  private reverseCandidate = false;

  constructor(params: Partial<RingDetectorParams> = {}) {
    this.params = { ...DEFAULT_RING_PARAMS, ...params };
  }

  reset(): void {
    this.state = 'idle';
    this.prev = null;
    this.decels = [];
    this.lastFire = -Infinity;
    this.lastPeak = 0;
    this.dir = 1;
  }

  /** Sensitivity + expected IOI around now (see adaptParams). Cheap: call it as often as needed. */
  setContext(ctx: RingContext): void {
    this.ctx = ctx;
  }

  get context(): RingContext {
    return this.ctx;
  }

  /** Parameters in effect for the current context. */
  effective(): RingDetectorParams {
    return adaptParams(this.params, this.ctx);
  }

  signal(s: MotionSample): number {
    const g: Vec3 = [s.gx, s.gy, s.gz];
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1]) || !Number.isFinite(g[2])) return NaN;
    return this.params.axis ? dot(g, this.params.axis) : norm(g);
  }

  push(s: MotionSample): StrikeEvent | null {
    const p = this.effective();
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
    const tMid = (prev.t + s.t) / 2;
    const both = p.bidirectional && p.axis !== null;

    if (this.state === 'cooldown') {
      if (both && -this.dir * w >= p.armOmega) {
        // The other half of a shake: arm at once (the refractory check happens when it ends).
        this.arm(-this.dir as 1 | -1, s, w, accMag, p);
        return null;
      }
      if (this.dir * w < p.rearmOmega && s.t - this.lastFire >= p.refractoryMs) this.state = 'idle';
      return null;
    }

    if (this.state === 'idle') {
      if (w >= p.armOmega) this.arm(1, s, w, accMag, p);
      else if (both && -w >= p.armOmega) this.arm(-1, s, w, accMag, p);
      return null;
    }

    // stroke
    const sw = this.dir * w;
    this.decels.push({ t: tMid, d: (this.dir * (prev.w - w)) / dt });
    if (sw > this.peakW) {
      this.peakW = sw;
      this.peakVec = [s.gx, s.gy, s.gz];
    }
    this.peakAcc = Math.max(this.peakAcc, accMag);
    if (sw < p.releaseRatio * this.peakW) {
      this.state = 'cooldown';
      return this.finishStroke(s.t, p);
    }
    if (s.t - this.strokeStart > p.maxStrokeMs) this.state = 'cooldown';
    return null;
  }

  private arm(dir: 1 | -1, s: MotionSample, w: number, accMag: number, p: RingDetectorParams): void {
    this.bounceCandidate = dir !== this.dir && s.t - this.lastFire < p.bounceMs;
    this.reverseCandidate = dir === -1 && s.t - this.lastFire < p.reverseWindowMs;
    this.dir = dir;
    this.state = 'stroke';
    this.strokeStart = s.t;
    this.peakW = dir * w;
    this.peakVec = [s.gx, s.gy, s.gz];
    this.peakAcc = accMag;
    this.decels = [];
  }

  private finishStroke(now: number, p: RingDetectorParams): StrikeEvent | null {
    if (this.decels.length === 0) return null;
    let k = 0;
    for (let i = 1; i < this.decels.length; i++) if (this.decels[i].d > this.decels[k].d) k = i;
    const maxDecel = this.decels[k].d;
    if (this.peakW < p.minPeakOmega || maxDecel < p.minDecel || now - this.lastFire < p.refractoryMs) return null;
    if (this.bounceCandidate && this.peakW < p.bounceRatio * this.lastPeak) return null;
    if (this.reverseCandidate && this.peakW < p.reverseRatio * Math.min(this.lastPeak, p.reverseRefMax)) return null;

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
    this.lastPeak = this.peakW;
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
