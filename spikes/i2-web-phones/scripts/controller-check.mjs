// Real-controller check: S1's actual phone page (mobile emulation, "Touch: on" tap mode) joins
// the real host; the game assigns it a chart part; this script taps the cued zone, then the bell,
// at each note's time — exercising assign → zones → cue glow → tap gesture → host relay → judge.
// Motion-sensor ringing itself is covered by S1 (emulation) and needs a real phone.
//   npm run build && node scripts/controller-check.mjs [--song silent-night] [--diff easy] [--shots]
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
const song = opt('song', 'silent-night');
const diff = opt('diff', 'easy');
const shots = argv.includes('--shots');
const port = 18300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const host = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [tsx, 'src/host/server.ts', '--no-open', '--game', join(root, 'dist'), '--http-port', String(port), '--port', String(port + 363)], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const on = (d) => {
    buf += d.toString();
    if (buf.includes('Game (TV)')) resolve(p);
  };
  p.stdout.on('data', on);
  p.stderr.on('data', on);
  p.on('exit', (c) => reject(new Error(`host exited ${c}:\n${buf}`)));
});

const browser = await chromium.launch({ channel: opt('channel', 'chrome'), headless: !argv.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
let ok = false;
try {
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  const errors = [];
  phone.on('pageerror', (e) => errors.push(`phone: ${e}`));
  await phone.goto(`http://127.0.0.1:${port}/`);
  await phone.fill('#name', 'Pixel');
  await phone.tap('#start');
  await phone.waitForSelector('#main:not([hidden])');
  await phone.tap('#tap-toggle');

  const game = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  game.on('pageerror', (e) => errors.push(`game: ${e}`));
  await game.goto(`http://127.0.0.1:${port}/game/?song=${song}&diff=${diff}&ringers=1&form=short&waitPhones=1&start=play&startDelay=3000`);
  // Assignment reaches the phone: 4 zones in the chart's lane colours.
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
  let glowOk = 0;
  let glowChecked = 0;
  console.log(`tapping ${plan.length} notes…`);
  for (const [k, n] of plan.entries()) {
    const lead = n.epoch - 230 - Date.now();
    if (lead > 0) await sleep(lead);
    if (k % 3 === 0) {
      // The phone should be glowing the next note's zone (allow one 50 ms UI refresh of staleness).
      glowChecked++;
      const at = Date.now();
      const next = await phone.$eval('#zones .zone.next small', (e) => e.textContent).catch(() => null);
      const due = (t) => plan.find((p) => p.epoch > t - 120)?.bell;
      if (next === due(at) || next === due(at - 60)) glowOk++;
    }
    if (zones.length > 1 && selected !== n.bell && zoneBox[n.bell]) {
      const c = center(zoneBox[n.bell]);
      await phone.touchscreen.tap(c.x, c.y);
      selected = n.bell;
    }
    if (shots && k === Math.floor(plan.length / 2)) await phone.screenshot({ path: join(outDir, 'i2-phone-controller.png') });
    const wait = n.epoch - Date.now();
    if (wait > 0) await sleep(wait);
    const c = center(bellBox);
    await phone.touchscreen.tap(c.x, c.y);
  }
  await game.waitForFunction(() => document.title === 'I2_DONE', null, { timeout: 120000, polling: 500 });
  const r = await game.evaluate(() => window.__i2Result);
  if (shots) await game.screenshot({ path: join(outDir, 'i2-phone-controller-results.png') });
  const p = r.players[0];
  const hit = p.perfect + p.great + p.good;
  const summary = { song, diff, zones, notes: p.notes, hit, perfect: p.perfect, miss: p.miss, strays: p.strays, offsetMs: p.offsetMs, glow: `${glowOk}/${glowChecked}`, input: r.hgp.input, errors };
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, 'controller-check.json'), JSON.stringify(summary, null, 2));
  if (shots) copyFileSync(join(outDir, 'i2-phone-controller.png'), join(root, '..', '..', 'docs', 'spikes', 'media', 'i2-phone-controller.png'));
  ok = hit / p.notes >= 0.8 && glowOk / glowChecked >= 0.8 && errors.length === 0;
} finally {
  await browser.close();
  host.kill();
}
console.log(ok ? 'CONTROLLER CHECK OK' : 'CONTROLLER CHECK FAILED');
process.exit(ok ? 0 : 1);
