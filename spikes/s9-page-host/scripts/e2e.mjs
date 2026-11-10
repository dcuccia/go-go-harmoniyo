// S9 end-to-end: no Node game host. The TV page hosts the session; the real S1 phone controller
// (mobile emulation, "Touch: on") joins it from the QR link through the local signalling relay and
// WebRTC data channels, gets a chart part, and taps every note of a short song; the game judges.
//   npm run build && node scripts/e2e.mjs [--song silent-night] [--diff easy] [--relay] [--shots]
// --origin=http://127.0.0.1:18961 runs against `npm run worker` (wrangler dev: the real Worker + Durable Object).
// --relay forces the phone↔TV path through a local TURN server (node-turn), like AP-isolated Wi-Fi.
import { spawn } from 'node:child_process';
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
const shots = argv.includes('--shots');
const port = Number(opt('port', '18964'));
const turnPort = port + 1;
const room = relay ? 'E2ERLY' : 'E2E001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --origin=<url>: use an already-running signalling service (`npm run worker`, i.e. wrangler dev).
const external = opt('origin', '');
const base = external || `http://127.0.0.1:${port}`;
let serverLog = '';
const server = external
  ? null
  : await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [tsx, 'server/dev-server.ts', '--port', String(port), '--host', '127.0.0.1', '--no-stun', ...(relay ? ['--turn-port', String(turnPort)] : [])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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
let ok = false;
try {
  const errors = [];
  // TV page: hosts the session. ICE test switches are forwarded to phones through the QR link.
  const ice = relay ? `&turn=${encodeURIComponent(`turn:127.0.0.1:${turnPort}?transport=udp`)}&tu=s9&tc=s9-local&relay=1` : '&ice=none';
  const game = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  game.on('pageerror', (e) => errors.push(`game: ${e}`));
  const tvT0 = Date.now();
  await game.goto(`${base}/?room=${room}${ice}&song=${song}&diff=${diff}&ringers=1&form=short&waitPhones=1&start=play&startDelay=3000`);
  await game.waitForFunction(() => window.__s9host?.signalState === 'open' && /\/c\/\?r=/.test(document.getElementById('join-url')?.textContent ?? ''), null, { timeout: 20000 });
  const tvReadyMs = Date.now() - tvT0;
  const joinUrl = (await game.textContent('#join-url')).trim();
  console.log(`TV hosting room ${room} after ${tvReadyMs} ms; join link ${joinUrl}`);

  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e}`));
  const phoneT0 = Date.now();
  await phone.goto(joinUrl);
  await phone.fill('#name', 'Pixel');
  await phone.tap('#start');
  await phone.waitForSelector('#main:not([hidden])');
  await phone.tap('#tap-toggle');
  await phone.waitForFunction(() => window.__s9?.open !== undefined, null, { timeout: 20000 });
  const joinMs = Date.now() - phoneT0;
  await sleep(500);
  const timings = await phone.evaluate(() => window.__s9);
  console.log(`phone joined in ${joinMs} ms (page load → data channel open): ${JSON.stringify(timings)}`);

  // Assignment reaches the phone: zones in the chart's lane colours.
  await phone.waitForFunction(() => document.querySelectorAll('#zones .zone').length >= 2, null, { timeout: 20000 });
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
  await game.waitForFunction(() => document.title === 'I2_DONE', null, { timeout: 120000, polling: 500 });
  const r = await game.evaluate(() => window.__i2Result);
  const host = await game.evaluate(() => {
    const h = window.__s9host;
    const g = h.gestures;
    return {
      stats: h.stats,
      phones: h.session.phones().map((d) => ({ name: d.name, route: d.route, path: d.path, joinMs: d.joinMs })),
      gestures: g.length,
      via: g.reduce((a, x) => ((a[x.via] = (a[x.via] ?? 0) + 1), a), {}),
      // Arrival latency on the host clock: receive time − the phone's synced source time.
      arrival: g.filter((x) => Number.isFinite(x.th)).map((x) => x.rx - x.th),
    };
  });
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
  writeFileSync(join(outDir, `e2e${external ? '-worker' : ''}${relay ? '-relay' : ''}.json`), JSON.stringify({ ...summary, signal: external || 'dev-server' }, null, 2));
  const routeOk = host.phones[0]?.route === (relay ? 'relay' : 'direct');
  ok = hit / p.notes >= 0.8 && errors.length === 0 && routeOk;
  if (!routeOk) console.log(`unexpected route: ${JSON.stringify(host.phones)}`);
} finally {
  await browser.close();
  server?.kill();
}
console.log(ok ? 'S9 E2E OK' : 'S9 E2E FAILED');
process.exit(ok ? 0 : 1);
