// Maps between AudioContext time and the performance.now() timeline.
//
// AudioContext.getOutputTimestamp() returns {contextTime, performanceTime}: the context-time
// sample frame that is *leaving the speakers* at performanceTime. So
//   audibleContextTime(perfMs) = perfMs/1000 + offset,  offset = contextTime - performanceTime/1000
// already includes output latency. When unavailable (or returning zeros), fall back to
// currentTime - (baseLatency + outputLatency).

import { Samples } from '../core/stats';

export class AudioClock {
  private offset = NaN;
  readonly jitterMs = new Samples(2048);
  readonly naiveDeltaMs = new Samples(2048);
  usingOutputTimestamp = false;
  private firstSample: { perf: number; offset: number } | null = null;
  private lastSample: { perf: number; offset: number } | null = null;

  constructor(private readonly ctx: AudioContext) {}

  private rawOffset(): { offset: number; perf: number } | null {
    const now = performance.now();
    if (typeof this.ctx.getOutputTimestamp === 'function') {
      const ts = this.ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0 && ts.contextTime > 0) {
        this.usingOutputTimestamp = true;
        const offset = ts.contextTime - ts.performanceTime / 1000;
        if (this.ctx.state === 'running') {
          // How far the naive "currentTime − latency" estimate is from getOutputTimestamp (ms; + = naive is later).
          const naive = this.ctx.currentTime - (this.ctx.baseLatency || 0) - (this.ctx.outputLatency || 0) - now / 1000;
          this.naiveDeltaMs.push((naive - offset) * 1000);
        }
        return { offset, perf: now };
      }
    }
    this.usingOutputTimestamp = false;
    if (this.ctx.state !== 'running') return null;
    const latency = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    return { offset: this.ctx.currentTime - latency - now / 1000, perf: now };
  }

  /** Times the offset was re-anchored by more than 50 ms (diagnostics). */
  readonly snaps: { perf: number; deltaMs: number }[] = [];
  /** performance.now() of the last re-anchoring (> 50 ms jump), e.g. output start-up underruns. */
  lastSnapPerf = NaN;

  /** Call once per frame. Smooths quantization jitter of the output timestamp. */
  update(): void {
    const s = this.rawOffset();
    if (!s) return;
    if (!Number.isFinite(this.offset) || Math.abs(s.offset - this.offset) > 0.05) {
      if (Number.isFinite(this.offset)) {
        this.lastSnapPerf = s.perf;
        if (this.snaps.length < 256) this.snaps.push({ perf: s.perf, deltaMs: (s.offset - this.offset) * 1000 });
      }
      this.offset = s.offset;
    } else {
      this.jitterMs.push((s.offset - this.offset) * 1000);
      this.offset += 0.03 * (s.offset - this.offset);
    }
    this.firstSample ??= { perf: s.perf, offset: this.offset };
    this.lastSample = { perf: s.perf, offset: this.offset };
  }

  get ready(): boolean {
    return Number.isFinite(this.offset);
  }

  /** Context time audible at the given performance.now() time. */
  contextTimeAt(perfMs: number): number {
    return perfMs / 1000 + this.offset;
  }

  /** Drift of the audio clock vs performance.now() in parts per million (positive = audio fast). */
  driftPpm(): number {
    if (!this.firstSample || !this.lastSample) return NaN;
    const dt = (this.lastSample.perf - this.firstSample.perf) / 1000;
    if (dt < 5) return NaN;
    return ((this.lastSample.offset - this.firstSample.offset) / dt) * 1e6;
  }
}
