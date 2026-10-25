import { DEFAULT_BELLS, midiToHz, type Bell, type DetectMode, type Parts, type SoundMode } from '../core/hgp.ts';
import { isAccidental } from '../../../shared/pitch-palette.ts';
import { ImpactDetector } from '../core/impact-detector.ts';
import { learnAxis, RingDetector, type MotionSample, type StrikeEvent, type Vec3 } from '../core/ring-detector.ts';
import { bell as playBell, click, perfToCtx, testBeep, unlockAudio } from './audio.ts';
import { deviceId, HgpClient } from './hgp-client.ts';
import { MotionSource } from './motion.ts';
import { TabGuard } from './tab-guard.ts';
import { takeoverScreen } from './takeover.ts';

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
/** Lobby (I2 seating chart): the game's parts, which one is mine, my Ready state. */
let lobby: Parts | null = null;
/** Taken part the player tapped: asks "Swap with <name>?" before claiming. */
let pendingSwap = -1;
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
/** One controller tab per phone (the deviceId is shared by every tab of this browser). */
const tabGuard = new TabGuard('go-go-harmoniyo/controller');
const client = new HgpClient({
  kind: 'phone',
  deviceId: deviceId(),
  name: localStorage.getItem(NAME_KEY) ?? 'phone',
  hello: { app: 'go-go-harmoniyo/s1-controller', gestures: ['ring', 'impact', 'tap'], sound: true, tab: tabGuard.tab },
});

// ── one tab per phone: "connected in another tab — [Use this tab]" ──────────
let started = false;
const takeover = takeoverScreen(() => void useThisTab());
async function useThisTab(): Promise<void> {
  if (!started) return start(true);
  await tabGuard.acquire(true);
  client.takeover();
}
tabGuard.onLost = () => {
  // The user took over in another tab: stand by (the host also tells us `replaced`).
  client.goStandby('another tab took over');
  takeover.show('replaced');
};
client.onReplaced = () => {
  tabGuard.release();
  takeover.show('replaced');
};
void tabGuard.otherActive().then((other) => {
  if (other && !started) takeover.show('other-tab');
});

// ── UI ──────────────────────────────────────────────────────────────────────
function render(): void {
  showBell();
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
/** Next expected bell: from game cues if present, else during a multi-bell metronome test. */
function expectedBell(): string | null {
  const clk = client.clock;
  if (!clk.ready) return null;
  const hostNow = clk.toHost(performance.now());
  if (cues && cues.at.length) {
    // Glow the bell of the next note not yet ~120 ms in the past.
    while (cueIdx < cues.at.length && cues.at[cueIdx] < hostNow - 120) cueIdx++;
    return cueIdx < cues.at.length ? cues.bells[cueIdx] ?? null : null;
  }
  if (!test?.expect || test.start === undefined || !test.period) return null;
  const i = Math.ceil((hostNow - test.start - test.period * 0.35) / test.period);
  return test.expect[Math.max(0, Math.min(test.expect.length - 1, i))] ?? null;
}
/** Game cues (host time + bell id of each upcoming note for this phone), sent by a game host. */
let cues: { at: number[]; bells: string[] } | null = null;
let cueIdx = 0;

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
    // Sharps/flats get a ring outline as well as the deeper colour (colour is never the only cue).
    el.className = isAccidental(b.midi) ? 'zone acc' : 'zone';
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
  showBell();
}

/** Big bell: the selected bell's colour, name and (for sharps/flats) a ring outline. */
function showBell(): void {
  const b = myBell();
  document.body.style.setProperty('--bell', b.color);
  $('bell').classList.toggle('acc', isAccidental(b.midi));
  $('bell-label').textContent = b.label;
  $('bell-id').textContent = b.id;
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
    case 'cues':
      cues = Array.isArray(m.at) && m.at.length ? { at: m.at as number[], bells: (m.bells as string[]) ?? [] } : null;
      cueIdx = 0;
      renderZones();
      break;
    case 'parts':
      if (Array.isArray(m.parts)) {
        // Normalise once: everything below can trust the shapes (strings, numbers, arrays).
        const parts = (m.parts as Record<string, any>[]).filter((p) => p && typeof p === 'object').map((p, i) => ({
          index: i,
          name: String(p.name ?? `Ringer ${i + 1}`),
          range: String(p.range ?? ''),
          bells: (Array.isArray(p.bells) ? p.bells : []).map((b: Record<string, unknown>) => ({ id: String(b?.id ?? ''), label: String(b?.label ?? ''), midi: Number(b?.midi) || 0, color: String(b?.color ?? '#888') })),
          notes: Number(p.notes) || 0,
          perSec: Number(p.perSec) || 0,
          level: Math.round(Number(p.level)) || 1,
          player: { kind: p.player?.kind === 'phone' || p.player?.kind === 'keyboard' ? p.player.kind : 'tv', id: typeof p.player?.id === 'string' ? p.player.id : undefined, name: String(p.player?.name ?? '') },
          ready: p.ready === true,
        })) as Parts['parts'];
        lobby = { type: 'parts', phase: m.phase === 'play' ? 'play' : 'lobby', song: typeof m.song === 'string' ? m.song : undefined, parts, you: Number.isInteger(m.you) ? (m.you as number) : -1, ready: m.ready === true, next: m.next === true };
        renderLobby();
      }
      break;
  }
  render();
};
client.onState = (s) => {
  lastInfo = s;
  render();
};

// ── lobby: pick your part (I2 seating chart, HGP `parts` / `claim` / `ready`) ──
const escHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const meter = (level: number): string => '●'.repeat(Math.max(0, Math.min(5, level))) + '○'.repeat(Math.max(0, 5 - level));

/** Update one element's markup only if it changed, so taps never land on a node being replaced. */
const shown = new WeakMap<Element, string>();
function setHtml(el: Element, html: string): void {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}

function renderLobby(): void {
  // Drop-in: joined while a song plays → "you're in for the next song" until the round ends.
  const waiting = !!lobby && lobby.phase === 'play' && !!lobby.next && lobby.you < 0;
  $('waiting').hidden = !waiting;
  if (waiting) $('waiting-song').textContent = lobby!.song ? `Now playing: ${lobby!.song}` : '';
  const show = !!lobby && lobby.phase === 'lobby' && lobby.parts.length > 0;
  $('lobby').hidden = !show;
  if (!show || !lobby) return;
  $('lobby-next').hidden = !(lobby.next && lobby.you < 0);
  $('lobby-song').textContent = lobby.song ?? '';
  const box = $('parts');
  while (box.children.length > lobby.parts.length) box.lastElementChild!.remove();
  while (box.children.length < lobby.parts.length) {
    const el = document.createElement('div');
    el.className = 'pcard';
    el.setAttribute('role', 'listitem');
    box.appendChild(el);
  }
  const occupant = (i: number) => lobby!.parts[i]?.player;
  if (pendingSwap >= 0 && (pendingSwap === lobby.you || occupant(pendingSwap)?.kind === 'tv')) pendingSwap = -1;
  lobby.parts.forEach((p, i) => {
    const el = box.children[i] as HTMLElement;
    el.dataset.part = String(i);
    const mine = i === lobby!.you;
    el.classList.toggle('mine', mine);
    el.classList.toggle('taken', !mine && p.player.kind !== 'tv');
    const who = mine ? 'You' : p.player.kind === 'tv' ? '🤖 TV plays' : `${p.player.kind === 'keyboard' ? '⌨' : '📱'} ${escHtml(p.player.name)}`;
    const bells = p.bells.map((b) => `<i class="${isAccidental(b.midi) ? 'acc' : ''}" style="background:${escHtml(b.color)}">${escHtml(b.label)}</i>`).join('');
    const swap = pendingSwap === i ? `<button class="swap" data-swap="${i}">⇄ Swap with ${escHtml(p.player.name)}?</button>` : '';
    setHtml(
      el,
      `<b>${escHtml(p.name)}</b><span class="who">${who}${p.ready ? ' <span class="rdy">✓</span>' : ''}</span>` +
        `<span class="meta"><span class="pb">${bells}</span><span>${escHtml(p.range)}</span><span class="meter" title="difficulty ${p.level}/5">${meter(p.level)}</span><span>${p.notes} notes</span></span>${swap}`,
    );
  });
  const ready = $('ready');
  ready.setAttribute('aria-pressed', String(lobby.ready));
  ready.textContent = lobby.ready ? '✓ Ready' : "I'm ready";
  $('sit-out').hidden = lobby.you < 0;
}

$('parts').addEventListener('click', (e) => {
  if (!lobby) return;
  const t = e.target as HTMLElement;
  const swap = t.closest<HTMLElement>('[data-swap]');
  if (swap) {
    client.send({ type: 'claim', part: Number(swap.dataset.swap) });
    pendingSwap = -1;
    navigator.vibrate?.(15);
    return;
  }
  const card = t.closest<HTMLElement>('.pcard');
  if (!card) return;
  const i = Number(card.dataset.part);
  const p = lobby.parts[i];
  if (!p || i === lobby.you) return;
  if (p.player.kind === 'tv') {
    client.send({ type: 'claim', part: i });
    pendingSwap = -1;
    navigator.vibrate?.(10);
  } else pendingSwap = pendingSwap === i ? -1 : i;
  renderLobby();
});
$('ready').addEventListener('click', () => {
  if (!lobby) return;
  client.send({ type: 'ready', ready: !lobby.ready });
});
$('sit-out').addEventListener('click', () => client.send({ type: 'claim', part: -1 }));

// ── startup (needs a user gesture for iOS motion permission + audio) ────────
async function requestWakeLock(): Promise<void> {
  const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

let starting = false;
async function start(takeoverTab = false): Promise<void> {
  if (started || starting) return; // a double tap must not open a second connection
  starting = true;
  try {
    await startController(takeoverTab);
  } finally {
    starting = false;
  }
}

async function startController(takeoverTab: boolean): Promise<void> {
  const name = ($('name') as HTMLInputElement).value.trim() || 'phone';
  localStorage.setItem(NAME_KEY, name);
  // Both must be *called* synchronously inside the tap handler (iOS user-activation rules).
  const permP = MotionSource.requestPermission().catch((e: unknown) => `error: ${String(e)}`);
  const audioP = unlockAudio().catch((e: unknown) => ({ state: `error: ${String(e)}`, audioSession: '?', baseLatency: NaN, outputLatency: NaN }));
  // Another tab of this phone is playing (e.g. the TV's QR scanned again): let it keep playing.
  if (!(await tabGuard.acquire(takeoverTab))) {
    takeover.show('other-tab');
    return;
  }
  const perm = await permP;
  const audioInfo = await audioP;
  await requestWakeLock();
  const api = await motion.start(q.get('api') === 'generic' ? 'generic' : 'auto', Number(q.get('hz') ?? 60));
  motion.onSample = onSample;
  client.setName(name);
  if (takeoverTab) client.takeover();
  else client.connect();
  started = true;
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
