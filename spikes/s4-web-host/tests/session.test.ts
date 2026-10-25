import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../src/audio/engine';
import type { Chart } from '../src/core/chart';
import { Session, type SessionHud, type SessionRenderer } from '../src/game/session';
import type { GestureSink, InputSource } from '../src/input/types';

// A session on a fake clock: AudioContext time = performance.now() / 1000, song time 0 at 3 s.
function setup(missGraceMs?: number) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const audio = {
    ctx: { get currentTime() { return now / 1000; } },
    clock: { update() {}, contextTimeAt: (perf: number) => perf / 1000 },
    prepare() {},
    bell() {},
  } as unknown as AudioEngine;
  const renderer = { setChart() {}, press() {}, hit() {}, miss() {}, setFire() {}, frame() {}, bufferSize: { width: 1, height: 1 }, gpu: '' } as unknown as SessionRenderer;
  const hud: SessionHud = { reset() {}, judgement() {}, update() {} };
  let sink: GestureSink = () => {};
  const phone: InputSource = { id: 'hgp', start: (s) => (sink = s), stop() {} };
  const chart: Chart = {
    title: 't',
    lanes: [{ index: 0, pitch: 72, name: 'C5' }],
    notes: [{ id: 0, time: 1, lane: 0, pitch: 72, velocity: 100 }],
    backing: [],
    beatTimes: [0],
    beatsPerBar: 4,
    bpm: 120,
    duration: 2,
    droppedPitches: [],
  };
  const s = new Session('play', chart, audio, renderer, hud, [phone], { visualMs: 0, inputMs: 0 }, { leadIn: 3, missGraceMs });
  s.start();
  return {
    s,
    /** Run one rAF frame whose work starts at `perf` ms. */
    frame: (perf: number) => {
      now = perf;
      s.frame(perf);
    },
    /** A ring struck at `sourcePerf`, handled by the page at `atPerf`. */
    ring: (sourcePerf: number, atPerf: number) => {
      now = atPerf;
      sink({ source: 'hgp', deviceId: 'p', gesture: 'ring', lane: 0, hostTimeMs: sourcePerf, receivedAtMs: atPerf });
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('session miss sweep', () => {
  // The note is at song 1 s = perf 4000 ms; the good window is ±140 ms.
  it('without grace, a ring arriving 200 ms after the window closed is a stray (S4 keyboard behaviour)', () => {
    const { s, frame, ring } = setup();
    frame(4100);
    frame(4300); // sweeps up to the previous frame start (4100): still inside the window
    frame(4400); // sweeps up to 4300 > 4140: miss
    ring(4020, 4410);
    expect(s.judge.state.counts.miss).toBe(1);
    expect(s.judge.state.strays).toBe(1);
  });

  it('with grace, a late-arriving ring is judged on its source time', () => {
    const { s, frame, ring } = setup(250);
    frame(4100);
    frame(4300);
    frame(4380);
    ring(4020, 4385); // 365 ms in flight (Wi-Fi power save + busy PC)
    frame(4600);
    expect(s.judge.state.counts.perfect).toBe(1);
    expect(s.judge.state.counts.miss).toBe(0);
    expect(s.judge.state.strays).toBe(0);
  });

  it('a ring queued behind a long frame still hits: the sweep lags one frame', () => {
    const { s, frame, ring } = setup(0);
    frame(4000);
    frame(4700); // the frame starting at 4000 took 700 ms; it sweeps only up to 4000
    ring(4030, 4705); // arrived during the long frame, handled after this rAF callback
    expect(s.judge.state.counts.perfect).toBe(1);
    expect(s.judge.state.strays).toBe(0);
  });

  it('still counts the miss once the grace has passed', () => {
    const { s, frame } = setup(250);
    frame(4300);
    frame(4380); // up to 4300 - 250 = 4050: not yet
    expect(s.judge.state.counts.miss).toBe(0);
    frame(4500); // up to 4380 - 250 = 4130 < 4140: not yet
    expect(s.judge.state.counts.miss).toBe(0);
    frame(4600); // up to 4500 - 250 = 4250: miss
    expect(s.judge.state.counts.miss).toBe(1);
  });
});
