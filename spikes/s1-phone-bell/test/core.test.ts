import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClockSync, samplePoint } from '../src/core/clock-sync.ts';
import { matchNearest } from '../src/core/match.ts';
import { quantile, summarize } from '../src/core/stats.ts';

test('quantile interpolates', () => {
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.95), 4.8);
  assert.ok(Number.isNaN(quantile([], 0.5)));
  const s = summarize([3, 1, 2, NaN]);
  assert.equal(s.n, 3);
  assert.equal(s.p50, 2);
});

test('matchNearest pairs closest first, reports misses and extras', () => {
  const m = matchNearest([1000, 2000, 3000], [1010, 1990, 2005, 5000], 50);
  assert.deepEqual(
    m.pairs.map((p) => [p.refIndex, p.evIndex]),
    [
      [0, 0],
      [1, 2],
    ],
  );
  assert.deepEqual(m.missed, [2]);
  assert.deepEqual(m.extra, [1, 3]);
});

test('samplePoint: symmetric path gives exact offset', () => {
  // device clock = host + 1000; one-way 5 ms each way, host processing 1 ms
  const p = samplePoint({ t0: 1000, t1: 5, t2: 6, t3: 1011 });
  assert.equal(p.offset, -1000);
  assert.equal(p.rtt, 10);
});

test('ClockSync rejects slow exchanges via min-RTT filtering', () => {
  const sync = new ClockSync();
  const off = 5000; // host = local + 5000
  // good exchange (rtt 4, symmetric)
  sync.add({ t0: 0, t1: 2 + off, t2: 2 + off, t3: 4 });
  // power-save spike on the uplink only (would bias by +50 ms if trusted)
  sync.add({ t0: 100, t1: 202 + off, t2: 202 + off, t3: 204 });
  assert.equal(Math.round(sync.offsetAt(200)), off);
});

test('ClockSync tracks drift and inverts', () => {
  const sync = new ClockSync();
  const drift = 100e-6;
  const hostOf = (local: number) => local * (1 + drift) + 777;
  for (let local = 0; local < 60_000; local += 250) {
    const t1 = hostOf(local + 2);
    sync.add({ t0: local, t1, t2: t1 + 0.1, t3: local + 4.1 });
  }
  const at = 61_000;
  assert.ok(Math.abs(sync.toHost(at) - hostOf(at)) < 0.5, `err ${sync.toHost(at) - hostOf(at)}`);
  assert.ok(Math.abs(sync.toLocal(sync.toHost(at)) - at) < 1e-6);
  assert.ok(Math.abs(sync.estimate!.drift - drift) < 10e-6);
});

test('ClockSync resets after a clock jump', () => {
  const sync = new ClockSync();
  for (let i = 0; i < 20; i++) sync.add({ t0: i * 100, t1: i * 100 + 2, t2: i * 100 + 2, t3: i * 100 + 4 });
  assert.equal(Math.round(sync.offsetAt(2000)), 0);
  for (let i = 20; i < 25; i++) sync.add({ t0: i * 100, t1: i * 100 + 2 + 500, t2: i * 100 + 2 + 500, t3: i * 100 + 4 });
  assert.equal(Math.round(sync.offsetAt(2500)), 500);
});
