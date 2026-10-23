import './style.css';
import { chartFromMidi, calibrationChart, type Chart } from './core/chart';
import { parseMidi } from './core/midi';
import { AudioEngine } from './audio/engine';
import { HighwayRenderer } from './render/highway';
import { KeyboardSource } from './input/keyboard';
import { Session, type Mode, type Offsets, type SessionResult } from './game/session';
import { Hud } from './ui/hud';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) !== '0' : d);

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const OFFSETS_KEY = 's4.offsets';
const offsets: Offsets = { visualMs: 0, inputMs: 0, ...JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? '{}') };
if (params.has('vis')) offsets.visualMs = num('vis', 0);
if (params.has('inp')) offsets.inputMs = num('inp', 0);
const saveOffsets = (): void => localStorage.setItem(OFFSETS_KEY, JSON.stringify(offsets));

const renderer = new HighwayRenderer($<HTMLCanvasElement>('gl'), {
  bloom: flag('bloom', true),
  fixedWidth: params.has('w') ? num('w', 1920) : undefined,
  fixedHeight: params.has('h') ? num('h', 1080) : undefined,
  maxPixelRatio: num('dpr', 2),
  msaa: num('msaa', 0),
  particles: flag('particles', true),
});
const audio = new AudioEngine();
const hud = new Hud();
const statsEl = $('stats');
statsEl.classList.toggle('hidden', !flag('stats', false));

let chart: Chart | null = null;
let session: Session | null = null;
let lastMode: Mode = 'play';

async function loadMidi(data: ArrayBuffer, title: string): Promise<void> {
  const midi = parseMidi(data);
  chart = chartFromMidi(midi, { title, maxLanes: num('lanes', 8) });
  $('song-name').textContent = `${title} · ${chart.lanes.length} bells · ${chart.notes.length} notes`;
  renderer.setChart(chart);
  layoutLanes();
}

async function loadDefault(): Promise<void> {
  const url = params.get('song') ?? 'songs/jingle-bells.mid';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}). Run "npm run song" first.`);
  await loadMidi(await res.arrayBuffer(), params.get('title') ?? 'Jingle Bells (chorus)');
}

function layoutLanes(): void {
  hud.positionLanes(renderer.laneScreenPositions());
}

async function start(mode: Mode): Promise<void> {
  const c = mode === 'calibrate' ? calibrationChart(16, 100) : chart;
  if (!c) return;
  lastMode = mode;
  await audio.resume();
  session?.stop();
  const s = new Session(mode, c, audio, renderer, hud, [new KeyboardSource(c.lanes.length, mode === 'calibrate' ? 0 : null)], offsets);
  s.onFinish = (r) => finish(r);
  session = s;
  s.start();
  if (params.has('bench')) {
    const w = window as unknown as Record<string, unknown>;
    w.__s4Notes = c.notes;
    w.__s4PerfAt = (t: number) => s.perfAtSong(t);
  }
  layoutLanes();
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
}

function finish(r: SessionResult): void {
  (window as unknown as { __s4Result: SessionResult }).__s4Result = r;
  if (params.has('bench')) document.title = 'BENCH_DONE';
  const body = $('res-body');
  if (r.calibration) {
    offsets.inputMs = r.calibration.medianMs;
    saveOffsets();
    body.innerHTML = `Taps: ${r.calibration.taps}<br>Median input offset: <span class="big">${r.calibration.medianMs.toFixed(0)} ms</span> (±${r.calibration.madMs.toFixed(0)} MAD) — saved.<br><small>Positive = you ring late relative to what you hear. A/V offset (←/→) is ${offsets.visualMs} ms.</small>`;
  } else {
    const c = r.counts;
    body.innerHTML = `<span class="big">${r.score.toLocaleString()}</span><br>Accuracy ${(r.accuracy * 100).toFixed(1)}% · best streak ${r.maxStreak}<br>Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss} · stray rings ${r.strays}`;
  }
  $('res-title').textContent = r.mode === 'calibrate' ? 'Calibration' : r.title;
  $('res-json').textContent = JSON.stringify({ ...r, userAgent: navigator.userAgent, url: location.search }, null, 2);
  $('results').classList.remove('hidden');
}

function toMenu(): void {
  session?.stop();
  session = null;
  hud.show(false);
  $('results').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (chart) renderer.setChart(chart);
}

$('btn-play').onclick = () => void start('play');
$('btn-auto').onclick = () => void start('autoplay');
$('btn-cal').onclick = () => void start('calibrate');
$('btn-again').onclick = () => void start(lastMode);
$('btn-menu').onclick = toMenu;
$('btn-copy').onclick = () => void navigator.clipboard.writeText($('res-json').textContent ?? '');

async function loadFile(f: File): Promise<void> {
  try {
    await loadMidi(await f.arrayBuffer(), f.name.replace(/\.midi?$/i, ''));
    $('menu-error').textContent = chart && chart.droppedPitches.length ? `Note: ${chart.droppedPitches.length} melody pitches exceed 8 lanes and will be auto-played.` : '';
  } catch (e) {
    $('menu-error').textContent = String(e);
  }
}
$<HTMLInputElement>('file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void loadFile(f);
};
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) {
    toMenu();
    void loadFile(f);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') toMenu();
  else if (e.code === 'Backquote') statsEl.classList.toggle('hidden');
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    offsets.visualMs += (e.code === 'ArrowRight' ? 5 : -5) * (e.shiftKey ? 4 : 1);
    saveOffsets();
  } else if (e.code === 'Enter' && !session) void start('play');
});
window.addEventListener('resize', () => {
  renderer.resize();
  layoutLanes();
});

// Idle (menu) rendering uses wall-clock time; sessions drive time from the audio clock.
let lastIdle = performance.now();
let lastStats = 0;
function loop(ts: number): void {
  requestAnimationFrame(loop);
  if (session) session.frame(ts);
  else {
    const dt = Math.min(0.1, (ts - lastIdle) / 1000);
    lastIdle = ts;
    renderer.frame(ts / 1000 + 1e4, dt, ts / 1000);
  }
  if (session && !statsEl.classList.contains('hidden') && ts - lastStats > 500) {
    lastStats = ts;
    const m = session.metrics() as Record<string, any>;
    statsEl.textContent = [
      `${m.render.width}×${m.render.height} dpr ${m.render.dpr}  ${m.fps} fps`,
      `frame ms p50 ${m.frameMs.p50} p95 ${m.frameMs.p95} p99 ${m.frameMs.p99} max ${m.frameMs.max}`,
      `long frames ${m.longFramePct}%  cpu ms p50 ${m.cpuMs.p50} p95 ${m.cpuMs.p95}`,
      `audio sr ${m.audio.sampleRate} base ${m.audio.baseLatencyMs} out ${m.audio.outputLatencyMs} ms outTS ${m.audio.getOutputTimestamp}`,
      `clock jitter p95 ${m.clockJitterMs.p95} ms drift ${m.audioDriftPpm} ppm`,
      `smooth err p95 ${m.smoothnessErrMs.p95} ms  late sched ${m.lateSchedules}`,
      `input dispatch p50 ${m.input.dispatchMs.p50} judge p50 ${m.input.eventToJudgeMs.p50} →frame p50 ${m.input.eventToNextFrameMs.p50}`,
      `hit offset mean ${m.input.hitOffsetMs.mean} p95 ${m.input.hitOffsetMs.p95} ms`,
      `GPU ${m.render.gpu}`,
    ].join('\n');
  }
}
requestAnimationFrame(loop);

loadDefault()
  .then(() => {
    const auto = params.get('mode') as Mode | null;
    if (auto && flag('auto', false)) void start(auto);
  })
  .catch((e) => ($('menu-error').textContent = String(e)));
