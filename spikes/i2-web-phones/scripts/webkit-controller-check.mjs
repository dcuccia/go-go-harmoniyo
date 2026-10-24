// WebKit smoke test for the phone controller (#27): S1's real phone page in Playwright WebKit with an
// iPhone profile, over HTTPS with the host's self-signed certificate, against the real S1 host and the
// built I2 game (TV page in Chrome). An early Safari-engine signal, NOT a substitute for a real iPhone:
// see "What emulation can't show" in the written report.
//
// Covers: Tap to start (stubbed DeviceMotionEvent.requestPermission, called inside the tap), Web Audio
// unlock on the tap, joining + "Pick your part", zones + next-zone glow during a song, and synthetic
// devicemotion rings (calibration, lobby practice, then rung on the song's notes) that reach the host.
//
//   npx playwright-core install webkit        # once (Linux CI: add --with-deps)
//   npm run build && node scripts/webkit-controller-check.mjs [--device="iPhone 15"] [--song=jingle-bells]
//       [--diff=easy] [--port=18700] [--channel=chrome] [--headed] [--shots]
// Writes results/webkit-controller-check.json and .md.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const s1 = join(root, '..', 's1-phone-bell');
const tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const outDir = join(root, 'results');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const deviceName = opt('device', 'iPhone 15');
const song = opt('song', 'jingle-bells');
const diff = opt('diff', 'easy');
const port = Number(opt('port', '18700'));
const httpsPort = port + 363;
const headless = !argv.includes('--headed');
const shots = argv.includes('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!devices[deviceName]) throw new Error(`unknown Playwright device "${deviceName}"`);

const checks = [];
function check(name, ok, detail = '') {
  const status = ok === null ? 'skip' : ok ? 'pass' : 'fail';
  checks.push({ name, status, detail });
  console.log(`  ${{ pass: '✓', fail: '✗', skip: '–' }[status]} ${name}${detail ? ` — ${detail}` : ''}`);
}
const errors = [];

// ── page-side instrumentation for the phone (runs before the controller's scripts) ──────────────
function phoneInit() {
  const wk = (window.__wk = { calls: [], inGesture: false, audioStub: false, motionNative: typeof window.DeviceMotionEvent === 'function', rpNative: false, motionVia: '' });
  // "Inside the tap": between a capturing and a bubbling click listener on window, i.e. synchronously
  // within the Tap-to-start handler (the strict form of iOS's user-activation rule).
  window.addEventListener('click', () => (wk.inGesture = true), true);
  window.addEventListener('click', () => (wk.inGesture = false), false);
  const log = (what) => wk.calls.push({ what, inGesture: wk.inGesture, t: performance.now() });

  // DeviceMotionEvent (secure contexts only in WebKit). Stub requestPermission like iOS 13+ Safari.
  if (typeof window.DeviceMotionEvent !== 'function') {
    window.DeviceMotionEvent = class DeviceMotionEvent extends Event {};
  }
  const DME = window.DeviceMotionEvent;
  wk.rpNative = typeof DME.requestPermission === 'function';
  Object.defineProperty(DME, 'requestPermission', {
    configurable: true,
    value: () => {
      log('requestPermission');
      return Promise.resolve('granted');
    },
  });

  // Web Audio: record when the context is created, resumed and the silent unlock buffer started.
  // Playwright's Windows WebKit has no Web Audio at all: stub it (and skip the unlock check) so the
  // rest of the controller can be exercised; Linux/macOS WebKit use the real implementation.
  if (typeof window.AudioContext !== 'function' && typeof window.webkitAudioContext !== 'function') {
    wk.audioStub = true;
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, start() {}, stop() {}, ...extra });
    window.AudioContext = class AudioContext {
      state = 'suspended';
      sampleRate = 48000;
      baseLatency = 0;
      outputLatency = 0;
      destination = node();
      get currentTime() {
        return performance.now() / 1000;
      }
      createBuffer() {
        return {};
      }
      createBufferSource() {
        return node({ buffer: null });
      }
      createGain() {
        return node({ gain: param() });
      }
      createOscillator() {
        return node({ frequency: param() });
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
    };
  }
  const AC = window.AudioContext ?? window.webkitAudioContext;
  wk.contexts = [];
  class Recorded extends AC {
    constructor(...a) {
      super(...a);
      log('new AudioContext');
      wk.contexts.push(this);
    }
    resume() {
      log('AudioContext.resume');
      return super.resume();
    }
    createBufferSource() {
      const s = super.createBufferSource();
      const start = s.start.bind(s);
      s.start = (...a) => {
        if (s.buffer && s.buffer.length === 1) log('unlock buffer start');
        return start(...a);
      };
      return s;
    }
  }
  window.AudioContext = Recorded;
  if (window.webkitAudioContext) window.webkitAudioContext = Recorded;

  // Synthetic motion on a 60 Hz sample grid (WebKit off-device never fires devicemotion). A ring is a
  // 100 ms ramp of rotation rate around one axis to 700 °/s and an abrupt stop, so its sharpest
  // deceleration — the detected strike time — lands on the scheduled time `at` (performance.now()
  // timeline). Timers in Playwright's Windows WebKit tick at ~32 Hz, so each tick dispatches every
  // sample due since the last one with its own timeStamp (like a sensor delivering a batch).
  const rings = [];
  const omega = (t) => {
    for (const at of rings) {
      if (t >= at - 110 && t < at - 10) return (700 * (t - (at - 110))) / 100;
    }
    return 0;
  };
  const motionEvent = (init, timeStamp) => {
    let e = null;
    try {
      e = new DeviceMotionEvent('devicemotion', init);
      if (e.rotationRate?.beta !== init.rotationRate.beta) e = null;
      else wk.motionVia = 'DeviceMotionEvent constructor';
    } catch {
      e = null;
    }
    if (!e) {
      e = new Event('devicemotion');
      for (const k of Object.keys(init)) Object.defineProperty(e, k, { value: init[k] });
      wk.motionVia = 'Event + defined properties';
    }
    Object.defineProperty(e, 'timeStamp', { value: timeStamp });
    return e;
  };
  wk.ringAt = (epochMs) => rings.push(epochMs - performance.timeOrigin);
  wk.samples = 0;
  const step = 1000 / 60;
  let next = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (next < now - 150) next = now; // the page was paused: don't replay a long gap
    const n = () => (Math.random() - 0.5) * 0.2;
    for (; next <= now; next += step) {
      const init = {
        acceleration: { x: n(), y: n(), z: n() },
        accelerationIncludingGravity: { x: n(), y: n(), z: 9.81 + n() },
        rotationRate: { alpha: n(), beta: omega(next), gamma: n() },
        interval: step,
      };
      wk.samples++;
      window.dispatchEvent(motionEvent(init, next));
    }
    while (rings.length && rings[0] < now - 1000) rings.shift();
  }, 8);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const host = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [tsx, 'src/host/server.ts', '--no-open', '--game', join(root, 'dist'), '--http-port', String(port), '--port', String(httpsPort)], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
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

const tvBrowser = await chromium.launch({ channel: opt('channel', 'chrome'), headless, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const wkBrowser = await webkit.launch({ headless });
const env = { device: deviceName, webkit: wkBrowser.version(), tv: `Chrome ${tvBrowser.version()}`, platform: `${process.platform} ${process.arch}`, node: process.version };
console.log(`WebKit ${env.webkit} (${deviceName}) on ${env.platform}; TV: ${env.tv}`);
const summary = {};
let ok = false;
try {
  // TV (game) page: two parts so the phone has something to pick.
  const tv = await tvBrowser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('pageerror', (e) => errors.push(`tv: ${e}`));
  await tv.goto(`http://127.0.0.1:${port}/game/?song=${song}&diff=${diff}&ringers=2&seed=7`);
  await tv.waitForFunction(() => window.__i2?.cards?.length === 2, null, { timeout: 20000 });
  await tv.evaluate(() => {
    window.__rings = [];
    window.__i2.link.ringListeners.add((e) => window.__rings.push({ deviceId: e.deviceId, g: e.g, bell: e.bell, synced: e.th !== undefined }));
  });

  // Phone: iPhone profile in WebKit, HTTPS with the self-signed certificate.
  const ctx = await wkBrowser.newContext({ ...devices[deviceName], ignoreHTTPSErrors: true });
  await ctx.addInitScript(phoneInit);
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e}`));
  phone.on('console', (m) => m.type() === 'error' && errors.push(`phone console: ${m.text()}`));
  const resp = await phone.goto(`https://127.0.0.1:${httpsPort}/`);
  const pre = await phone.evaluate(() => ({ secure: window.isSecureContext, warning: document.getElementById('secure')?.textContent ?? '', ua: navigator.userAgent, wk: { motionNative: window.__wk.motionNative, rpNative: window.__wk.rpNative, audioStub: window.__wk.audioStub }, wakeLockApi: 'wakeLock' in navigator, audioSessionApi: 'audioSession' in navigator }));
  Object.assign(env, { ua: pre.ua, nativeDeviceMotionEvent: pre.wk.motionNative, nativeRequestPermission: pre.wk.rpNative, webAudio: pre.wk.audioStub ? 'missing in this WebKit build (stubbed)' : 'native', wakeLockApi: pre.wakeLockApi, audioSessionApi: pre.audioSessionApi });
  check('controller page loads over HTTPS (self-signed) as a secure context', resp?.ok() && pre.secure && !pre.warning, `HTTP ${resp?.status()}, isSecureContext ${pre.secure}`);

  // 1. Tap to start: permission + audio unlock inside the gesture.
  await phone.fill('#name', 'iPhone');
  await phone.tap('#start');
  await phone.waitForSelector('#main:not([hidden])', { timeout: 10000 });
  await sleep(300);
  const st = await phone.evaluate(() => ({ calls: window.__wk.calls, state: window.__wk.contexts[0]?.state ?? 'none', banner: document.getElementById('banner')?.textContent ?? '' }));
  const call = (w) => st.calls.find((c) => c.what === w);
  check('Tap to start calls DeviceMotionEvent.requestPermission inside the tap', call('requestPermission')?.inGesture === true, JSON.stringify(call('requestPermission') ?? null));
  if (pre.wk.audioStub) check('Web Audio unlock on the tap', null, 'skipped: this WebKit build has no Web Audio (Playwright WebKit on Windows); run on Linux/macOS');
  else {
    const inTap = ['new AudioContext', 'unlock buffer start', 'AudioContext.resume'].every((w) => call(w)?.inGesture === true);
    check('Web Audio unlock on the tap (context created, silent buffer started and resumed inside the tap; running)', inTap && st.state === 'running', `state ${st.state}; ${st.calls.filter((c) => c.what !== 'requestPermission').map((c) => `${c.what}${c.inGesture ? ' (in tap)' : ' (after tap)'}`).join(', ')}`);
  }
  check('calibration starts after Tap to start (uncalibrated phone)', /Calibrating/.test(st.banner), st.banner);

  // 2. Joining + Pick your part.
  const phoneId = await tv
    .waitForFunction(() => window.__i2.link.phones.find((p) => p.name === 'iPhone')?.id ?? false, null, { timeout: 10000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  check('phone joins the host over WSS and appears on the TV', !!phoneId, phoneId ?? 'not in the TV device list');
  await tv.waitForFunction((id) => window.__i2.seats[0] === id, phoneId, { timeout: 8000 }).then(
    () => check('first phone takes the first part', true),
    () => check('first phone takes the first part', false),
  );
  const cards = await phone
    .waitForSelector('#lobby:not([hidden]) #parts .pcard.mine', { timeout: 8000 })
    .then(() => phone.$$eval('#parts .pcard', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())))
    .catch(() => []);
  check('"Pick your part" lists both parts with names, occupant and meter', cards.length === 2 && /You/.test(cards[0]) && /TV plays/.test(cards[1]) && /[●○]{5}/.test(cards[1]), cards.join(' | '));
  await phone.locator('#parts .pcard[data-part="1"]').tap();
  await tv.waitForFunction((id) => JSON.stringify(window.__i2.seats) === JSON.stringify(['tv', id]), phoneId, { timeout: 8000 }).then(
    () => check('tapping a part the TV plays claims it', true),
    () => check('tapping a part the TV plays claims it', false),
  );
  if (shots) await phone.screenshot({ path: join(outDir, 'webkit-iphone-part-picker.png') });

  // 3. Calibration (6 synthetic rings), then lobby practice rings that must reach the host (TV).
  const ringNow = async (n, gapMs) => {
    const t0 = Date.now() + 300;
    for (let i = 0; i < n; i++) await phone.evaluate((at) => window.__wk.ringAt(at), t0 + i * gapMs);
    await sleep(300 + n * gapMs + 300);
  };
  await ringNow(6, 600);
  const cal = await phone.evaluate(() => ({ axis: localStorage.getItem('hgp-ring-axis'), banner: document.getElementById('banner')?.textContent ?? '', status: document.getElementById('status')?.textContent ?? '', samples: window.__wk.samples, via: window.__wk.motionVia }));
  env.motionEvents = cal.via;
  check('6 synthetic rings calibrate the swing axis', !!cal.axis && !/uncalibrated/.test(cal.status), `axis ${cal.axis}; ${cal.samples} devicemotion events via ${cal.via}; phone status: ${cal.status}`);
  const before = await tv.evaluate((id) => window.__rings.filter((r) => r.deviceId === id).length, phoneId);
  await ringNow(4, 600);
  const practice = await tv.evaluate(([id, n]) => window.__rings.filter((r) => r.deviceId === id).slice(n), [phoneId, before]);
  check('synthetic motion rings reach the host (lobby practice: 4 rings, synced source times)', practice.length === 4 && practice.every((r) => r.g === 'ring' && r.synced), `${practice.length} received: ${practice.map((r) => `${r.g}${r.synced ? '' : ' (unsynced)'}`).join(', ')}`);

  // 4. Song: zones + next-zone glow, ring each note by touching its zone and swinging.
  await tv.click('#btn-play');
  await tv.waitForFunction(() => window.__i2?.session, null, { timeout: 20000 });
  await phone.waitForFunction(() => document.querySelectorAll('#zones .zone').length >= 2, null, { timeout: 15000 }).catch(() => {});
  const zones = await phone.$$eval('#zones .zone', (els) => els.map((e) => ({ id: e.querySelector('small')?.textContent ?? '', color: getComputedStyle(e).getPropertyValue('--zone').trim() })));
  const part = await tv.evaluate(() => {
    const { team, session } = window.__i2;
    const r = team.ringers.find((x) => x.index === 1);
    const bellOf = new Map(r.bells.map((b) => [b.lane, b.id]));
    return {
      bells: r.bells.map((b) => ({ id: b.id, color: b.color })),
      plan: r.noteIds.map((id) => {
        const n = team.chart.notes[id];
        return { epoch: performance.timeOrigin + session.perfAtSong(n.time), bell: bellOf.get(n.lane) };
      }),
    };
  });
  const zoneIds = zones.map((z) => z.id);
  const phoneBells = part.bells.slice(0, 4).map((b) => b.id);
  check('zones show the part’s bells (low → high, like the highway)', zoneIds.join() === phoneBells.join(), `${zoneIds.join(' ')} vs part ${phoneBells.join(' ')}`);
  const plan = part.plan.filter((n) => zoneIds.includes(n.bell));
  const boxes = {};
  for (const [i, id] of zoneIds.entries()) boxes[id] = await phone.locator('#zones .zone').nth(i).boundingBox();
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  let selected = null;
  let glowOk = 0;
  let glowChecked = 0;
  console.log(`  ringing ${plan.length} notes on ${zoneIds.join(' ')}…`);
  for (const [k, n] of plan.entries()) {
    const lead = n.epoch - 300 - Date.now();
    if (lead > 0) await sleep(lead);
    if (lead > -100) {
      glowChecked++;
      const at = Date.now();
      const next = await phone.$eval('#zones .zone.next small', (e) => e.textContent).catch(() => null);
      const due = (t) => plan.find((p) => p.epoch > t - 120)?.bell;
      if (next === due(at) || next === due(at - 60)) glowOk++;
    }
    if (selected !== n.bell && boxes[n.bell]) {
      const c = center(boxes[n.bell]);
      await phone.touchscreen.tap(c.x, c.y);
      selected = n.bell;
    }
    await phone.evaluate((at) => window.__wk.ringAt(at), n.epoch);
    if (shots && k === Math.floor(plan.length / 2)) await phone.screenshot({ path: join(outDir, 'webkit-iphone-controller.png') });
  }
  check('the next zone glows for the upcoming note', glowChecked > 0 && glowOk / glowChecked >= 0.8, `${glowOk}/${glowChecked} samples`);
  await tv.waitForFunction(() => document.title === 'I2_DONE', null, { timeout: 120000, polling: 500 }).catch(() => {});
  const r = await tv.evaluate(() => window.__i2Result ?? null);
  const p = r?.players?.find((x) => x.name === 'iPhone') ?? r?.players?.[1];
  const hit = p ? p.perfect + p.great + p.good : 0;
  // Notes closer than ~260 ms can't all be rung by this synthetic swing (100 ms ramp + the detector's
  // 150 ms refractory time); a real ringer has the same limit with one bell.
  const close = plan.filter((n, i) => i > 0 && n.epoch - plan[i - 1].epoch < 260).length;
  Object.assign(summary, { song, diff, zones: zoneIds, notes: p?.notes ?? plan.length, rung: plan.length, notesUnder260msApart: close, hit, perfect: p?.perfect, miss: p?.miss, strays: p?.strays, offsetMs: p?.offsetMs, glow: `${glowOk}/${glowChecked}`, input: r?.hgp?.input });
  check('motion rings during the song are judged as hits (≥ 70 % of notes)', p && hit / p.notes >= 0.7, p ? `${hit}/${p.notes} hit (perfect ${p.perfect}, miss ${p.miss}, strays ${p.strays}; ${close} notes < 260 ms after the previous one), offset ${JSON.stringify(p.offsetMs)}` : 'no results');
  if (shots) await tv.screenshot({ path: join(outDir, 'webkit-tv-results.png') });

  check('no page errors', errors.length === 0, errors.join(' | '));
  ok = checks.every((c) => c.status !== 'fail');
} catch (e) {
  check('script completed', false, String(e).split('\n')[0]);
  ok = false;
} finally {
  await wkBrowser.close();
  await tvBrowser.close();
  host.kill();
}

const at = new Date().toISOString();
writeFileSync(join(outDir, 'webkit-controller-check.json'), JSON.stringify({ at, ok, env, summary, checks, errors }, null, 2));
const icon = { pass: '✅', fail: '❌', skip: '⏭️' };
const md = `# WebKit smoke test: phone controller (iPhone emulation)

Generated by \`node scripts/webkit-controller-check.mjs\` (#27) on ${at}. Result: **${ok ? 'OK' : 'FAILED'}**.

An early Safari-engine signal, **not** a substitute for a real iPhone (#31, #34).

| | |
|---|---|
| Phone | Playwright WebKit ${env.webkit}, \`${env.device}\` profile (${env.ua ?? '?'}) |
| TV | ${env.tv} (headless${headless ? '' : ': off'}) |
| Host | ${env.platform}, Node ${env.node}; S1 host over HTTPS (self-signed) + the built I2 game |
| Native \`DeviceMotionEvent\` / \`requestPermission\` | ${env.nativeDeviceMotionEvent} / ${env.nativeRequestPermission} (stubbed to resolve \`granted\`) |
| Synthetic motion events | ${env.motionEvents ?? '?'} |
| Web Audio | ${env.webAudio ?? '?'} |
| \`navigator.wakeLock\` / \`navigator.audioSession\` present | ${env.wakeLockApi} / ${env.audioSessionApi} |

| Check | Result | Detail |
|---|---|---|
${checks.map((c) => `| ${c.name} | ${icon[c.status]} | ${String(c.detail).replace(/\|/g, '\\|')} |`).join('\n')}

## What emulation can't show

- **Real sensors.** WebKit off-device never fires \`devicemotion\`; the rings here are synthetic
  rotation-rate ramps. Real swing detection, calibration and false-ring rates need a real iPhone
  (#34). The permission prompt itself is stubbed: the check only shows that the controller *calls*
  \`DeviceMotionEvent.requestPermission\` inside the Tap-to-start gesture and uses the answer.
- **The silent switch.** No ring/silent switch or iOS audio session here, so whether the bell is
  audible on an iPhone (and whether \`navigator.audioSession.type = 'playback'\` helps) is untested.
  Web Audio is checked only for the unlock sequence and the context reaching \`running\`.
- **The real certificate bypass.** The context ignores HTTPS errors; Safari's *Show Details → visit
  this website* flow and how long iOS remembers the exception are not exercised (#35).
- **Wake Lock.** Whether the screen stays awake (and whether iOS grants \`navigator.wakeLock\`) can't be
  seen headless.
- **Backgrounding.** Locking the phone, switching apps and coming back (WebSocket teardown, timers
  paused, reconnect with the same seat; #36) are not simulated.
- Also: iOS Safari's real touch latency, 120 Hz displays, Low Power Mode and memory pressure. The
  WebKit build is Playwright's (desktop WebKit with an iPhone user agent, viewport and touch), not
  iOS Safari; Playwright's Windows WebKit has no Web Audio at all.
`;
writeFileSync(join(outDir, 'webkit-controller-check.md'), md);
console.log(ok ? `WEBKIT CONTROLLER CHECK OK (${checks.filter((c) => c.status === 'pass').length} passed, ${checks.filter((c) => c.status === 'skip').length} skipped)` : `WEBKIT CONTROLLER CHECK FAILED (${checks.filter((c) => c.status === 'fail').length}/${checks.length} failed)`);
process.exit(ok ? 0 : 1);
