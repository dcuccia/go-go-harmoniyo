// Drop-in + practice speed E2E (no hardware): real S1 host serving the built game, two S1 phone pages
// in mobile emulation. Alice plays a round at a slowed-down practice speed; Bob scans the always-visible
// corner QR and joins mid-song: he waits ("you're in for the next song", "+1 waiting" on the TV) and
// is seated in the first TV-played part when Again starts. Also checks the lobby speed control
// (5 % steps, remembered for the browser session) and the corner QR's show/hide rules.
//   npm run build && node scripts/dropin-e2e.mjs [--headed] [--shots] [--channel=msedge] [--port=18600]
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
const media = join(root, '..', '..', 'docs', 'spikes', 'media');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const shots = argv.includes('--shots');
const port = Number(opt('port', '18600'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Shortest carol (20 s at full speed), two parts: Alice plays one, the TV the other until Bob takes it. */
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
  const gameUrl = `http://127.0.0.1:${port}/game/?song=${SONG}&diff=easy&ringers=2&seed=3&form=short`; // the song once: the checks time a ~20 s song
  await game.goto(gameUrl);
  await game.waitForFunction(() => window.__i2?.cards?.length === 2, null, { timeout: 20000 });

  const seatNames = () => game.evaluate(() => window.__i2.seats.map((id) => (id === 'tv' || id === 'keyboard' ? id : window.__i2.link.phones.find((p) => p.id === id)?.name ?? id)));
  async function waitSeats(want, label) {
    await waitCheck(
      game.waitForFunction(
        (x) => JSON.stringify(window.__i2.seats.map((id) => (id === 'tv' || id === 'keyboard' ? id : window.__i2.link.phones.find((p) => p.id === id)?.name ?? id))) === JSON.stringify(x),
        want,
        { timeout: 10000, polling: 100 },
      ),
      label,
      want.join(' / '),
    );
  }
  async function phone(name) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.fill('#name', name);
    await page.tap('#start');
    await page.waitForSelector('#main:not([hidden])');
    return { ctx, page };
  }
  const cornerShown = () => game.evaluate(() => !document.querySelector('#corner-join').classList.contains('hidden'));

  // 1. Practice speed in the lobby: 5 % steps from 50 % to 100 %, default 100 %, kept for the session.
  const ui = await game.evaluate(() => {
    const r = document.querySelector('#rng-speed');
    return { min: r.min, max: r.max, step: r.step, value: r.value, label: document.querySelector('#speed-val').textContent };
  });
  check('speed control: 50–100 % in 5 % steps, default 100 %', ui.min === '50' && ui.max === '100' && ui.step === '5' && ui.value === '100' && ui.label === '100%', JSON.stringify(ui));
  check('lobby: no corner QR (the lobby has the big one)', !(await cornerShown()));
  await game.focus('#rng-speed');
  for (let k = 0; k < 10; k++) await game.keyboard.press('ArrowLeft');
  await waitCheck(game.waitForFunction(() => window.__i2.speed === 0.5 && document.querySelector('#speed-val').textContent === '50%', null, { timeout: 5000 }), 'arrow keys step the speed down to 50 %');
  await game.reload();
  await game.waitForFunction(() => window.__i2?.cards?.length === 2, null, { timeout: 20000 });
  const kept = await game.evaluate(() => ({ speed: window.__i2.speed, ui: document.querySelector('#rng-speed').value, info: document.querySelector('#speed-info').textContent, dur: window.__i2.team.chart.duration }));
  check('speed is remembered for the browser session (reload)', kept.speed === 0.5 && kept.ui === '50', JSON.stringify(kept));
  check('lobby says what slows down and the song length at this speed', /instead of 20 s/.test(kept.info) && /timing is judged the same/.test(kept.info), kept.info);

  // 2. Alice joins in the lobby and plays.
  const alice = await phone('Alice');
  await waitSeats(['Alice', 'tv'], 'Alice takes the first part');
  await alice.page.waitForFunction(() => /50% speed/.test(document.querySelector('#ringer')?.textContent ?? ''), null, { timeout: 8000 }).then(
    () => check('phone label shows the practice speed', true),
    () => check('phone label shows the practice speed', false),
  );
  await game.click('#btn-play');
  await waitCheck(game.waitForFunction(() => !document.querySelector('#hud').classList.contains('hidden'), null, { timeout: 15000 }), 'round starts');
  const hud = await game.evaluate(() => ({ badge: document.querySelector('#speed-badge').textContent, shown: !document.querySelector('#speed-badge').classList.contains('hidden'), bpm: window.__i2.team.chart.bpm, dur: window.__i2.team.chart.duration }));
  check('HUD shows the speed', hud.shown && /50% speed/.test(hud.badge), JSON.stringify(hud));
  const info = await game.evaluate(() => ({ url: window.__i2.link.info.joinUrl, tls: window.__i2.link.info.tlsMode }));
  await waitCheck(game.waitForFunction(() => {
    const img = document.querySelector('#corner-qr');
    return !document.querySelector('#corner-join').classList.contains('hidden') && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 8000 }), 'corner QR is shown and loaded during the song');
  const corner = await game.evaluate(() => {
    const r = document.querySelector('#corner-join').getBoundingClientRect();
    return { url: document.querySelector('#corner-url').textContent, hint: document.querySelector('#corner-hint').textContent, src: document.querySelector('#corner-qr').getAttribute('src'), x: r.x, y: r.y, w: r.width, h: r.height };
  });
  check('corner shows the short join URL (and the certificate hint with a self-signed cert)', corner.url === info.url.replace(/\/$/, '') && (/self-signed/.test(info.tls) ? /warning/.test(corner.hint) : true) && corner.src.includes(encodeURIComponent(info.url)), JSON.stringify(corner));
  check('corner QR is small and in the top-left corner', corner.x < 40 && corner.y < 40 && corner.w <= 220 && corner.h <= 300, `${Math.round(corner.w)}×${Math.round(corner.h)} at ${Math.round(corner.x)},${Math.round(corner.y)}`);

  // 3. Bob joins mid-song: waiting screen on his phone, "+1 waiting" on the TV, nobody's seat changes.
  await sleep(4000);
  const bob = await phone('Bob');
  await waitCheck(bob.page.waitForSelector('#waiting:not([hidden])', { timeout: 10000 }), 'phone that joins mid-song shows "you\'re in for the next song"');
  const waitText = await bob.page.textContent('#waiting');
  check('waiting screen names the next song and the one playing', /next song/.test(waitText) && /Now playing: We Wish You/.test(waitText), waitText.replace(/\s+/g, ' ').trim());
  check('waiting phone does not see the part picker mid-song', await bob.page.locator('#lobby').isHidden());
  await waitCheck(game.waitForFunction(() => /\+1 waiting/.test(document.querySelector('#corner-wait').textContent) && !document.querySelector('#corner-wait').classList.contains('hidden'), null, { timeout: 8000 }), 'TV shows "+1 waiting"');
  const waitTv = await game.evaluate(() => ({ text: document.querySelector('#corner-wait').textContent, queue: [...window.__i2.joinQueue.waiting] }));
  check('TV names the waiting player', /Bob/.test(waitTv.text), waitTv.text);
  check('the running round is unchanged (the TV keeps playing the free part)', JSON.stringify(await seatNames()) === JSON.stringify(['Alice', 'tv']), (await seatNames()).join(' / '));
  if (shots) {
    await sleep(1500);
    await game.screenshot({ path: join(outDir, 'i2-ingame-join-qr.png') });
    await bob.page.screenshot({ path: join(outDir, 'i2-phone-waiting.png') });
  }

  // 4. Results: the QR stays; "Next round … Joining: Bob"; Bob's phone can already pick a part.
  await waitCheck(game.waitForFunction(() => document.title === 'I2_DONE', null, { timeout: 120000, polling: 500 }), 'song finishes (results screen)');
  const r = await game.evaluate(() => window.__i2Result);
  check('result records the speed and the stretched song (≈ 2 × 20.4 s)', r.speed === 0.5 && r.chartDurationSec > 39 && r.chartDurationSec < 43, `speed ${r.speed}, ${r.chartDurationSec} s`);
  const res = await game.evaluate(() => ({ body: document.querySelector('#res-body').textContent, next: document.querySelector('#res-next').textContent }));
  check('results show the practice speed', /Practice speed 50%/.test(res.body), res.body.replace(/\s+/g, ' '));
  check('results list who joins next round', /Joining: Bob/.test(res.next), res.next);
  check('corner QR and "+1 waiting" stay on the results screen', (await cornerShown()) && /\+1 waiting/.test(await game.textContent('#corner-wait')));
  await waitCheck(bob.page.waitForSelector('#lobby:not([hidden]) #lobby-next:not([hidden])', { timeout: 8000 }), 'waiting phone sees "Pick your part" with "you\'re in for the next song" on the results screen');
  if (shots) await game.screenshot({ path: join(outDir, 'i2-results-join-qr.png') });

  // 5. Again: Bob gets the first TV-played part, his phone its bells; the queue is empty.
  await game.click('#btn-again');
  await waitSeats(['Alice', 'Bob'], 'Again: the waiting phone is seated in the first TV-played part');
  await waitCheck(game.waitForFunction(() => window.__i2.joinQueue.waiting.length === 0 && document.querySelector('#corner-wait').classList.contains('hidden'), null, { timeout: 5000 }), '"+1 waiting" clears');
  const part1 = await game.evaluate(() => window.__i2.cards[1].name);
  await waitCheck(bob.page.waitForFunction((n) => document.querySelector('#ringer')?.textContent?.includes(n), part1, { timeout: 8000 }), 'Bob\'s phone gets the part\'s bells and label', part1);
  check('Bob\'s waiting screen is gone', await bob.page.locator('#waiting').isHidden());
  const round2 = await game.evaluate(() => ({ phones: window.__i2.team.ringers.length, speed: window.__i2.speed }));
  check('round 2 has both phones and keeps the speed', round2.phones === 2 && round2.speed === 0.5, JSON.stringify(round2));

  // 6. Esc → lobby: corner QR hidden again; back to full speed for the next player.
  await game.keyboard.press('Escape');
  await waitCheck(game.waitForFunction(() => document.querySelector('#corner-join').classList.contains('hidden'), null, { timeout: 5000 }), 'corner QR hides in the lobby');
  await game.focus('#rng-speed');
  await game.keyboard.press('End');
  await waitCheck(game.waitForFunction(() => window.__i2.speed === 1 && Math.abs(window.__i2.team.chart.duration - 20.4) < 1.5, null, { timeout: 5000 }), 'speed back to 100 % restores the written tempo');

  // 7. ?joinQr=0 turns the corner QR off (owner preference), even mid-song.
  await game.close();
  const off = await tv.newPage();
  await off.goto(`${gameUrl}&joinQr=0&start=autoplay`);
  await off.waitForFunction(() => !document.querySelector('#hud').classList.contains('hidden'), null, { timeout: 15000 });
  check('?joinQr=0 hides the corner QR', await off.evaluate(() => document.querySelector('#corner-join').classList.contains('hidden')));
  await off.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  ok = checks.every((c) => c.ok);
} finally {
  await browser.close();
  host.kill();
}

if (shots) {
  for (const f of ['i2-ingame-join-qr.png', 'i2-results-join-qr.png', 'i2-phone-waiting.png']) {
    try {
      copyFileSync(join(outDir, f), join(media, f));
    } catch {
      // not captured
    }
  }
}
writeFileSync(join(outDir, 'dropin-e2e.json'), JSON.stringify({ at: new Date().toISOString(), ok, checks }, null, 2));
console.log(ok ? `DROP-IN E2E OK (${checks.length} checks)` : `DROP-IN E2E FAILED (${checks.filter((c) => !c.ok).length}/${checks.length} failed)`);
process.exit(ok ? 0 : 1);
