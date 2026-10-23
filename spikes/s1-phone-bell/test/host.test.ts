import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeMetronome, analyzeClink } from '../src/host/analysis.ts';
import { analyzeOnsets, encodeWav } from '../src/core/onsets.ts';
import { rng, gauss } from '../sim/synth.ts';

test('onsets: knock -> 2 kHz beep delays are recovered within 3 ms', () => {
  const sr = 48000;
  const r = rng(5);
  const x = new Float32Array(sr * 12);
  for (let i = 0; i < x.length; i++) x[i] = 0.002 * gauss(r);
  const delays = [37, 52, 41, 120, 66, 45, 38, 90, 55, 47];
  for (let k = 0; k < delays.length; k++) {
    const knock = Math.round((0.5 + k) * sr);
    for (let i = 0; i < sr * 0.03; i++) x[knock + i] += 0.5 * gauss(r) * Math.exp(-i / (sr * 0.004));
    const beep = knock + Math.round((delays[k] / 1000) * sr);
    for (let i = 0; i < sr * 0.08; i++) x[beep + i] += 0.3 * Math.sin((2 * Math.PI * 2000 * i) / sr);
  }
  const res = analyzeOnsets(x, sr, 2000);
  assert.equal(res.knocks.length, delays.length, `knocks ${res.knocks}`);
  assert.equal(res.pairs.length, delays.length, `tones ${res.tones}`);
  res.pairs.forEach((p, i) => assert.ok(Math.abs(p.delay - delays[i]) <= 3, `pair ${i}: ${p.delay} vs ${delays[i]}`));
  assert.equal(encodeWav(x.subarray(0, 10), sr).byteLength, 44 + 20);
});

test('analyzeMetronome scores detection, extras, offsets and arrival delay', () => {
  const beats = Array.from({ length: 10 }, (_, i) => 1000 + i * 750);
  const dev = { id: 'a', name: 'A' };
  const gs = beats
    .filter((_, i) => i !== 3)
    .map((b, i) => ({ deviceId: 'a', g: 'ring', seq: i + 1, th: b + 20, rx: b + 30, via: 'ws' }));
  gs.push({ deviceId: 'a', g: 'ring', seq: 99, th: 1000 + 3.5 * 750, rx: 0, via: 'ws' });
  const [r] = analyzeMetronome(beats, 750, [dev], gs);
  assert.equal(r.detected, 9);
  assert.equal(r.extra, 1);
  assert.equal(r.offset.p50, 20);
  assert.equal(r.spread.p95, 0);
  assert.ok(r.seqGaps > 0);
});

test('analyzeClink pairs impacts across phones', () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const gs = [1000, 2000, 3000].flatMap((t, i) => [
    { deviceId: 'a', g: 'impact', seq: i, th: t, rx: t, via: 'ws' },
    { deviceId: 'b', g: 'impact', seq: i, th: t + 5, rx: t, via: 'ws' },
  ]);
  const [r] = analyzeClink([a, b], gs, 0, 5000);
  assert.equal(r.paired, 3);
  assert.equal(r.diff.p50, 5);
});

test('analyzeMetronome scores multi-bell selection (right bell, touch lead)', () => {
  const beats = [1000, 2000, 3000, 4000];
  const expect = { a: ['C5', 'D5', 'E5', 'F5'] };
  const bells = ['C5', 'D5', 'C5', 'F5'];
  const leads = [300, 250, -20, 400];
  const gs = beats.map((b, i) => ({ deviceId: 'a', g: 'ring', seq: i + 1, th: b, rx: b, via: 'ws', bell: bells[i], lead: leads[i] }));
  const [r] = analyzeMetronome(beats, 1000, [{ id: 'a', name: 'A' }], gs, expect);
  assert.equal(r.rightBell, 3);
  assert.equal(r.lateTouches, 1);
  assert.equal(r.lead?.p50, 275);
});
