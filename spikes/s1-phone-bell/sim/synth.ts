import type { MotionSample, Vec3 } from '../src/core/ring-detector.ts';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function uniform(r: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * r();
}

function unitNear(r: () => number, base: Vec3, spreadDeg: number): Vec3 {
  const s = (spreadDeg * Math.PI) / 180;
  const v: Vec3 = [base[0] + gauss(r) * s, base[1] + gauss(r) * s, base[2] + gauss(r) * s];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function randomUnit(r: () => number): Vec3 {
  return unitNear(r, [gauss(r), gauss(r), gauss(r)], 0);
}

/** A continuous-time motion component, zero outside [start, start + dur). */
interface Segment {
  start: number;
  dur: number;
  /** angular speed along `axis` (deg/s) and linear accel along `accDir` (m/s²) at local time τ (ms) */
  f: (tau: number) => { w: number; a: number };
  axis: Vec3;
  accDir: Vec3;
}

export interface RingerProfile {
  name: string;
  peak: [number, number];
  rise: [number, number];
  stop: [number, number];
  /** probability that the return swing also ends abruptly (a false-positive risk) */
  abruptReturn: number;
  /** std of human timing vs beat, ms */
  timingSd: number;
}

export const RINGERS: Record<string, RingerProfile> = {
  adult: { name: 'adult', peak: [400, 800], rise: [110, 200], stop: [25, 40], abruptReturn: 0.05, timingSd: 25 },
  child: { name: 'child', peak: [260, 450], rise: [130, 230], stop: [35, 55], abruptReturn: 0.1, timingSd: 45 },
  sloppy: { name: 'sloppy', peak: [300, 700], rise: [100, 220], stop: [30, 60], abruptReturn: 0.35, timingSd: 60 },
};

function ringSegment(r: () => number, ringTime: number, prof: RingerProfile, axis: Vec3, accDir: Vec3): Segment {
  const P = uniform(r, prof.peak[0], prof.peak[1]);
  const R = uniform(r, prof.rise[0], prof.rise[1]);
  const S = uniform(r, prof.stop[0], prof.stop[1]);
  const B = uniform(r, 0.05, 0.2);
  const Bd = 60;
  const A = (P / 500) * uniform(r, 12, 25);
  // ring moment (max deceleration of the cos² stop) is at R + S/2
  const start = ringTime - (R + S / 2);
  return {
    start,
    dur: R + S + Bd,
    axis,
    accDir,
    f: (tau) => {
      if (tau < R) return { w: P * Math.sin(((Math.PI / 2) * tau) / R) ** 2, a: 4 * Math.sin((Math.PI * tau) / R) };
      if (tau < R + S) {
        const x = (tau - R) / S;
        return { w: P * Math.cos((Math.PI / 2) * x) ** 2, a: -A * Math.sin(Math.PI * x) };
      }
      return { w: -B * P * Math.sin((Math.PI * (tau - R - S)) / Bd), a: 0 };
    },
  };
}

function returnSegment(r: () => number, start: number, maxDur: number, prof: RingerProfile, axis: Vec3, accDir: Vec3): Segment {
  const Q = uniform(r, 0.4, 0.8) * uniform(r, prof.peak[0], prof.peak[1]);
  const neg: Vec3 = [-axis[0], -axis[1], -axis[2]];
  if (r() < prof.abruptReturn) {
    const S = uniform(r, 35, 70);
    const R = Math.max(80, Math.min(uniform(r, 150, 250), maxDur - S));
    return {
      start,
      dur: R + S,
      axis: neg,
      accDir,
      f: (tau) =>
        tau < R
          ? { w: Q * Math.sin(((Math.PI / 2) * tau) / R) ** 2, a: 0 }
          : { w: Q * Math.cos(((Math.PI / 2) * (tau - R)) / S) ** 2, a: -(Q / 500) * 10 * Math.sin((Math.PI * (tau - R)) / S) },
    };
  }
  const D = Math.max(200, Math.min(uniform(r, 300, 450), maxDur));
  return { start, dur: D, axis: neg, accDir, f: (tau) => ({ w: Q * Math.sin((Math.PI * tau) / D), a: 0 }) };
}

export type Distractor = 'tilt' | 'wave' | 'pickup' | 'walk' | 'bump';

function distractorSegment(r: () => number, kind: Distractor, start: number): Segment {
  const axis = randomUnit(r);
  const accDir = randomUnit(r);
  switch (kind) {
    case 'tilt': {
      const M = uniform(r, 60, 180);
      const D = uniform(r, 400, 900);
      return { start, dur: D, axis, accDir, f: (tau) => ({ w: M * Math.sin((Math.PI * tau) / D), a: 0.5 }) };
    }
    case 'wave': {
      const M = uniform(r, 150, 300);
      const f = uniform(r, 1.5, 3) / 1000;
      const D = uniform(r, 1000, 2000);
      return { start, dur: D, axis, accDir, f: (tau) => ({ w: M * Math.sin(2 * Math.PI * f * tau), a: 3 * Math.sin(2 * Math.PI * f * tau) }) };
    }
    case 'pickup': {
      const M = uniform(r, 150, 300);
      const R = uniform(r, 200, 350);
      const S = uniform(r, 80, 140);
      return {
        start,
        dur: R + S,
        axis,
        accDir,
        f: (tau) =>
          tau < R
            ? { w: M * Math.sin(((Math.PI / 2) * tau) / R) ** 2, a: 2 }
            : { w: M * Math.cos(((Math.PI / 2) * (tau - R)) / S) ** 2, a: -2 },
      };
    }
    case 'walk': {
      const D = uniform(r, 3000, 6000);
      return { start, dur: D, axis, accDir, f: (tau) => ({ w: 40 * Math.sin(2 * Math.PI * tau / 1000), a: 2.5 * Math.sin(2 * Math.PI * tau / 500) }) };
    }
    case 'bump': {
      const A = uniform(r, 5, 20);
      return { start, dur: 15, axis, accDir, f: (tau) => ({ w: 30 * Math.sin((Math.PI * tau) / 15), a: A * Math.sin((Math.PI * tau) / 15) }) };
    }
  }
}

/**
 * Impact (clink / table knock) seen by a phone: a sharp accel transient that decays as the
 * chassis rings down (τ 6–20 ms), little rotation. Real waveforms need physical capture.
 */
export function impactSegment(r: () => number, t: number): Segment {
  const A = uniform(r, 10, 40);
  const tau0 = uniform(r, 6, 20);
  return { start: t, dur: 5 * tau0, axis: randomUnit(r), accDir: randomUnit(r), f: (tau) => ({ w: 20 * Math.exp(-tau / tau0), a: A * Math.exp(-tau / tau0) }) };
}

export interface SensorModel {
  rateHz: number;
  /** Real sensor clocks are not exactly nominal; each simulated phone gets rate × (1 ± this). */
  rateTolerance: number;
  /** Event-timestamp jitter, ms (sd). */
  jitterSd: number;
  /** Constant sensor→event latency, ms. */
  latency: number;
  gyroNoise: number;
  accNoise: number;
  dropProb: number;
}

export const SENSOR_60HZ: SensorModel = { rateHz: 60, rateTolerance: 0.01, jitterSd: 1.0, latency: 8, gyroNoise: 4, accNoise: 0.15, dropProb: 0.01 };
export const SENSOR_100HZ: SensorModel = { ...SENSOR_60HZ, rateHz: 100 };
export const SENSOR_200HZ: SensorModel = { ...SENSOR_60HZ, rateHz: 200 };

/**
 * Sample continuous segments like a phone sensor: box-filter over one period (decimating
 * sensor), random phase, noise, timestamp latency + jitter, occasional dropped events.
 */
export function sample(r: () => number, segs: readonly Segment[], durationMs: number, sensor: SensorModel): MotionSample[] {
  const T = 1000 / (sensor.rateHz * (1 + uniform(r, -sensor.rateTolerance, sensor.rateTolerance)));
  const phase = r() * T;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: MotionSample[] = [];
  const sub = 4;
  let lastT = -Infinity;
  for (let s = phase; s < durationMs; s += T) {
    const w: Vec3 = [0, 0, 0];
    const a: Vec3 = [0, 0, 0];
    for (let j = 0; j < sub; j++) {
      const tt = s - (T * (j + 0.5)) / sub;
      for (const g of sorted) {
        if (g.start > tt) break;
        const tau = tt - g.start;
        if (tau < 0 || tau >= g.dur) continue;
        const v = g.f(tau);
        for (let i = 0; i < 3; i++) {
          w[i] += (v.w * g.axis[i]) / sub;
          a[i] += (v.a * g.accDir[i]) / sub;
        }
      }
    }
    if (r() < sensor.dropProb) continue;
    let t = s + sensor.latency + gauss(r) * sensor.jitterSd;
    if (t <= lastT) t = lastT + 0.1;
    lastT = t;
    out.push({
      t,
      ax: a[0] + gauss(r) * sensor.accNoise,
      ay: a[1] + gauss(r) * sensor.accNoise,
      az: a[2] + gauss(r) * sensor.accNoise,
      gx: w[0] + gauss(r) * sensor.gyroNoise,
      gy: w[1] + gauss(r) * sensor.gyroNoise,
      gz: w[2] + gauss(r) * sensor.gyroNoise,
    });
  }
  return out;
}

export interface RingSession {
  samples: MotionSample[];
  /** True physical ring moments (sensor time base, before sensor latency). */
  rings: number[];
  beats: number[];
  axis: Vec3;
  durationMs: number;
}

/** A scripted metronome session: one ring per beat, with return swings in between. */
export function ringSession(seed: number, prof: RingerProfile, count: number, bpm: number, sensor: SensorModel): RingSession {
  const r = rng(seed);
  const period = 60_000 / bpm;
  const axis = unitNear(r, [1, 0, 0], 0.2);
  const accDir = unitNear(r, [0, 0, 1], 0.2);
  const segs: Segment[] = [];
  const rings: number[] = [];
  const beats: number[] = [];
  const t0 = 2000;
  for (let i = 0; i < count; i++) {
    beats.push(t0 + i * period);
    rings.push(t0 + i * period + gauss(r) * prof.timingSd);
  }
  for (let i = 0; i < count; i++) {
    const ring = rings[i];
    const seg = ringSegment(r, ring, prof, unitNear(r, axis, 15), unitNear(r, accDir, 15));
    segs.push(seg);
    // The bell must be back in the ready position before the next stroke starts.
    const retStart = seg.start + seg.dur + uniform(r, 40, 120);
    const nextStart = i + 1 < count ? rings[i + 1] - 280 : retStart + 600;
    segs.push(returnSegment(r, retStart, nextStart - retStart - 40, prof, unitNear(r, axis, 15), accDir));
  }
  const durationMs = t0 + count * period + 1000;
  return { samples: sample(r, segs, durationMs, sensor), rings, beats, axis, durationMs };
}

/** Non-ringing handling of the phone: everything that must NOT ring. */
export function distractorSession(seed: number, durationMs: number, sensor: SensorModel): { samples: MotionSample[]; counts: Record<Distractor, number> } {
  const r = rng(seed);
  const kinds: Distractor[] = ['tilt', 'wave', 'pickup', 'walk', 'bump'];
  const counts: Record<Distractor, number> = { tilt: 0, wave: 0, pickup: 0, walk: 0, bump: 0 };
  const segs: Segment[] = [];
  let t = 500;
  while (t < durationMs - 6000) {
    const k = kinds[Math.floor(r() * kinds.length)];
    const seg = distractorSegment(r, k, t);
    segs.push(seg);
    counts[k]++;
    t += seg.dur + uniform(r, 300, 1500);
  }
  return { samples: sample(r, segs, durationMs, sensor), counts };
}

/** Two phones experiencing the same impacts (clink test). */
export function clinkSession(seed: number, count: number, sensor: SensorModel): { a: MotionSample[]; b: MotionSample[]; impacts: number[]; durationMs: number } {
  const r = rng(seed);
  const impacts: number[] = [1500];
  for (let i = 1; i < count; i++) impacts.push(impacts[i - 1] + uniform(r, 900, 1600));
  const durationMs = impacts[impacts.length - 1] + 1500;
  const segsA = impacts.map((t) => impactSegment(r, t));
  const segsB = impacts.map((t) => impactSegment(r, t));
  return { a: sample(rng(seed + 1), segsA, durationMs, sensor), b: sample(rng(seed + 2), segsB, durationMs, sensor), impacts, durationMs };
}
