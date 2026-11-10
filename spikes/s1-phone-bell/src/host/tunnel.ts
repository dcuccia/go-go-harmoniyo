/**
 * Runs a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`) and reports
 * its state: `starting` → `up` (address reachable, then published) → `down` (exited or could not
 * start; restarted a few times). See ADR-0012. No top-level await / import.meta.url (bundled by the
 * portable package).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as dns } from 'node:dns';
import https from 'node:https';
import { parseCloudflaredOutput, TUNNEL_REGISTER_FALLBACK_MS, type TunnelState } from './transport.ts';

export interface QuickTunnelOptions {
  cloudflared: string;
  originPort: number;
  onChange: (state: TunnelState, url: string, reason: string) => void;
  /**
   * Is the published address reachable from the internet yet? Runs before the state becomes `up`
   * (the tunnel stays `starting`, reason "checking the address"). A failure restarts cloudflared for
   * a fresh address. See waitTunnelReady.
   */
  verify?: (url: string) => Promise<TunnelReady>;
  spawnFn?: (cmd: string, args: string[]) => ChildProcess;
  maxRestarts?: number;
  restartDelayMs?: number;
  registerFallbackMs?: number;
}

export class QuickTunnel {
  state: TunnelState = 'off';
  url = '';
  reason = '';
  restarts = 0;
  /** The last readiness check (set just before the state becomes `up`, or when it failed). */
  ready: TunnelReady | null = null;
  /** Milliseconds from spawning cloudflared to `up`. */
  upAfterMs = 0;
  /** Set while `down` if cloudflared will be restarted (after restartDelayMs). */
  restartPending = false;
  private child: ChildProcess | null = null;
  private stopped = false;
  private timers = new Set<NodeJS.Timeout>();

  constructor(private readonly o: QuickTunnelOptions) {}

  start(): void {
    this.stopped = false;
    const spawnFn = this.o.spawnFn ?? ((cmd: string, args: string[]) => spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
    let pending = '';
    let registered = false;
    let lastErr = '';
    let failReason = '';
    let checking = '';
    const spawnedAt = Date.now();
    this.set('starting', '', '');
    let child: ChildProcess;
    try {
      child = spawnFn(this.o.cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.o.originPort}`]);
    } catch (e) {
      this.set('down', '', `cloudflared could not start: ${String(e)}`);
      return;
    }
    this.child = child;
    let upAt = 0;
    const current = (url: string) => child === this.child && url === pending && !this.stopped;
    const goUp = (url: string) => {
      upAt = Date.now();
      this.upAfterMs = upAt - spawnedAt;
      this.set('up', url, '');
    };
    const publish = () => {
      if (child !== this.child || !pending || this.state === 'up' || checking === pending) return;
      const url = pending;
      if (!this.o.verify) return goUp(url);
      checking = url;
      this.set('starting', '', 'checking the address');
      this.o.verify(url).then(
        (r) => {
          if (!current(url)) return;
          this.ready = r;
          if (r.ok) return goUp(url);
          failReason = `the address ${url} did not become reachable (${r.reason})`;
          child.kill();
        },
        (e: unknown) => {
          if (!current(url)) return;
          failReason = `checking ${url} failed: ${String(e)}`;
          child.kill();
        },
      );
    };
    const scan = (buf: Buffer) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) if (/\bERR\b/.test(line)) lastErr = line.replace(/^\S+\s+ERR\s+/, '').trim();
      for (const ev of parseCloudflaredOutput(text)) {
        if (ev.kind === 'url' && ev.url !== pending) {
          pending = ev.url;
          if (registered) publish();
          else this.later(publish, this.o.registerFallbackMs ?? TUNNEL_REGISTER_FALLBACK_MS);
        } else if (ev.kind === 'registered') {
          registered = true;
          publish();
        }
      }
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (child !== this.child) return;
      this.child = null;
      this.set('down', '', e.code === 'ENOENT' ? `cloudflared not found at ${this.o.cloudflared}` : `cloudflared could not start: ${e.message}`);
    });
    child.on('exit', (code, signal) => {
      if (child !== this.child) return;
      this.child = null;
      if (this.stopped) return;
      // A tunnel that was up for a while earns its restarts back (a rare crash, not a crash loop).
      if (upAt && Date.now() - upAt > 60_000) this.restarts = 0;
      this.restartPending = this.restarts < (this.o.maxRestarts ?? 3);
      this.set('down', '', failReason || `cloudflared exited (${signal ?? `code ${code}`})${lastErr ? `: ${lastErr}` : ''}`);
      if (this.restartPending) {
        this.restarts++;
        this.later(() => {
          this.restartPending = false;
          if (!this.stopped) this.start();
        }, this.o.restartDelayMs ?? 5000);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const c = this.child;
    this.child = null;
    try {
      c?.kill();
    } catch {
      // already gone
    }
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  private set(state: TunnelState, url: string, reason: string): void {
    if (state === this.state && url === this.url && reason === this.reason) return;
    this.state = state;
    this.url = url;
    this.reason = reason;
    this.o.onChange(state, url, reason);
  }
}

/** Can this PC resolve Cloudflare's quick-tunnel API? A fast "no internet" before spawning cloudflared. */
export async function internetReachable(timeoutMs = 3000, lookup: (host: string) => Promise<unknown> = (h) => dns.lookup(h)): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((r) => {
    timer = setTimeout(() => r(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([lookup('api.trycloudflare.com').then(() => true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── readiness: is the published address reachable yet? ──────────────────────

/**
 * Measured 2026-11-09 (cloudflared 2026.10.7, Windows): a quick-tunnel hostname resolves about 2 s
 * after cloudflared prints it. A DNS query made before that (within ~1 s) gets NXDOMAIN, and resolvers
 * — 1.1.1.1, 8.8.8.8 and the OS cache alike — then keep that "no such name" for the zone's 60 s
 * negative TTL. So: wait before the first query, ask public resolvers (never the OS resolver, whose
 * negative cache the TV PC's browser shares), rotate between them so one early answer cannot block
 * us, and pin the HTTPS check to the address we got.
 */
export const TUNNEL_READY_TIMEOUT_MS = 45_000;
export const TUNNEL_FIRST_DNS_QUERY_MS = 3_000;
export const TUNNEL_READY_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
/** The host answers GET /tunnel-check with this run's token, so the check proves it reached us. */
export const TUNNEL_CHECK_PATH = '/tunnel-check';

export interface TunnelReady {
  ok: boolean;
  /** From the start of the check until a public resolver returned an address. */
  dnsMs: number;
  /** From that answer until GET /tunnel-check returned 200 with our token. */
  httpMs: number;
  totalMs: number;
  address: string;
  resolver: string;
  reason: string;
}

export interface TunnelReadyOptions {
  /** Expected body of GET <url>tunnel-check. */
  expect: string;
  timeoutMs?: number;
  firstQueryDelayMs?: number;
  intervalMs?: number;
  resolvers?: string[];
  /** Addresses (A, else AAAA) for `host` from DNS server `server`; throws (e.g. ENOTFOUND) when none. */
  resolve?: (server: string, host: string) => Promise<string[]>;
  /** HTTPS GET `url` connecting to `address` (SNI/Host stay the tunnel hostname). */
  probe?: (url: string, address: string) => Promise<{ status: number; body: string }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function waitTunnelReady(url: string, o: TunnelReadyOptions): Promise<TunnelReady> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const resolve = o.resolve ?? resolvePublic;
  const probe = o.probe ?? probePinned;
  const resolvers = o.resolvers ?? TUNNEL_READY_RESOLVERS;
  const timeoutMs = o.timeoutMs ?? TUNNEL_READY_TIMEOUT_MS;
  const intervalMs = o.intervalMs ?? 1_000;
  const start = now();
  const deadline = start + timeoutMs;
  const host = new URL(url).hostname;
  const result = (ok: boolean, reason: string, dnsAt = 0, address = '', resolver = ''): TunnelReady => {
    const t = now();
    return { ok, reason, address, resolver, totalMs: t - start, dnsMs: dnsAt ? dnsAt - start : t - start, httpMs: dnsAt ? t - dnsAt : 0 };
  };
  const errText = (e: unknown) => (e as { code?: string })?.code ?? (e instanceof Error ? e.message : String(e));

  await sleep(Math.min(o.firstQueryDelayMs ?? TUNNEL_FIRST_DNS_QUERY_MS, timeoutMs));
  let address = '';
  let resolver = '';
  let last = '';
  for (let i = 0; ; i++) {
    const server = resolvers[i % resolvers.length]!;
    try {
      address = (await resolve(server, host))[0] ?? '';
      if (address) {
        resolver = server;
        break;
      }
      last = 'no address';
    } catch (e) {
      last = errText(e);
    }
    if (now() + intervalMs > deadline) return result(false, `no DNS answer for ${host} from ${resolvers.join(' or ')} in ${timeoutMs / 1000} s (last: ${last})`);
    await sleep(intervalMs);
  }
  const dnsAt = now();
  const checkUrl = new URL(TUNNEL_CHECK_PATH, url).href;
  for (;;) {
    try {
      const r = await probe(checkUrl, address);
      if (r.status === 200 && r.body.trim() === o.expect) return result(true, '', dnsAt, address, resolver);
      last = r.status === 200 ? 'answered, but not by this host' : `HTTP ${r.status}`;
    } catch (e) {
      last = errText(e);
    }
    if (now() + intervalMs > deadline) return result(false, `${host} resolves but HTTPS through it failed for ${timeoutMs / 1000} s (last: ${last})`, dnsAt, address, resolver);
    await sleep(intervalMs);
  }
}

async function resolvePublic(server: string, host: string): Promise<string[]> {
  const r = new dns.Resolver({ timeout: 2_000, tries: 1 });
  r.setServers([server]);
  try {
    return await r.resolve4(host);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENODATA') return r.resolve6(host);
    throw e;
  }
}

function probePinned(url: string, address: string): Promise<{ status: number; body: string }> {
  const family = address.includes(':') ? 6 : 4;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 5_000,
      headers: { 'cache-control': 'no-store' },
      // Connect to the address the public resolver gave us; the OS resolver is never asked.
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => {
        if (body.length < 1024) body += d;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}