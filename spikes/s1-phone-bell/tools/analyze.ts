/**
 * Offline re-analysis of recorded phone traces: replay raw motion through the ring detector
 * with different thresholds and score against the metronome beats of a recorded test.
 *
 *   npm run analyze -- data/<session> [--minDecel 4500 --minPeakOmega 200 ...] [--any-axis]
 *                      [--sens normal|quick] [--ioi 125]   (fast-passage context, e.g. a fast metronome)
 *
 * Prints per-device sensor statistics (rate, interval jitter, gaps) and detection results.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { matchNearest } from '../src/core/match.ts';
import { DEFAULT_RING_PARAMS, isSensitivity, learnAxis, RingDetector, type RingContext, type MotionSample, type RingDetectorParams, type StrikeEvent } from '../src/core/ring-detector.ts';
import { centeredAbs, fmt, summarize } from '../src/core/stats.ts';

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    armOmega: { type: 'string' },
    minPeakOmega: { type: 'string' },
    minDecel: { type: 'string' },
    releaseRatio: { type: 'string' },
    rearmOmega: { type: 'string' },
    refractoryMs: { type: 'string' },
    'any-axis': { type: 'boolean', default: false },
    sens: { type: 'string' },
    ioi: { type: 'string' },
  },
});
const dir = positionals[0];
if (!dir) {
  console.error('usage: npm run analyze -- data/<session> [--minDecel N ...]');
  process.exit(1);
}

const overrides: Partial<RingDetectorParams> = {};
for (const k of ['armOmega', 'minPeakOmega', 'minDecel', 'releaseRatio', 'rearmOmega', 'refractoryMs'] as const) {
  const v = a[k];
  if (v !== undefined) overrides[k] = Number(v);
}

const context: RingContext = { sensitivity: isSensitivity(a.sens) ? a.sens : 'normal', ioiMs: a.ioi ? Number(a.ioi) : null };

const files = readdirSync(dir);
const metronomes = files
  .filter((f) => f.startsWith('results-metronome-'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { test: { id: string; beats: number[]; period: number } });

console.log(`Session ${dir}; detector ${JSON.stringify({ ...DEFAULT_RING_PARAMS, ...overrides, axis: a['any-axis'] ? 'any' : 'learned' })}; context ${JSON.stringify(context)}\n`);
console.log('| Device | samples | rate (Hz) | Δt p50 / p95 / max (ms) | gaps >50 ms | test | detected | extra | spread p95 (ms) |');
console.log('|---|---|---|---|---|---|---|---|---|');

for (const f of files.filter((x) => x.startsWith('raw-'))) {
  const id = f.slice(4, -'.ndjson'.length);
  const samples: (MotionSample & { off: number })[] = [];
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const b = JSON.parse(line) as { off: number; s: number[][] };
    for (const r of b.s) samples.push({ t: r[0], ax: r[1], ay: r[2], az: r[3], gx: r[4], gy: r[5], gz: r[6], off: b.off });
  }
  samples.sort((x, y) => x.t - y.t);
  const dts = samples.slice(1).map((s, i) => s.t - samples[i].t);
  const iv = summarize(dts.filter((d) => d < 1000));
  const gaps = dts.filter((d) => d > 50 && d < 1000).length;
  const rate = 1000 / iv.p50;

  const run = (params: Partial<RingDetectorParams>, ss: readonly (MotionSample & { off: number })[]) => {
    const d = new RingDetector(params);
    if (params.axis !== null) d.setContext(context);
    const out: (StrikeEvent & { th: number })[] = [];
    for (const s of ss) {
      const e = d.push(s);
      if (e) out.push({ ...e, th: e.t + s.off });
    }
    return out;
  };
  let axis: RingDetectorParams['axis'] = null;
  if (!a['any-axis']) {
    // learn from the first 8 strikes of the whole recording
    axis = learnAxis(run({ ...overrides, axis: null }, samples).slice(0, 8));
  }
  const evs = run({ ...overrides, axis }, samples);
  if (metronomes.length === 0) {
    console.log(`| ${id} | ${samples.length} | ${fmt(rate)} | ${fmt(iv.p50)} / ${fmt(iv.p95)} / ${fmt(iv.max)} | ${gaps} | – | ${evs.length} strikes | – | – |`);
  }
  for (const m of metronomes) {
    const lo = m.test.beats[0] - m.test.period / 2;
    const hi = m.test.beats[m.test.beats.length - 1] + m.test.period / 2;
    const ths = evs.filter((e) => e.th >= lo && e.th <= hi).map((e) => e.th);
    if (!samples.some((s) => s.t + s.off >= lo && s.t + s.off <= hi)) continue;
    const r = matchNearest(m.test.beats, ths, Math.min(m.test.period * 0.45, 300));
    const spread = summarize(centeredAbs(r.pairs.map((p) => p.diff)));
    console.log(
      `| ${id} | ${samples.length} | ${fmt(rate)} | ${fmt(iv.p50)} / ${fmt(iv.p95)} / ${fmt(iv.max)} | ${gaps} | ${m.test.id} | ${r.pairs.length}/${m.test.beats.length} | ${r.extra.length} | ${fmt(spread.p95)} |`,
    );
  }
}
