export interface BackoffOptions {
  /** First retry delay (ms). */
  baseMs?: number;
  /** Cap for any delay (ms). */
  maxMs?: number;
  /** A connection must stay open this long before the delay resets to `baseMs`. */
  stableMs?: number;
}

/**
 * Reconnect back-off: exponential (×2) from `baseMs` to `maxMs` with "equal jitter" (each delay is
 * uniform in [d/2, d]), so phones that drop together don't come back in lock-step. The delay resets
 * only after a connection stayed open `stableMs`: a connection that opens and is closed right away
 * (another tab took over, the host kicks it, a flaky tunnel) keeps backing off instead of retrying
 * every 500 ms forever.
 */
export class Backoff {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly stableMs: number;
  private cur: number;
  private openedAt: number | null = null;

  constructor(opts: BackoffOptions = {}, private rand: () => number = Math.random) {
    this.baseMs = opts.baseMs ?? 500;
    this.maxMs = opts.maxMs ?? 5000;
    this.stableMs = opts.stableMs ?? 5000;
    this.cur = this.baseMs;
  }

  /** The un-jittered delay the next retry is drawn from. */
  get current(): number {
    return this.cur;
  }

  /** The connection opened at `now` (ms). */
  opened(now: number): void {
    this.openedAt = now;
  }

  /** The connection closed at `now` (ms): reset if it had been open long enough. */
  closed(now: number): void {
    if (this.openedAt !== null && now - this.openedAt >= this.stableMs) this.cur = this.baseMs;
    this.openedAt = null;
  }

  /** Delay before the next attempt; grows the base for the attempt after it. */
  next(): number {
    const d = Math.min(this.maxMs, this.cur);
    this.cur = Math.min(this.maxMs, this.cur * 2);
    return Math.round(d / 2 + (d / 2) * this.rand());
  }

  reset(): void {
    this.cur = this.baseMs;
    this.openedAt = null;
  }
}
