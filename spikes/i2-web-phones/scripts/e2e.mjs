// End-to-end check without phones: real S1 host (serving the built game) + S1 simulated phones
// (tools/sim-phones.ts --game) + headless Chrome playing the game page; asserts that every
// simulated ringer's rings arrive, map to the right lanes and are judged on source timestamps.
//   npm run build && node scripts/e2e.mjs [--only=name,...] [--channel=chrome|msedge] [--headed] [--shots]
//     [--port=18080]  first S1 host port (one per scenario; kept away from S1's default 8080)
//     [--repeat=N] [--bail] [--load=K]  flake hunting: N consecutive suite runs, optionally with K
//                  busy CPU threads; per-run rows go to results/e2e-repeat.ndjson
// A failing scenario prints its timing evidence: cue-anchor drift (song→host-time mapping vs the
// one the phones were cued with), audio clock re-anchorings, host clock-sync jumps, long frames,
// ring arrival latency, strays, and each simulated phone's ring plan and clock-sync health.
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const s1 = join(root, '..', 's1-phone-bell');
const tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const outDir = join(root, 'results');
const media = join(root, '..', '..', 'docs', 'spikes', 'media');
mkdirSync(outDir, { recursive: true });

const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const only = opt('only', '');
const channel = opt('channel', 'chrome');
const headed = argv.includes('--headed');
const shots = argv.includes('--shots');
const quality = opt('quality', 'high');
const qs = quality === 'low' ? '&bloom=0&particles=0&dpr=1' : '';
/** Run the whole suite N times (flake hunting); stops at the first failing pass with --bail. */
const repeat = Number(opt('repeat', '1'));
const bail = argv.includes('--bail');
/** Busy-loop worker threads competing for the CPU while the suite runs (load test). */
const load = Number(opt('load', '0'));
/** First HTTP port (S1 host); each scenario uses the next one. Away from S1's default 8080. */
const basePort = Number(opt('port', '18080'));
const verbose = argv.includes('--verbose') || repeat === 1;

const scenarios = [
  { name: 'silent-night-easy-3', song: 'silent-night', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob', 'Cara'] },
  { name: 'jingle-bells-medium-4', song: 'jingle-bells', diff: 'medium', ringers: 4, phones: ['Alice', 'Bob', 'Cara', 'Dan'], shot: 'i2-4-ringers' },
  { name: 'joy-easy-2-with-host', song: 'joy-to-the-world', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob'], hostRingers: 1, shot: 'i2-2-phones-plus-host' },
  { name: 'silent-night-late60', song: 'silent-night', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob', 'Cara'], late: 60 },
].filter((s) => !only || only.split(',').includes(s.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tolerance on a mean ring offset over n rings. One simulated ring's offset is N(0, 20 ms) human
 * jitter (--jitter 20) plus 60 Hz quantisation, uniform over 16.7 ms: σ = √(20² + 16.7²/12) ≈ 20.6
 * ms; 4.5 standard errors (two-sided false alarm < 1e-5) but never below `floor`. A 7-note part gets
 * ±35 ms, the pooled team (38–161 rings) ±7–15 ms: tight enough to catch arrival-time judging
 * (+35 ms) or a +80 ms clock-mapping slip.
 */
const RING_SIGMA_MS = Math.sqrt(20 ** 2 + (1000 / 60) ** 2 / 12);
const meanTolMs = (n, floor = 12) => Math.max(floor, (4.5 * RING_SIGMA_MS) / Math.sqrt(Math.max(1, n)));

function startHost(port) {
  return new Promise((resolve, reject) => {
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
}

function startSims(port, names, late, seconds) {
  const p = spawn(process.execPath, [tsx, 'tools/sim-phones.ts', '--game', '--diag', '--url', `ws://127.0.0.1:${port}/hgp`, '--names', names.join(','), '--seconds', String(seconds), '--late', String(late ?? 0), '--jitter', '20', '--miss', '0.03'], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
  p.diag = null;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines.filter(Boolean)) {
      if (line.startsWith('[diag] ')) p.diag = JSON.parse(line.slice(7));
      else if (verbose) process.stdout.write(`    [sim] ${line}\n`);
    }
  });
  p.stderr.on('data', (d) => process.stdout.write(`    [sim!] ${d}`));
  return p;
}

const loadWorkers = Array.from({ length: load }, () => new Worker('for (;;) Math.sqrt(Math.random());', { eval: true }));
if (load) console.log(`CPU load: ${load} busy worker threads`);

const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: !headed,
  // SwiftShader WebGL when there is no GPU (CI runners).
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader'],
});

/** Timing evidence for a scenario (printed when it fails, kept in the JSON either way). */
function timingSummary(r, sims) {
  const t = r.timing ?? {};
  const sends = t.cueSends ?? [];
  // Song→host mapping now vs the one the phones' current cues were computed with.
  const drift = (t.samples ?? []).map((s) => s.anchorMs - ([...sends].reverse().find((c) => c.perf <= s.perf) ?? sends[0])?.anchorMs).filter(Number.isFinite);
  const lf = (t.longFrames ?? []).map((f) => f.ms);
  const rings = t.rings ?? [];
  const lat = rings.map((x) => x.latMs).sort((a, b) => a - b);
  const r2 = (x) => Math.round(x * 100) / 100;
  const half = (p) => {
    const xs = rings.filter((x) => x.p === p && x.offMs !== null);
    const m = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x.offMs, 0) / a.length) * 10) / 10 : null);
    return [m(xs.slice(0, xs.length >> 1)), m(xs.slice(xs.length >> 1))];
  };
  return {
    cueAnchorDriftMs: drift.length ? { min: r2(Math.min(...drift)), max: r2(Math.max(...drift)), end: r2(drift[drift.length - 1]) } : null,
    cueSends: sends.length,
    audioSnaps: t.audioSnaps ?? [],
    hostSyncResets: t.hostSyncResets,
    hostSyncJumps: t.hostSyncJumps ?? [],
    roundStartPerf: sends[0]?.perf,
    longFrames: { n: lf.length, maxMs: lf.length ? Math.max(...lf) : 0 },
    ringArrivalMs: lat.length ? { p50: lat[lat.length >> 1], p99: lat[Math.floor(lat.length * 0.99)], max: lat[lat.length - 1] } : null,
    strays: rings.filter((x) => x.offMs === null).map((x) => ({ p: x.p, latMs: x.latMs })),
    meanOffsetByHalfMs: r.players.map((p, i) => `${p.name} ${half(i).join(' → ')}`),
    phones: sims.diag,
  };
}

const all = [];
let passes = 0;
for (let run = 1; run <= repeat; run++) {
  let port = basePort;
  const runRows = [];
  if (repeat > 1) console.log(`\n═══ run ${run}/${repeat} ═══`);
  for (const sc of scenarios) {
    if (verbose) console.log(`\n▶ ${sc.name}`);
    const host = await startHost(port);
    const sims = startSims(port, sc.phones, sc.late, 240);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const url = `http://127.0.0.1:${port}/game/?song=${sc.song}&diff=${sc.diff}&ringers=${sc.ringers}&waitPhones=${sc.phones.length}&start=play${qs}${sc.shot && shots ? '&startDelay=4000' : ''}`;
    await page.goto(url);
    if (shots && sc.shot) {
      await page.waitForFunction((n) => document.querySelectorAll('#phones li:not(.off):not(.dim)').length >= n, sc.phones.length, { timeout: 20000 });
      await sleep(300);
      await page.screenshot({ path: join(outDir, `${sc.shot}-lobby.png`) });
    }
    await page.waitForFunction(() => !document.querySelector('#hud')?.classList.contains('hidden'), null, { timeout: 30000 });
    const t0 = Date.now();
    if (shots && sc.shot) {
      await sleep(9000);
      await page.screenshot({ path: join(outDir, `${sc.shot}-play.png`) });
    }
    await page.waitForFunction(() => document.title === 'I2_DONE', null, { timeout: 240000, polling: 500 });
    const r = await page.evaluate(() => window.__i2Result);
    if (shots && sc.shot) await page.screenshot({ path: join(outDir, `${sc.shot}-results.png`) });
    const wallS = (Date.now() - t0) / 1000;
    await page.close();
    sims.kill();
    host.kill();
    await sleep(500);
    port += 1;

    // Assertions. The simulated phones' draws are seeded per part, so each part's rings are fixed;
    // what may vary is only how the game receives and judges them.
    const fails = [];
    const late = sc.late ?? 0;
    const phonePlayers = r.players.filter((p) => p.slot === 'phone');
    if (phonePlayers.length !== sc.phones.length) fails.push(`expected ${sc.phones.length} phone ringers, got ${phonePlayers.length}`);
    if ((r.autoRingers?.length ?? 0) !== (sc.hostRingers ?? 0)) fails.push(`expected ${sc.hostRingers ?? 0} host ringers, got ${r.autoRingers?.length}`);
    let sum = 0;
    let n = 0;
    for (const p of phonePlayers) {
      const hit = p.perfect + p.great + p.good;
      // Every ring the phone sent on the right bell must be a hit (±1: a wrong-zone ring can take a
      // neighbouring note on its bell, leaving that note's own ring stray).
      const expect = sims.diag?.find((d) => d.name === p.name)?.expectHits;
      if (expect === undefined) fails.push(`${p.name}: no ring plan from the simulated phone`);
      else if (hit < expect - 1) fails.push(`${p.name}: hit ${hit}/${p.notes}, the phone rang ${expect} on the right bell`);
      const tol = meanTolMs(p.offsetMs.n);
      if (!(Math.abs(p.offsetMs.mean - late) <= tol)) fails.push(`${p.name}: mean offset ${p.offsetMs.mean} ms, expected ${late} ± ${tol.toFixed(1)}`);
      sum += p.offsetMs.mean * p.offsetMs.n;
      n += p.offsetMs.n;
    }
    const teamMean = sum / n;
    const teamTol = meanTolMs(n, 6);
    if (!(Math.abs(teamMean - late) <= teamTol)) fails.push(`team mean offset ${teamMean.toFixed(1)} ms over ${n} rings, expected ${late} ± ${teamTol.toFixed(1)}`);
    if (r.hgp.input.unsynced > 0) fails.push(`unsynced rings: ${r.hgp.input.unsynced}`);
    if (errors.length) fails.push(`page errors: ${errors.join(' | ')}`);
    const timing = timingSummary(r, sims);
    const { timing: _raw, ...rest } = r;
    const row = { run, scenario: sc.name, ok: fails.length === 0, fails, wallS, timing, result: rest };
    runRows.push(row);
    const line = `${r.players.map((p) => `${p.name} ${p.perfect + p.great + p.good}/${p.notes} (${p.offsetMs.mean} ms)`).join(', ')}`;
    if (verbose || !row.ok) console.log(`  ${row.ok ? 'PASS' : 'FAIL'}  ${sc.name}: team ${r.score} pts, accuracy ${(r.accuracy * 100).toFixed(1)}%, ${line}`);
    for (const f of fails) console.log(`    ✗ ${f}`);
    if (!row.ok) console.log(`    timing: ${JSON.stringify(timing)}`);
  }
  const ok = runRows.every((x) => x.ok);
  if (ok) passes++;
  all.push(...runRows);
  if (repeat > 1) {
    const worst = Math.max(...runRows.map((x) => Math.max(Math.abs(x.timing.cueAnchorDriftMs?.min ?? 0), Math.abs(x.timing.cueAnchorDriftMs?.max ?? 0))));
    console.log(`  run ${run}: ${ok ? 'PASS' : 'FAIL'} (${passes}/${run} passing runs; worst cue-anchor drift ${worst.toFixed(2)} ms; max |mean offset − expected| ${Math.max(...runRows.flatMap((x) => x.result.players.filter((p) => p.slot === 'phone').map((p) => Math.abs(p.offsetMs.mean - (scenarios.find((s) => s.name === x.scenario).late ?? 0))))).toFixed(1)} ms)`);
    appendFileSync(join(outDir, 'e2e-repeat.ndjson'), runRows.map((x) => JSON.stringify({ run: x.run, scenario: x.scenario, ok: x.ok, fails: x.fails, load, timing: x.timing, players: x.result.players.map((p) => ({ name: p.name, slot: p.slot, notes: p.notes, hit: p.perfect + p.great + p.good, mean: p.offsetMs.mean, p95abs: p.offsetMs.p95abs })), fps: x.result.metrics.fps })).join('\n') + '\n');
    if (!ok && bail) break;
  }
}
await browser.close();
for (const w of loadWorkers) void w.terminate();

if (shots) {
  for (const f of ['i2-4-ringers-play.png', 'i2-4-ringers-lobby.png', 'i2-2-phones-plus-host-play.png', 'i2-4-ringers-results.png']) {
    try {
      copyFileSync(join(outDir, f), join(media, f));
    } catch {
      // scenario not run
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
if (repeat === 1) writeFileSync(join(outDir, `e2e-${stamp}.json`), JSON.stringify(all, null, 2));
const md = [
  `| Scenario | Result | Team score | Team acc. | Ringers (hit/notes, mean offset, p95 abs) | Ring→page p50 | Host clock err | fps |`,
  `|---|---|---|---|---|---|---|---|`,
  ...all.map(({ scenario, ok, result: r }) => {
    const m = r.metrics;
    const players = r.players.map((p) => `${p.name}${p.slot === 'phone' ? '' : ` (${p.slot})`} ${p.perfect + p.great + p.good}/${p.notes}, ${p.offsetMs.mean} ms, ±${p.offsetMs.p95abs}`).join('; ');
    return `| ${scenario} | ${ok ? 'PASS' : 'FAIL'} | ${r.score} | ${(r.accuracy * 100).toFixed(1)} % | ${players} | ${r.hgp.input?.latencyMs?.p50 ?? '–'} ms | ±${r.hgp.hostClock?.errBound?.toFixed(2)} ms | ${m.fps} |`;
  }),
].join('\n');
if (repeat === 1) {
  writeFileSync(join(outDir, `e2e-summary.md`), `# I2 E2E (${stamp}, ${channel}${headed ? '' : ' headless'}, quality ${quality})\n\n${md}\n`);
  console.log(`\n${md}\n`);
} else console.log(`\n${passes}/${repeat} consecutive-run passes (load ${load}); details in results/e2e-repeat.ndjson`);
const ok = all.every((a) => a.ok);
console.log(ok ? 'I2 E2E OK' : 'I2 E2E FAILED');
process.exit(ok ? 0 : 1);
