// Reconnect / takeover E2E (no hardware): real S1 host serving the built game, S1 phone pages in mobile
// emulation. Regression test for the 2026-10-25 "joining thrash": two tabs with the same deviceId (the
// TV's corner QR scanned again on a phone that already plays) kicked each other off every ~660 ms.
//   1. A second tab of a joined phone shows "connected in another tab — Use this tab" without connecting.
//   2. "Use this tab" takes over once (host: one `replaced`), the old tab stands by; stable afterwards.
//   3. Re-scan mid-song: the playing tab stays connected and its rings still reach the host.
//   4. Two pages that can't coordinate (separate browser profiles sharing a deviceId): at most one
//      takeover, then stable — the host's `replaced` + client standby is the backstop.
//   5. Without Web Locks (iOS Safari < 15.4): the localStorage heartbeat does the same as 1–2.
//   npm run build && node scripts/takeover-e2e.mjs [--headed] [--channel=msedge] [--port=18800]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const s1 = join(root, '..', 's1-phone-bell');
const tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const outDir = join(root, 'results');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const port = Number(opt('port', '18800'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SONG = 'we-wish-you-a-merry-christmas';

const host = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [tsx, 'src/host/server.ts', '--no-open', '--game', join(root, 'dist'), '--http-port', String(port), '--port', String(port + 363)], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const t = setTimeout(() => reject(new Error(`host did not start:\n${buf}`)), 30000);
  const on = (d) => {
    buf += d.toString();
    if (buf.includes('Game (TV)')) {
      clearTimeout(t);
      resolve(p);
    }
  };
  p.stdout.on('data', on);
  p.stderr.on('data', on);
  p.on('exit', (c) => reject(new Error(`host exited ${c}:\n${buf}`)));
});

const checks = [];
const errors = [];
const evidence = {};
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const waitCheck = (p, name, detail = '') => p.then(() => check(name, true, detail), (e) => check(name, false, String(e).split('\n')[0]));

const browser = await chromium.launch({
  channel: opt('channel', 'chrome'),
  headless: !argv.includes('--headed'),
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader'],
});
let ok = false;
try {
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const game = await tv.newPage();
  game.on('pageerror', (e) => errors.push(`game: ${e}`));
  game.on('console', (m) => m.type() === 'error' && errors.push(`game console: ${m.text()}`));
  await game.goto(`http://127.0.0.1:${port}/game/?song=${SONG}&diff=easy&ringers=2&seed=3`);
  await game.waitForFunction(() => window.__i2?.cards?.length === 2 && window.__i2.link.info?.session, null, { timeout: 20000 });
  // Count device broadcasts reaching the game, and watch whether a phone ever drops offline.
  await game.evaluate(() => {
    const link = window.__i2.link;
    const prev = link.onDevices;
    window.__dev = { n: 0, offline: {} };
    link.onDevices = (phones) => {
      window.__dev.n++;
      for (const p of phones) if (!p.online) window.__dev.offline[p.id] = (window.__dev.offline[p.id] ?? 0) + 1;
      prev(phones);
    };
  });
  const session = await game.evaluate(() => window.__i2.link.info.session);
  const eventsFile = join(s1, 'data', session, 'events.ndjson');
  /** Host event log: hellos / replaced / disconnects / gestures for one deviceId. */
  function log(id) {
    const lines = existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const mine = lines.filter((e) => e.deviceId === id);
    return {
      hello: mine.filter((e) => e.msg?.type === 'hello').length,
      takeoverHello: mine.filter((e) => e.msg?.type === 'hello' && e.msg.takeover === true).length,
      replaced: mine.filter((e) => e.type === 'replaced').length,
      disconnect: mine.filter((e) => e.type === 'disconnect').length,
      gesturesAfter: (rx) => mine.filter((e) => e.msg?.type === 'gesture' && e.rx > rx).length,
      lastRx: lines.reduce((m, e) => Math.max(m, e.rx ?? e.at ?? 0), 0),
    };
  }
  const devCount = () => game.evaluate(() => window.__dev.n);
  const seatNames = () => game.evaluate(() => window.__i2.seats.map((id) => (id === 'tv' || id === 'keyboard' ? id : window.__i2.link.phones.find((p) => p.id === id)?.name ?? id)));

  const pageOf = async (ctx, name) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`http://127.0.0.1:${port}/`);
    return page;
  };
  const startPhone = async (page, name) => {
    await page.fill('#name', name);
    await page.tap('#start');
    await page.waitForSelector('#main:not([hidden])');
  };
  const connected = (page) => page.evaluate(() => /^connected/.test(document.querySelector('#status').textContent ?? ''));
  const overlay = (page) => page.evaluate(() => {
    const el = document.querySelector('#takeover');
    return el && !el.hidden ? el.dataset.reason : null;
  });
  const deviceIdOf = (page) => page.evaluate(() => localStorage.getItem('hgp-device-id'));

  // 1. Alice joins; a second tab of her phone (QR scanned again) does not connect.
  const alice = await browser.newContext({ ...devices['Pixel 7'] });
  const a = await pageOf(alice, 'Alice tab A');
  await startPhone(a, 'Alice');
  const aliceId = await deviceIdOf(a);
  await waitCheck(game.waitForFunction(() => JSON.stringify(window.__i2.seats.slice(0, 1)) !== '["tv"]', null, { timeout: 10000 }), 'Alice is seated');
  await waitCheck(a.waitForFunction(() => /^connected/.test(document.querySelector('#status').textContent ?? ''), null, { timeout: 8000 }), 'tab A connected');
  const b = await pageOf(alice, 'Alice tab B');
  await waitCheck(b.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'tab B (same phone) shows "connected in another tab" on load');
  check('tab B offers "Use this tab" and explains the other tab keeps playing', (await overlay(b)) === 'other-tab' && /another tab/.test(await b.textContent('#takeover')) && (await b.isVisible('#takeover-use')));
  await sleep(2500);
  let L = log(aliceId);
  check('tab B did not connect (host saw one hello, no replacement)', L.hello === 1 && L.replaced === 0, JSON.stringify({ hello: L.hello, replaced: L.replaced }));
  check('tab A is still connected and not in standby', (await connected(a)) && (await overlay(a)) === null);

  // 2. "Use this tab": exactly one takeover, then stable; the TV keeps Alice's seat and never sees her offline.
  const dev0 = await devCount();
  await b.tap('#takeover-use');
  await waitCheck(b.waitForFunction(() => /^connected/.test(document.querySelector('#status').textContent ?? '') && !document.querySelector('#main').hidden, null, { timeout: 8000 }), 'tab B takes over (connected, bell screen)');
  await waitCheck(a.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'tab A shows the takeover screen');
  check('tab A says another tab took over', (await overlay(a)) === 'replaced', await a.textContent('#takeover-msg'));
  await sleep(6000);
  L = log(aliceId);
  evidence.takeover = { hello: L.hello, takeoverHello: L.takeoverHello, replaced: L.replaced, disconnect: L.disconnect, deviceBroadcasts6s: (await devCount()) - dev0 };
  check('one takeover, then stable for 6 s (no ping-pong)', L.hello === 2 && L.takeoverHello === 1 && L.replaced === 1, JSON.stringify(evidence.takeover));
  check('tab A stays off (no auto-reconnect)', !(await connected(a)) && (await overlay(a)) === 'replaced');
  check('the TV never saw Alice offline', L.disconnect === 0 && !(await game.evaluate((id) => window.__dev.offline[id] ?? 0, aliceId)));
  check('device broadcasts to the TV stay calm (heartbeat-level, ≤ 5 in 6 s)', evidence.takeover.deviceBroadcasts6s <= 5, String(evidence.takeover.deviceBroadcasts6s));
  check('Alice keeps her seat', JSON.stringify((await seatNames())[0]) === '"Alice"', (await seatNames()).join(' / '));

  // Back to tab A (taking over again is one more clean switch), then B goes away.
  await a.tap('#takeover-use');
  await waitCheck(a.waitForFunction(() => /^connected/.test(document.querySelector('#status').textContent ?? '') && document.querySelector('#takeover').hidden, null, { timeout: 8000 }), 'tab A takes back over');
  await waitCheck(b.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'tab B stands by');
  await sleep(1500);
  L = log(aliceId);
  check('switching back is one more takeover', L.hello === 3 && L.replaced === 2, JSON.stringify({ hello: L.hello, replaced: L.replaced }));
  await b.close();

  // 3. Mid-song re-scan: the playing tab keeps playing.
  await game.click('#btn-play');
  await waitCheck(game.waitForFunction(() => !document.querySelector('#hud').classList.contains('hidden'), null, { timeout: 15000 }), 'round starts');
  const c = await pageOf(alice, 'Alice tab C (re-scan mid-song)');
  const t0 = log(aliceId).lastRx;
  await waitCheck(c.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 're-scan mid-song: the new tab shows the takeover screen');
  // Ring on tab A (touch mode) while tab C sits there.
  await a.evaluate(() => document.querySelector('#bell').classList.add('tappable'));
  for (let k = 0; k < 4; k++) {
    await a.dispatchEvent('#bell', 'pointerdown');
    await sleep(400);
  }
  await sleep(2500);
  L = log(aliceId);
  evidence.rescan = { hello: L.hello, replaced: L.replaced, disconnect: L.disconnect, gestures: L.gesturesAfter(t0) };
  check('re-scan mid-song: no new connection, no replacement', L.hello === 3 && L.replaced === 2 && L.disconnect === 0, JSON.stringify(evidence.rescan));
  check('the playing tab stays connected and its rings reach the host', (await connected(a)) && (await overlay(a)) === null && evidence.rescan.gestures >= 4, `${evidence.rescan.gestures} gestures`);
  check('the TV keeps the round as it was', JSON.stringify((await seatNames())[0]) === '"Alice"');
  await c.close();

  // 4. Two pages that can't coordinate (separate profiles, same deviceId): the host's `replaced` is the backstop.
  const dup = 'dev-dup-bob';
  const ctxs = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    await ctx.addInitScript((id) => localStorage.setItem('hgp-device-id', id), dup);
    ctxs.push(ctx);
  }
  const p1 = await pageOf(ctxs[0], 'Bob profile 1');
  const p2 = await pageOf(ctxs[1], 'Bob profile 2');
  check('separate profiles cannot see each other (no takeover screen on load)', (await overlay(p1)) === null && (await overlay(p2)) === null);
  await startPhone(p1, 'Bob');
  await waitCheck(p1.waitForFunction(() => /^connected/.test(document.querySelector('#status').textContent ?? ''), null, { timeout: 8000 }), 'Bob profile 1 connected');
  await startPhone(p2, 'Bob');
  await waitCheck(p1.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'the older page stands by when the newer one connects');
  const tDup = Date.now();
  await sleep(8000);
  L = log(dup);
  evidence.noCoordination = { hello: L.hello, replaced: L.replaced, disconnect: L.disconnect, windowMs: Date.now() - tDup };
  check('no ping-pong: one replacement, then stable for 8 s', L.hello === 2 && L.replaced === 1, JSON.stringify(evidence.noCoordination));
  check('newest page wins and stays connected; the old one stays off', (await connected(p2)) && !(await connected(p1)));

  // 5. No Web Locks (iOS Safari < 15.4, which also lacks BroadcastChannel): the localStorage heartbeat.
  const old = await browser.newContext({ ...devices['Pixel 7'] });
  await old.addInitScript(() => {
    delete Navigator.prototype.locks;
  });
  const o1 = await pageOf(old, 'Cara tab 1 (no Web Locks)');
  check('fallback: navigator.locks is gone', await o1.evaluate(() => !('locks' in navigator)));
  await startPhone(o1, 'Cara');
  const caraId = await deviceIdOf(o1);
  await waitCheck(o1.waitForFunction(() => /^connected/.test(document.querySelector('#status').textContent ?? ''), null, { timeout: 8000 }), 'fallback: tab 1 connected');
  const o2 = await pageOf(old, 'Cara tab 2 (no Web Locks)');
  await waitCheck(o2.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'fallback: tab 2 shows the takeover screen without connecting');
  await o2.tap('#takeover-use');
  await waitCheck(o1.waitForSelector('#takeover:not([hidden])', { timeout: 5000 }), 'fallback: Use this tab → tab 1 stands by');
  await sleep(5000);
  L = log(caraId);
  evidence.fallback = { hello: L.hello, replaced: L.replaced, disconnect: L.disconnect };
  check('fallback: one takeover, then stable for 5 s', L.hello === 2 && L.replaced === 1 && (await connected(o2)) && !(await connected(o1)), JSON.stringify(evidence.fallback));

  check('no page errors', errors.length === 0, errors.join(' | '));
  ok = checks.every((x) => x.ok);
} finally {
  await browser.close();
  host.kill();
}

writeFileSync(join(outDir, 'takeover-e2e.json'), JSON.stringify({ at: new Date().toISOString(), ok, evidence, checks }, null, 2));
console.log(ok ? `TAKEOVER E2E OK (${checks.length} checks)` : `TAKEOVER E2E FAILED (${checks.filter((x) => !x.ok).length}/${checks.length} failed)`);
process.exit(ok ? 0 : 1);
