import { DEFAULT_BELLS, midiToHz, type Bell, type DetectMode, type SoundMode } from '../core/hgp.ts';
import { ImpactDetector } from '../core/impact-detector.ts';
import { learnAxis, RingDetector, type MotionSample, type StrikeEvent, type Vec3 } from '../core/ring-detector.ts';
import { bell as playBell, click, perfToCtx, testBeep, unlockAudio } from './audio.ts';
import { deviceId, HgpClient } from './hgp-client.ts';
import { MotionSource } from './motion.ts';

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const AXIS_KEY = 'hgp-ring-axis';
const NAME_KEY = 'hgp-name';

// ── state ───────────────────────────────────────────────────────────────────
let myBells: Bell[] = [DEFAULT_BELLS[3]];
let selIdx = 0;
let selAt = 0;
const myBell = (): Bell => myBells[Math.min(selIdx, myBells.length - 1)];
let soundMode: SoundMode = 'device';
/** YARG mode (I1): this phone's ringer seat, shown above the bell. */
let ringer: { slot: number; title: string; song?: string } | null = null;
let mode: DetectMode = 'ring';
let recording = false;
let raw: number[][] = [];
let calibrating: StrikeEvent[] | null = null;
let test: { id: string; kind: string; start?: number; period?: number; count?: number; durationMs?: number; expect?: string[]; next: number } | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
let lastOmega = 0;
let peakOmega = 0;
let gestureCount = 0;
let lastInfo = '';

const detectorOverrides: Record<string, number> = {};
for (const k of ['armOmega', 'minPeakOmega', 'minDecel', 'releaseRatio', 'rearmOmega', 'refractoryMs', 'maxStrokeMs', 'timeOffsetMs']) {
  const v = q.get(k);
  if (v !== null && Number.isFinite(Number(v))) detectorOverrides[k] = Number(v);
}
const savedAxis = localStorage.getItem(AXIS_KEY);
const ring = new RingDetector({ ...detectorOverrides, axis: savedAxis ? (JSON.parse(savedAxis) as Vec3) : null });
const impact = new ImpactDetector();
const motion = new MotionSource();
const client = new HgpClient({
  kind: 'phone',
  deviceId: deviceId(),
  name: localStorage.getItem(NAME_KEY) ?? 'phone',
  hello: { app: 'handbell-hero/s1-controller', gestures: ['ring', 'impact', 'tap'], sound: true },
});

// ── UI ──────────────────────────────────────────────────────────────────────
function render(): void {
  document.body.style.setProperty('--bell', myBell().color);
  $('bell-label').textContent = myBell().label;
  $('bell-id').textContent = myBell().id;
  const e = client.clock.estimate;
  const st = motion.stats();
  $('status').textContent = [
    client.connected ? (client.transport === 'rtc' ? 'connected (WebRTC)' : 'connected') : 'offline',
    `${motion.api} ${st.rateHz.toFixed(0)} Hz${motion.hasGyro ? '' : ' (no gyro!)'}`,
    e ? `sync ±${e.errBound.toFixed(1)} ms, rtt ${e.rttP50.toFixed(0)} ms` : 'sync…',
    `sound: ${soundMode}`,
    `mode: ${mode}${ring.params.axis ? '' : ' (uncalibrated)'}`,
  ].join(' · ');
  $('debug').textContent = `|ω| ${lastOmega.toFixed(0)} deg/s (peak ${peakOmega.toFixed(0)}) · gestures ${gestureCount} · ${lastInfo}`;
  const banner = $('banner');
  if (calibrating) {
    banner.textContent = `Calibrating: ring ${Math.max(0, 6 - calibrating.length)} more times`;
    banner.hidden = false;
  } else if (test) {
    const msgs: Record<string, string> = {
      metronome: `Metronome test — ring on every click (${Math.min(test.next, test.count ?? 0)}/${test.count})${test.expect ? '. Touch the glowing zone, then ring.' : ''}`,
      idle: 'False-ring test — DON\'T ring. Hold, wave, walk around, put the phone down and pick it up…',
      clink: 'Clink test — gently tap the two phones together (or knock the table they lie on) about once a second',
      latency: 'Latency test — knock the phone on the table near the microphone, once a second',
    };
    banner.textContent = msgs[test.kind] ?? test.kind;
    banner.hidden = false;
  } else banner.hidden = true;
}

function flash(): void {
  const el = $('bell');
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
}

// ── gestures ────────────────────────────────────────────────────────────────
function emitGesture(g: string, t: number, vel: number, src: string, extra: Record<string, unknown> = {}): void {
  gestureCount++;
  const clk = client.clock;
  const th = clk.ready ? clk.toHost(t) : undefined;
  client.sendFast({ type: 'gesture', seq: client.nextSeq(), g, t, th, err: clk.estimate?.errBound, bell: myBell().id, sel: myBells.length > 1 ? selAt : undefined, vel, det: performance.now() - t, src, ...extra });
  if (soundMode === 'device' || soundMode === 'both') {
    if (test?.kind === 'latency') testBeep();
    else playBell(midiToHz(myBell().midi), 0, vel);
  }
  navigator.vibrate?.(10);
  flash();
}

function onSample(s: MotionSample): void {
  const w = Math.hypot(s.gx, s.gy, s.gz);
  if (Number.isFinite(w)) {
    lastOmega = w;
    peakOmega = Math.max(peakOmega * 0.995, w);
  }
  if (recording) raw.push([+s.t.toFixed(2), +s.ax.toFixed(3), +s.ay.toFixed(3), +s.az.toFixed(3), +s.gx.toFixed(2), +s.gy.toFixed(2), +s.gz.toFixed(2)]);
  if (mode === 'impact') {
    const e = impact.push(s);
    if (e) {
      lastInfo = `impact peak ${e.peak.toFixed(1)} m/s² (thr ${e.threshold.toFixed(1)})`;
      emitGesture('impact', e.t, Math.min(1, e.peak / 30), 'motion');
    }
    return;
  }
  const e = ring.push(s);
  if (!e) return;
  lastInfo = `ring ω ${e.peakOmega.toFixed(0)}, decel ${(e.maxDecel / 1000).toFixed(1)}k, det ${(e.firedAt - e.t).toFixed(0)} ms`;
  if (calibrating) {
    calibrating.push(e);
    playBell(midiToHz(myBell().midi), 0, e.intensity);
    flash();
    if (calibrating.length >= 6) finishCalibration();
    return;
  }
  emitGesture('ring', e.t, e.intensity, 'motion', { peak: Math.round(e.peakOmega), decel: Math.round(e.maxDecel) });
}

function startCalibration(): void {
  ring.params.axis = null;
  ring.reset();
  calibrating = [];
}

function finishCalibration(): void {
  const axis = calibrating ? learnAxis(calibrating) : null;
  calibrating = null;
  if (axis) {
    ring.params.axis = axis;
    localStorage.setItem(AXIS_KEY, JSON.stringify(axis));
    lastInfo = `calibrated axis [${axis.map((v) => v.toFixed(2)).join(', ')}]`;
  } else lastInfo = 'calibration failed — try again';
  ring.reset();
  client.send({ type: 'result', test: 'calibration', data: { axis } });
}

// ── tests from host ─────────────────────────────────────────────────────────
function onTest(m: Record<string, unknown>): void {
  if (m.action === 'stop') {
    test = null;
    mode = 'ring';
    flushRaw();
    recording = q.get('record') === '1';
    return;
  }
  const kind = String(m.test);
  test = {
    id: String(m.id),
    kind,
    start: typeof m.start === 'number' ? m.start : undefined,
    period: typeof m.period === 'number' ? m.period : undefined,
    count: typeof m.count === 'number' ? m.count : undefined,
    durationMs: typeof m.durationMs === 'number' ? m.durationMs : undefined,
    expect: Array.isArray(m.expect) ? (m.expect as string[]) : undefined,
    next: 0,
  };
  mode = kind === 'clink' || kind === 'latency' ? 'impact' : 'ring';
  impact.reset();
  ring.reset();
  recording = true;
}

// Metronome: schedule clicks ~300 ms ahead on the audio clock, mapped from host time.
window.setInterval(() => {
  if (!test || test.kind !== 'metronome' || test.start === undefined || !test.period || !test.count) return;
  const clk = client.clock;
  if (!clk.ready) return;
  const nowP = performance.now();
  while (test.next < test.count) {
    const tLocal = clk.toLocal(test.start + test.next * test.period);
    if (tLocal > nowP + 300) break;
    if (tLocal > nowP - 20) click(perfToCtx(tLocal), test.next % 4 === 0);
    test.next++;
  }
}, 50);

// ── multi-bell thumb zones ──────────────────────────────────────────────────
/** Next expected bell during a multi-bell metronome test (the "note highway" stand-in). */
function expectedBell(): string | null {
  if (!test?.expect || test.start === undefined || !test.period) return null;
  const clk = client.clock;
  if (!clk.ready) return null;
  const i = Math.ceil((clk.toHost(performance.now()) - test.start - test.period * 0.35) / test.period);
  return test.expect[Math.max(0, Math.min(test.expect.length - 1, i))] ?? null;
}

function select(i: number, t: number): void {
  if (i === selIdx) return;
  selIdx = i;
  selAt = t;
  navigator.vibrate?.(5);
  renderZones();
}

function buildZones(): void {
  const z = $('zones');
  z.innerHTML = '';
  document.body.classList.toggle('multi', myBells.length > 1);
  // One column per bell, like the YARG highway lanes (low → high, left → right); else 2×2.
  z.style.gridTemplateColumns = ringer || myBells.length > 4 ? `repeat(${myBells.length}, 1fr)` : '';
  if (myBells.length < 2) return;
  myBells.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'zone';
    el.style.setProperty('--zone', b.color);
    el.innerHTML = `<b>${b.label}</b><small>${b.id}</small>`;
    // pointerdown (not click): fires on first contact, ~100 ms earlier than click on mobile.
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(i, e.timeStamp);
    });
    z.appendChild(el);
  });
  renderZones();
}

let lastExpected: string | null = null;
function renderZones(): void {
  const exp = expectedBell();
  lastExpected = exp;
  [...$('zones').children].forEach((el, i) => {
    el.classList.toggle('selected', i === selIdx);
    el.classList.toggle('next', myBells[i]?.id === exp);
  });
  document.body.style.setProperty('--bell', myBell().color);
  $('bell-label').textContent = myBell().label;
  $('bell-id').textContent = myBell().id;
}
window.setInterval(() => {
  if (myBells.length > 1 && expectedBell() !== lastExpected) renderZones();
}, 50);

function flushRaw(): void {
  if (raw.length === 0) return;
  const clk = client.clock;
  const off = clk.ready ? clk.offsetAt(raw[raw.length - 1][0]) : NaN;
  client.send({ type: 'raw', off, cols: ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'], s: raw });
  raw = [];
}
window.setInterval(flushRaw, 250);

window.setInterval(() => {
  const e = client.clock.estimate;
  const st = motion.stats();
  client.send({
    type: 'status',
    api: motion.api,
    rateHz: Math.round(st.rateHz * 10) / 10,
    interval: st,
    gyro: motion.hasGyro,
    offset: e?.offset,
    drift: e ? e.drift * 1e6 : undefined,
    rttMin: e?.rttMin,
    rttP50: e?.rttP50,
    syncN: e?.n,
    transport: client.transport,
    visible: document.visibilityState === 'visible',
    mode,
    axis: ring.params.axis,
    wakeLock: wakeLock !== null,
  });
  render();
}, 1000);

client.onMessage = (m) => {
  switch (m.type) {
    case 'assign': {
      const bells = m.bells as Bell[] | undefined;
      if (bells && bells.length > 0) {
        const changed = bells.map((b) => b.id).join() !== myBells.map((b) => b.id).join();
        myBells = bells.slice(0, 5);
        if (changed) {
          selIdx = 0;
          selAt = performance.now();
          buildZones();
        }
      }
      soundMode = (m.sound as SoundMode) ?? soundMode;
      ringer = (m.ringer as typeof ringer) ?? null;
      $('ringer').hidden = !ringer;
      $('ringer').textContent = ringer ? `🎮 ${ringer.title}${ringer.song ? ` — ${ringer.song}` : ''}` : '';
      if (bells && bells.length > 0) buildZones();
      break;
    }
    case 'config':
      if (m.mode === 'ring' || m.mode === 'impact') mode = m.mode;
      if (typeof m.record === 'boolean') recording = m.record;
      if (m.detector && typeof m.detector === 'object') Object.assign(ring.params, m.detector);
      if (m.calibrate) startCalibration();
      break;
    case 'test':
      onTest(m);
      break;
  }
  render();
};
client.onState = (s) => {
  lastInfo = s;
  render();
};

// ── startup (needs a user gesture for iOS motion permission + audio) ────────
async function requestWakeLock(): Promise<void> {
  const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

async function start(): Promise<void> {
  const name = ($('name') as HTMLInputElement).value.trim() || 'phone';
  localStorage.setItem(NAME_KEY, name);
  // Both must be *called* synchronously inside the tap handler (iOS user-activation rules).
  const permP = MotionSource.requestPermission().catch((e: unknown) => `error: ${String(e)}`);
  const audioP = unlockAudio().catch((e: unknown) => ({ state: `error: ${String(e)}`, audioSession: '?', baseLatency: NaN, outputLatency: NaN }));
  const perm = await permP;
  const audioInfo = await audioP;
  await requestWakeLock();
  const api = await motion.start(q.get('api') === 'generic' ? 'generic' : 'auto', Number(q.get('hz') ?? 60));
  motion.onSample = onSample;
  client.setName(name);
  client.connect();
  $('start-screen').hidden = true;
  $('main').hidden = false;
  recording = q.get('record') === '1';
  const env = {
    permission: perm,
    api,
    secureContext: window.isSecureContext,
    audio: audioInfo,
    wakeLock: wakeLock !== null,
    ua: navigator.userAgent,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
  };
  lastInfo = `permission ${perm}`;
  window.setTimeout(() => client.send({ type: 'result', test: 'environment', data: env }), 1500);
  if (q.get('rtc') === '1') window.setTimeout(() => void client.startRtc(), 2000);
  if (!ring.params.axis) startCalibration();
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void requestWakeLock();
    client.sync.reset();
    client.reconnectNow();
  }
});

($('name') as HTMLInputElement).value = localStorage.getItem(NAME_KEY) ?? '';
$('start').addEventListener('click', () => void start());
$('calibrate').addEventListener('click', () => startCalibration());
$('tap-toggle').addEventListener('click', () => {
  const zone = $('bell');
  zone.classList.toggle('tappable');
  $('tap-toggle').textContent = zone.classList.contains('tappable') ? 'Touch: on' : 'Touch: off';
});
$('bell').addEventListener('pointerdown', (e) => {
  if (!$('bell').classList.contains('tappable')) return;
  e.preventDefault();
  emitGesture('tap', e.timeStamp, 0.8, 'touch');
});
$('secure').textContent = window.isSecureContext ? '' : '⚠ Not a secure context: motion sensors are blocked. Open the https:// link.';
