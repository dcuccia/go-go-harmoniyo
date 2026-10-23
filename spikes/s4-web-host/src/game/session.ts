import type { Chart } from '../core/chart';
import { Judge, isJudgement, type Grade, type Judgement, type StrayRing } from '../core/judge';
import { Samples, roundSummary, round } from '../core/stats';
import type { AudioEngine } from '../audio/engine';
import type { HighwayRenderer } from '../render/highway';
import type { GestureEvent, InputSource } from '../input/types';
import type { Hud } from '../ui/hud';

export type Mode = 'play' | 'autoplay' | 'calibrate';

/** What a session needs from a renderer (a single highway, or a composite of several). */
export type SessionRenderer = Pick<HighwayRenderer, 'setChart' | 'press' | 'hit' | 'miss' | 'setFire' | 'frame' | 'bufferSize' | 'gpu'>;
export type SessionHud = Pick<Hud, 'reset' | 'judgement' | 'update'>;

export interface SessionOptions {
  /** Play the bell on the host when a player rings (default true). Off when phones sound locally. */
  hostRingSound?: boolean;
}

export interface Offsets {
  /** Shift visuals later (+) / earlier (−) relative to audio, ms. */
  visualMs: number;
  /** Player's habitual input lag (from tap calibration), subtracted from input times, ms. */
  inputMs: number;
}

interface Scheduled {
  time: number;
  play: (when: number) => void;
}

export interface SessionResult {
  mode: Mode;
  title: string;
  score: number;
  accuracy: number;
  counts: Record<Grade, number>;
  maxStreak: number;
  strays: number;
  calibration?: { taps: number; medianMs: number; madMs: number };
  metrics: Record<string, unknown>;
}

const LEAD_IN = 3;
const SCHEDULE_AHEAD = 0.3;

export class Session {
  readonly judge: Judge;
  private songStartCtx = NaN;
  private readonly scheduled: Scheduled[] = [];
  private schedPtr = 0;
  private autoPtr = 0;
  private lastRaf = NaN;
  private lastSong = NaN;
  private frameEst = 1000 / 60;
  private frameCount = 0;
  private finished = false;
  private pendingInputTimes: number[] = [];
  private calibrationOffsets: number[] = [];
  private lateSchedules = 0;
  readonly m = {
    frameMs: new Samples(20000),
    cpuMs: new Samples(20000),
    smoothMs: new Samples(20000),
    avQuantMs: new Samples(4096),
    dispatchMs: new Samples(1024),
    judgeMs: new Samples(1024),
    toFrameMs: new Samples(1024),
    hitOffsetMs: new Samples(1024),
  };
  onFinish: ((r: SessionResult) => void) | null = null;
  /** Every judged ring, stray ring and miss (e is null for misses). */
  onJudgement: ((r: Judgement | StrayRing, e: GestureEvent | null) => void) | null = null;

  constructor(
    readonly mode: Mode,
    readonly chart: Chart,
    private readonly audio: AudioEngine,
    private readonly renderer: SessionRenderer,
    private readonly hud: SessionHud,
    private readonly sources: InputSource[],
    readonly offsets: Offsets,
    private readonly opts: SessionOptions = {},
  ) {
    this.judge = new Judge(chart.notes, chart.lanes.length);
    const pans = chart.lanes.map((_, i) => (chart.lanes.length > 1 ? (i / (chart.lanes.length - 1)) * 1.2 - 0.6 : 0));
    for (const b of chart.backing) this.scheduled.push({ time: b.time, play: (w) => audio.bell(b.pitch, w, 0.25 + (b.velocity / 127) * 0.45, 0) });
    if (mode === 'autoplay') {
      for (const n of chart.notes) this.scheduled.push({ time: n.time, play: (w) => audio.bell(n.pitch, w, 0.9, pans[n.lane]) });
    } else if (mode === 'calibrate') {
      chart.notes.forEach((n, i) => this.scheduled.push({ time: n.time, play: (w) => audio.click(w, i % 4 === 0) }));
      // Count-in clicks.
      for (let b = 0; b < 4; b++) this.scheduled.push({ time: chart.beatTimes[b], play: (w) => audio.click(w, b === 0) });
    }
    this.scheduled.sort((a, b) => a.time - b.time);
    audio.prepare([...chart.lanes.map((l) => l.pitch), ...chart.backing.map((b) => b.pitch)]);
  }

  start(): void {
    this.audio.clock.update();
    this.songStartCtx = this.audio.ctx.currentTime + LEAD_IN;
    if (this.mode !== 'autoplay') for (const s of this.sources) s.start((e) => this.onGesture(e));
    this.renderer.setChart(this.chart);
    this.hud.reset(this.chart, this.mode);
  }

  stop(): void {
    for (const s of this.sources) s.stop();
  }

  /** Song time audible at performance.now()-time `perfMs`. */
  songTimeAt(perfMs: number): number {
    return this.audio.clock.contextTimeAt(perfMs) - this.songStartCtx;
  }

  /** performance.now() time at which song time `t` is audible (inverse of songTimeAt). */
  perfAtSong(t: number): number {
    return (t - this.songTimeAt(0)) * 1000;
  }

  private onGesture(e: GestureEvent): void {
    if (this.finished) return;
    const lane = e.lane ?? this.chart.lanes.findIndex((l) => l.pitch === e.pitch);
    if (lane < 0 || lane >= this.chart.lanes.length) return;
    const raw = this.songTimeAt(e.hostTimeMs);
    const t = raw - this.offsets.inputMs / 1000;
    this.renderer.press(lane);
    const pan = this.chart.lanes.length > 1 ? (lane / (this.chart.lanes.length - 1)) * 1.2 - 0.6 : 0;
    if (this.mode === 'calibrate') {
      let best = Infinity;
      for (const n of this.chart.notes) if (Math.abs(raw - n.time) < Math.abs(best)) best = raw - n.time;
      if (Math.abs(best) < 0.25) {
        this.calibrationOffsets.push(best * 1000);
        this.hud.judgement('tap', best * 1000);
      }
    } else {
      if (this.opts.hostRingSound !== false) this.audio.bell(this.chart.lanes[lane].pitch, 0, 0.95, pan);
      const r = this.judge.ring(lane, t);
      this.onJudgement?.(r, e);
      if (isJudgement(r)) {
        this.renderer.hit(r.noteId, lane, r.grade);
        this.hud.judgement(r.grade, r.offset * 1000);
        this.m.hitOffsetMs.push(r.offset * 1000);
      } else {
        this.hud.judgement('stray');
      }
    }
    const now = performance.now();
    this.m.dispatchMs.push(e.receivedAtMs - e.hostTimeMs);
    this.m.judgeMs.push(now - e.hostTimeMs);
    this.pendingInputTimes.push(e.hostTimeMs);
  }

  /** Called from requestAnimationFrame. */
  frame(rafTs: number): void {
    const cpu0 = performance.now();
    for (const t of this.pendingInputTimes) this.m.toFrameMs.push(cpu0 - t);
    this.pendingInputTimes.length = 0;

    this.audio.clock.update();
    const dtMs = Number.isFinite(this.lastRaf) ? rafTs - this.lastRaf : this.frameEst;
    this.lastRaf = rafTs;
    this.frameCount++;
    if (this.frameCount > 30 && dtMs > 0 && dtMs < 100) this.frameEst += 0.05 * (dtMs - this.frameEst);

    // The frame being prepared is presented ~one vsync after rAF fires.
    const displayPerf = rafTs + this.frameEst;
    const songDisplay = this.songTimeAt(displayPerf) - this.offsets.visualMs / 1000;
    const songNow = this.songTimeAt(cpu0);

    // Audio scheduling on the AudioContext clock.
    const ctx = this.audio.ctx;
    while (this.schedPtr < this.scheduled.length && this.songStartCtx + this.scheduled[this.schedPtr].time < ctx.currentTime + SCHEDULE_AHEAD) {
      const s = this.scheduled[this.schedPtr++];
      const when = this.songStartCtx + s.time;
      if (when < ctx.currentTime) this.lateSchedules++;
      s.play(when);
    }

    // Autoplay / calibration visuals fire when a note reaches the strike line on screen.
    if (this.mode !== 'play') {
      const notes = this.chart.notes;
      while (this.autoPtr < notes.length && notes[this.autoPtr].time <= songDisplay) {
        const n = notes[this.autoPtr++];
        this.m.avQuantMs.push((songDisplay - n.time) * 1000);
        if (this.mode === 'autoplay') {
          const r = this.judge.ring(n.lane, n.time);
          if (isJudgement(r)) this.hud.judgement(r.grade, 0);
        }
        this.renderer.press(n.lane);
        this.renderer.hit(n.id, n.lane, 'perfect');
      }
    } else {
      for (const miss of this.judge.sweep(songNow - this.offsets.inputMs / 1000)) {
        this.renderer.miss(miss.noteId, miss.lane);
        this.hud.judgement('miss');
        this.onJudgement?.(miss, null);
      }
    }

    if (this.frameCount > 30 && songDisplay > 0) {
      this.m.frameMs.push(dtMs);
      if (Number.isFinite(this.lastSong)) this.m.smoothMs.push(Math.abs((songDisplay - this.lastSong) * 1000 - dtMs));
    }
    this.lastSong = songDisplay;

    const s = this.judge.state;
    this.renderer.setFire(this.mode !== 'calibrate' && s.multiplier >= this.judge.maxMultiplier ? 1 : 0);
    this.renderer.frame(songDisplay, Math.min(dtMs, 100) / 1000, rafTs / 1000);
    this.hud.update(s, this.judge.accuracySoFar(), songDisplay, this.chart.duration, this.offsets);
    if (this.frameCount > 30) this.m.cpuMs.push(performance.now() - cpu0);

    if (!this.finished && songNow > this.chart.duration + 1.5) {
      this.finished = true;
      this.stop();
      this.onFinish?.(this.result());
    }
  }

  result(): SessionResult {
    const s = this.judge.state;
    const r: SessionResult = {
      mode: this.mode,
      title: this.chart.title,
      score: s.score,
      accuracy: this.judge.accuracy(),
      counts: { ...s.counts },
      maxStreak: s.maxStreak,
      strays: s.strays,
      metrics: this.metrics(),
    };
    if (this.mode === 'calibrate' && this.calibrationOffsets.length) {
      const sorted = [...this.calibrationOffsets].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const dev = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      r.calibration = { taps: sorted.length, medianMs: round(med, 1), madMs: round(dev[Math.floor(dev.length / 2)], 1) };
    }
    return r;
  }

  metrics(): Record<string, unknown> {
    const frames = this.m.frameMs.summary();
    const vals = this.m.frameMs.values();
    const long = vals.filter((v) => v > frames.p50 * 1.5).length;
    const size = this.renderer.bufferSize;
    return {
      frameMs: roundSummary(frames),
      fps: round(1000 / frames.mean, 1),
      longFramePct: round((long / Math.max(1, vals.length)) * 100, 2),
      cpuMs: roundSummary(this.m.cpuMs.summary()),
      smoothnessErrMs: roundSummary(this.m.smoothMs.summary()),
      avQuantizationMs: roundSummary(this.m.avQuantMs.summary()),
      clockJitterMs: roundSummary(this.audio.clock.jitterMs.summary(), 3),
      naiveLatencyEstimateDeltaMs: roundSummary(this.audio.clock.naiveDeltaMs.summary(), 2),
      audioDriftPpm: round(this.audio.clock.driftPpm(), 1),
      lateSchedules: this.lateSchedules,
      input: {
        dispatchMs: roundSummary(this.m.dispatchMs.summary()),
        eventToJudgeMs: roundSummary(this.m.judgeMs.summary()),
        eventToNextFrameMs: roundSummary(this.m.toFrameMs.summary()),
        hitOffsetMs: roundSummary(this.m.hitOffsetMs.summary()),
      },
      render: { width: size.width, height: size.height, gpu: this.renderer.gpu, dpr: window.devicePixelRatio },
      audio: this.audio.info(),
      frameEstimateMs: round(this.frameEst, 2),
    };
  }
}
