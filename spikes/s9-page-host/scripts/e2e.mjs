// S9 end-to-end: no Node game host. The TV page hosts the session; the real S1 phone controller
// (mobile emulation, "Touch: on") joins it from the QR link through the local signalling relay and
// WebRTC data channels, gets a chart part, and taps every note of a short song; the game judges.
//   npm run build && node scripts/e2e.mjs [--song silent-night] [--diff easy] [--relay] [--shots]
// --origin=http://127.0.0.1:18961 runs against `npm run worker` (wrangler dev: the real Worker + Durable Object).
// --relay forces the phone↔TV path through a local TURN server (node-turn), like AP-isolated Wi-Fi.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const outDir = join(root, 'results');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const song = opt('song', 'silent-night');
const diff = opt('diff', 'easy');
const relay = argv.includes('--relay');
const unavailable = argv.includes('--trial-unavailable');
const fallback = unavailable || argv.includes('--trial-fallback');
const trial = fallback || argv.includes('--trial');
const shots = argv.includes('--shots');
const port = Number(opt('port', '18964'));
const turnPort = port + 1;
const room = trial ? 'T1234567890A' : relay ? 'E2ERLY' : 'E2E001';
const initialRoom = trial ? 'E2E001' : room;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --origin=<url>: use an already-running signalling service (`npm run worker`, i.e. wrangler dev).
const external = opt('origin', '');
assert.ok(!trial || (!external && !relay), 'the fake trial provider requires the local server and unforced ICE');
const base = external || `http://127.0.0.1:${port}`;
let serverLog = '';
const server = external
  ? null
  : await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [tsx, 'server/dev-server.ts', '--port', String(port), '--host', '127.0.0.1', '--no-stun', ...(relay || fallback ? ['--turn-port', String(turnPort)] : [])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const on = (d) => {
    serverLog += d.toString();
    if (serverLog.includes('S9 dev server')) resolve(p);
  };
  p.stdout.on('data', on);
  p.stderr.on('data', on);
  p.on('exit', (c) => reject(new Error(`dev server exited ${c}:\n${serverLog}`)));
});

const browser = await chromium.launch({
  channel: opt('channel', 'chrome'),
  headless: !argv.includes('--headed'),
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader'],
});
async function check() {
  const errors = [];
  // TV page: hosts the session. ICE test switches are forwarded to phones through the QR link.
  const ice = relay ? `&turn=${encodeURIComponent(`turn:127.0.0.1:${turnPort}?transport=udp`)}&tu=s9&tc=s9-local&relay=1` : '&ice=none';
  const game = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const owner = 'a'.repeat(64);
  const hostTicket = 'b'.repeat(64);
  const invite = 'c'.repeat(64);
  const expiresAt = Date.now() + 120_000;
  const grants = [];
  const fakeTrial = async (route) => {
    const req = route.request();
    const auth = req.headers().authorization;
    assert.equal(req.method(), 'POST');
    if (req.url().endsWith('/turn-trial')) {
      assert.equal(auth, `Bearer ${owner}`);
      await route.fulfill({ status: 201, json: { room, hostTicket, invite, expiresAt } });
      return;
    }
    grants.push(auth);
    if (unavailable) {
      await route.fulfill({ status: 503, json: { error: 'relay-unavailable' } });
      return;
    }
    await route.fulfill({ json: {
      expiresAt,
      iceServers: [{ urls: `turn:127.0.0.1:${turnPort}?transport=udp`, username: 's9', credential: 's9-local' }],
    } });
  };
  if (trial) await game.route('**/turn-trial**', fakeTrial);
  await game.addInitScript(() => {
    window.__exitCalls = 0;
    window.Capacitor = { Plugins: { App: {
      addListener: (_, back) => { window.__capBack = back; },
      exitApp: async () => { window.__exitCalls++; },
    } } };
  });
  game.on('pageerror', (e) => errors.push(`game: ${e}`));
  const tvT0 = Date.now();
  await game.goto(`${base}/?room=${initialRoom}${ice}&song=${song}&diff=${diff}&ringers=1&form=short&waitPhones=1&start=play&startDelay=3000`);
  if (trial) {
    await game.getByRole('button', { name: 'Relay trial…' }).click();
    await game.getByLabel('Relay trial owner key').fill(owner);
    await game.locator('#s9-badge form button').click();
    await game.waitForFunction(() => window.__s9host?.trialState === 'ready');
  }
  await game.waitForFunction((r) => window.__s9host?.signalState === 'open' &&
    (document.getElementById('join-url')?.textContent ?? '').includes(`/c/?r=${r}`), room, { timeout: 20000 });
  const tvReadyMs = Date.now() - tvT0;
  const joinUrl = (await game.textContent('#join-url')).trim();
  if (trial) {
    const url = new URL(joinUrl);
    assert.equal(url.search, `?r=${room}&trial=1`);
    assert.equal(url.hash, `#invite=${invite}`);
  }
  console.log(`TV hosting after ${tvReadyMs} ms`);

  // An Android remote may send centre with no KeyboardEvent.code; the app's Back callback
  // must pop the inner picker before closing a dialog or asking the shell to exit.
  await game.waitForFunction(() => document.querySelector('#seating .part'));
  if (trial) await game.locator('#btn-play').focus();
  await game.keyboard.press('ArrowDown');
  const centre = () => game.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  const back = () => game.evaluate(() => window.__capBack());
  const focus = (selector) => game.locator(`${selector}:focus`).count();
  await centre(); // Round options
  await centre(); // Edit seating
  await centre(); // Pick a player for the first part
  assert.equal(await focus('#seating .picker'), 1, 'code-less centre opens the seating picker');
  await back();
  assert.equal(await focus('#seating .part'), 1, 'Back closes only the picker');
  await back();
  assert.equal(await focus('#edit-seating'), 1, 'Back restores the seating launcher');
  await back();
  assert.equal(await focus('#open-round'), 1, 'Back restores the lobby launcher');
  assert.equal(await game.evaluate(() => window.__exitCalls), 0, 'Back in a panel never exits');

  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  if (trial) await phone.route('**/turn-trial**', fakeTrial);
  if (fallback) {
    // Disable candidate gathering only for the first (STUN-only) phone connection.
    await phone.addInitScript(() => {
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(config) {
          super(config?.iceTransportPolicy === 'all' ? { iceServers: [], iceTransportPolicy: 'relay' } : config);
        }
      };
    });
  }
  phone.on('pageerror', (e) => errors.push(`phone: ${e}`));
  const phoneT0 = Date.now();
  await phone.goto(joinUrl);
  await phone.fill('#name', 'Pixel');
  await phone.tap('#start');
  await phone.waitForSelector('#main:not([hidden])');
  if (unavailable) {
    const notice = phone.getByText('Relay unavailable.', { exact: false });
    await notice.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await phone.evaluate(() => window.__s9?.route), undefined, 'a failed relay is never reported as the selected route');
    assert.deepEqual(grants, [`Bearer ${invite}`]);
    assert.deepEqual(errors, []);
    console.log('S9 E2E OK: relay unavailable recovery notice');
    return true;
  }
  await phone.tap('#tap-toggle');
  await phone.waitForFunction(() => window.__s9?.open !== undefined, null, { timeout: 20000 });
  const joinMs = Date.now() - phoneT0;
  await sleep(500);
  const timings = await phone.evaluate(() => window.__s9);
  if (trial) {
    assert.deepEqual(grants, fallback ? [`Bearer ${invite}`, `Bearer ${hostTicket}`] : [], 'only failed direct ICE requests protected grants');
    assert.equal(timings.route, fallback ? 'relay' : 'direct');
  }
  console.log(`phone joined in ${joinMs} ms (page load → data channel open): ${JSON.stringify(timings)}`);

  // Assignment reaches the phone: zones in the chart's lane colours.
  await phone.waitForFunction(() => document.querySelectorAll('#zones .zone').length >= 2, null, { timeout: 20000 });
  if (trial) assert.equal(await phone.locator('#main').getAttribute('data-s9-connection'), 'connected');
  const zones = await phone.$$eval('#zones .zone', (els) => els.map((e) => e.querySelector('small')?.textContent ?? ''));
  console.log(`phone zones: ${zones.join(' ')}`);
  await game.waitForFunction(() => window.__i2?.session, null, { timeout: 30000 });

  // Note schedule on the shared wall clock (both pages are in one browser on one PC).
  const plan = await game.evaluate(() => {
    const { team, session } = window.__i2;
    const r = team.ringers[0];
    const bellOf = new Map(r.bells.map((b) => [b.lane, b.id]));
    return r.noteIds.map((id) => {
      const n = team.chart.notes[id];
      return { epoch: performance.timeOrigin + session.perfAtSong(n.time), bell: bellOf.get(n.lane) };
    });
  });
  const zoneBox = {};
  for (const [i, id] of zones.entries()) zoneBox[id] = await phone.locator('#zones .zone').nth(i).boundingBox();
  const bellBox = await phone.locator('#bell').boundingBox();
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  let selected = null;
  console.log(`tapping ${plan.length} notes…`);
  for (const [k, n] of plan.entries()) {
    const lead = n.epoch - 230 - Date.now();
    if (lead > 0) await sleep(lead);
    if (zones.length > 1 && selected !== n.bell && zoneBox[n.bell]) {
      const c = center(zoneBox[n.bell]);
      await phone.touchscreen.tap(c.x, c.y);
      selected = n.bell;
    }
    if (shots && k === Math.floor(plan.length / 2)) {
      await phone.screenshot({ path: join(outDir, 's9-phone.png') });
      await game.screenshot({ path: join(outDir, 's9-tv.png') });
    }
    const wait = n.epoch - Date.now();
    if (wait > 0) await sleep(wait);
    const c = center(bellBox);
    await phone.touchscreen.tap(c.x, c.y);
  }
  // Snapshot the live phones when the song ends, before Back changes the screen or exits.
  const finished = await game.waitForFunction(() => {
    if (document.title !== 'I2_DONE') return false;
    const h = window.__s9host;
    const g = h.gestures;
    return {
      r: window.__i2Result,
      host: {
        stats: h.stats,
        phones: h.session.phones().map((d) => ({ name: d.name, route: d.route, path: d.path, joinMs: d.joinMs })),
        gestures: g.length,
        via: g.reduce((a, x) => ((a[x.via] = (a[x.via] ?? 0) + 1), a), {}),
        // Arrival latency on the host clock: receive time − the phone's synced source time.
        arrival: g.filter((x) => Number.isFinite(x.th)).map((x) => x.rx - x.th),
      },
    };
  }, null, { timeout: 120000, polling: 500 });
  const { r, host } = await finished.jsonValue();
  await finished.dispose();
  const arr = [...host.arrival].sort((a, b) => a - b);
  const q = (p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] * 100) / 100 : null);
  const p = r.players[0];
  const hit = p.perfect + p.great + p.good;
  const summary = {
    when: new Date().toISOString(),
    browser: `${browser.browserType().name()} ${browser.version()}`,
    relay,
    song,
    diff,
    tvReadyMs,
    joinMs,
    phoneTimings: timings,
    zones,
    notes: p.notes,
    hit,
    perfect: p.perfect,
    miss: p.miss,
    strays: p.strays,
    offsetMs: p.offsetMs,
    input: r.hgp.input,
    host: { ...host, arrival: undefined, arrivalMs: { n: arr.length, p50: q(0.5), p95: q(0.95), max: q(0.999) } },
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!argv.includes('--no-report') && !trial) writeFileSync(join(outDir, `e2e${external ? '-worker' : ''}${relay ? '-relay' : ''}.json`), JSON.stringify({ ...summary, signal: external || 'dev-server' }, null, 2));
  const routeOk = host.phones[0]?.route === (relay || fallback ? 'relay' : 'direct');
  const ok = hit / p.notes >= 0.8 && errors.length === 0 && routeOk;
  if (!routeOk) console.log(`unexpected route at song completion: ${JSON.stringify(host.phones)}`);

  assert.equal(await focus('#btn-again'), 1, 'Results focuses Again');
  await back();
  assert.equal(await focus('#btn-play'), 1, 'Back from results restores Play');
  assert.equal(await game.evaluate(() => window.__exitCalls), 0, 'Back from results never exits');
  await back();
  assert.equal(await game.evaluate(() => window.__exitCalls), 1, 'Back exits only at the top-level lobby');
  return ok;
}
let ok;
try {
  ok = await check();
} finally {
  await browser.close();
  server?.kill();
}
if (!unavailable) {
  console.log(ok ? 'S9 E2E OK' : 'S9 E2E FAILED');
  process.exit(ok ? 0 : 1);
}
