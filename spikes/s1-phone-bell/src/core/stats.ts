export interface Summary {
  n: number;
  mean: number;
  sd: number;
  min: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(values: readonly number[]): Summary {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) {
    return { n: 0, mean: NaN, sd: NaN, min: NaN, p05: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  }
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    min: xs[0],
    p05: quantile(xs, 0.05),
    p50: quantile(xs, 0.5),
    p95: quantile(xs, 0.95),
    p99: quantile(xs, 0.99),
    max: xs[n - 1],
  };
}

export function median(values: readonly number[]): number {
  return summarize(values).p50;
}

/** Absolute deviations from the median: the "spread" left after a constant-offset calibration. */
export function centeredAbs(values: readonly number[]): number[] {
  const m = median(values);
  return values.map((v) => Math.abs(v - m));
}

export function fmt(x: number, digits = 1): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '–';
}
