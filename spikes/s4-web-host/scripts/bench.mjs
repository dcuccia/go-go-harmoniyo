// Reproducible S4 measurements. Usage (dev server or `npm run preview` must be running):
//   node scripts/bench.mjs [baseUrl] [--only=name] [--channel=chrome|msedge|chromium] [--headless]
// Runs autoplay / synthetic-keyboard sessions at several render sizes and CPU throttling
// rates, collects window.__s4Result, takes mid-song screenshots, and writes
// bench-results/<timestamp>.json.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/';
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const only = opt('only', '');
const channel = opt('channel', 'chrome');
const headless = args.includes('--headless');
const gpuHigh = opt('gpu', '') === 'high';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-results');
mkdirSync(outDir, { recursive: true });

const runs = [
  { name: 'auto-1080p-ultra', q: 'mode=autoplay&w=1920&h=1080&msaa=4' },
  { name: 'auto-1080p', q: 'mode=autoplay&w=1920&h=1080' },
  { name: 'auto-1080p-low', q: 'mode=autoplay&w=1920&h=1080&bloom=0&particles=0&dpr=1' },
  { name: 'auto-720p', q: 'mode=autoplay&w=1280&h=720' },
  { name: 'auto-4k-ultra', q: 'mode=autoplay&w=3840&h=2160&msaa=4' },
  { name: 'auto-4k', q: 'mode=autoplay&w=3840&h=2160' },
  { name: 'auto-4k-nobloom', q: 'mode=autoplay&w=3840&h=2160&bloom=0' },
  { name: 'auto-1080p-cpu4x', q: 'mode=autoplay&w=1920&h=1080', cpu: 4 },
  { name: 'auto-1080p-cpu6x', q: 'mode=autoplay&w=1920&h=1080', cpu: 6 },
  { name: 'auto-1080p-cpu6x-low', q: 'mode=autoplay&w=1920&h=1080&bloom=0&particles=0', cpu: 6 },
  { name: 'keys-1080p', q: 'mode=play&w=1920&h=1080', keys: true },
].filter((r) => !only || only.split(',').some((o) => r.name === o));

const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless,
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1600,940', '--disable-background-timer-throttling', ...(gpuHigh ? ['--force_high_performance_gpu'] : [])],
});
const results = {};
for (const run of runs) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  if (run.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: run.cpu });
  await page.goto(`${base}?${run.q}&auto=1&bench=1`);
  await page.waitForFunction(() => document.querySelector('#hud') && !document.querySelector('#hud').classList.contains('hidden'));
  if (run.keys) {
    // Synthetic player: press each lane key at the note's audible time (± 20 ms uniform noise).
    const notes = await page.evaluate(() => window.__s4Notes);
    const keys = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];
    for (const n of notes) {
      const target = (await page.evaluate((t) => window.__s4PerfAt(t), n.time)) + (Math.random() - 0.5) * 40;
      const now = await page.evaluate(() => performance.now());
      if (target - now > 3) await page.waitForTimeout(target - now - 2);
      await page.keyboard.press(keys[n.lane]);
    }
  } else {
    await page.waitForTimeout(19000);
    await page.screenshot({ path: join(outDir, `${run.name}${gpuHigh ? '-dgpu' : ''}.png`) });
  }
  await page.waitForFunction(() => document.title === 'BENCH_DONE', null, { timeout: 120000 });
  results[run.name] = await page.evaluate(() => window.__s4Result);
  const m = results[run.name].metrics;
  console.log(
    `${run.name.padEnd(22)} ${m.render.width}x${m.render.height} fps ${m.fps} frame p50/p95/p99 ${m.frameMs.p50}/${m.frameMs.p95}/${m.frameMs.p99} long ${m.longFramePct}% cpu p95 ${m.cpuMs.p95} smooth p95 ${m.smoothnessErrMs.p95}` +
      (run.keys ? ` | judge p50 ${m.input.eventToJudgeMs.p50} frame p50 ${m.input.eventToNextFrameMs.p50} hit mean ${m.input.hitOffsetMs.mean}` : ''),
  );
  await page.close();
}
const ua = await (await browser.newPage()).evaluate(() => navigator.userAgent);
await browser.close();
const file = join(outDir, `bench-${gpuHigh ? 'dgpu-' : 'default-gpu-'}${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ base, channel, headless, gpuHigh, userAgent: ua, results }, null, 2));
console.log(`wrote ${file}`);
