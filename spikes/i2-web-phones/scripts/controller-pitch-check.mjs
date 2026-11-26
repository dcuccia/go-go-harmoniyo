// Controller-only regression: real S1 page served by Node, deterministic HGP assignments/cues.
// No TV, scoring or simulated motion. Run from I2: node scripts/controller-pitch-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright-core';

const s1 = fileURLToPath(new URL('../../s1-phone-bell/', import.meta.url));
const port = 18301;
const url = `http://127.0.0.1:${port}/`;
const useWebKit = process.argv.includes('--webkit');
const runner = useWebKit ? webkit : chromium;
const pitches = [
  { id: 'C4', label: 'C', midi: 60, color: '#e04040' },
  { id: 'Db4', label: 'D♭', midi: 61, color: '#a55918' },
  { id: 'D4', label: 'D', midi: 62, color: '#edae30' },
  { id: 'E4', label: 'E', midi: 64, color: '#ffdd60' },
];
const ringer = { slot: 0, title: 'Ringer 1', song: 'A song title with enough words to wrap on a narrow phone' };
const cases = [
  { device: 'Pixel 7' },
  { device: 'iPhone 13', safe: { top: 47, bottom: 34 } },
  { device: 'Pixel 7', viewport: { width: 320, height: 480 } },
  { device: 'iPhone 13 landscape', safe: { left: 47, right: 47, bottom: 21 } },
  { device: 'iPhone 13 landscape', viewport: { width: 568, height: 320 }, safe: { left: 32, right: 32, bottom: 21 } },
];

const host = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/host/server.ts', '--no-open', '--lan-only', '--no-https', '--http-port', String(port)], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`S1 host did not start:\n${output}`)), 30_000);
    host.once('error', (err) => { clearTimeout(timer); reject(err); });
    host.once('exit', (code) => { clearTimeout(timer); reject(new Error(`S1 host exited (${code}):\n${output}`)); });
    const log = (chunk) => {
      output += chunk;
      if (output.includes('Dashboard:')) { clearTimeout(timer); resolve(); }
    };
    host.stdout.on('data', log);
    host.stderr.on('data', log);
  });
  browser = await runner.launch(useWebKit ? {} : { channel: 'chrome' });
  console.log(`${runner.name()} ${browser.version()}`);

  for (const { device, viewport = devices[device].viewport, safe = {} } of cases) {
    const context = await browser.newContext({ ...devices[device], viewport });
    try {
      const { promise: connected, resolve: onConnect } = Promise.withResolvers();
      const taps = [];
      await context.routeWebSocket('**/hgp', (socket) => {
        socket.onMessage((data) => {
          const m = JSON.parse(data);
          if (m.type === 'hello') onConnect((message) => socket.send(JSON.stringify(message)));
          if (m.type === 'sync') socket.send(JSON.stringify({ ...m, t1: m.t0, t2: m.t0 }));
          if (m.type === 'gesture') taps.push(m);
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('hgp-ring-axis', '[1,0,0]');
      });
      await page.goto(`${url}?rtc=0`);
      await page.evaluate((insets) => {
        // Desktop emulation has no real notches/home indicator. Exercise our insets explicitly.
        for (const [edge, px] of Object.entries(insets)) document.body.style.setProperty(`--pad-${edge}`, `${px}px`);
      }, safe);
      await page.tap('#start');
      await page.waitForFunction(() => document.querySelector('#connection-title').textContent.startsWith('Connected'));
      const send = await connected;
      assert.equal(await page.locator('#zones').isVisible(), false, 'no target before assignment');
      await page.tap('#tap-toggle');
      await page.evaluate(() => {
        document.querySelector('#zones').addEventListener('pointerdown', (event) => {
          if (event.isTrusted && event.pointerType === 'touch') {
            document.querySelector('#zones').dataset.selectedOnDown = document.querySelector('#bell-id').textContent;
          }
        });
      });
      const selected = () => page.locator('#bell-id').textContent();
      const assign = (n, seat = ringer) => send({ type: 'assign', bells: pitches.slice(0, n), ringer: seat, sound: 'host' });
      const parts = (phase, you, next = false) => send({
        type: 'parts', phase, you, next,
        parts: [{ name: 'Ringer 1', bells: pitches, player: { kind: 'phone', name: device } }],
      });
      parts('play', 0);
      const bands = [];
      let touches = 0;
      for (const n of [2, 3, 4]) {
        assign(n);
        await page.waitForFunction((count) => document.querySelectorAll('#zones .zone').length === count, n);
        const bounds = await page.locator('#zones .zone').evaluateAll((zones) => zones.map((zone) => {
          const { left, right, top, bottom } = zone.getBoundingClientRect();
          return { id: zone.querySelector('small').textContent, left, right, top, bottom };
        }));
        const [{ left, top, bottom }] = bounds;
        const right = bounds.at(-1).right;
        bands.push({ top, bottom, widths: bounds.map((box) => Math.round(box.right - box.left)) });
        assert.deepEqual(bounds.map((box) => box.id), pitches.slice(0, n).map((pitch) => pitch.id), 'low-to-high order');
        assert.ok(top >= 0 && bottom - top >= (viewport.height <= 500 ? 72 : 200), 'taller strip is on screen');
        const bottomGap = viewport.height - bottom;
        const expectedGap = Math.max(16, (safe.bottom ?? 0) + 8);
        assert.ok(Math.abs(bottomGap - expectedGap) < 1, `${device} ${viewport.width}×${viewport.height}: band ${top}..${bottom} should end ${expectedGap}px above the bottom`);
        assert.ok(left >= (safe.left ?? 0) && right <= viewport.width - (safe.right ?? 0), 'clear of both screen edges');
        for (const selector of ['#tap-toggle', '#calibrate', '#bell']) {
          const box = await page.locator(selector).boundingBox();
          assert.ok(box.y >= 0 && box.y + box.height < top, `${selector} is reachable outside the selection strip`);
        }
        for (const [i, box] of bounds.entries()) {
          assert.equal(box.top, top);
          assert.equal(box.bottom, bottom);
          if (i > 0) assert.equal(box.left, bounds[i - 1].right, 'no gap at the seam');
        }
        const rows = [Math.ceil(top) + 1, Math.round((top + bottom) / 2), Math.floor(bottom) - 2];
        for (const [row, y] of rows.entries()) {
          for (const [i, box] of bounds.entries()) {
            // Cover the right edge, center, and left edge, including both sides of each seam.
            const x = [Math.floor(box.right) - 1, Math.round((box.left + box.right) / 2), Math.ceil(box.left) + 1][row];
            await page.locator('#zones').evaluate((zones) => delete zones.dataset.selectedOnDown);
            await page.touchscreen.tap(x, y);
            assert.equal(await page.locator('#zones').getAttribute('data-selected-on-down'), pitches[i].id, `touch-down at (${x}, ${y})`);
            touches++;
          }
        }
        // With Touch on, a pitch touch is still only selection. Only the bell emits a gesture.
        await page.touchscreen.tap((left + right) / 2, Math.floor(bottom) + 4);
        assert.equal(await selected(), pitches[n - 1].id);
        assert.equal(taps.length, 0);
      }
      assert.deepEqual(bands.map(({ top, bottom }) => [top, bottom]), bands.map(() => [bands[0].top, bands[0].bottom]), 'the band is identical for 2, 3 and 4 pitches');
      send({ type: 'cues', at: [60_000], bells: ['Db4'] });
      const cue = page.locator('#zones .acc.next');
      await cue.waitFor();
      assert.equal(await cue.locator('small').textContent(), 'Db4');
      await page.tap('#bell');
      await page.waitForFunction(() => document.querySelector('#debug').textContent.includes('gestures 1'));
      assert.deepEqual(taps.map(({ g, bell }) => [g, bell]), [['tap', 'E4']]);
      parts('lobby', 0);
      await page.waitForSelector('#lobby');
      assert.equal(await page.locator('#main.game-pitches').count(), 0, 'part picker does not use game targets');
      parts('play', 0);
      // Reassigning does not move the controls into the strip or leave stale zones behind.
      assign(1);
      await page.waitForSelector('#zones', { state: 'hidden' });
      assert.equal(await page.locator('#bell').isVisible(), true);
      assert.equal(await selected(), 'C4');
      parts('play', -1, true);
      await page.waitForSelector('#waiting');
      await page.waitForSelector('#bell', { state: 'hidden' });
      assert.equal(await page.locator('#zones').isVisible(), false, 'waiting players cannot hit stale pitch targets');
      assign(4, null);
      parts('play', 0);
      await page.waitForSelector('#zones');
      assert.equal(await page.locator('#main').evaluate((main) => main.classList.contains('game-pitches')), false);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ device, viewport, safe, bands, touches }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  host.kill();
}
