// Render the owner's blind-listening set: per carol, the same bells + three accompaniments —
// procedural (S5 chart + I2 backing), LLM-assisted (S6 candidate chart + I2 backing) and AMT
// (melody bells + AMT accompaniment through the I2 synth voices). Headless Chrome renders with
// OfflineAudioContext; clips are loudness-matched mono WAVs with shuffled letters.
//   node scripts/render-previews.ts [--mock] [--ogg-python <python with soundfile>] [--songs deck-the-halls,the-holly-and-the-ivy] [--channel chrome]
// Needs `npm ci` in spikes/i2-web-phones (Vite + playwright-core) and a local Chrome or Edge.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { S6_DIR } from '../src/llm.ts';
import { midiNotesSeconds } from '../src/midi-io.ts';

const argv = process.argv.slice(2);
const mock = argv.includes('--mock');
const opt = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const songs = opt('songs', 'deck-the-halls,the-holly-and-the-ivy').split(',');
const channel = opt('channel', 'chrome');
const SPIKES = join(S6_DIR, '..');
const I2 = join(SPIKES, 'i2-web-phones');
const req = createRequire(join(I2, 'package.json'));
const { createServer } = await import(pathToFileURL(join(I2, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
const { chromium } = req('playwright-core');

const chartsDir = mock ? join(S6_DIR, 'results', 'mock', 'charts') : join(S6_DIR, 'charts');
const outDir = mock ? join(S6_DIR, 'results', 'mock', 'previews') : join(S6_DIR, 'previews');
mkdirSync(outDir, { recursive: true });
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const MAX = 50;

interface Variant { variant: string; describe: string; job: Record<string, unknown> }
const jobs: Record<string, unknown>[] = [];
const key: Record<string, Record<string, string>> = {};
for (const id of songs) {
  const s5 = readJson(join(SPIKES, 's5-chart-pipeline', 'charts', `${id}.json`));
  const variants: Variant[] = [
    { variant: 'procedural', describe: 'S5 chart (hard, 4 ringers) + I2 procedural backing from the S5 chords', job: { chart: s5, difficulty: 'hard', ringers: 4, backing: true } },
  ];
  const s6 = join(chartsDir, `${id}-s6.json`);
  if (existsSync(s6)) {
    const meta = existsSync(join(S6_DIR, 'candidates', 'candidates.json')) ? readJson(join(S6_DIR, 'candidates', 'candidates.json')).candidates?.find((c: { song: string }) => c.song === id) : null;
    variants.push({ variant: 'llm', describe: `S6 qwen3:8b candidate chart (hard, 4 ringers; AI parts: ${meta?.aiParts?.join(', ') ?? 'see candidates.json'}; bass/inner realized by S5 from the chords) + I2 procedural backing from its chords`, job: { chart: readJson(s6), difficulty: 'hard', ringers: 4, backing: true } });
  }
  const amt = join(S6_DIR, 'results', 'amt', id, 'accompaniment.mid');
  if (existsSync(amt)) {
    const rep = readJson(join(S6_DIR, 'results', 'amt', id, 'report.json'));
    variants.push({ variant: 'amt', describe: `S5 melody bells (easy, 4 ringers) + AMT accompaniment (${String(rep.model_dir ?? '').match(/music-(small|medium|large)-800k/)?.[0] ?? 'AMT'}, ${rep.mode ?? ''} run) through the I2 bass/pad voices`, job: { chart: s5, difficulty: 'easy', ringers: 4, backing: false, amt: midiNotesSeconds(readFileSync(amt)) } });
  }
  // Deterministic shuffle so letters don't reveal the variant.
  const order = variants.map((v) => ({ v, k: createHash('sha256').update(`${id}:${v.variant}:s6-blind`).digest('hex') })).sort((a, b) => a.k.localeCompare(b.k)).map((x) => x.v);
  key[id] = {};
  order.forEach((v, i) => {
    const letter = 'ABC'[i];
    key[id][letter] = `${v.variant}: ${v.describe}`;
    jobs.push({ name: `${id}-${letter}`, maxSeconds: MAX, ...v.job });
  });
}

const server = await createServer({ root: SPIKES, cacheDir: join(I2, 'node_modules', '.vite-s6'), logLevel: 'error', server: { port: 5299, strictPort: false, fs: { allow: [join(SPIKES, '..')] } } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true });
let out: { error?: string; userAgent: string; sampleRate: number; results: { name: string; seconds: number; wav: string; rmsDb: number; peak: number; bellNotes: number; amtNotes: number; backingEvents: number }[] };
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  await page.addInitScript((j: unknown) => ((window as unknown as { __jobs: unknown }).__jobs = j), jobs);
  const t0 = performance.now();
  await page.goto(`${url}s6-ai-arranging/preview/render.html`);
  await page.waitForFunction(() => document.title === 'RENDER_DONE', null, { timeout: 300000, polling: 250 });
  out = await page.evaluate(() => (window as unknown as { __out: never }).__out);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`rendered ${jobs.length} clips in ${Math.round(performance.now() - t0)} ms`);
} finally {
  await browser.close();
  await server.close();
}
if (out.error) throw new Error(out.error);
for (const r of out.results) writeFileSync(join(outDir, `${r.name}.wav`), Buffer.from(r.wav, 'base64'));
const oggPython = argv.includes('--ogg-python') ? opt('ogg-python', '') : '';
const ext = oggPython ? 'ogg' : 'wav';
if (oggPython) {
  const r = spawnSync(oggPython, [join(S6_DIR, 'scripts', 'wav_to_ogg.py'), ...out.results.map((x) => join(outDir, `${x.name}.wav`))], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`wav_to_ogg failed: ${r.stderr}`);
  console.log(r.stdout.trim());
}
writeFileSync(join(outDir, 'answer-key.json'), JSON.stringify({ $comment: 'Blind-listening key: do not open before listening (see README.md).', key }, null, 2) + '\n');
const md = [
  `# S6 preview render (${new Date().toISOString().slice(0, 10)}, ${channel} headless, OfflineAudioContext ${out.sampleRate} Hz mono)`,
  '',
  `Generated by \`node scripts/render-previews.ts${mock ? ' --mock' : ''}\`. ${out.userAgent}`,
  '',
  '| Clip | Seconds | RMS | Peak | Bell strikes | AMT notes | Backing events |',
  '|---|---|---|---|---|---|---|',
  ...out.results.map((r) => `| ${r.name}.${ext} | ${r.seconds} | ${r.rmsDb} dBFS | ${r.peak} | ${r.bellNotes} | ${r.amtNotes} | ${r.backingEvents} |`),
  '',
].join('\n');
writeFileSync(join(mock ? join(S6_DIR, 'results', 'mock') : join(S6_DIR, 'results'), 'previews.md'), md);
console.log(md);
