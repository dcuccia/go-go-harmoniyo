import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Backoff } from '../src/core/backoff.ts';
import { TabGuard } from '../src/web/tab-guard.ts';

test('backoff: doubles with equal jitter, capped at 5 s', () => {
  const lo = new Backoff({}, () => 0);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(() => lo.next()), [250, 500, 1000, 2000, 2500, 2500, 2500]);
  const hi = new Backoff({}, () => 1);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(() => hi.next()), [500, 1000, 2000, 4000, 5000, 5000, 5000]);
  let seed = 7;
  const rnd = new Backoff({}, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  for (let i = 0; i < 200; i++) {
    const d = rnd.next();
    assert.ok(d >= 250 && d <= 5000, `delay ${d} out of range`);
  }
});

test('backoff: a connection that is kicked right after opening keeps backing off (no 500 ms ping-pong)', () => {
  // The 2026-10-25 log: hello every ~660 ms because the delay reset to 500 ms on every open.
  const b = new Backoff({}, () => 1);
  let t = 0;
  const delays: number[] = [];
  for (let i = 0; i < 8; i++) {
    b.opened(t);
    t += 150; // replaced by the other tab 150 ms later
    b.closed(t);
    const d = b.next();
    delays.push(d);
    t += d;
  }
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 5000, 5000, 5000, 5000]);
});

test('backoff: resets only after the connection was stable for 5 s', () => {
  const b = new Backoff({}, () => 1);
  b.next();
  b.next();
  b.next();
  assert.equal(b.current, 4000);
  b.opened(10_000);
  b.closed(14_999); // 4.999 s: not stable
  assert.equal(b.current, 4000);
  b.opened(20_000);
  b.closed(25_000); // 5 s: stable
  assert.equal(b.current, 500);
  assert.equal(b.next(), 500);
  // A connection that never opened doesn't reset it either.
  b.closed(99_999);
  assert.equal(b.current, 1000);
});

// ── tab guard ───────────────────────────────────────────────────────────────

/** Two tabs sharing one localStorage (no Web Locks: iOS < 15.4), with `storage` events between them. */
function storageWorld() {
  const data = new Map<string, string>();
  let t = 1000;
  const listeners: { tab: TabGuard | null; fn: (k: string | null, v: string | null) => void }[] = [];
  const timers: { fn: () => void; owner: number }[] = [];
  let writer = -1;
  const muted = new Set<number>();
  function make(idx: number): TabGuard {
    const entry: (typeof listeners)[number] = { tab: null, fn: () => {} };
    listeners.push(entry);
    const g = new TabGuard('ctl', {
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
          writer = idx;
          for (const [i, l] of listeners.entries()) if (i !== idx && !muted.has(i)) l.fn(k, v); // storage events fire in *other* tabs
        },
        removeItem: (k) => {
          data.delete(k);
          for (const [i, l] of listeners.entries()) if (i !== idx) l.fn(k, null);
        },
      },
      onStorage: (fn) => (entry.fn = fn),
      now: () => t,
      setInterval: (fn) => timers.push({ fn, owner: idx }) - 1,
      clearInterval: (h) => (timers[h as number] = { fn: () => {}, owner: -1 }),
    });
    entry.tab = g;
    return g;
  }
  return {
    make,
    muted,
    advance(ms: number, only?: number) {
      t += ms;
      for (const x of timers) if (only === undefined || x.owner === only) x.fn();
    },
    get writer() {
      return writer;
    },
  };
}

test('tab guard (localStorage fallback): a second tab sees the first and does not take over unless asked', async () => {
  const w = storageWorld();
  const a = w.make(0);
  const b = w.make(1);
  assert.equal(a.mode, 'storage');
  let aLost = 0;
  let bLost = 0;
  a.onLost = () => aLost++;
  b.onLost = () => bLost++;
  assert.equal(await a.acquire(false), true);
  w.advance(1000);
  assert.equal(await b.otherActive(), true);
  assert.equal(await b.acquire(false), false, 'existing tab keeps playing');
  assert.equal(aLost, 0);
  // "Use this tab": B steals; A notices (storage event) once and stops its heartbeat.
  assert.equal(await b.acquire(true), true);
  assert.equal(aLost, 1);
  assert.equal(a.active, false);
  for (let i = 0; i < 5; i++) w.advance(1000);
  assert.equal(aLost, 1);
  assert.equal(bLost, 0, 'the old tab must not write the key back (no ping-pong)');
  assert.equal(await a.otherActive(), true);
});

test('tab guard (localStorage fallback): a stale heartbeat (suspended tab) does not block, and the woken tab yields', async () => {
  const w = storageWorld();
  const a = w.make(0);
  const b = w.make(1);
  let aLost = 0;
  a.onLost = () => aLost++;
  await a.acquire(false);
  w.muted.add(0); // A is suspended: no heartbeat, no storage events
  w.advance(10_000, 1);
  assert.equal(await b.otherActive(), false);
  assert.equal(await b.acquire(false), true);
  assert.equal(aLost, 0);
  // A wakes up: its heartbeat sees B's entry and yields instead of overwriting it.
  w.muted.delete(0);
  const before = w.writer;
  w.advance(1000, 0);
  assert.equal(aLost, 1);
  assert.equal(w.writer, before);
  assert.equal(a.active, false);
});

/** Minimal Web Locks model: exclusive locks, ifAvailable, steal (rejects the holder with AbortError). */
function fakeLocks() {
  const held = new Map<string, { release: () => void; reject: (e: Error) => void }>();
  return {
    async query() {
      return { held: [...held.keys()].map((name) => ({ name })) };
    },
    request(name: string, opts: { steal?: boolean; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const cur = held.get(name);
        if (cur && opts.ifAvailable) {
          resolve(cb(null));
          return;
        }
        if (cur && !opts.steal) throw new Error('queued requests not modelled');
        if (cur) {
          held.delete(name);
          const e = new Error('stolen');
          e.name = 'AbortError';
          cur.reject(e);
        }
        const entry = { release: () => {}, reject };
        held.set(name, entry);
        void Promise.resolve(cb({ name })).then((v) => {
          if (held.get(name) === entry) held.delete(name);
          resolve(v);
        });
      });
    },
  };
}

test('tab guard (Web Locks): second tab waits, takeover steals once, old tab is told', async () => {
  const locks = fakeLocks();
  const a = new TabGuard('ctl', { locks });
  const b = new TabGuard('ctl', { locks });
  assert.equal(a.mode, 'locks');
  let aLost = 0;
  a.onLost = () => aLost++;
  assert.equal(await b.otherActive(), false);
  assert.equal(await a.acquire(false), true);
  assert.equal(await b.otherActive(), true);
  assert.equal(await b.acquire(false), false);
  assert.equal(await b.acquire(true), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(aLost, 1);
  assert.equal(a.active, false);
  assert.equal(await a.otherActive(), true);
  b.release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await a.otherActive(), false);
});
