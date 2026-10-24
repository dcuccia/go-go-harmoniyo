// Seating chart E2E (no hardware): real S1 host serving the built game, two S1 phone pages in mobile
// emulation (Alice, Bob: the real "Pick your part" UI) and one S1 simulated phone (tools/sim-phones.ts:
// Cara, late joiner). Checks claim, swap, Ready, Rotate, drag, TV-remote keys, late join,
// disconnect → TV plays → reconnect reclaims, and the regression for the lobby dropdown bug: the
// "who plays" picker (and the song dropdown) survive device broadcasts.
//   npm run build && node scripts/seating-e2e.mjs [--headed] [--shots] [--channel=msedge]
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
const port = Number(opt('port', '18500'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function sim(name, extra = []) {
  const p = spawn(process.execPath, [tsx, 'tools/sim-phones.ts', '--game', '--url', `ws://127.0.0.1:${port}/hgp`, '--names', name, '--seconds', '300', ...extra], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`    [sim] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`    [sim!] ${d}`));
  return p;
}

const checks = [];
const errors = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ channel: opt('channel', 'chrome'), headless: !argv.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sims = [];
let ok = false;
try {
  const game = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  game.on('pageerror', (e) => errors.push(`game: ${e}`));
  game.on('console', (m) => m.type() === 'error' && errors.push(`game console: ${m.text()}`));
  await game.goto(`http://127.0.0.1:${port}/game/?song=jingle-bells&diff=easy&ringers=3&seed=7`);
  await game.waitForFunction(() => window.__i2?.cards?.length === 3, null, { timeout: 20000 });

  const seats = () => game.evaluate(() => window.__i2.seats.slice());
  const idOf = (name) => game.evaluate((n) => window.__i2.link.phones.find((p) => p.name === n)?.id ?? null, name);
  const seatNames = () => game.evaluate(() => window.__i2.seats.map((id) => (id === 'tv' || id === 'keyboard' ? id : window.__i2.link.phones.find((p) => p.id === id)?.name ?? id)));
  /** Wait until the TV's seats are `want` (phone names; 'tv' / 'keyboard' literal). */
  async function waitSeats(want, label) {
    try {
      await game.waitForFunction(
        (x) => JSON.stringify(window.__i2.seats.map((id) => (id === 'tv' || id === 'keyboard' ? id : window.__i2.link.phones.find((p) => p.id === id)?.name ?? id))) === JSON.stringify(x),
        want,
        { timeout: 8000, polling: 100 },
      );
      check(label, true, want.join(' / '));
    } catch {
      check(label, false, `want ${want.join(' / ')}, got ${(await seatNames()).join(' / ')}`);
    }
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
  const card = (p, i) => p.locator(`#parts .pcard[data-part="${i}"]`);

  // 1. Join order → parts; the TV plays the rest.
  const alice = await phone('Alice');
  await waitSeats(['Alice', 'tv', 'tv'], 'first phone takes the first part');
  const bob = await phone('Bob');
  await waitSeats(['Alice', 'Bob', 'tv'], 'second phone takes the next TV-played part');
  await alice.page.waitForSelector('#lobby:not([hidden]) #parts .pcard.mine', { timeout: 8000 });
  const aliceCards = await alice.page.$$eval('#parts .pcard', (els) => els.map((e) => e.textContent));
  check('phone shows "Pick your part" with every part, occupant, range and meter', aliceCards.length === 3 && /TV plays/.test(aliceCards[2]) && /You/.test(aliceCards[0]) && /notes/.test(aliceCards[1]) && /[●○]{5}/.test(aliceCards[1]), aliceCards.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  const names = await game.evaluate(() => window.__i2.cards.map((c) => c.name));
  check('parts have musical names', names.join() === 'Low melody,Middle melody,High melody', names.join(', '));

  // 2. Regression (lobby dropdown bug): the picker survives device broadcasts and Ready changes.
  await game.evaluate(() => {
    const l = window.__i2.link;
    const f = l.onDevices;
    window.__devN = 0;
    l.onDevices = (...a) => {
      window.__devN++;
      f(...a);
    };
  });
  await game.click('#seating .part[data-part="2"]');
  await game.waitForSelector('#seating .picker:not([hidden])');
  await game.evaluate(() => {
    document.querySelector('#seating .picker').__tag = 'picker';
    document.querySelector('#sel-song').__tag = 'song';
    document.querySelectorAll('#seating .part').forEach((el, i) => (el.__tag = `part${i}`));
  });
  await bob.page.tap('#ready');
  await sleep(4000); // > one 3 s heartbeat, plus the Ready broadcast and the phones' status changes
  const survived = await game.evaluate(() => {
    const p = document.querySelector('#seating .picker');
    return {
      broadcasts: window.__devN,
      picker: p.__tag === 'picker' && !p.hidden && document.activeElement === p,
      expanded: document.querySelector('#seating .part[data-part="2"]').getAttribute('aria-expanded'),
      song: document.querySelector('#sel-song').__tag === 'song',
      parts: [...document.querySelectorAll('#seating .part')].every((el, i) => el.__tag === `part${i}`),
      readyChip: !!document.querySelector('#seating .part[data-part="1"].ready'),
    };
  });
  check('picker stays open, focused and is the same node across device broadcasts', survived.broadcasts >= 2 && survived.picker && survived.expanded === 'true', JSON.stringify(survived));
  check('song dropdown and part cards are patched in place, not replaced', survived.song && survived.parts);
  check('TV shows Ready (✓) on the part of the phone that pressed it', survived.readyChip);

  // 3. TV picker by keyboard: TV → Alice → Bob, Enter: Bob moves from part 1 to part 2.
  await game.keyboard.press('ArrowDown');
  await game.keyboard.press('ArrowDown');
  await game.keyboard.press('Enter');
  await waitSeats(['Alice', 'tv', 'Bob'], 'TV picker (↓ ↓ Enter) moves Bob to the TV-played part');
  check('picker closed after choosing', await game.locator('#seating .picker').isHidden());

  // 4. Phone claims a free part.
  await card(alice.page, 1).tap();
  await waitSeats(['tv', 'Alice', 'Bob'], 'phone claims a free (TV-played) part');
  const partName1 = names[1];
  await alice.page.waitForFunction((n) => document.querySelector('#ringer')?.textContent?.includes(n), partName1, { timeout: 8000 }).then(
    () => check('phone gets the new part’s bells and label', true, partName1),
    () => check('phone gets the new part’s bells and label', false),
  );

  // 5. Phone swaps with a taken part ("Swap with Alice?" → executed at once).
  await card(bob.page, 1).tap();
  const swapBtn = bob.page.locator('#parts .swap');
  await swapBtn.waitFor({ timeout: 5000 });
  const swapText = await swapBtn.textContent();
  check('taken part offers "Swap with <name>?"', /Swap with Alice\?/.test(swapText ?? ''), swapText ?? '');
  if (shots) await bob.page.screenshot({ path: join(outDir, 'i2-phone-part-picker.png') });
  await swapBtn.tap();
  await waitSeats(['tv', 'Bob', 'Alice'], 'swap is executed immediately');

  // 6. Ready from the second phone.
  await alice.page.tap('#ready');
  await game.waitForFunction(() => /Ready 2\/2/.test(document.querySelector('#ready-info')?.textContent ?? ''), null, { timeout: 8000 }).then(
    () => check('TV counts Ready 2/2', true),
    () => check('TV counts Ready 2/2', false),
  );
  const pressed = await alice.page.getAttribute('#ready', 'aria-pressed');
  check('phone Ready toggle reflects the host state', pressed === 'true');

  // 7. 🔁 Rotate.
  await game.click('#btn-rotate');
  await waitSeats(['Alice', 'tv', 'Bob'], '🔁 Rotate moves everyone one part');

  // 8. Drag a part's chip onto another part (swap) and the TV chip onto a part.
  await game.locator('#seating .part[data-part="2"] .part-seat .chip').dragTo(game.locator('#seating .part[data-part="0"]'));
  await waitSeats(['Bob', 'tv', 'Alice'], 'drag Bob’s chip onto Alice’s part swaps them');

  // 9. TV remote: ↓ enters the part cards, → moves, Enter opens the picker, End = Keyboard, Enter.
  await game.evaluate(() => document.activeElement?.blur());
  await game.keyboard.press('ArrowDown');
  await game.keyboard.press('ArrowRight');
  await game.keyboard.press('Enter');
  await game.keyboard.press('End');
  await game.keyboard.press('Enter');
  await waitSeats(['Bob', 'keyboard', 'Alice'], 'remote keys (↓ → Enter End Enter) give part 2 to Keyboard');

  // 10. TV chip from the tray onto the keyboard's part: the TV plays it again.
  await game.locator('#seating .tray .chip.k-tv').dragTo(game.locator('#seating .part[data-part="1"]'));
  await waitSeats(['Bob', 'tv', 'Alice'], 'drag the TV chip onto a part');

  // 11. Late joiner (S1 simulated phone): takes the TV part, then claims part 0 (swap) and readies.
  sims.push(sim('Cara', ['--claim', '0', '--ready']));
  await waitSeats(['Cara', 'Bob', 'Alice'], 'late joiner takes the TV part, then claims part 0 (swap with Bob)');
  await game.waitForFunction(() => !!document.querySelector('#seating .part[data-part="0"].ready'), null, { timeout: 8000 }).then(
    () => check('simulated phone Ready shows on the TV', true),
    () => check('simulated phone Ready shows on the TV', false),
  );
  if (shots) {
    await game.evaluate(() => document.activeElement?.blur());
    await game.mouse.move(5, 5);
    await sleep(300);
    await game.screenshot({ path: join(outDir, 'i2-seating-lobby.png') });
  }

  // 12. 🎲 Shuffle (seeded): still the same three players, one per part.
  await game.click('#btn-shuffle');
  await sleep(300);
  const shuffled = await seatNames();
  check('🎲 Shuffle seats everyone once', [...shuffled].sort().join() === 'Alice,Bob,Cara', shuffled.join(' / '));

  // 13. Disconnect → the TV plays the part; reconnect reclaims it (simulated phone and real page).
  const caraPart = shuffled.indexOf('Cara');
  sims.pop().kill();
  await game.waitForFunction((i) => window.__i2.seats[i] === 'tv', caraPart, { timeout: 8000 }).then(
    () => check('disconnect: the TV plays the part', true, `part ${caraPart}`),
    () => check('disconnect: the TV plays the part', false),
  );
  sims.push(sim('Cara'));
  await game.waitForFunction(([i]) => window.__i2.seats[i] === 'sim-Cara', [caraPart], { timeout: 10000 }).then(
    () => check('reconnect reclaims the same part (simulated phone)', true),
    () => check('reconnect reclaims the same part (simulated phone)', false),
  );
  const aliceId = await idOf('Alice');
  const alicePart = (await seats()).indexOf(aliceId);
  await alice.page.close();
  await game.waitForFunction((i) => window.__i2.seats[i] === 'tv', alicePart, { timeout: 8000 }).catch(() => {});
  const page2 = await alice.ctx.newPage();
  page2.on('pageerror', (e) => errors.push(`Alice 2: ${e}`));
  await page2.goto(`http://127.0.0.1:${port}/`);
  await page2.tap('#start'); // name and deviceId are remembered by the browser
  await game.waitForFunction(([i, id]) => window.__i2.seats[i] === id, [alicePart, aliceId], { timeout: 10000 }).then(
    () => check('reconnect reclaims the same part (phone page reloaded)', true),
    () => check('reconnect reclaims the same part (phone page reloaded)', false),
  );

  // 14. Play is available without everyone Ready; phones hide the picker while playing.
  await game.click('#btn-play');
  await game.waitForFunction(() => !document.querySelector('#hud')?.classList.contains('hidden'), null, { timeout: 15000 }).then(
    () => check('▶ Play starts without everyone Ready', true),
    () => check('▶ Play starts without everyone Ready', false),
  );
  await bob.page.waitForSelector('#lobby[hidden]', { state: 'attached', timeout: 8000 }).then(
    () => check('phones hide "Pick your part" during the song', true),
    () => check('phones hide "Pick your part" during the song', false),
  );
  await game.keyboard.press('Escape');
  await bob.page.waitForSelector('#lobby:not([hidden])', { timeout: 8000 }).then(
    () => check('back in the lobby the phones show it again', true),
    () => check('back in the lobby the phones show it again', false),
  );
  const pressedAfter = await bob.page.getAttribute('#ready', 'aria-pressed');
  check('Ready resets when a song starts', pressedAfter === 'false');

  check('no page errors', errors.length === 0, errors.join(' | '));
  ok = checks.every((c) => c.ok);
} finally {
  await browser.close();
  sims.forEach((p) => p.kill());
  host.kill();
}

if (shots) {
  for (const f of ['i2-seating-lobby.png', 'i2-phone-part-picker.png']) {
    try {
      copyFileSync(join(outDir, f), join(media, f));
    } catch {
      // not captured
    }
  }
}
writeFileSync(join(outDir, 'seating-e2e.json'), JSON.stringify({ at: new Date().toISOString(), ok, checks }, null, 2));
console.log(ok ? `SEATING E2E OK (${checks.length} checks)` : `SEATING E2E FAILED (${checks.filter((c) => !c.ok).length}/${checks.length} failed)`);
process.exit(ok ? 0 : 1);
