// S9 measurements on one PC (headless Chrome; both ends local, so this isolates protocol/stack and
// host-page overhead, not Wi-Fi). Compares today's paths with the page host:
//   ws        S1 Node host, WebSocket (/hgp)                       (today: LAN / tunnel)
//   werift    S1 Node host, WebRTC data channel via werift         (today: ADR-0012 direct link)
//   s9-rel    TV page host, reliable 'hgp' data channel            (S9)
//   s9-fast   TV page host, unordered 'hgp-fast' data channel      (S9: gestures + sync)
//   s9-relay  as s9-fast, forced through a local TURN relay        (S9: AP-isolated Wi-Fi / CGNAT stand-in)
//   s9-play   as s9-fast while the TV page is playing a song       (main-thread render load on the host)
// For each: N clock-sync exchanges → RTT (p50/p95/p99/max), jitter (mean |ΔRTT|), loss, offset
// spread; for S9 also the clock-sync error against the truth (both pages share one browser clock).
// Join: N PeerSocket joins per path → time to open and success rate.
//   npm run build && node scripts/measure.mjs [--n 500] [--joins 20]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const s1 = join(root, '..', 's1-phone-bell');
const outDir = join(root, 'results');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : (argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
};
const N = Number(opt('n', '500'));
const JOINS = Number(opt('joins', '20'));
const INTERVAL = Number(opt('interval', '20'));
const S1_PORT = 18966;
const S9_PORT = 18967;
const TURN_PORT = 18968;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(name, cwd, args, ready) {
  return new Promise((resolve, reject) => {
    let log = '';
    const p = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const on = (d) => {
      log += d.toString();
      if (ready.test(log)) resolve(p);
    };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error(`${name} exited ${c}:\n${log}`)));
  });
}

async function waitHttp(url, ms = 60_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`${url} not up`);
}

// ── stats ───────────────────────────────────────────────────────────────────
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
function q(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
}
function syncStats(samples, sent, truth) {
  const pts = samples.map((s) => ({ rtt: s.t3 - s.t0 - (s.t2 - s.t1), offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2, at: s.t0 }));
  const rtts = pts.map((p) => p.rtt);
  const sorted = [...rtts].sort((a, b) => a - b);
  let jit = 0;
  for (let i = 1; i < rtts.length; i++) jit += Math.abs(rtts[i] - rtts[i - 1]);
  const offs = pts.map((p) => p.offset).sort((a, b) => a - b);
  // What ClockSync uses: the minimum-RTT exchange (per 5 s bucket; one bucket ≈ 10 s here → take the global min).
  const best = pts.reduce((a, b) => (b.rtt < a.rtt ? b : a), pts[0] ?? { rtt: NaN, offset: NaN });
  const out = {
    sent,
    received: pts.length,
    lossPct: round((1 - pts.length / sent) * 100, 1),
    rttMs: { min: round(sorted[0]), p50: round(q(sorted, 0.5)), p95: round(q(sorted, 0.95)), p99: round(q(sorted, 0.99)), max: round(sorted.at(-1)) },
    jitterMs: round(jit / Math.max(1, rtts.length - 1)),
    offsetSpreadMs: round(q(offs, 0.95) - q(offs, 0.05)),
  };
  if (Number.isFinite(truth)) {
    const errs = pts.map((p) => Math.abs(p.offset - truth)).sort((a, b) => a - b);
    out.syncErrorMs = { minRttSample: round(Math.abs(best.offset - truth), 3), p50: round(q(errs, 0.5), 3), p95: round(q(errs, 0.95), 3) };
  }
  return out;
}
function joinStats(rows) {
  const ok = rows.filter((r) => r.ok);
  const t = ok.map((r) => r.ms).sort((a, b) => a - b);
  return { tries: rows.length, ok: ok.length, successPct: round((ok.length / Math.max(1, rows.length)) * 100, 1), msToOpen: { p50: round(q(t, 0.5), 1), p95: round(q(t, 0.95), 1), max: round(t.at(-1), 1) }, routes: [...new Set(ok.map((r) => r.route))], failures: rows.filter((r) => !r.ok).map((r) => r.why) };
}

// ── probe code (runs in the page) ───────────────────────────────────────────
const probeBundle = (
  await build({
    stdin: {
      contents: `import { PeerSocket } from './src/peer-socket.ts'; window.PeerSocket = PeerSocket;`,
      resolveDir: root,
      sourcefile: 'probe-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2022',
  })
).outputFiles[0].text;

const probeHelpers = `
window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.measureSync = async (send, n, interval) => {
  const samples = [];
  window.onSync = (text) => {
    const t3 = performance.now();
    let m; try { m = JSON.parse(String(text)); } catch { return; }
    if (m.type === 'sync' && typeof m.t1 === 'number') samples.push({ t0: m.t0, t1: m.t1, t2: m.t2, t3 });
  };
  for (let i = 0; i < n; i++) { send(JSON.stringify({ type: 'sync', id: (i + 1), t0: performance.now() })); await sleep(interval); }
  await sleep(500);
  window.onSync = null;
  return samples;
};
window.hello = (send, id) => send(JSON.stringify({ type: 'hello', v: 0, kind: 'phone', deviceId: id, name: id }));
window.peerJoin = (room, params, timeoutMs = 20000) => new Promise((resolve) => {
  const t0 = performance.now();
  const s = new PeerSocket({ signalOrigin: location.origin, room, peer: 'm-' + Math.random().toString(36).slice(2, 9), params: new URLSearchParams(params), timeoutMs });
  s.onopen = () => {
    const ms = performance.now() - t0;
    // The selected route is read from getStats just after open.
    setTimeout(() => resolve({ s, ok: true, ms, route: s.t.route, path: s.t.path, t: s.t }), 150);
  };
  s.onclose = (e) => resolve({ s, ok: false, ms: performance.now() - t0, why: e.code + ' ' + e.reason });
});
`;

// ── run ────────────────────────────────────────────────────────────────────
const s1Tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const s9Tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const s1Host = await start('s1 host', s1, [s1Tsx, 'src/host/server.ts', '--no-open', '--no-https', '--http-port', String(S1_PORT), '--rtc', 'on'], /RTC:/);
console.log('s1 host started');
await waitHttp(`http://127.0.0.1:${S1_PORT}/`);
console.log('s1 host up');
const s9Dev = await start('s9 dev server', root, [s9Tsx, 'server/dev-server.ts', '--port', String(S9_PORT), '--host', '127.0.0.1', '--no-stun', '--turn-port', String(TURN_PORT)], /S9 dev server/);

const browser = await chromium.launch({
  channel: opt('channel', 'chrome'),
  headless: !argv.includes('--headed'),
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader'],
});
const results = { when: new Date().toISOString(), env: {}, sync: {}, join: {}, notes: [] };
let ok = false;
try {
  results.env = {
    browser: `${browser.browserType().name()} ${browser.version()} (headless)`,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    node: process.version,
    setup: 'all endpoints on one PC over loopback (127.0.0.1); no Wi-Fi, no real phones',
    syncN: N,
    syncIntervalMs: INTERVAL,
  };
  const relayParams = `turn=${encodeURIComponent(`turn:127.0.0.1:${TURN_PORT}?transport=udp`)}&tu=s9&tc=s9-local&relay=1`;
  const tv = async (room, extra = '') => {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto(`http://127.0.0.1:${S9_PORT}/?room=${room}&${extra}`);
    await p.waitForFunction(() => window.__s9host?.signalState === 'open', null, { timeout: 30000 });
    return p;
  };
  console.log('TV pages…');
  const tvIdle = await tv('MEAS01', 'ice=none');
  const tvRelay = await tv('MEAS02', relayParams);

  const probe = await browser.newPage();
  await probe.goto(`http://127.0.0.1:${S9_PORT}/healthz`);
  await probe.addScriptTag({ content: probeBundle });
  await probe.addScriptTag({ content: probeHelpers });
  const origin = (p) => p.evaluate(() => performance.timeOrigin);
  const probeOrigin = await origin(probe);
  // host − local for a host in another page of this browser.
  const truth = async (p) => probeOrigin - (await origin(p));

  console.log('probe ready');
  // 1. Today: WebSocket to the S1 Node host.
  const ws = await probe.evaluate(
    async ({ port, n, interval }) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/hgp`);
      window.s1ws = ws;
      ws.onmessage = (e) => {
        window.onSync?.(e.data);
        window.onWs?.(e.data);
      };
      await new Promise((r) => (ws.onopen = r));
      const welcome = new Promise((r) => (window.onWs = (d) => JSON.parse(d).type === 'welcome' && r()));
      hello((t) => ws.send(t), 'probe-ws');
      await welcome;
      return measureSync((t) => ws.send(t), n, interval);
    },
    { port: S1_PORT, n: N, interval: INTERVAL },
  );
  results.sync.ws = syncStats(ws, N);
  console.log('ws', JSON.stringify(results.sync.ws));

  // 2. Today: werift direct link (ADR-0012), negotiated over that WebSocket. Join timed per try.
  const weriftJoins = [];
  let weriftSamples = [];
  for (let i = 0; i < Math.min(JOINS, 10); i++) {
    const r = await probe.evaluate(
      async ({ measure, n, interval }) => {
        const t0 = performance.now();
        const pc = new RTCPeerConnection({ iceServers: [] });
        const dc = pc.createDataChannel('hgp', { ordered: false, maxRetransmits: 0 });
        dc.onmessage = (e) => window.onSync?.(e.data);
        const opened = new Promise((r, j) => {
          dc.onopen = r;
          setTimeout(() => j(new Error('timeout')), 20000);
        });
        window.onWs = async (d) => {
          const m = JSON.parse(d);
          if (m.type === 'rtc' && m.kind === 'answer') await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        };
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((r) => {
          if (pc.iceGatheringState === 'complete') return r();
          pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r();
          setTimeout(r, 2000);
        });
        window.s1ws.send(JSON.stringify({ type: 'rtc', kind: 'offer', sdp: pc.localDescription.sdp }));
        try {
          await opened;
        } catch (e) {
          pc.close();
          return { ok: false, ms: performance.now() - t0, why: String(e) };
        }
        const ms = performance.now() - t0;
        const samples = measure ? await measureSync((t) => dc.send(t), n, interval) : [];
        pc.close();
        await sleep(200);
        return { ok: true, ms, route: 'direct', samples };
      },
      { measure: i === 0, n: N, interval: INTERVAL },
    );
    if (r.samples?.length) weriftSamples = r.samples;
    weriftJoins.push({ ...r, samples: undefined });
  }
  results.sync.werift = syncStats(weriftSamples, N);
  results.join.werift = joinStats(weriftJoins);
  console.log('werift', JSON.stringify(results.sync.werift), JSON.stringify(results.join.werift));
  results.notes.push('werift join = RTCPeerConnection created → data channel open, over an already-open WebSocket (non-trickle, gathers first; the WS join itself is extra).');

  // 3. S9: PeerSocket to the TV page (reliable and fast), plus forced TURN relay.
  async function s9(room, params, tvPage, label, joins) {
    const rows = [];
    let measured = null;
    for (let i = 0; i < joins; i++) {
      const measure = i === 0;
      const r = await probe.evaluate(
        async ({ room, params, measure, n, interval }) => {
          const j = await peerJoin(room, params);
          const { s, ...row } = j;
          if (!j.ok) return row;
          if (!measure) {
            s.close();
            await sleep(150);
            return row;
          }
          s.onmessage = (e) => window.onSync?.(e.data);
          hello((t) => s.send(t), 'probe-' + Math.random().toString(36).slice(2, 6));
          await sleep(300);
          const rel = await measureSync((t) => s.send(t), n, interval);
          s.fast.onmessage = (e) => window.onSync?.(e.data);
          const fast = await measureSync((t) => s.fast.send(t), n, interval);
          window.keep = s; // left open for the 'playing' run
          return { ...row, rel, fast };
        },
        { room, params, measure, n: N, interval: INTERVAL },
      );
      if (measure) measured = r;
      else await sleep(100);
      rows.push({ ok: r.ok, ms: r.ms, route: r.route, why: r.why });
      if (measure) await probe.evaluate(() => (window.keep?.close(), sleep(200)));
    }
    const t = await truth(tvPage);
    results.join[label] = joinStats(rows);
    console.log(label, JSON.stringify(results.join[label]));
    return { measured, truth: t };
  }
  const direct = await s9('MEAS01', 'ice=none', tvIdle, 's9-direct', JOINS);
  if (direct.measured?.rel) {
    results.sync['s9-rel'] = syncStats(direct.measured.rel, N, direct.truth);
    results.sync['s9-fast'] = syncStats(direct.measured.fast, N, direct.truth);
  }
  const relay = await s9('MEAS02', relayParams, tvRelay, 's9-relay', Math.min(JOINS, 10));
  if (relay.measured?.fast) {
    results.sync['s9-relay-rel'] = syncStats(relay.measured.rel, N, relay.truth);
    results.sync['s9-relay'] = syncStats(relay.measured.fast, N, relay.truth);
  }

  // 4. S9 while the TV page renders a song (the host shares the main thread with the game).
  await tvIdle.close();
  const tvPlay = await tv('MEAS03', 'ice=none&song=silent-night&diff=easy&ringers=1&form=short&waitPhones=1&start=play&startDelay=500');
  const joined = await probe.evaluate(async () => {
    const j = await peerJoin('MEAS03', 'ice=none');
    if (!j.ok) return { ok: false, why: j.why };
    const s = j.s;
    window.playSock = s;
    s.onmessage = (e) => window.onSync?.(e.data);
    hello((t) => s.send(t), 'probe-play');
    await sleep(300);
    // Autostart waits for a phone that reports a synced clock.
    s.send(JSON.stringify({ type: 'status', syncN: 10, syncErr: 0.5 }));
    return { ok: true };
  });
  let playing = false;
  if (joined.ok) {
    playing = await tvPlay
      .waitForFunction(() => !!window.__i2?.session, null, { timeout: 40000 })
      .then(() => true)
      .catch(() => false);
  }
  const play = joined.ok
    ? await probe.evaluate(
        async ({ n, interval }) => {
          const s = window.playSock;
          s.fast.onmessage = (e) => window.onSync?.(e.data);
          return { ok: true, fast: await measureSync((t) => s.fast.send(t), n, interval) };
        },
        { n: N, interval: INTERVAL },
      )
    : joined;
  playing = playing && (await tvPlay.evaluate(() => !!window.__i2?.session));
  if (play.ok) results.sync['s9-play'] = { ...syncStats(play.fast, N, await truth(tvPlay)), songPlaying: playing };
  results.notes.push(`s9-play: TV page was ${playing ? 'playing a song (three.js render loop, headless SwiftShader)' : 'NOT playing (song did not start)'} during the run.`);

  console.log(JSON.stringify(results, null, 2));
  writeFileSync(join(outDir, 'measure.json'), JSON.stringify(results, null, 2));
  ok = !!results.sync['s9-fast'] && results.join['s9-direct'].ok > 0;
} finally {
  await browser.close();
  s1Host.kill();
  s9Dev.kill();
}
console.log(ok ? 'S9 MEASURE OK' : 'S9 MEASURE FAILED');
process.exit(ok ? 0 : 1);
