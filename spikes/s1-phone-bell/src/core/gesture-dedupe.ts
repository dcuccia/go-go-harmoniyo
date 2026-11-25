// Gesture de-duplication: browser-safe (no node imports), shared by the Node host (transport.ts)
// and the in-page host (HostSession, S9).

/**
 * While a phone has a data channel it sends each gesture on both paths (the channel is unreliable,
 * and a path can drop mid-switch); the host keeps the first copy. A copy is identified by its
 * sequence number and source timestamp (`th`, the phone's clock), so a page reload that restarts
 * `seq` at 1 is not mistaken for a duplicate.
 */
export class GestureDedupe {
  private seen = new Map<string, Map<string, number>>();
  constructor(private readonly windowMs = 30_000) {}

  /** True for the first copy of this gesture. */
  first(deviceId: string, seq: unknown, th: unknown, at: number): boolean {
    // HGP requires seq; a sender without it can't be de-duplicated, so never drop its gestures.
    if (seq === undefined || seq === null) return true;
    let m = this.seen.get(deviceId);
    if (!m) this.seen.set(deviceId, (m = new Map()));
    const key = `${String(seq)}|${String(th)}`;
    if (m.has(key)) return false;
    m.set(key, at);
    if (m.size > 64) {
      for (const [k, t] of m) {
        if (at - t <= this.windowMs && m.size <= 512) break;
        m.delete(k);
      }
    }
    return true;
  }

  forget(deviceId: string): void {
    this.seen.delete(deviceId);
  }
}
