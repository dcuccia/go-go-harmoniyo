/**
 * Phone ↔ host route selection (ADR-0012, amending ADR-0006): pure helpers, unit-tested in
 * test/transport.test.ts. The host joins phones through a Cloudflare quick tunnel when it can
 * (`auto`), falls back to the LAN self-signed URL when it can't, and lets phones that came through
 * the tunnel upgrade their game traffic to a direct WebRTC data channel.
 *
 * No top-level await and no import.meta.url here: the portable package (#43) bundles the host.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** `auto`: tunnel if possible, LAN otherwise. `tunnel`: tunnel only (`--tunnel`). `lan`: LAN only. */
export type TransportMode = 'auto' | 'tunnel' | 'lan';
/** Which phones the host asks to try a direct WebRTC data channel. */
export type RtcPolicy = 'auto' | 'on' | 'off';
/** How a phone's WebSocket reached the host. */
export type WsRoute = 'tunnel' | 'lan' | 'local';
/** A phone's active game path, as shown on the TV and dashboard. */
export type Route = 'direct' | WsRoute | 'offline';
/** `off`: not used. `starting`: cloudflared running, no usable address yet. `down`: unavailable. */
export type TunnelState = 'off' | 'starting' | 'up' | 'down';

export const TUNNEL_ENV = 'GOGOHARMONIYO_CLOUDFLARED';
/** In `auto`, how long the TV waits for the tunnel address before showing the LAN one. */
export const TUNNEL_GRACE_MS = 15_000;
/** Publish the tunnel URL this long after it appears even if no "Registered" line is seen. */
export const TUNNEL_REGISTER_FALLBACK_MS = 8_000;

export interface ModeArgs {
  tunnel?: boolean;
  'lan-only'?: boolean;
  'no-tunnel'?: boolean;
  'no-https'?: boolean;
  'public-url'?: string;
  cert?: string;
}

/**
 * Transport mode from the host flags. A given `--public-url` or `--cert` means the owner set up
 * their own join address, so it is used as is (LAN). Throws on contradictory flags.
 */
export function transportMode(a: ModeArgs): TransportMode {
  const lanOnly = !!(a['lan-only'] || a['no-tunnel']);
  if (a.tunnel && lanOnly) throw new Error('--tunnel and --lan-only/--no-tunnel contradict each other: pick one');
  if (a.tunnel) return 'tunnel';
  if (lanOnly || a['no-https'] || a['public-url'] || a.cert) return 'lan';
  return 'auto';
}

export function rtcPolicy(v: string | undefined): RtcPolicy {
  const p = (v ?? 'auto').toLowerCase();
  if (p === 'auto' || p === 'on' || p === 'off') return p;
  throw new Error(`--rtc must be auto, on or off (got "${v}")`);
}

// ── cloudflared lookup ──────────────────────────────────────────────────────

export interface CloudflaredLookup {
  /** `--cloudflared <path>` */
  flag?: string;
  env?: Record<string, string | undefined>;
  platform?: string;
  /** The running executable: the portable package's go-go-harmoniyo.exe (Node SEA), else node. */
  execPath?: string;
  exists?: (p: string) => boolean;
}

export interface CloudflaredFound {
  path: string;
  source: 'flag' | 'env' | 'beside-exe' | 'path' | 'install-folder';
}

/**
 * Where to look for cloudflared, in order: `--cloudflared <path>`, `$GOGOHARMONIYO_CLOUDFLARED`,
 * next to the running executable (the portable zip ships cloudflared.exe beside
 * go-go-harmoniyo.exe), PATH, then the usual install folders.
 */
export function cloudflaredCandidates(o: CloudflaredLookup = {}): CloudflaredFound[] {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  const exe = win ? 'cloudflared.exe' : 'cloudflared';
  // Path rules follow the target platform, not the OS running this (tests cover both everywhere).
  const { dirname, join } = win ? win32 : posix;
  const out: CloudflaredFound[] = [];
  if (o.flag) out.push({ path: o.flag, source: 'flag' });
  if (env[TUNNEL_ENV]) out.push({ path: env[TUNNEL_ENV]!, source: 'env' });
  const execPath = o.execPath ?? process.execPath;
  if (execPath) out.push({ path: join(dirname(execPath), exe), source: 'beside-exe' });
  const pathVar = env.PATH ?? env.Path ?? '';
  const exts = win ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const dir of pathVar.split(win ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) out.push({ path: join(dir, `cloudflared${ext}`), source: 'path' });
  }
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const places = win
    ? [
        join(local, 'Programs', 'cloudflared', exe),
        join(local, 'Microsoft', 'WinGet', 'Links', exe),
        join(env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', exe),
        join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', exe),
      ]
    : ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared', join(home, '.local', 'bin', 'cloudflared')];
  for (const p of places) out.push({ path: p, source: 'install-folder' });
  return out;
}

export function findCloudflared(o: CloudflaredLookup = {}): CloudflaredFound | null {
  const exists = o.exists ?? existsSync;
  return cloudflaredCandidates(o).find((c) => exists(c.path)) ?? null;
}

// ── cloudflared output ──────────────────────────────────────────────────────

export type CloudflaredEvent = { kind: 'url'; url: string } | { kind: 'registered' };

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Events in a chunk of cloudflared's log output (the quick-tunnel URL, a registered connection). */
export function parseCloudflaredOutput(text: string): CloudflaredEvent[] {
  const out: CloudflaredEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = QUICK_URL.exec(line);
    // "Requesting new quick Tunnel on trycloudflare.com..." has no subdomain, so it doesn't match.
    if (m && !/api\.trycloudflare\.com/.test(m[0])) out.push({ kind: 'url', url: `${m[0]}/` });
    if (/Registered tunnel connection/i.test(line)) out.push({ kind: 'registered' });
  }
  return out;
}

// ── join URL ────────────────────────────────────────────────────────────────

export interface JoinState {
  mode: TransportMode;
  /** The LAN join URL (self-signed HTTPS, a provided cert, or plain HTTP); '' in `tunnel` mode. */
  lanUrl: string;
  tunnel: TunnelState;
  tunnelUrl: string;
  /** In `auto`, the grace period for the tunnel to come up has passed (see lanQrAfterMs). */
  graceOver: boolean;
  /** The tunnel is `down` but cloudflared will be restarted for a new address (still worth waiting for). */
  restarting?: boolean;
}

/**
 * The address the QR code shows. The tunnel when it is up (no certificate warning, works through
 * Wi-Fi client isolation); in `auto` the LAN URL when the tunnel is down for good or slow to start;
 * '' while waiting (the TV shows "starting the cloud tunnel…", /qr.svg answers 503).
 */
export function chooseJoinUrl(s: JoinState): string {
  if (s.mode === 'lan') return s.lanUrl;
  if (s.tunnel === 'up' && s.tunnelUrl) return s.tunnelUrl;
  if (s.mode === 'tunnel') return '';
  const waiting = s.tunnel === 'starting' || (s.tunnel === 'down' && !!s.restarting);
  return waiting && !s.graceOver ? '' : s.lanUrl;
}

/**
 * `--lan-qr-after <seconds>|never`: in `auto`, how long the TV shows "starting the cloud tunnel…"
 * before falling back to the Wi-Fi (self-signed) QR code while the tunnel is still getting ready.
 * `never`: only once the tunnel has given up. Default TUNNEL_GRACE_MS. Returns ms (Infinity = never).
 */
export function lanQrAfterMs(v: string | undefined): number {
  if (v === undefined) return TUNNEL_GRACE_MS;
  if (/^never$/i.test(v.trim())) return Infinity;
  const s = Number(v);
  if (v.trim() === '' || !Number.isFinite(s) || s < 0) throw new Error(`--lan-qr-after must be a number of seconds or "never" (got "${v}")`);
  return Math.round(s * 1000);
}

// ── per-phone route ─────────────────────────────────────────────────────────

/** Cloudflare adds cf-ray / cf-connecting-ip to every request it forwards to the origin. */
export function classifyWsRoute(headers: Record<string, string | string[] | undefined>, remoteAddress: string | undefined): WsRoute {
  if (headers['cf-ray'] !== undefined || headers['cf-connecting-ip'] !== undefined) return 'tunnel';
  const ra = (remoteAddress ?? '').replace(/^::ffff:/, '');
  if (ra === '127.0.0.1' || ra === '::1' || ra === '') return 'local';
  return 'lan';
}

/**
 * Offer the direct-path upgrade? `auto` offers it to phones that joined through the tunnel (LAN
 * phones already have a direct WebSocket); `on` to every phone (tests); `off` to none.
 */
export function shouldOfferRtc(policy: RtcPolicy, route: WsRoute, available: boolean): boolean {
  if (!available || policy === 'off') return false;
  return policy === 'on' || route === 'tunnel';
}

export function deviceRoute(online: boolean, rtcOpen: boolean, wsRoute: WsRoute | undefined): Route {
  if (!online) return 'offline';
  if (rtcOpen) return 'direct';
  return wsRoute ?? 'local';
}

// ── gesture de-duplication ──────────────────────────────────────────────────

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
