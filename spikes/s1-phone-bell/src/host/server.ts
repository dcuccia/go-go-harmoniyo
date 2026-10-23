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
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
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
import { ChartLibrary, percentile, YARG_DEFAULT_PORT, YargLink, YargRoom, type Seat } from './yarg.ts';

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
    // I1: forward rings to the YARG fork's HgpBridge (see docs/spikes/I1-yarg-phones.md)
    yarg: { type: 'boolean', default: false },
    'yarg-port': { type: 'string', default: String(YARG_DEFAULT_PORT) },
    'yarg-phones': { type: 'string', default: '4' },
    'yarg-ringers': { type: 'string', default: '4' },
    song: { type: 'string' },
    difficulty: { type: 'string', default: 'expert' },
    charts: { type: 'string' },
    /** Serve a static game build (e.g. spikes/i2-web-phones/dist) at /game/ and open it instead of the dashboard. */
    game: { type: 'string' },
  },
});
const GAME_DIR = args.game ? resolve(args.game) : null;

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
  const pems = await generateCert([{ name: 'commonName', value: `go-go-harmoniyo ${LAN_IP}` }], {
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
  '.json': 'application/json',
  '.png': 'image/png',
  '.mid': 'audio/midi',
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
  if (GAME_DIR && (p === '/game' || p.startsWith('/game/'))) {
    if (p === '/game') {
      res.writeHead(302, { location: '/game/' + url.search }).end();
      return;
    }
    const rel = decodeURIComponent(p.slice('/game/'.length)) || 'index.html';
    const file = normalize(join(GAME_DIR, rel));
    if (!file.startsWith(GAME_DIR + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    return sendFile(res, file);
  }
  if (p === '/qr.svg') {
    // The join URL is empty until a --tunnel URL arrives; QRCode throws on empty input.
    const u = url.searchParams.get('u') || joinUrl;
    if (!u) {
      res.writeHead(503, { 'retry-after': '1' }).end('join URL not ready');
      return;
    }
    const svg = await QRCode.toString(u, { type: 'svg', margin: 1 });
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
  /** Ringer seat shown on the phone (HGP `assign.ringer`, shared with I1's YARG mode). */
  ringer?: { slot: number; title: string; song?: string };
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

// ── YARG sidecar (I1) ───────────────────────────────────────────────────────

const charts = ChartLibrary.load(args.charts ?? join(ROOT, '..', 's5-chart-pipeline', 'charts'));
let yarg: { room: YargRoom; link: YargLink } | null = null;
if (args.yarg) {
  const link = new YargLink(Number(args['yarg-port']), now, (text) => onYargMessage(text));
  const room = new YargRoom({
    maxPhones: Number(args['yarg-phones']),
    ringerCount: Number(args['yarg-ringers']),
    charts,
    song: args.song,
    difficulty: args.difficulty,
    send: (text) => link.send(text),
    now,
    schedule: (fn, ms) => void setTimeout(fn, ms),
    log: (s) => {
      console.log(s);
      logEvent({ type: 'yarg', at: now(), msg: s });
    },
  });
  yarg = { room, link };
  if (args.song && !room.chart) console.warn(`  --song "${args.song}" not found in charts (${charts.charts.map((c) => c.song.id).join(', ')})`);
}

function onYargMessage(text: string): void {
  if (!yarg) return;
  logEvent({ type: 'yarg-in', at: now(), text });
  const changed = yarg.room.onSongReport(text);
  if (changed === null) return;
  console.log(`YARG: ${text.trim()}`);
  applySeats(changed);
}

/** Push re-assigned seat bells to their phones. */
function applySeats(seats: Seat[]): void {
  for (const s of seats) {
    const d = s.phoneId ? devices.get(s.phoneId) : undefined;
    if (!d) continue;
    d.bells = s.bells;
    sendAssign(d);
  }
  broadcastDevices();
}

function yargSummary() {
  if (!yarg) return null;
  const { room, link } = yarg;
  return { ...room.summary(), connected: link.connected, port: link.port, bridgeRtt: link.rtt, ageP50: percentile(room.ages, 50), ageP95: percentile(room.ages, 95), songs: charts.charts.map((c) => ({ id: c.song.id, title: c.song.title })) };
}

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
    yarg: yargSummary(),
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
  toDashboards({ type: 'devices', hostTime: now(), devices: [...devices.values()].map(deviceSummary), soundMode, bellsPerPhone, test: running, yarg: yargSummary() });
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
  const seat = yarg?.room.seatOf(d.id);
  const ringer = !yarg ? d.ringer : seat ? { slot: seat.slot, title: yarg.room.seatTitle(seat), song: yarg.room.chart?.song.title } : { slot: -1, title: 'All ringer seats are taken: free play (not sent to YARG)' };
  const msg = { type: 'assign', bells: d.bells, sound: soundMode, select: d.bells.length > 1 ? 'zones' : 'single', ringer };
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
      if (yarg && (g.g === 'ring' || g.g === 'tap')) {
        const lane = yarg.room.ring(d.id, bellId, Number.isFinite(th) ? th : rx - (g.det ?? 0), rx);
        if (lane !== null) logEvent({ type: 'yarg-ring', at: now(), deviceId: d.id, bell: bellId, lane, th });
      }
      const bell = d.bells.find((b) => b.id === bellId) ?? DEFAULT_BELLS.find((b) => b.id === bellId) ?? d.bells[0];
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
      if (yarg) break; // YARG mode: bells come from the chart part
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
      if (yarg) break;
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
    case 'assign-bells': {
      // Explicit bell list for one phone (e.g. a ringer's part from a chart, I2), 1–5 bells, plus
      // an optional ringer seat label (same `assign.ringer` shape as I1's YARG mode).
      const d = devices.get(String(m.deviceId));
      const bells = Array.isArray(m.bells) ? (m.bells as Bell[]).filter((b) => b && typeof b.id === 'string' && typeof b.midi === 'number').slice(0, 5) : [];
      if (d && bells.length) {
        d.bells = bells.map((b) => ({ id: b.id, label: String(b.label ?? b.id), midi: b.midi, color: String(b.color ?? '#888') }));
        const r = m.ringer as { slot?: unknown; title?: unknown; song?: unknown } | undefined;
        d.ringer = r && typeof r.title === 'string' ? { slot: Number(r.slot ?? 0), title: r.title, song: typeof r.song === 'string' ? r.song : undefined } : undefined;
        sendAssign(d);
      }
      break;
    }
    case 'cues': {
      // Upcoming notes for one phone (host time + bell id) so it can glow the next zone.
      const d = devices.get(String(m.deviceId));
      if (d) send(d.ws, { type: 'cues', at: Array.isArray(m.at) ? m.at : [], bells: Array.isArray(m.bells) ? m.bells : [] });
      return; // high volume: skip event log + device broadcast
    }
    case 'config': {
      const targets = m.deviceId === 'all' ? phones() : [devices.get(String(m.deviceId))].filter((d): d is Device => !!d);
      for (const d of targets) send(d.ws, { type: 'config', ...(m.config as object) });
      break;
    }
    case 'yarg-song':
      if (yarg) applySeats(yarg.room.setSong(m.song ? String(m.song) : null, m.difficulty ? String(m.difficulty) : undefined));
      break;
    case 'yarg-remove':
      // Free a ringer seat (removes its YARG bell device); an online phone there becomes free play.
      if (yarg) {
        const seat = yarg.room.seats[Number(m.slot)];
        yarg.room.remove(Number(m.slot));
        const d = seat?.phoneId ? devices.get(seat.phoneId) : undefined;
        if (d) {
          d.bells = nextBells();
          sendAssign(d);
        }
      }
      break;
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
      if (yarg && (kind === 'phone' || kind === 'sim')) {
        const seat = yarg.room.join(id, dev.name);
        if (seat) dev.bells = seat.bells;
      }
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
      const seat = yarg?.room.leave(dev.id);
      if (seat) console.log(`YARG: ${dev.name} left Ringer ${seat.slot + 1} (seat kept for a rejoin or another phone)`);
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

/** A failing request must never take down the host (players would all drop). */
function serveHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  handleHttp(req, res).catch((err: unknown) => {
    console.error(`HTTP ${req.method} ${req.url} failed:`, err);
    if (!res.headersSent) res.writeHead(500).end('internal error');
    else res.end();
  });
}

/**
 * Fail fast if another process already answers on this port. On Windows a 0.0.0.0 bind can succeed
 * next to an existing 127.0.0.1 listener, so clients on 127.0.0.1 would silently reach the other host.
 */
async function assertPortFree(port: number): Promise<void> {
  const inUse = await new Promise<boolean>((done) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); done(true); });
    s.once('timeout', () => { s.destroy(); done(false); });
    s.once('error', () => done(false));
  });
  if (inUse) exitPortInUse(port);
}

function exitPortInUse(port: number): never {
  console.error(`\n  Port ${port} is already in use (another S1/I2 host?). Stop it or pick another port.\n`);
  process.exit(1);
}

function listenOrExit(server: http.Server | https.Server, port: number, host: string): void {
  server.once('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') exitPortInUse(port);
    throw e;
  });
  server.listen(port, host);
}

async function main(): Promise<void> {
  await buildWeb();
  await assertPortFree(HTTP_PORT);
  const local = http.createServer((req, res) => serveHttp(req, res));
  attach(local);
  // Loopback only (dashboard + cloudflared) unless --no-https, where it is the phones' listener too.
  listenOrExit(local, HTTP_PORT, args['no-https'] ? '0.0.0.0' : '127.0.0.1');
  // 127.0.0.1, not "localhost": on Windows "localhost" may resolve to ::1 where another app can live.
  const dashboardUrl = `http://127.0.0.1:${HTTP_PORT}/dashboard`;

  console.log(`S1 host — session ${SESSION}`);
  console.log(`  Data:      ${DATA}`);
  console.log(`  LAN IPs:   ${candidates.map((c) => `${c.address} (${c.name})`).join(', ') || 'none'}  → using ${LAN_IP} (override with --ip)`);
  console.log(`  RTC:       ${werift ? 'werift available (experimental)' : 'werift not installed — WebRTC disabled'}`);
  if (yarg) {
    const { room, link } = yarg;
    await link.start(() => room.announce());
    console.log(`  YARG:      forwarding rings to 127.0.0.1:${link.port} (start YARG with -hgp); ${room.maxPhones} ringer seats, ` +
      `${charts.charts.length} charts, song ${room.chart?.song.title ?? '(from YARG when a song loads)'}, tier ${room.defaultTier}`);
    let lastConnected = false;
    let lastRings = 0;
    setInterval(() => {
      if (link.connected !== lastConnected) {
        lastConnected = link.connected;
        console.log(lastConnected ? `YARG: bridge connected (localhost round trip ${link.rtt.toFixed(2)} ms)` : 'YARG: bridge not answering — is YARG running with -hgp?');
        if (lastConnected) room.announce();
        broadcastDevices();
      }
      if (room.ringsSent !== lastRings) {
        lastRings = room.ringsSent;
        const seats = room.seats.filter((s): s is Seat => !!s).map((s) => `R${s.slot + 1} ${s.name}${s.online ? '' : ' (offline)'}: ${s.rings}`);
        console.log(`YARG: rings sent ${room.ringsSent} [${seats.join(', ')}], source→host age p50 ${percentile(room.ages, 50).toFixed(0)} ms, p95 ${percentile(room.ages, 95).toFixed(0)} ms`);
      }
    }, 5000);
  }

  if (args.tunnel) {
    tlsMode = 'cloud tunnel (trycloudflare.com)';
    startTunnel();
  } else if (!args['no-https']) {
    const tls = await tlsOptions();
    tlsMode = tls.mode;
    await assertPortFree(HTTPS_PORT);
    const secure = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => serveHttp(req, res));
    attach(secure);
    listenOrExit(secure, HTTPS_PORT, '0.0.0.0');
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
  if (GAME_DIR) {
    const gameUrl = `http://127.0.0.1:${HTTP_PORT}/game/`;
    console.log(`  Game (TV): ${gameUrl}   (serving ${GAME_DIR})\n`);
    openBrowser(gameUrl);
  } else openBrowser(dashboardUrl);
}

process.on('SIGINT', () => {
  stopTest(true);
  console.log(`\nLogs and results: ${DATA}`);
  if (yarg) {
    // Remove the virtual bell devices from YARG, then give the datagrams a moment to leave.
    yarg.room.removeAll();
    setTimeout(() => process.exit(0), 200);
    return;
  }
  process.exit(0);
});

await main();
