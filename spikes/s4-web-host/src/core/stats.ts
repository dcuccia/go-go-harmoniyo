// Small statistics helpers for frame-time / latency measurements.

export interface Summary {
  n: number;
  mean: number;
  std: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(values: readonly number[]): Summary {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : NaN;
  const std = n ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : NaN;
  return { n, mean, std, min: n ? s[0] : NaN, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: n ? s[n - 1] : NaN };
}

/** Fixed-capacity ring buffer of samples. */
export class Samples {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;
  constructor(capacity = 4096) {
    this.buf = new Float64Array(capacity);
  }
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  get count(): number {
    return this.n;
  }
  clear(): void {
    this.n = 0;
    this.i = 0;
  }
  values(): number[] {
    const len = this.buf.length;
    const out = new Array<number>(this.n);
    for (let k = 0; k < this.n; k++) out[k] = this.buf[(this.i - this.n + k + len) % len];
    return out;
  }
  summary(): Summary {
    return summarize(this.values());
  }
}

export const round = (v: number, d = 2): number => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

export function roundSummary(s: Summary, d = 2): Summary {
  return {
    n: s.n,
    mean: round(s.mean, d),
    std: round(s.std, d),
    min: round(s.min, d),
    p50: round(s.p50, d),
    p95: round(s.p95, d),
    p99: round(s.p99, d),
    max: round(s.max, d),
  };
}
