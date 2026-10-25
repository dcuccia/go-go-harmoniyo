/**
 * Fast repeated rings (eighth / sixteenth notes): how fast can a phone ring, before and after the
 * adaptive detector (ring-detector.ts `adaptParams`). Synthetic data only.
 *   npm run sim:fast        (this section alone)
 *   npm run sim             (part of results/sim-results.md)
 */
import { pathToFileURL } from 'node:url';
import { matchNearest } from '../src/core/match.ts';
import { DEFAULT_RING_PARAMS, expectedIoi, RingDetector, type MotionSample, type RingContext, type RingDetectorParams, type Sensitivity, type StrikeEvent } from '../src/core/ring-detector.ts';
import { fmt } from '../src/core/stats.ts';
import { distractorSession, noteSession, passageBeats, RINGERS, ringSession, SENSOR_100HZ, SENSOR_200HZ, SENSOR_60HZ, type FastTechnique, type SensorModel } from './synth.ts';

/** Before = S1 defaults (no context); after = adaptive, Normal or Quick, with the chart's note times as cues. */
export type Variant = 'before' | Sensitivity;
export const VARIANTS: Variant[] = ['before', 'normal', 'quick'];
const LABEL: Record<Variant, string> = { before: 'Before (S1 defaults)', normal: 'After · Normal', quick: 'After · Quick' };
const PROFILES = Object.keys(RINGERS) as (keyof typeof RINGERS)[];

export function detectWithContext(samples: readonly MotionSample[], params: Partial<RingDetectorParams>, ctxAt: ((t: number) => RingContext) | null): StrikeEvent[] {
  const d = new RingDetector(params);
  const out: StrikeEvent[] = [];
  let lastCtx = -Infinity;
  for (const s of samples) {
    // The phone refreshes its context every ~50 ms (controller.ts); do the same here.
    if (ctxAt && s.t - lastCtx >= 50) {
      d.setContext(ctxAt(s.t));
      lastCtx = s.t;
    }
    const e = d.push(s);
    if (e) out.push(e);
  }
  return out;
}

/** Cue-driven context: what the phone knows from `cues` (its note times) and its lobby sensitivity. */
export function cueContext(v: Variant, notes: readonly number[]): ((t: number) => RingContext) | null {
  if (v === 'before') return null;
  return (t) => ({ sensitivity: v, ioiMs: expectedIoi(notes, t) });
}

interface Score {
  truth: number;
  matched: number;
  fastTruth: number;
  fastMatched: number;
  extra: number;
}
const empty = (): Score => ({ truth: 0, matched: 0, fastTruth: 0, fastMatched: 0, extra: 0 });
const pct = (a: number, b: number): string => (b ? `${fmt((100 * a) / b)} %` : '–');

function scoreSession(beats: readonly number[], fast: readonly boolean[], technique: FastTechnique, sensor: SensorModel, v: Variant, seed: number, acc: Score): void {
  for (const prof of PROFILES) {
    const sess = noteSession(seed + prof.length * 31, RINGERS[prof], beats, technique, sensor);
    const evs = detectWithContext(sess.samples, { axis: sess.axis }, cueContext(v, beats));
    let minGap = Infinity;
    for (let i = 1; i < beats.length; i++) minGap = Math.min(minGap, beats[i] - beats[i - 1]);
    // Detected times carry the sensor latency (~+16 ms at 60 Hz): match within half the shortest IOI.
    const m = matchNearest(sess.rings, evs.map((e) => e.t), Math.max(40, Math.min(120, 0.5 * minGap)));
    acc.truth += sess.rings.length;
    acc.matched += m.pairs.length;
    acc.extra += m.extra.length;
    const hit = new Set(m.pairs.map((p) => p.refIndex));
    fast.forEach((f, i) => {
      if (!f) return;
      acc.fastTruth++;
      if (hit.has(i)) acc.fastMatched++;
    });
  }
}

export function fastRingsReport(log: (s?: string) => void, quick = false): void {
  const seeds = quick ? 1 : 3;
  log('## 5. Fast repeated rings (eighth and sixteenth notes)');
  log();
  log(
    'Owner feedback (4-player session): several rings in quick succession are hard. Model: notes at least 500 ms apart are a full ring + smooth return (as above); closer notes are played either as a **shake** (back-and-forth, both halves stop abruptly — how ringers play fast repeated notes on one bell) or as **flicks** (small forward strokes with a quick smooth return). Fast strokes peak lower (adult 260–520, child 170–320 deg/s) and timing jitter scales with the IOI. Calibrated axis throughout. *Before* = S1 detector as shipped; *After* = adaptive detector fed the phone\'s cues (its note times, `expectedIoi`) and its lobby sensitivity (`adaptParams`). Detected = rings matched one-to-one within ±min(120 ms, IOI/2); False = unmatched detections per true ring. 3 ringer profiles pooled.',
  );
  log();

  // 5a: maximum ring rate.
  const iois = [500, 400, 300, 250, 214, 188, 167, 150, 125, 107, 94];
  log('### 5a. Maximum ring rate: one bar of quarters, then 24 notes at a constant IOI (fast notes detected)');
  log();
  log(`| Sensor | Technique | Detector | ${iois.map((x) => `${x} ms`).join(' | ')} | Max ring rate (this IOI and all slower: ≥ 90 % detected, ≤ 5 % false) |`);
  log(`|---|---|---|${iois.map(() => '---').join('|')}|---|`);
  for (const sensor of [SENSOR_60HZ, SENSOR_100HZ, SENSOR_200HZ]) {
    for (const technique of ['shake', 'flick'] as FastTechnique[]) {
      for (const v of VARIANTS) {
        let fastest = '–';
        let sustained = true;
        const cells = iois.map((ioi) => {
          const acc = empty();
          for (let k = 0; k < seeds; k++) {
            const q = 600;
            const beats = [...[0, 1, 2, 3].map((i) => 2000 + i * q), ...Array.from({ length: 24 }, (_, i) => 2000 + 4 * q + i * ioi)];
            const fast = beats.map((_, i) => i >= 4);
            scoreSession(beats, fast, technique, sensor, v, 7000 + k * 101 + ioi, acc);
          }
          const det = acc.fastMatched / acc.fastTruth;
          sustained &&= det >= 0.9 && acc.extra / acc.truth <= 0.05;
          if (sustained) fastest = `${ioi} ms (${fmt(1000 / ioi, 1)} rings/s)`;
          return `${fmt(100 * det)}${acc.extra / acc.truth > 0.05 ? ` (+${fmt((100 * acc.extra) / acc.truth)} false)` : ''}`;
        });
        log(`| ${sensor.rateHz} Hz | ${technique} | ${LABEL[v]} | ${cells.join(' | ')} | ${fastest} |`);
      }
    }
  }
  log();
  log('IOI → tempo: 300 ms = 8ths at 100 bpm, 250 = 8ths at 120, 214 = 8ths at 140, 150 = 16ths at 100, 125 = 16ths at 120, 107 = 16ths at 140. Cells show fast-note detection % (and false % when over 5 %).');
  log();

  // 5b: musical passages.
  log('### 5b. Passages: one bar of quarters + one bar of 8ths or 16ths, ×6 phrases');
  log();
  log('| Sensor | Passage | Technique | ' + VARIANTS.map((v) => `${LABEL[v]}: fast notes / all notes / false`).join(' | ') + ' |');
  log('|---|---|---|' + VARIANTS.map(() => '---').join('|') + '|');
  for (const sensor of [SENSOR_60HZ, SENSOR_200HZ]) {
    for (const sub of [2, 4] as const) {
      for (const bpm of [100, 120, 140]) {
        for (const technique of (sub === 2 ? ['shake', 'flick'] : ['shake']) as FastTechnique[]) {
          const cells = VARIANTS.map((v) => {
            const acc = empty();
            for (let k = 0; k < seeds; k++) {
              const { times, fast } = passageBeats(bpm, sub, 6);
              scoreSession(times, fast, technique, sensor, v, 9000 + k * 53 + bpm + sub, acc);
            }
            return `${pct(acc.fastMatched, acc.fastTruth)} / ${pct(acc.matched, acc.truth)} / ${pct(acc.extra, acc.truth)}`;
          });
          log(`| ${sensor.rateHz} Hz | ${sub === 2 ? '8ths' : '16ths'} at ${bpm} bpm | ${technique} | ${cells.join(' | ')} |`);
        }
      }
    }
  }
  log();

  // 5c: false rings must stay low (S1 test B) and slow ringing must not regress.
  log('### 5c. False rings and slow-ringing regression (60 Hz)');
  log();
  log('Test B model: 30 min of non-ringing handling (tilts, waves, pick-ups, walking, bumps) per cell, no cues (lobby / between songs). *Fast forced* = the context says IOI 125 ms the whole time (worst case: a host sending only a song-wide hint, no cues). Slow metronome = section 2 sessions (72–96 bpm, 600 rings per profile) with the context set.');
  log();
  log('| Context | Distractor FP/min (calibrated) | Distractor FP/min (uncalibrated) | Slow metronome detected | Slow metronome false |');
  log('|---|---|---|---|---|');
  const contexts: [string, RingContext | null][] = [
    ['Before (S1 defaults)', null],
    ['Normal, no cues', { sensitivity: 'normal' }],
    ['Quick, no cues', { sensitivity: 'quick' }],
    ['Normal, fast forced (IOI 125 ms)', { sensitivity: 'normal', ioiMs: 125 }],
    ['Quick, fast forced (IOI 125 ms)', { sensitivity: 'quick', ioiMs: 125 }],
  ];
  for (const [name, ctx] of contexts) {
    const fp = (axis: boolean): string => {
      let n = 0;
      let minutes = 0;
      for (let k = 0; k < (quick ? 1 : 3); k++) {
        const durationMs = 10 * 60_000;
        const d = distractorSession(500 + k, durationMs, SENSOR_60HZ);
        n += detectWithContext(d.samples, axis ? { axis: [1, 0, 0] } : {}, ctx ? () => ctx : null).length;
        minutes += durationMs / 60_000;
      }
      return fmt(n / minutes, 2);
    };
    let truth = 0;
    let matched = 0;
    let extra = 0;
    for (const prof of PROFILES) {
      for (let k = 0; k < (quick ? 1 : 4); k++) {
        const sess = ringSession(1000 + k * 17 + prof.length, RINGERS[prof], 150, 72 + k * 8, SENSOR_60HZ);
        const evs = detectWithContext(sess.samples, { axis: sess.axis }, ctx ? () => ctx : null);
        const m = matchNearest(sess.rings, evs.map((e) => e.t), 120);
        truth += sess.rings.length;
        matched += m.pairs.length;
        extra += m.extra.length;
      }
    }
    log(`| ${name} | ${fp(true)} | ${fp(false)} | ${pct(matched, truth)} | ${pct(extra, truth)} |`);
  }
  log();
  log(`Thresholds in effect: S1 defaults armOmega ${DEFAULT_RING_PARAMS.armOmega}, minPeak ${DEFAULT_RING_PARAMS.minPeakOmega}, minDecel ${DEFAULT_RING_PARAMS.minDecel}, refractory ${DEFAULT_RING_PARAMS.refractoryMs} ms; see \`adaptParams\` in src/core/ring-detector.ts for Quick and fast-passage values.`);
  log();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lines: string[] = [];
  fastRingsReport((s = '') => lines.push(s), process.argv.includes('--quick'));
  console.log(lines.join('\n'));
}
