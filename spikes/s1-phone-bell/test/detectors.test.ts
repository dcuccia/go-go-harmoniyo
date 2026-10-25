import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImpactDetector } from '../src/core/impact-detector.ts';
import { matchNearest } from '../src/core/match.ts';
import { adaptParams, DEFAULT_RING_PARAMS, expectedIoi, learnAxis, RingDetector, type MotionSample, type StrikeEvent, type Vec3 } from '../src/core/ring-detector.ts';
import { cueContext, detectWithContext } from '../sim/fast-rings.ts';
import { distractorSession, noteSession, passageBeats, RINGERS, ringSession, SENSOR_60HZ } from '../sim/synth.ts';

/** Angular speed profile along X: sin² rise to `peak` over `rise` ms, cos² stop over `stop` ms. */
function stroke(t0: number, peak: number, rise: number, stop: number, sign = 1, rate = 60): MotionSample[] {
  const out: MotionSample[] = [];
  const T = 1000 / rate;
  for (let t = t0 - 200; t < t0 + rise + stop + 300; t += T) {
    const tau = t - t0;
    let w = 0;
    if (tau >= 0 && tau < rise) w = peak * Math.sin(((Math.PI / 2) * tau) / rise) ** 2;
    else if (tau >= rise && tau < rise + stop) w = peak * Math.cos(((Math.PI / 2) * (tau - rise)) / stop) ** 2;
    out.push({ t, ax: 0, ay: 0, az: 0, gx: sign * w, gy: 0, gz: 0 });
  }
  return out;
}

function run(d: RingDetector, samples: MotionSample[]): StrikeEvent[] {
  return samples.map((s) => d.push(s)).filter((e): e is StrikeEvent => e !== null);
}

test('ring: one abrupt stroke -> one strike near the max-deceleration moment', () => {
  const d = new RingDetector();
  const evs = run(d, stroke(1000, 500, 150, 30));
  assert.equal(evs.length, 1);
  const truth = 1000 + 150 + 15;
  assert.ok(Math.abs(evs[0].t - truth) < 10, `t=${evs[0].t} truth=${truth}`);
  assert.ok(evs[0].firedAt >= evs[0].t);
  assert.deepEqual(evs[0].axis.map((v) => Math.round(v) + 0), [1, 0, 0]);
});

test('ring: smooth swing is rejected (not abrupt)', () => {
  const d = new RingDetector();
  assert.equal(run(d, stroke(1000, 400, 300, 300)).length, 0);
});

test('ring: calibrated axis ignores the opposite (return) direction', () => {
  const d = new RingDetector({ axis: [1, 0, 0] });
  assert.equal(run(d, stroke(1000, 500, 150, 30, -1)).length, 0);
  assert.equal(run(d, stroke(3000, 500, 150, 30, +1)).length, 1);
});

test('learnAxis picks the majority (forward) direction', () => {
  const mk = (sign: number, decel: number): StrikeEvent => ({ t: 0, firedAt: 0, peakOmega: 500, maxDecel: decel, peakAccel: 0, intensity: 0.5, axis: [sign, 0, 0] });
  const axis = learnAxis([mk(-1, 9000), mk(-1, 8000), mk(-1, 7000), mk(+1, 20000)]);
  assert.deepEqual(axis?.map((v) => Math.round(v) + 0), [-1, 0, 0]);
  assert.equal(learnAxis([mk(1, 1)]), null);
});

test('ring: synthetic adult session meets the S1 detection target (sim smoke)', () => {
  const sess = ringSession(1, RINGERS.adult, 120, 80, SENSOR_60HZ);
  const cal = run(new RingDetector(), sess.samples.filter((s) => s.t < sess.rings[7] + 300));
  const axis = learnAxis(cal);
  assert.ok(axis);
  const evs = run(new RingDetector({ axis }), sess.samples);
  const m = matchNearest(sess.rings, evs.map((e) => e.t), 120);
  assert.ok(m.pairs.length / sess.rings.length >= 0.98, `detected ${m.pairs.length}/${sess.rings.length}`);
  assert.ok(m.extra.length / sess.rings.length <= 0.02, `extra ${m.extra.length}`);
});

test('ring: distractors produce few false rings with a calibrated axis', () => {
  const d = distractorSession(3, 5 * 60_000, SENSOR_60HZ);
  const evs = run(new RingDetector({ axis: [1, 0, 0] }), d.samples);
  assert.ok(evs.length <= 3, `false rings: ${evs.length}`);
});

test('impact: one sharp spike -> one event at the midpoint of the bracketing samples', () => {
  const d = new ImpactDetector();
  const samples: MotionSample[] = [];
  for (let i = 0; i < 120; i++) {
    const t = i * 16.7;
    const a = i === 60 ? 20 : i === 61 ? 8 : 0.1 * Math.sin(i);
    samples.push({ t, ax: a, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 });
  }
  const evs = samples.map((s) => d.push(s)).filter((e) => e !== null);
  assert.equal(evs.length, 1);
  assert.ok(Math.abs(evs[0]!.t - (59.5 * 16.7)) < 1e-6);
});

// ── fast passages ───────────────────────────────────────────────────────────

/** Back-and-forth shake along X: alternating-sign strokes `ioi` ms apart, each stopping abruptly. */
function shake(t0: number, n: number, ioi: number, peak = 350, stop = 30, rate = 60): { samples: MotionSample[]; rings: number[] } {
  const T = 1000 / rate;
  const rings = Array.from({ length: n }, (_, i) => t0 + i * ioi);
  const samples: MotionSample[] = [];
  for (let t = t0 - 400; t < rings[n - 1] + 400; t += T) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      const rise = ioi - stop - 5;
      const tau = t - (rings[i] - stop / 2 - rise);
      const sign = i % 2 === 0 ? 1 : -1;
      if (tau >= 0 && tau < rise) w += sign * peak * Math.sin(((Math.PI / 2) * tau) / rise) ** 2;
      else if (tau >= rise && tau < rise + stop) w += sign * peak * Math.cos(((Math.PI / 2) * (tau - rise)) / stop) ** 2;
    }
    samples.push({ t, ax: 0, ay: 0, az: 0, gx: w, gy: 0, gz: 0 });
  }
  return { samples, rings };
}

test('adaptParams: Normal outside fast passages is exactly the S1 defaults', () => {
  const base = { ...DEFAULT_RING_PARAMS, axis: [1, 0, 0] as Vec3 };
  assert.equal(adaptParams(base, {}), base);
  assert.equal(adaptParams(base, { sensitivity: 'normal', ioiMs: 600 }), base);
  assert.equal(adaptParams(base, { sensitivity: 'normal', ioiMs: null }), base);
});

test('adaptParams: fast passage shortens the refractory with the IOI, enables both directions, never raises thresholds', () => {
  const base = { ...DEFAULT_RING_PARAMS, axis: [1, 0, 0] as Vec3 };
  const p = adaptParams(base, { sensitivity: 'normal', ioiMs: 125 });
  assert.equal(p.bidirectional, true);
  assert.ok(p.refractoryMs < 100 && p.refractoryMs >= 65, `refractory ${p.refractoryMs}`);
  assert.ok(p.minDecel < base.minDecel && p.minPeakOmega < base.minPeakOmega);
  // Uncalibrated: |ω| is already direction-agnostic, so no bidirectional flag.
  assert.equal(adaptParams({ ...base, axis: null }, { ioiMs: 125 }).bidirectional, false);
  // A stricter manual override stays stricter.
  assert.equal(adaptParams({ ...base, minDecel: 2000 }, { ioiMs: 125 }).minDecel, 2000);
  // Quick lowers thresholds even without a fast passage, but keeps the return swing ignored.
  const q = adaptParams(base, { sensitivity: 'quick' });
  assert.ok(q.minDecel < base.minDecel && q.bidirectional === false);
});

test('expectedIoi: the shortest local gap around now, null between phrases', () => {
  const notes = [1000, 1600, 2200, 2350, 2500, 2650, 3400];
  assert.equal(expectedIoi(notes, 1300), 600);
  assert.equal(expectedIoi(notes, 2400), 150);
  assert.equal(expectedIoi(notes, 2000), 150); // within the 250 ms lead of the run
  assert.equal(expectedIoi(notes, 6000), null);
  assert.equal(expectedIoi([1000, 1010, 1200], 1100), 200); // a chord counts once (from its first note)
});

test('ring: a 16th-note shake (125 ms) — S1 defaults catch at most every other ring; the fast context catches them all', () => {
  const { samples, rings } = shake(1000, 16, 125);
  const before = run(new RingDetector({ axis: [1, 0, 0] }), samples);
  assert.ok(before.length <= 8, `before ${before.length}`);
  const d = new RingDetector({ axis: [1, 0, 0] });
  d.setContext({ sensitivity: 'normal', ioiMs: 125 });
  const after = run(d, samples);
  const m = matchNearest(rings, after.map((e) => e.t), 60);
  assert.ok(m.pairs.length >= 15, `after ${m.pairs.length}/16`);
  assert.ok(m.extra.length <= 1, `extra ${m.extra.length}`);
});

test('ring: in a fast passage a small rebound after a ring is not a second ring', () => {
  // One forward ring, then a rebound backward at 30 % of its peak.
  const s = stroke(1000, 400, 120, 30);
  const d = new RingDetector({ axis: [1, 0, 0] });
  d.setContext({ ioiMs: 150 });
  const merged = [...s.filter((x) => x.t < 1000 + 150 + 5), ...stroke(1000 + 150 + 5, 120, 30, 20, -1).filter((x) => x.t >= 1000 + 150 + 5)];
  assert.equal(run(d, merged).length, 1);
});

test('ring: fast passages and Quick keep false rings low on non-ringing handling (S1 test B)', () => {
  const d = distractorSession(3, 5 * 60_000, SENSOR_60HZ);
  const quick = new RingDetector({ axis: [1, 0, 0] });
  quick.setContext({ sensitivity: 'quick' });
  assert.ok(run(quick, d.samples).length <= 3, 'quick');
});

test('ring: fast-passage sim smoke (8ths at 120 bpm, shake) — detection up, false rings low', () => {
  const { times } = passageBeats(120, 2, 4);
  const sess = noteSession(5, RINGERS.adult, times, 'shake', SENSOR_60HZ);
  const before = detectWithContext(sess.samples, { axis: sess.axis }, null);
  const after = detectWithContext(sess.samples, { axis: sess.axis }, cueContext('normal', times));
  const mb = matchNearest(sess.rings, before.map((e) => e.t), 100);
  const ma = matchNearest(sess.rings, after.map((e) => e.t), 100);
  assert.ok(mb.pairs.length / sess.rings.length < 0.75, `before ${mb.pairs.length}/${sess.rings.length}`);
  assert.ok(ma.pairs.length / sess.rings.length >= 0.9, `after ${ma.pairs.length}/${sess.rings.length}`);
  assert.ok(ma.extra.length / sess.rings.length <= 0.08, `extra ${ma.extra.length}`);
});