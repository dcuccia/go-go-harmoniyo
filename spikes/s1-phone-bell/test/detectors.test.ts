import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImpactDetector } from '../src/core/impact-detector.ts';
import { matchNearest } from '../src/core/match.ts';
import { learnAxis, RingDetector, type MotionSample, type StrikeEvent } from '../src/core/ring-detector.ts';
import { distractorSession, RINGERS, ringSession, SENSOR_60HZ } from '../sim/synth.ts';

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
