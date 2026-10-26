// Audio-render sanity check for the procedural backing and the performance SFX: Vite dev server +
// headless Chrome render four carols (one per style) with OfflineAudioContext and check that the
// output is audible, does not clip, sits under the bells, starts every count-in click and the
// first groove downbeat on its scheduled sample (also at practice speed 0.75), ends with the
// ritardando tag on time and decays to silence, and goes silent after stop(). Each SFX is rendered
// alone: no clipping, on its scheduled sample, under one bell, and ducked when a bell rings.
//   npm run audio-check [-- --channel=msedge] [--songs=jingle-bells,silent-night]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const channel = opt('channel', 'chrome');
const songs = opt('songs', '');

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true });
let out;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}test/render-check.html${songs ? `?songs=${songs}` : ''}`);
  await page.waitForFunction(() => document.title === 'RENDER_DONE', null, { timeout: 120000, polling: 250 });
  out = await page.evaluate(() => window.__render);
  if (errors.length) out.pageErrors = errors;
} finally {
  await browser.close();
  await server.close();
}
if (out.error) {
  console.error(out.error);
  process.exit(1);
}

const fails = [];
for (const r of out.rows) {
  const tag = `${r.song} (${r.style})`;
  if (!(r.peak < 1)) fails.push(`${tag}: clips (peak ${r.peak})`);
  if (!(r.backingRmsDb > -50)) fails.push(`${tag}: too quiet (${r.backingRmsDb} dBFS)`);
  if (!(r.backingVsBellsDb < -4 && r.backingVsBellsDb > -18)) fails.push(`${tag}: backing should sit 4–18 dB under the bells at the default volume (${r.backingVsBellsDb} dB)`);
  if (r.clicks < 3 || r.clickOnsetErrMs.some((e) => !(Math.abs(e) <= 0.5))) fails.push(`${tag}: count-in clicks off grid ${JSON.stringify(r.clickOnsetErrMs)}`);
  if (!(Math.abs(r.firstDownbeatOnsetErrMs) <= 0.5)) fails.push(`${tag}: first downbeat onset ${r.firstDownbeatOnsetErrMs} ms`);
  if (!r.silentAfterStop) fails.push(`${tag}: still sounding after stop()`);
  if (!r.silentBeforeStart) fails.push(`${tag}: sound before the first scheduled event`);
  if (!(r.ending.peak < 1)) fails.push(`${tag}: ending clips (peak ${r.ending.peak})`);
  if (r.ending.tagNotes < 5) fails.push(`${tag}: ritardando tag has ${r.ending.tagNotes} glock notes`);
  if (!(Math.abs(r.ending.lastDingOnsetErrMs) <= 0.5)) fails.push(`${tag}: closing ding onset ${r.ending.lastDingOnsetErrMs} ms`);
  if (!(r.ending.tailRmsDb < -70)) fails.push(`${tag}: ending still sounding 4 s after the closing ding (${r.ending.tailRmsDb} dBFS)`);
  if (!(Math.abs(r.slowDownbeatOnsetErrMs) <= 0.5)) fails.push(`${tag}: first downbeat at practice speed 0.75: ${r.slowDownbeatOnsetErrMs} ms`);
}
const sfx = out.sfx;
for (const s of sfx.rows) {
  if (!(s.peak < 1)) fails.push(`SFX ${s.cue}: clips (peak ${s.peak})`);
  // ≤ 1 ms: a sawtooth/filtered voice can take a few samples to rise above −100 dBFS.
  if (!(Math.abs(s.onsetErrMs) <= 1)) fails.push(`SFX ${s.cue}: onset ${s.onsetErrMs} ms`);
  if (!(s.rmsDb > -60)) fails.push(`SFX ${s.cue}: inaudible (${s.rmsDb} dBFS)`);
  if (!(s.vsBellDb <= -6 && s.vsBellDb >= -30)) fails.push(`SFX ${s.cue}: should sit 6–30 dB under a bell at the default volume (${s.vsBellDb} dB)`);
}
if (!(sfx.duckDb <= -6)) fails.push(`SFX ducking under a bell only ${sfx.duckDb} dB`);
if (!sfx.silentBefore) fails.push('SFX: sound before the scheduled cue');
if (out.pageErrors) fails.push(...out.pageErrors);

const md = [
  `| Song | Style | Events (20 s) | Count-in clicks | Lead-in (s) | Peak | Backing RMS | Bells RMS | Backing vs bells | Click onset error (ms) | First downbeat (ms) | Silent before / after stop | Render (ms) |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...out.rows.map((r) => `| ${r.song} | ${r.style} | ${r.events} | ${r.clicks} | ${r.leadInSec} | ${r.peak} | ${r.backingRmsDb} dBFS | ${r.bellsRmsDb} dBFS | ${r.backingVsBellsDb} dB | ${r.clickOnsetErrMs.join(', ')} | ${r.firstDownbeatOnsetErrMs} | ${r.silentBeforeStart ? 'yes' : 'no'} / ${r.silentAfterStop ? 'yes' : 'no'} | ${r.renderMs} |`),
  '',
  '**Ending** (ritardando tag + fermata, from 2 s before the final downbeat) and **practice speed** 0.75:',
  '',
  '| Song | Ending peak | Tag glock notes | Closing ding onset (ms) | Level 4 s after the ding | First downbeat at 0.75× (ms) |',
  '|---|---|---|---|---|---|',
  ...out.rows.map((r) => `| ${r.song} | ${r.ending.peak} | ${r.ending.tagNotes} | ${r.ending.lastDingOnsetErrMs} | ${r.ending.tailRmsDb} dBFS | ${r.slowDownbeatOnsetErrMs} |`),
  '',
  `**Performance SFX** (SFX volume 50 %, each alone; vs bell = RMS over the effect vs one G5 bell at autoplay gain over the same span). Ducking: a bell 80 ms before a sparkle lowers its first 120 ms by **${sfx.duckDb} dB**.`,
  '',
  '| Cue | Peak | RMS | vs one bell | Onset error (ms) | Length (s) |',
  '|---|---|---|---|---|---|',
  ...sfx.rows.map((s) => `| ${s.cue} | ${s.peak} | ${s.rmsDb} dBFS | ${s.vsBellDb} dB | ${s.onsetErrMs} | ${s.lengthSec} |`),
].join('\n');
mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results', 'backing-render.md'), `# Backing + SFX render check (${new Date().toISOString().slice(0, 10)}, ${channel} headless, OfflineAudioContext ${out.sampleRate} Hz, default volume 50 %)\n\nGenerated by \`npm run audio-check\`. ${out.userAgent}\n\n${md}\n`);
console.log(md);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(fails.length ? 'BACKING RENDER CHECK FAILED' : 'BACKING RENDER CHECK OK');
process.exit(fails.length ? 1 : 0);
