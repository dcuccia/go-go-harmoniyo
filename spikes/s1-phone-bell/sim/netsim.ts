import { ClockSync } from '../src/core/clock-sync.ts';
import { gauss, rng, uniform } from './synth.ts';

/** One-way delay model for a Wi-Fi/LAN/relay path. All ms. */
export interface NetProfile {
  name: string;
  upBase: number;
  downBase: number;
  /** mean of exponential jitter added to each direction */
  jitter: number;
  /** probability of a power-save / retransmit / airtime spike per packet */
  spikeProb: number;
  spike: [number, number];
  loss: number;
}

export const NET_PROFILES: NetProfile[] = [
  { name: 'LAN, quiet', upBase: 2, downBase: 1.5, jitter: 0.8, spikeProb: 0.02, spike: [10, 40], loss: 0 },
  { name: 'LAN, busy + power-save', upBase: 3, downBase: 2, jitter: 3, spikeProb: 0.15, spike: [20, 200], loss: 0.01 },
  { name: 'LAN, asymmetric (worst case)', upBase: 8, downBase: 1, jitter: 1.5, spikeProb: 0.05, spike: [20, 100], loss: 0 },
  { name: 'Cloud relay / tunnel', upBase: 22, downBase: 18, jitter: 4, spikeProb: 0.05, spike: [20, 150], loss: 0 },
];

export interface DeviceClock {
  offset: number;
  driftPpm: number;
  /** timer resolution, ms (Safari ~1 ms; Chrome 0.1 ms without cross-origin isolation) */
  resolution: number;
}

export function localTime(c: DeviceClock, host: number): number {
  const t = host * (1 + c.driftPpm * 1e-6) + c.offset;
  return Math.floor(t / c.resolution) * c.resolution;
}

function oneWay(r: () => number, base: number, p: NetProfile): number {
  let d = base - Math.log(Math.max(1e-12, r())) * p.jitter;
  if (r() < p.spikeProb) d += uniform(r, p.spike[0], p.spike[1]);
  return d;
}

export interface SyncSimResult {
  /** errors (device-estimated host time − true host time) sampled over the run, ms */
  errors: number[];
  rtts: number[];
  /** function returning the sync error at a host time (for composing with detector error) */
  errorAt: (host: number) => number;
}

/**
 * Simulate device-initiated ping/pong (burst at start, then every `intervalMs`) over `durationMs`
 * and measure the error of ClockSync.toHost at many instants.
 */
export function simulateSync(seed: number, net: NetProfile, clock: DeviceClock, durationMs: number, intervalMs = 250): SyncSimResult {
  const r = rng(seed);
  const sends: number[] = [];
  for (let i = 0; i < 10; i++) sends.push(i * 50);
  for (let t = 600; t < durationMs; t += intervalMs + gauss(r) * 5) sends.push(t);

  interface Arrival {
    h3: number;
    s: { t0: number; t1: number; t2: number; t3: number };
  }
  const arrivals: Arrival[] = [];
  const rtts: number[] = [];
  for (const h0 of sends) {
    if (r() < net.loss) continue;
    const h1 = h0 + oneWay(r, net.upBase, net);
    const h2 = h1 + 0.05;
    if (r() < net.loss) continue;
    const h3 = h2 + oneWay(r, net.downBase, net);
    const s = { t0: localTime(clock, h0), t1: h1, t2: h2, t3: localTime(clock, h3) };
    arrivals.push({ h3, s });
    rtts.push(s.t3 - s.t0 - (s.t2 - s.t1));
  }
  arrivals.sort((a, b) => a.h3 - b.h3);

  const sync = new ClockSync();
  const snapshots: { h: number; err: number }[] = [];
  const errors: number[] = [];
  let k = 0;
  for (let h = 0; h < durationMs; h += 20) {
    while (k < arrivals.length && arrivals[k].h3 <= h) sync.add(arrivals[k++].s);
    if (!sync.ready) continue;
    const err = sync.toHost(localTime(clock, h)) - h;
    snapshots.push({ h, err });
    if (h > 3000) errors.push(err);
  }
  const errorAt = (host: number): number => {
    let lo = 0;
    let hi = snapshots.length - 1;
    if (hi < 0) return NaN;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (snapshots[mid].h <= host) lo = mid;
      else hi = mid - 1;
    }
    return snapshots[lo].err;
  };
  return { errors, rtts, errorAt };
}
