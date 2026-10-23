// End-to-end check without phones: real S1 host (serving the built game) + S1 simulated phones
// (tools/sim-phones.ts --game) + headless Chrome playing the game page; asserts that every
// simulated ringer's rings arrive, map to the right lanes and are judged on source timestamps.
//   npm run build && node scripts/e2e.mjs [--only name,...] [--channel chrome|msedge] [--headed] [--shots]
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

const scenarios = [
  { name: 'silent-night-easy-3', song: 'silent-night', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob', 'Cara'] },
  { name: 'jingle-bells-medium-4', song: 'jingle-bells', diff: 'medium', ringers: 4, phones: ['Alice', 'Bob', 'Cara', 'Dan'], shot: 'i2-4-ringers' },
  { name: 'joy-easy-2-with-host', song: 'joy-to-the-world', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob'], hostRingers: 1, shot: 'i2-2-phones-plus-host' },
  { name: 'silent-night-late60', song: 'silent-night', diff: 'easy', ringers: 3, phones: ['Alice', 'Bob', 'Cara'], late: 60 },
].filter((s) => !only || only.split(',').includes(s.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const p = spawn(process.execPath, [tsx, 'tools/sim-phones.ts', '--game', '--url', `ws://127.0.0.1:${port}/hgp`, '--names', names.join(','), '--seconds', String(seconds), '--late', String(late ?? 0), '--jitter', '20', '--miss', '0.03'], { cwd: s1, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`    [sim] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`    [sim!] ${d}`));
  return p;
}

const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: !headed,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

const all = [];
let port = 18080;
for (const sc of scenarios) {
  console.log(`\n▶ ${sc.name}`);
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

  // Assertions
  const fails = [];
  const late = sc.late ?? 0;
  const phonePlayers = r.players.filter((p) => p.slot === 'phone');
  if (phonePlayers.length !== sc.phones.length) fails.push(`expected ${sc.phones.length} phone ringers, got ${phonePlayers.length}`);
  if ((r.autoRingers?.length ?? 0) !== (sc.hostRingers ?? 0)) fails.push(`expected ${sc.hostRingers ?? 0} host ringers, got ${r.autoRingers?.length}`);
  for (const p of phonePlayers) {
    const hit = p.perfect + p.great + p.good;
    if (hit / p.notes < 0.8) fails.push(`${p.name}: hit ${hit}/${p.notes}`);
    if (Math.abs(p.offsetMs.mean - late) > 12) fails.push(`${p.name}: mean offset ${p.offsetMs.mean} ms, expected ≈ ${late}`);
  }
  if (r.hgp.input.unsynced > 0) fails.push(`unsynced rings: ${r.hgp.input.unsynced}`);
  if (errors.length) fails.push(`page errors: ${errors.join(' | ')}`);
  const row = { scenario: sc.name, ok: fails.length === 0, fails, wallS, result: r };
  all.push(row);
  console.log(`  ${row.ok ? 'PASS' : 'FAIL'}  team ${r.score} pts, accuracy ${(r.accuracy * 100).toFixed(1)}%, ${r.players.map((p) => `${p.name} ${p.perfect + p.great + p.good}/${p.notes} (${p.offsetMs.mean} ms)`).join(', ')}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
await browser.close();

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
writeFileSync(join(outDir, `e2e-${stamp}.json`), JSON.stringify(all, null, 2));
const md = [
  `| Scenario | Result | Team score | Team acc. | Ringers (hit/notes, mean offset, p95 abs) | Ring→page p50 | Host clock err | fps |`,
  `|---|---|---|---|---|---|---|---|`,
  ...all.map(({ scenario, ok, result: r }) => {
    const m = r.metrics;
    const players = r.players.map((p) => `${p.name}${p.slot === 'phone' ? '' : ` (${p.slot})`} ${p.perfect + p.great + p.good}/${p.notes}, ${p.offsetMs.mean} ms, ±${p.offsetMs.p95abs}`).join('; ');
    return `| ${scenario} | ${ok ? 'PASS' : 'FAIL'} | ${r.score} | ${(r.accuracy * 100).toFixed(1)} % | ${players} | ${r.hgp.input?.latencyMs?.p50 ?? '–'} ms | ±${r.hgp.hostClock?.errBound?.toFixed(2)} ms | ${m.fps} |`;
  }),
].join('\n');
writeFileSync(join(outDir, `e2e-summary.md`), `# I2 E2E (${stamp}, ${channel}${headed ? '' : ' headless'}, quality ${quality})\n\n${md}\n`);
console.log(`\n${md}\n`);
const ok = all.every((a) => a.ok);
console.log(ok ? 'I2 E2E OK' : 'I2 E2E FAILED');
process.exit(ok ? 0 : 1);
