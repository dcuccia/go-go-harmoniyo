/**
 * S1 host harness: serves the phone controller + dashboard, speaks HGP v0 over WebSocket
 * (and optionally a WebRTC data channel), runs scripted timing tests, and logs everything.
 *
 *   npm start                      # HTTPS (self-signed) on the LAN + http://localhost dashboard
 *   npm start -- --cert c.pem --key k.pem --hostname bells.example.com   # publicly trusted cert
 *   npm run tunnel                 # Cloudflare quick tunnel (cloud relay), no cert needed
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as esbuild from 'esbuild';
import QRCode from 'qrcode';
import { generate as generateCert } from 'selfsigned';
import { WebSocket, WebSocketServer } from 'ws';
import { bellBlock, DEFAULT_BELLS, HGP_VERSION, parseMessage, type Bell, type SoundMode, type TestKind } from '../core/hgp.ts';
import {
  analyzeClink,
  analyzeIdle,
  analyzeMetronome,
  clinkMarkdown,
  idleMarkdown,
  metronomeMarkdown,
  type DeviceLabel,
  type LoggedGesture,
} from './analysis.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB = join(ROOT, 'src', 'web');
const DIST = join(ROOT, 'dist', 'web');

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '8443' },
    'http-port': { type: 'string', default: '8080' },
    ip: { type: 'string' },
    cert: { type: 'string' },
    key: { type: 'string' },
    hostname: { type: 'string' },
    'public-url': { type: 'string' },
    tunnel: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    'no-https': { type: 'boolean', default: false },
  },
});

const now = () => performance.now();
const SESSION = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DATA = join(ROOT, 'data', SESSION);
mkdirSync(DATA, { recursive: true });
const EVENTS_LOG = join(DATA, 'events.ndjson');
const SUMMARY = join(DATA, 'summary.md');

function logEvent(o: unknown): void {
  appendFileSync(EVENTS_LOG, JSON.stringify(o) + '\n');
}

// ── network ─────────────────────────────────────────────────────────────────

function lanCandidates(): { name: string; address: string; score: number }[] {
  const out: { name: string; address: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      const fam = a.family as string | number;
      if ((fam !== 'IPv4' && fam !== 4) || a.internal) continue;
      let score = 0;
      if (/wi-?fi|wlan|wireless|^en0$|ethernet|^eth/i.test(name)) score += 2;
      if (/vethernet|virtualbox|vmware|wsl|hyper-v|docker|tailscale|zerotier|bluetooth|vpn|loopback/i.test(name)) score -= 10;
      if (a.address.startsWith('192.168.')) score += 3;
      else if (a.address.startsWith('10.')) score += 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 1;
      if (a.address.startsWith('169.254.')) score -= 20;
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const candidates = lanCandidates();
const LAN_IP = args.ip ?? candidates[0]?.address ?? '127.0.0.1';
const HTTPS_PORT = Number(args.port);
const HTTP_PORT = Number(args['http-port']);

async function tlsOptions(): Promise<{ key: string; cert: string; mode: string }> {
  if (args.cert && args.key) {
    return { key: readFileSync(args.key, 'utf8'), cert: readFileSync(args.cert, 'utf8'), mode: 'provided certificate' };
  }
  const dir = join(ROOT, 'certs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `selfsigned-${LAN_IP}.json`);
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8')) as { key: string; cert: string; expires: number };
    if (c.expires > Date.now() + 86_400_000) return { key: c.key, cert: c.cert, mode: 'self-signed (cached)' };
  }
  const notAfterDate = new Date(Date.now() + 30 * 86_400_000);
  const pems = await generateCert([{ name: 'commonName', value: `handbell-hero ${LAN_IP}` }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: LAN_IP },
          { type: 7, ip: '127.0.0.1' },
          { type: 2, value: 'localhost' },
        ],
      },
    ],
  });
  writeFileSync(file, JSON.stringify({ key: pems.private, cert: pems.cert, expires: notAfterDate.getTime() }));
  return { key: pems.private, cert: pems.cert, mode: 'self-signed (new)' };
}

// ── web bundle ──────────────────────────────────────────────────────────────

async function buildWeb(): Promise<void> {
  await esbuild.build({
    entryPoints: {
      controller: join(WEB, 'controller.ts'),
      dashboard: join(WEB, 'dashboard.ts'),
      meter: join(WEB, 'meter.ts'),
    },
    bundle: true,
    format: 'esm',
    target: ['es2020', 'safari15', 'chrome100'],
    outdir: DIST,
    sourcemap: 'linked',
    logLevel: 'warning',
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

let joinUrl = '';
let tlsMode = 'none';

function sendFile(res: http.ServerResponse, path: string): void {
  if (!existsSync(path)) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = path.slice(path.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(path));
}

async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  if (p === '/' || p === '/c' || p === '/controller') return sendFile(res, join(WEB, 'controller.html'));
  if (p === '/dashboard') return sendFile(res, join(WEB, 'dashboard.html'));
  if (p === '/meter') return sendFile(res, join(WEB, 'meter.html'));
  if (p === '/style.css') return sendFile(res, join(WEB, 'style.css'));
  if (p === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (p.startsWith('/dist/') && /^[\w./-]+$/.test(p) && !p.includes('..')) return sendFile(res, join(DIST, p.slice('/dist/'.length)));
  if (p === '/qr.svg') {
    const svg = await QRCode.toString(url.searchParams.get('u') ?? joinUrl, { type: 'svg', margin: 1 });
    res.writeHead(200, { 'content-type': MIME['.svg'] }).end(svg);
    return;
  }
  if (p === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(info()));
    return;
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const name = (url.searchParams.get('name') ?? 'upload.bin').replace(/[^\w.-]/g, '_');
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 100 * 1024 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      const file = join(DATA, `${Date.now()}-${name}`);
      writeFileSync(file, Buffer.concat(chunks));
      logEvent({ type: 'upload', file, size, at: now() });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, file }));
    });
    return;
  }
  res.writeHead(404).end('not found');
}

// ── devices & HGP ───────────────────────────────────────────────────────────

interface Device {
  id: string;
  name: string;
  kind: string;
  ua: string;
  hello: Record<string, unknown>;
  status: Record<string, unknown>;
  ws: WebSocket | null;
  rtc: { send: (s: string) => void; close: () => void } | null;
  bells: Bell[];
  connectedAt: number;
  lastSeen: number;
  events: number;
}

const devices = new Map<string, Device>();
const dashboards = new Set<WebSocket>();
const gestures: LoggedGesture[] = [];
let soundMode: SoundMode = 'device';

interface RunningTest {
  id: string;
  kind: TestKind;
  start: number;
  end: number;
  period?: number;
  beats?: number[];
  deviceIds: string[];
  expect?: Record<string, string[]>;
}
let running: RunningTest | null = null;
let testTimer: NodeJS.Timeout | null = null;

function info() {
  return {
    session: SESSION,
    joinUrl,
    tlsMode,
    lanIp: LAN_IP,
    candidates,
    hostTime: now(),
    soundMode,
    rtcAvailable: werift !== null,
    test: running,
  };
}

function send(ws: WebSocket | null, o: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
}

function toDashboards(o: unknown): void {
  const s = JSON.stringify(o);
  for (const d of dashboards) if (d.readyState === WebSocket.OPEN) d.send(s);
}

function deviceLabel(d: Device): DeviceLabel {
  const st = d.status;
  return {
    id: d.id,
    name: d.name,
    ua: d.ua,
    api: typeof st.api === 'string' ? st.api : undefined,
    rateHz: typeof st.rateHz === 'number' ? st.rateHz : undefined,
    rttP50: typeof st.rttP50 === 'number' ? st.rttP50 : undefined,
    rttMin: typeof st.rttMin === 'number' ? st.rttMin : undefined,
  };
}

function deviceSummary(d: Device) {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    ua: d.ua,
    online: d.ws?.readyState === WebSocket.OPEN,
    rtc: d.rtc !== null,
    bells: d.bells,
    status: d.status,
    events: d.events,
    lastSeen: d.lastSeen,
  };
}

function broadcastDevices(): void {
  toDashboards({ type: 'devices', hostTime: now(), devices: [...devices.values()].map(deviceSummary), soundMode, bellsPerPhone, test: running });
}

let bellsPerPhone = 1;

/** Next free block of `bellsPerPhone` consecutive bells. */
function nextBells(): Bell[] {
  const used = new Set([...devices.values()].flatMap((d) => d.bells.map((b) => b.id)));
  for (let start = 0; start < DEFAULT_BELLS.length; start += bellsPerPhone) {
    const block = bellBlock(start, bellsPerPhone);
    if (block.every((b) => !used.has(b.id))) return block;
  }
  return bellBlock(devices.size * bellsPerPhone, bellsPerPhone);
}

function sendAssign(d: Device): void {
  const msg = { type: 'assign', bells: d.bells, sound: soundMode, select: d.bells.length > 1 ? 'zones' : 'single' };
  send(d.ws, msg);
}

/** Handle a device message from any transport. `reply` answers on the same transport. */
function handleDeviceMessage(d: Device, m: Record<string, unknown> & { type: string }, rx: number, reply: (o: unknown) => void, via: string): void {
  d.lastSeen = rx;
  switch (m.type) {
    case 'sync':
      reply({ type: 'sync', id: m.id, t0: m.t0, t1: rx, t2: now() });
      return;
    case 'gesture': {
      d.events++;
      const th = typeof m.th === 'number' ? m.th : NaN;
      const lead = typeof m.t === 'number' && typeof m.sel === 'number' ? m.t - m.sel : undefined;
      const bellId = typeof m.bell === 'string' ? m.bell : d.bells[0].id;
      const g: LoggedGesture = { deviceId: d.id, g: String(m.g), seq: Number(m.seq), th, rx, det: typeof m.det === 'number' ? m.det : undefined, via, bell: bellId, lead };
      gestures.push(g);
      logEvent({ dir: 'in', via, rx, deviceId: d.id, msg: m });
      const bell = DEFAULT_BELLS.find((b) => b.id === bellId) ?? d.bells[0];
      toDashboards({ type: 'event', deviceId: d.id, name: d.name, bell, msg: m, rx, via, soundMode });
      return;
    }
    case 'raw':
      appendFileSync(join(DATA, `raw-${d.id}.ndjson`), JSON.stringify({ rx, ...m }) + '\n');
      return;
    case 'status':
      d.status = m;
      return;
    case 'result':
      logEvent({ dir: 'in', via, rx, deviceId: d.id, msg: m });
      appendFileSync(SUMMARY, `\n### ${String(m.test)} result from ${d.name} (${new Date().toLocaleString()})\n\n\`\`\`json\n${JSON.stringify(m.data, null, 2)}\n\`\`\`\n`);
      toDashboards({ type: 'device-result', deviceId: d.id, name: d.name, msg: m });
      return;
    case 'rtc':
      if (m.kind === 'offer' && typeof m.sdp === 'string') void answerRtc(d, m.sdp);
      return;
    default:
      logEvent({ dir: 'in', via, rx, deviceId: d.id, msg: m });
  }
}

// ── tests ───────────────────────────────────────────────────────────────────

function phones(): Device[] {
  return [...devices.values()].filter((d) => d.kind !== 'dashboard' && d.kind !== 'meter' && d.ws?.readyState === WebSocket.OPEN);
}

function startTest(cmd: Record<string, unknown>): void {
  stopTest(false);
  const kind = String(cmd.test) as TestKind;
  const id = `${kind}-${Date.now()}`;
  const lead = 4000;
  const deviceIds = phones().map((d) => d.id);
  let t: RunningTest;
  if (kind === 'metronome') {
    const bpm = Number(cmd.bpm ?? 80);
    const count = Number(cmd.count ?? 100);
    const period = 60_000 / bpm;
    const start = now() + lead;
    const beats = Array.from({ length: count }, (_, i) => start + i * period);
    const expect: Record<string, string[]> = {};
    t = { id, kind, start: start - period / 2, end: beats[count - 1] + period, period, beats, deviceIds, expect };
    for (const d of phones()) {
      // Multi-bell: a random melody over this phone's bells (changes bell on ~70 % of beats).
      let e: string[] | undefined;
      if (cmd.multi && d.bells.length > 1) {
        let k = 0;
        e = beats.map(() => {
          if (Math.random() < 0.7) k = (k + 1 + Math.floor(Math.random() * (d.bells.length - 1))) % d.bells.length;
          return d.bells[k].id;
        });
        expect[d.id] = e;
      }
      send(d.ws, { type: 'test', action: 'start', id, test: kind, start, period, count, expect: e });
    }
  } else {
    const durationMs = Number(cmd.durationMs ?? 60_000);
    const start = now() + 1500;
    t = { id, kind, start, end: start + durationMs, deviceIds };
    for (const d of phones()) send(d.ws, { type: 'test', action: 'start', id, test: kind, start, durationMs });
  }
  running = t;
  logEvent({ type: 'test-start', at: now(), test: t, devices: phones().map(deviceLabel) });
  toDashboards({ type: 'test-state', test: t, hostTime: now() });
  testTimer = setTimeout(() => stopTest(true), t.end - now() + 1500);
}

function stopTest(analyze: boolean): void {
  if (testTimer) clearTimeout(testTimer);
  testTimer = null;
  const t = running;
  if (!t) return;
  running = null;
  for (const d of phones()) send(d.ws, { type: 'test', action: 'stop', id: t.id, test: t.kind });
  toDashboards({ type: 'test-state', test: null, hostTime: now() });
  if (!analyze) return;
  const labels = t.deviceIds.map((id) => devices.get(id)).filter((d): d is Device => !!d).map(deviceLabel);
  let md = '';
  let data: unknown;
  if (t.kind === 'metronome' && t.beats && t.period) {
    const r = analyzeMetronome(t.beats, t.period, labels, gestures, t.expect);
    data = r;
    md = metronomeMarkdown(r);
  } else if (t.kind === 'idle') {
    const r = analyzeIdle(labels, gestures, t.start, t.end);
    data = r;
    md = idleMarkdown(r);
  } else if (t.kind === 'clink' || t.kind === 'latency') {
    const r = analyzeClink(labels.filter((l) => gestures.some((g) => g.deviceId === l.id && g.th >= t.start && g.th <= t.end)), gestures, t.start, t.end);
    data = r;
    md = r.length ? clinkMarkdown(r) : '_Clink pairing needs impact events from at least two phones._';
  }
  const header = `\n## ${t.kind} test ${t.id} (${new Date().toLocaleString()})\n\n`;
  appendFileSync(SUMMARY, header + md + '\n');
  writeFileSync(join(DATA, `results-${t.id}.json`), JSON.stringify({ test: t, devices: [...devices.values()].map(deviceSummary), data }, null, 2));
  toDashboards({ type: 'results', test: t, markdown: md, data });
  console.log(header + md);
}

function handleDashboardCommand(m: Record<string, unknown>): void {
  switch (m.cmd) {
    case 'test':
      startTest(m);
      break;
    case 'stop':
      stopTest(true);
      break;
    case 'sound':
      soundMode = String(m.sound) as SoundMode;
      for (const d of devices.values()) sendAssign(d);
      break;
    case 'assign': {
      // Give this phone the block of bells starting at `bellId`.
      const d = devices.get(String(m.deviceId));
      const start = DEFAULT_BELLS.findIndex((x) => x.id === m.bellId);
      if (d && start >= 0) {
        d.bells = bellBlock(start, bellsPerPhone);
        sendAssign(d);
      }
      break;
    }
    case 'bells': {
      // Re-deal consecutive blocks of n bells to every phone.
      bellsPerPhone = Math.max(1, Math.min(4, Number(m.n) || 1));
      [...devices.values()]
        .filter((d) => d.kind === 'phone')
        .forEach((d, i) => {
          d.bells = bellBlock(i * bellsPerPhone, bellsPerPhone);
          sendAssign(d);
        });
      break;
    }
    case 'config': {
      const targets = m.deviceId === 'all' ? phones() : [devices.get(String(m.deviceId))].filter((d): d is Device => !!d);
      for (const d of targets) send(d.ws, { type: 'config', ...(m.config as object) });
      break;
    }
  }
  logEvent({ type: 'cmd', at: now(), m });
  broadcastDevices();
}

// ── WebRTC (optional, experimental) ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let werift: any = null;
try {
  const name = 'werift';
  werift = await import(name);
} catch {
  werift = null;
}

async function answerRtc(d: Device, offerSdp: string): Promise<void> {
  if (!werift) {
    send(d.ws, { type: 'rtc', kind: 'error', error: 'werift not installed on host' });
    return;
  }
  try {
    d.rtc?.close();
    const pc = new werift.RTCPeerConnection({ iceServers: [] });
    pc.onDataChannel.subscribe((dc: { onMessage: { subscribe: (f: (data: string | Buffer) => void) => void }; send: (s: string) => void }) => {
      const replyRtc = (o: unknown) => dc.send(JSON.stringify(o));
      d.rtc = { send: (s) => dc.send(s), close: () => void pc.close() };
      broadcastDevices();
      dc.onMessage.subscribe((data) => {
        const rx = now();
        const m = parseMessage(typeof data === 'string' ? data : data.toString());
        if (m) handleDeviceMessage(d, m, rx, replyRtc, 'rtc');
      });
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const t0 = Date.now();
    while (pc.iceGatheringState !== 'complete' && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50));
    send(d.ws, { type: 'rtc', kind: 'answer', sdp: pc.localDescription.sdp });
  } catch (e) {
    console.error('rtc error', e);
    send(d.ws, { type: 'rtc', kind: 'error', error: String(e) });
  }
}

// ── WebSocket server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let dev: Device | null = null;
  let isDashboard = false;
  ws.on('message', (raw) => {
    const rx = now();
    const m = parseMessage(raw.toString());
    if (!m) return;
    if (m.type === 'hello') {
      const kind = String(m.kind ?? 'phone');
      if (kind === 'dashboard') {
        isDashboard = true;
        dashboards.add(ws);
        send(ws, { type: 'welcome', v: HGP_VERSION, deviceId: 'dashboard', session: SESSION, hostTime: now(), info: info() });
        broadcastDevices();
        return;
      }
      const id = String(m.deviceId ?? `dev-${Math.random().toString(36).slice(2, 8)}`);
      const existing = devices.get(id);
      if (existing?.ws && existing.ws !== ws) existing.ws.close();
      dev = existing ?? {
        id,
        name: String(m.name ?? id),
        kind,
        ua: String(m.ua ?? ''),
        hello: m,
        status: {},
        ws,
        rtc: null,
        bells: nextBells(),
        connectedAt: rx,
        lastSeen: rx,
        events: 0,
      };
      dev.ws = ws;
      dev.hello = m;
      dev.name = String(m.name ?? dev.name);
      dev.ua = String(m.ua ?? dev.ua);
      devices.set(id, dev);
      logEvent({ dir: 'in', via: 'ws', rx, deviceId: id, msg: m });
      send(ws, { type: 'welcome', v: HGP_VERSION, deviceId: id, session: SESSION, hostTime: now() });
      sendAssign(dev);
      if (running) {
        const t = running;
        if (!t.deviceIds.includes(id)) t.deviceIds.push(id);
        send(ws, { type: 'test', action: 'start', id: t.id, test: t.kind, start: t.beats?.[0] ?? t.start, period: t.period, count: t.beats?.length, durationMs: t.end - t.start });
      }
      broadcastDevices();
      return;
    }
    if (isDashboard) {
      if (m.type === 'cmd') handleDashboardCommand(m);
      else if (m.type === 'sync') send(ws, { type: 'sync', id: m.id, t0: m.t0, t1: rx, t2: now() });
      return;
    }
    if (dev) handleDeviceMessage(dev, m, rx, (o) => send(ws, o), 'ws');
  });
  ws.on('close', () => {
    if (isDashboard) dashboards.delete(ws);
    if (dev && dev.ws === ws) {
      dev.ws = null;
      logEvent({ type: 'disconnect', at: now(), deviceId: dev.id });
    }
    broadcastDevices();
  });
});

setInterval(broadcastDevices, 1000);

// ── listeners ───────────────────────────────────────────────────────────────

function attach(server: http.Server | https.Server): void {
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/hgp') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

function openBrowser(url: string): void {
  if (args['no-open']) return;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore
  }
}

async function printJoin(url: string): Promise<void> {
  joinUrl = url;
  console.log(`\n  Phones: scan this or open ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  toDashboards({ type: 'info', info: info() });
}

function startTunnel(): void {
  console.log('Starting Cloudflare quick tunnel (cloudflared)…');
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${HTTP_PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', () => {
    console.error('\n  cloudflared not found. Install it (Windows: winget install --id Cloudflare.cloudflared; macOS: brew install cloudflared) and retry.\n');
  });
  const scan = (buf: Buffer) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m && !joinUrl.startsWith(m[0])) void printJoin(`${m[0]}/`);
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  process.on('exit', () => child.kill());
}

async function main(): Promise<void> {
  await buildWeb();
  const local = http.createServer((req, res) => void handleHttp(req, res));
  attach(local);
  // Loopback only (dashboard + cloudflared) unless --no-https, where it is the phones' listener too.
  local.listen(HTTP_PORT, args['no-https'] ? '0.0.0.0' : '127.0.0.1');
  // 127.0.0.1, not "localhost": on Windows "localhost" may resolve to ::1 where another app can live.
  const dashboardUrl = `http://127.0.0.1:${HTTP_PORT}/dashboard`;

  console.log(`S1 host — session ${SESSION}`);
  console.log(`  Data:      ${DATA}`);
  console.log(`  LAN IPs:   ${candidates.map((c) => `${c.address} (${c.name})`).join(', ') || 'none'}  → using ${LAN_IP} (override with --ip)`);
  console.log(`  RTC:       ${werift ? 'werift available (experimental)' : 'werift not installed — WebRTC disabled'}`);

  if (args.tunnel) {
    tlsMode = 'cloud tunnel (trycloudflare.com)';
    startTunnel();
  } else if (!args['no-https']) {
    const tls = await tlsOptions();
    tlsMode = tls.mode;
    const secure = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => void handleHttp(req, res));
    attach(secure);
    secure.listen(HTTPS_PORT, '0.0.0.0');
    const host = args.hostname ?? LAN_IP;
    const url = args['public-url'] ?? `https://${host}${HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`}/`;
    console.log(`  TLS:       ${tls.mode}`);
    if (!args.cert) console.log('             Phones will show a certificate warning once: tap "Show Details/Advanced" → visit/proceed.');
    await printJoin(url);
  } else {
    tlsMode = 'none (plain HTTP — motion sensors will not work on phones)';
    await printJoin(args['public-url'] ?? `http://${LAN_IP}:${HTTP_PORT}/`);
  }
  console.log(`  Dashboard: ${dashboardUrl}\n`);
  openBrowser(dashboardUrl);
}

process.on('SIGINT', () => {
  stopTest(true);
  console.log(`\nLogs and results: ${DATA}`);
  process.exit(0);
});

await main();
