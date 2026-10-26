/**
 * One controller tab per browser. Two tabs share the persisted `deviceId` (localStorage), so if both
 * connected, the host would keep handing the device to whichever said `hello` last. The guard makes
 * a second tab (e.g. the TV's join QR scanned again on a phone that already plays) show "Use this
 * tab" instead of connecting, and tells the first tab when the user takes over.
 *
 * Web Locks (Chrome/Edge 69+, Firefox 96+, Safari/iOS 15.4+): an exclusive lock held for the page's
 * life; a takeover `steal`s it, which rejects the old holder's request with an AbortError. Without
 * Web Locks (iOS < 15.4, which also lacks BroadcastChannel) a localStorage heartbeat + `storage`
 * event does the same job; a hidden tab whose timers are suspended goes stale after `staleMs`, and
 * then the host's `replaced` message is the backstop.
 */

interface LockLike {
  request(name: string, options: { steal?: boolean; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TabGuardDeps {
  locks?: LockLike | null;
  storage?: StorageLike | null;
  /** Subscribe to other tabs' storage writes (`window.addEventListener('storage', …)`). */
  onStorage?: (fn: (key: string | null, value: string | null) => void) => void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  heartbeatMs?: number;
  staleMs?: number;
}

export class TabGuard {
  /** This page's id (also sent in `hello.tab` for the host's logs). */
  readonly tab = `tab-${Math.random().toString(36).slice(2, 10)}`;
  readonly mode: 'locks' | 'storage' | 'none';
  /** Another tab took over the controller role. */
  onLost: () => void = () => {};
  private held = false;
  private releaseLock: (() => void) | null = null;
  private beat: unknown = null;
  private readonly locks: LockLike | null;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly setIv: (fn: () => void, ms: number) => unknown;
  private readonly clearIv: (h: unknown) => void;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;

  constructor(private name: string, deps: TabGuardDeps = browserDeps()) {
    this.locks = deps.locks ?? null;
    this.storage = deps.storage ?? null;
    this.now = deps.now ?? Date.now;
    this.setIv = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIv = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.heartbeatMs = deps.heartbeatMs ?? 1000;
    this.staleMs = deps.staleMs ?? 3500;
    this.mode = this.locks ? 'locks' : this.storage ? 'storage' : 'none';
    deps.onStorage?.((key, value) => {
      if (this.mode !== 'storage' || key !== this.key || !this.held) return;
      const v = parse(value);
      if (v && v.tab !== this.tab) this.lost();
    });
  }

  get active(): boolean {
    return this.held;
  }

  private get key(): string {
    return `${this.name}:active`;
  }

  /** Is another tab of this browser the controller right now? */
  async otherActive(): Promise<boolean> {
    if (this.held) return false;
    if (this.locks) {
      try {
        const s = await this.locks.query();
        return (s.held ?? []).some((l) => l.name === this.name);
      } catch {
        return false;
      }
    }
    return this.storageOther();
  }

  /**
   * Become the controller tab. `steal: false` only succeeds if no other tab is (the existing tab
   * keeps playing); `steal: true` takes over (the user tapped "Use this tab"). Resolves to whether
   * this tab now holds the role.
   */
  async acquire(steal: boolean): Promise<boolean> {
    if (this.held) return true;
    if (this.locks) {
      const locks = this.locks;
      return new Promise<boolean>((resolve) => {
        locks
          .request(this.name, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            this.held = true;
            resolve(true);
            return new Promise<void>((r) => (this.releaseLock = r));
          })
          .then(
            () => {
              this.held = false;
            },
            (e: unknown) => {
              // AbortError: another tab stole the lock. Anything else: no lock support after all.
              const wasHeld = this.held;
              this.held = false;
              this.releaseLock = null;
              if (wasHeld) this.onLost();
              else resolve(!(e instanceof Error && e.name === 'AbortError'));
            },
          );
      });
    }
    if (this.storage) {
      if (!steal && this.storageOther()) return false;
      this.held = true;
      this.write();
      this.beat = this.setIv(() => {
        const v = this.read();
        if (v && v.tab !== this.tab) this.lost();
        else this.write();
      }, this.heartbeatMs);
      return true;
    }
    this.held = true;
    return true;
  }

  /** Give up the role (e.g. the host replaced this tab's connection). */
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.releaseLock?.();
    this.releaseLock = null;
    if (this.beat !== null) this.clearIv(this.beat);
    this.beat = null;
    if (this.storage && this.read()?.tab === this.tab) this.storage.removeItem(this.key);
  }

  private lost(): void {
    if (!this.held) return;
    this.held = false;
    if (this.beat !== null) this.clearIv(this.beat);
    this.beat = null;
    this.onLost();
  }

  private storageOther(): boolean {
    const v = this.read();
    return !!v && v.tab !== this.tab && this.now() - v.at < this.staleMs;
  }

  private read(): { tab: string; at: number } | null {
    try {
      return parse(this.storage?.getItem(this.key) ?? null);
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify({ tab: this.tab, at: this.now() }));
    } catch {
      // storage full or blocked: the host's `replaced` still prevents a ping-pong
    }
  }
}

function parse(s: string | null): { tab: string; at: number } | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as { tab?: unknown; at?: unknown };
    return typeof v.tab === 'string' && typeof v.at === 'number' ? { tab: v.tab, at: v.at } : null;
  } catch {
    return null;
  }
}

function browserDeps(): TabGuardDeps {
  if (typeof window === 'undefined') return {};
  const nav = navigator as Navigator & { locks?: LockLike };
  let storage: StorageLike | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    locks: nav.locks && typeof nav.locks.request === 'function' ? nav.locks : null,
    storage,
    onStorage: (fn) => window.addEventListener('storage', (e) => fn(e.key, e.newValue)),
  };
}
