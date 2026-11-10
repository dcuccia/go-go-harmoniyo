/**
 * Runs a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`) and reports
 * its state: `starting` → `up` (address published) → `down` (exited or could not start; restarted a
 * few times). See ADR-0012. No top-level await / import.meta.url (bundled by the portable package).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { parseCloudflaredOutput, TUNNEL_REGISTER_FALLBACK_MS, type TunnelState } from './transport.ts';

export interface QuickTunnelOptions {
  cloudflared: string;
  originPort: number;
  onChange: (state: TunnelState, url: string, reason: string) => void;
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
    const publish = () => {
      if (child !== this.child || !pending || this.state === 'up') return;
      upAt = Date.now();
      this.set('up', pending, '');
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
      this.set('down', '', `cloudflared exited (${signal ?? `code ${code}`})${lastErr ? `: ${lastErr}` : ''}`);
      if (this.restarts < (this.o.maxRestarts ?? 3)) {
        this.restarts++;
        this.later(() => {
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
