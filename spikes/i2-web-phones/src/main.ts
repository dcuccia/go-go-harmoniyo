import '../../s4-web-host/src/style.css';
import './style.css';
import { AudioEngine } from '../../s4-web-host/src/audio/engine';
import { isJudgement } from '../../s4-web-host/src/core/judge';
import { round } from '../../s4-web-host/src/core/stats';
import { Session, type Mode, type Offsets, type SessionHud, type SessionResult } from '../../s4-web-host/src/game/session';
import { KeyboardSource } from '../../s4-web-host/src/input/keyboard';
import type { InputSource } from '../../s4-web-host/src/input/types';
import { Hud } from '../../s4-web-host/src/ui/hud';
import type { SoundMode } from '../../s1-phone-bell/src/core/hgp.ts';
import { HgpInputSource } from './hgp-input';
import { defaultHgpUrl, HgpLink, type PhoneInfo } from './hgp-link';
import { MultiHighway } from './multi-highway';
import { buildTeamChart, findPart, isChartFormat, partBellNotes, ringerSummary, type Difficulty, type S5Chart, type TeamChart } from './team-chart';
import { accuracyOf, newStats, TeamHud, type PlayerStats } from './team-hud';
import { isAccidental } from '../../shared/pitch-palette';
import { BackingTrack, DEFAULT_BACKING, type BackingSettings } from './backing/track';
import { backingTimeline } from './backing/timeline';
import { describe as describeBacking } from './backing/patterns';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) !== '0' : d);
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── offsets (same semantics as S4; separate storage key) ───────────────────
const OFFSETS_KEY = 'i2.offsets';
const offsets: Offsets = { visualMs: 0, inputMs: 0, ...JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? '{}') };
if (params.has('vis')) offsets.visualMs = num('vis', 0);
if (params.has('inp')) offsets.inputMs = num('inp', 0);
const saveOffsets = (): void => localStorage.setItem(OFFSETS_KEY, JSON.stringify(offsets));

// ── backing track settings (lobby; saved) ──────────────────────────────────
const BACKING_KEY = 'i2.backing';
const backingSettings: BackingSettings = { ...DEFAULT_BACKING, ...JSON.parse(localStorage.getItem(BACKING_KEY) ?? '{}') };
if (params.has('backing')) backingSettings.enabled = flag('backing', true);
if (params.has('backingVol')) backingSettings.volume = Math.max(0, Math.min(1, num('backingVol', 50) / 100));
if (params.has('countin')) backingSettings.countIn = flag('countin', true);
const saveBacking = (): void => localStorage.setItem(BACKING_KEY, JSON.stringify(backingSettings));
let backing: BackingTrack | null = null;

// ── engine pieces (S4) ──────────────────────────────────────────────────────
const mh = new MultiHighway($('highways'), {
  bloom: flag('bloom', true),
  maxPixelRatio: num('dpr', 1.5),
  msaa: num('msaa', 0),
  particles: flag('particles', true),
});
const audio = new AudioEngine();
const hud = new Hud();
const teamHud = new TeamHud(mh);
const statsEl = $('stats');
statsEl.classList.toggle('hidden', !flag('stats', false));
/** Team HUD: S4 Hud for score/streak/progress; judgement pops are per highway instead. */
const sessionHud: SessionHud = {
  reset: (c, m) => hud.reset({ ...c, lanes: [] }, m),
  judgement: () => {},
  update: (...a) => hud.update(...a),
};

// ── phones (S1 host) ────────────────────────────────────────────────────────
const link = new HgpLink(defaultHgpUrl(params));
link.connect();

// ── lobby state ─────────────────────────────────────────────────────────────
type Slot = string; // deviceId | 'host' | 'keyboard'
interface SongIndex {
  profile: string;
  songs: { id: string; title: string; composer?: string; license?: string; durationSec: number; parts: { difficulty: Difficulty; ringerCount: number; strikes: number; maxBellsPerRinger: number }[] }[];
}
let index: SongIndex | null = null;
const chartCache = new Map<string, S5Chart>();
let songId = params.get('song') ?? 'jingle-bells';
let difficulty = (params.get('diff') ?? 'easy') as Difficulty;
let ringerCount = num('ringers', 0);
let ringersAuto = !params.has('ringers');
let slots: Slot[] = [];
const slotPinned: boolean[] = [];
let soundMode: SoundMode = (params.get('sound') as SoundMode | null) ?? 'device';
let team: TeamChart | null = null;
let session: Session | null = null;
let lastMode: Mode = 'play';
const sentAssign = new Map<string, string>();

const onlinePhones = (): PhoneInfo[] => link.phones.filter((p) => p.online && p.kind !== 'dashboard');
const phoneName = (id: string): string => link.phones.find((p) => p.id === id)?.name ?? id;
const slotName = (s: Slot, i: number): string => (s === 'host' ? `Ringer ${i + 1} (host)` : s === 'keyboard' ? 'Keyboard' : phoneName(s));
const slotKind = (s: Slot): string => (s === 'host' ? 'host plays' : s === 'keyboard' ? 'keyboard A S D F' : 'phone');

async function loadChart(id: string): Promise<S5Chart> {
  let c = chartCache.get(id);
  if (!c) {
    const res = await fetch(`charts/${id}.json`);
    if (!res.ok) throw new Error(`charts/${id}.json: ${res.status} — run "npm run charts"`);
    c = (await res.json()) as S5Chart;
    if (!isChartFormat(c.format)) throw new Error(`charts/${id}.json: unknown chart format "${c.format}"`);
    chartCache.set(id, c);
  }
  return c;
}

/** Fill unpinned slots with online phones in join order; the rest are played by the host. */
function autoSlots(): void {
  const phones = onlinePhones().map((p) => p.id);
  if (ringersAuto) ringerCount = Math.max(1, Math.min(4, phones.length || ringerCount || 3));
  slots.length = ringerCount;
  const used = new Set(slots.filter((s, i) => slotPinned[i] && s));
  const free = phones.filter((p) => !used.has(p));
  for (let i = 0; i < ringerCount; i++) {
    if (slotPinned[i] && slots[i]) continue;
    slots[i] = free.shift() ?? 'host';
  }
}

async function rebuild(forPlayMode: Mode = 'play'): Promise<void> {
  if (!index) return;
  autoSlots();
  const s5 = await loadChart(songId);
  const part = findPart(s5, difficulty, ringerCount);
  if (!part) {
    $('lobby-msg').textContent = `No ${difficulty} part for ${ringerCount} ringers in ${s5.song.title}.`;
    return;
  }
  $('lobby-msg').textContent = '';
  const active = slots.map((s) => forPlayMode === 'autoplay' || s !== 'host');
  if (!active.some(Boolean)) active.fill(true); // lobby preview with no players: show every highway
  team = buildTeamChart(s5, part, { active, transpose: num('octave', 1) ? 12 : 0 });
  mh.setTeam(team);
  const ringerSlots = team.ringers.map((r) => slots[r.index]);
  teamHud.setup(
    team,
    ringerSlots.map((s, i) => slotName(s, team!.ringers[i].index)),
    ringerSlots.map(slotKind),
  );
  sendAssignments();
  renderLobby();
}

/** Each phone in a slot gets its ringer's bells (sounding pitch, pitch-class colour) via the S1 host. */
function sendAssignments(): void {
  if (!team) return;
  for (const r of team.ringers) {
    const dev = slots[r.index];
    if (!dev || dev === 'host' || dev === 'keyboard') continue;
    const bells = r.bells.map((b) => ({ id: b.id, label: b.letter, midi: b.pitch, color: b.color }));
    const ringer = { slot: r.index, title: `Ringer ${r.index + 1}`, song: `${chartCache.get(songId)?.song.title ?? songId} (${difficulty})` };
    const key = JSON.stringify([bells, ringer]);
    if (sentAssign.get(dev) === key) continue;
    sentAssign.set(dev, key);
    link.assign(dev, bells, ringer);
  }
}

function laneMap(): Map<string, number> {
  const m = new Map<string, number>();
  if (!team) return m;
  for (const r of team.ringers) for (const b of r.bells) m.set(`${slots[r.index]}|${b.id}`, b.lane);
  return m;
}

// ── lobby UI ────────────────────────────────────────────────────────────────
function renderLobby(): void {
  const selSong = $<HTMLSelectElement>('sel-song');
  if (index && selSong.options.length !== index.songs.length) {
    selSong.innerHTML = index.songs.map((s) => `<option value="${s.id}">${s.title} (${Math.round(s.durationSec)} s, ${s.license ?? '?'})</option>`).join('');
  }
  selSong.value = songId;
  $<HTMLSelectElement>('sel-diff').value = difficulty;
  $<HTMLSelectElement>('sel-ringers').value = String(ringerCount);
  $<HTMLSelectElement>('sel-sound').value = soundMode;
  $<HTMLInputElement>('chk-backing').checked = backingSettings.enabled;
  $<HTMLInputElement>('rng-backing').value = String(Math.round(backingSettings.volume * 100));
  $<HTMLInputElement>('rng-backing').disabled = !backingSettings.enabled;
  $('backing-vol').textContent = `${Math.round(backingSettings.volume * 100)}%`;
  $<HTMLInputElement>('chk-countin').checked = backingSettings.countIn;

  const phones = link.phones;
  const opts = (sel: Slot): string =>
    [`<option value="host"${sel === 'host' ? ' selected' : ''}>Host plays this part</option>`]
      .concat(phones.map((p) => `<option value="${p.id}"${sel === p.id ? ' selected' : ''}>📱 ${esc(p.name)}${p.online ? '' : ' (offline)'}</option>`))
      .concat([`<option value="keyboard"${sel === 'keyboard' ? ' selected' : ''}>⌨ Keyboard (A S D F)</option>`])
      .join('');
  const s5 = chartCache.get(songId);
  const part = s5 ? findPart(s5, difficulty, ringerCount) : undefined;
  const preview = s5 && part ? buildTeamChart(s5, part) : null;
  $('slots').innerHTML = slots
    .map((s, i) => {
      const r = preview?.ringers[i];
      const colors = r ? r.bells.map((b) => `<i class="${b.accidental ? 'acc' : ''}" style="background:${b.color}" title="${b.name}">${b.name}</i>`).join('') : '';
      const auto = r?.autoBells.length ? `<small> +${r.autoBells.join(' ')} rung by host</small>` : '';
      return `<div class="slot"><b>Ringer ${i + 1}</b><span class="bells">${colors}${auto}</span><select data-slot="${i}">${opts(s)}</select></div>`;
    })
    .join('');
  $('slots')
    .querySelectorAll('select')
    .forEach((el) =>
      el.addEventListener('change', () => {
        const i = Number(el.dataset.slot);
        const v = el.value;
        const j = slots.indexOf(v);
        if (v !== 'host' && j >= 0 && j !== i) {
          slots[j] = slots[i];
          slotPinned[j] = true;
        }
        slots[i] = v;
        slotPinned[i] = true;
        void rebuild();
      }),
    );
  if (part) {
    const m = part.notes.length;
    $('part-info').textContent = `${m} notes · ${preview?.ringers.reduce((a, r) => a + r.bells.length, 0)} bells on phones${preview?.ringers.some((r) => r.autoBells.length) ? ' · some bells exceed 4 per phone and are rung by the host' : ''} · chart profile ${index?.profile}`;
  }
  $('backing-info').textContent = s5 ? `Backing: ${describeBacking(backingTimeline(s5))}` : '';

  $('phone-count').textContent = `(${onlinePhones().length} online)`;
  $('phones').innerHTML = phones
    .map((p) => {
      const st = p.status ?? {};
      const slot = slots.indexOf(p.id);
      const sync = typeof st.rttP50 === 'number' ? `rtt ${st.rttP50.toFixed(0)} ms` : 'syncing…';
      const sensors = st.api ? `${st.api}${st.rateHz ? ` ${Math.round(st.rateHz)} Hz` : ''}` : 'no motion yet';
      const bells = p.bells?.map((b) => `<i class="${isAccidental(b.midi) ? 'acc' : ''}" style="background:${b.color}">${esc(b.label)}</i>`).join('') ?? '';
      return `<li id="ph-${cssId(p.id)}" class="${p.online ? '' : 'off'}"><b>${esc(p.name)}</b> <span class="bells">${bells}</span><br><small>${p.online ? 'online' : 'offline'} · ${sync} · ${sensors}${st.axis ? '' : ' · uncalibrated'}${slot >= 0 ? ` · ringer ${slot + 1}` : ' · not playing'}</small></li>`;
    })
    .join('') || '<li class="dim">No phones yet — scan the QR code.</li>';

  const hostOk = link.state === 'open';
  $('host-state').textContent = hostOk ? `S1 host ${link.info.lanIp ?? ''} · ${link.info.tlsMode ?? ''} · clock sync ${link.sync.ready ? `±${(link.sync.estimate!.errBound).toFixed(2)} ms` : '…'}` : `Not connected to the phone host (${link.url}). Start it with "npm start" in spikes/i2-web-phones.`;
  $('host-state').classList.toggle('error', !hostOk);
  $('join-url').textContent = link.info.joinUrl ?? 'waiting for host…';
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cssId = (s: string): string => s.replace(/[^\w-]/g, '_');

$<HTMLSelectElement>('sel-song').onchange = (e) => {
  songId = (e.target as HTMLSelectElement).value;
  void rebuild();
};
$<HTMLSelectElement>('sel-diff').onchange = (e) => {
  difficulty = (e.target as HTMLSelectElement).value as Difficulty;
  void rebuild();
};
$<HTMLSelectElement>('sel-ringers').onchange = (e) => {
  ringerCount = Number((e.target as HTMLSelectElement).value);
  ringersAuto = false;
  void rebuild();
};
$<HTMLSelectElement>('sel-sound').onchange = (e) => {
  soundMode = (e.target as HTMLSelectElement).value as SoundMode;
  link.setSound(soundMode);
};
$<HTMLInputElement>('chk-backing').onchange = (e) => {
  backingSettings.enabled = (e.target as HTMLInputElement).checked;
  saveBacking();
  renderLobby();
};
$<HTMLInputElement>('rng-backing').oninput = (e) => {
  backingSettings.volume = Number((e.target as HTMLInputElement).value) / 100;
  saveBacking();
  $('backing-vol').textContent = `${Math.round(backingSettings.volume * 100)}%`;
};
$<HTMLInputElement>('chk-countin').onchange = (e) => {
  backingSettings.countIn = (e.target as HTMLInputElement).checked;
  saveBacking();
};

let lastPhoneKey = '';
link.onDevices = () => {
  // Rebuild only when the set of online phones changes (devices are broadcast every second).
  const key = onlinePhones()
    .map((p) => `${p.id}:${p.name}`)
    .join();
  if (key !== lastPhoneKey && !session) {
    lastPhoneKey = key;
    void rebuild();
  } else if (!session) renderLobby();
  maybeAutostart();
};
link.onInfo = () => {
  $<HTMLImageElement>('qr').src = `${link.httpOrigin}/qr.svg?u=${encodeURIComponent(link.info.joinUrl ?? '')}`;
  renderLobby();
};
link.onState = (s) => {
  if (s === 'open') link.setSound(soundMode);
  renderLobby();
};

// Lobby practice: ringing a phone lights its lane and its row.
link.ringListeners.add((e) => {
  if (session) return;
  const lane = laneMap().get(`${e.deviceId}|${e.bell}`);
  if (lane !== undefined) mh.press(lane);
  const li = document.getElementById(`ph-${cssId(e.deviceId)}`);
  if (li) {
    li.classList.remove('rang');
    void li.offsetWidth;
    li.classList.add('rang');
  }
});

// ── play ────────────────────────────────────────────────────────────────────
let players: PlayerStats[] = [];
let hgpInput: HgpInputSource | null = null;

async function start(mode: Mode): Promise<void> {
  await audio.resume();
  session?.stop();
  session = null;
  backing?.stop();
  backing = null;
  await rebuild(mode);
  if (!team) return;
  if (mode === 'play' && !team.ringers.some((r) => slots[r.index] !== 'host')) {
    $('lobby-msg').textContent = 'No players: join with a phone (or set a ringer to Keyboard), or use Autoplay demo.';
    return;
  }
  lastMode = mode;
  (document.activeElement as HTMLElement | null)?.blur();
  const t = team;
  const lanes = laneMap();
  hgpInput = new HgpInputSource(link, (dev, bell) => lanes.get(`${dev}|${bell}`));
  const sources: InputSource[] = [hgpInput];
  const kbRinger = t.ringers.find((r) => slots[r.index] === 'keyboard');
  if (kbRinger) sources.push(keyboardRinger(kbRinger.laneStart, kbRinger.bells.length, (lane) => audio.bell(t.chart.lanes[lane].pitch, 0, 0.9, 0)));

  const hostRingSound = soundMode !== 'device';
  const s5 = chartCache.get(songId)!;
  const part = findPart(s5, difficulty, ringerCount)!;
  // Groove + pad from the chart's chords; bass/inner bells of this part are left out of it.
  backing = new BackingTrack(audio, s5, partBellNotes(s5, part), { ...backingSettings });
  const s = new Session(mode, t.chart, audio, mh, sessionHud, sources, offsets, { hostRingSound, extraEvents: backing.scheduled(), leadIn: backing.leadIn });
  players = t.ringers.map((r) => newStats(slotName(slots[r.index], r.index), r.noteIds.length));
  teamHud.clearStats();
  s.onJudgement = (r, e) => {
    const ri = t.laneRinger[r.lane];
    const p = players[ri];
    if (!p) return;
    if (isJudgement(r)) {
      p.counts[r.grade]++;
      if (r.grade === 'miss') p.streak = 0;
      else {
        p.streak++;
        p.maxStreak = Math.max(p.maxStreak, p.streak);
        p.offsetsMs.push(r.offset * 1000);
      }
      teamHud.judgement(ri, r.grade, r.offset * 1000);
    } else p.strays++;
    teamHud.stats(ri, p);
    void e;
  };
  s.onFinish = (r) => finish(r);
  const hostParts = t.autoRingers.map((i) => `ringer ${i + 1}`).concat(t.ringers.filter((r) => r.autoBells.length).map((r) => r.autoBells.join(' ')));
  $('host-note').textContent = hostParts.length ? `Host rings: ${hostParts.join(' · ')}` : '';
  session = s;
  s.start();
  sendCues(s);
  teamHud.position();
  $('lobby').classList.add('hidden');
  $('results').classList.add('hidden');
}

/** Keyboard as one ringer: A S D F → that ringer's lanes; plays the bell on the host (no phone). */
function keyboardRinger(laneStart: number, n: number, ring: (lane: number) => void): InputSource {
  const kb = new KeyboardSource(n);
  return {
    id: 'keyboard',
    start: (sink) =>
      kb.start((e) => {
        const lane = (e.lane ?? 0) + laneStart;
        ring(lane);
        sink({ ...e, lane });
      }),
    stop: () => kb.stop(),
  };
}

/** Tell each phone when its notes are due (S1 host time) so it can glow the next zone. */
function sendCues(s: Session): void {
  if (!team || !link.sync.ready) return;
  for (const r of team.ringers) {
    const dev = slots[r.index];
    if (!dev || dev === 'host' || dev === 'keyboard') continue;
    const notes = r.noteIds.map((id) => team!.chart.notes[id]);
    const bellOfLane = new Map(r.bells.map((b) => [b.lane, b.id] as const));
    link.cues(
      dev,
      notes.map((n) => round(link.perfToHost(s.perfAtSong(n.time)), 1)),
      notes.map((n) => bellOfLane.get(n.lane) ?? ''),
    );
  }
}

function clearCues(): void {
  for (const s of slots) if (s && s !== 'host' && s !== 'keyboard') link.cues(s, [], []);
}

function summarize(xs: number[]): { n: number; mean: number; p50: number; p95abs: number } {
  const n = xs.length;
  if (!n) return { n: 0, mean: NaN, p50: NaN, p95abs: NaN };
  const sorted = [...xs].sort((a, b) => a - b);
  const abs = xs.map(Math.abs).sort((a, b) => a - b);
  return { n, mean: round(xs.reduce((a, b) => a + b, 0) / n, 1), p50: round(sorted[Math.floor(n / 2)], 1), p95abs: round(abs[Math.min(n - 1, Math.floor(n * 0.95))], 1) };
}

function finish(r: SessionResult): void {
  clearCues();
  const playerRows = players.map((p, i) => ({
    ringer: team?.ringers[i].index,
    name: p.name,
    slot: team ? slotKind(slots[team.ringers[i].index]) : '',
    notes: p.notes,
    ...p.counts,
    strays: p.strays,
    maxStreak: p.maxStreak,
    accuracy: round(accuracyOf(p), 3),
    offsetMs: summarize(p.offsetsMs),
  }));
  const input = hgpInput ? { ...hgpInput.stats, latencyMs: summarize(hgpInput.stats.latencyMs) } : null;
  const result = {
    ...r,
    song: songId,
    difficulty,
    ringers: ringerCount,
    soundMode,
    backing: backing
      ? { ...backing.settings, style: backing.style?.id ?? null, chords: backing.timeline?.source ?? null, events: backing.events.length, countInClicks: backing.clicks.length, leadInSec: round(backing.leadIn, 3) }
      : null,
    players: playerRows,
    autoRingers: team?.autoRingers,
    hgp: { input, hostClock: link.sync.estimate, joinUrl: link.info.joinUrl },
    userAgent: navigator.userAgent,
  };
  (window as unknown as { __i2Result: unknown }).__i2Result = result;
  document.title = 'I2_DONE';
  const c = r.counts;
  $('res-title').textContent = r.title;
  $('res-body').innerHTML =
    r.mode === 'autoplay'
      ? 'Autoplay demo finished.'
      : `Team score <span class="big">${r.score.toLocaleString()}</span><br>Accuracy ${(r.accuracy * 100).toFixed(1)}% · best team streak ${r.maxStreak}<br>Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss} · stray rings ${r.strays}`;
  $('res-players').innerHTML = r.mode === 'autoplay' ? '' : `<tr><th>Ringer</th><th>Notes</th><th>Hit</th><th>Perfect</th><th>Miss</th><th>Stray</th><th>Best streak</th><th>Accuracy</th><th>Timing (mean / p95)</th></tr>` +
    playerRows
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}</td><td>${p.notes}</td><td>${p.perfect + p.great + p.good}</td><td>${p.perfect}</td><td>${p.miss}</td><td>${p.strays}</td><td>${p.maxStreak}</td><td>${(p.accuracy * 100).toFixed(0)}%</td><td>${Number.isFinite(p.offsetMs.mean) ? `${p.offsetMs.mean > 0 ? '+' : ''}${p.offsetMs.mean} ms / ±${p.offsetMs.p95abs} ms` : '–'}</td></tr>`,
      )
      .join('');
  $('res-json').textContent = JSON.stringify(result, null, 2);
  $('results').classList.remove('hidden');
}

function toLobby(): void {
  session?.stop();
  session = null;
  backing?.stop();
  backing = null;
  clearCues();
  hud.show(false);
  $('results').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  lastPhoneKey = '';
  void rebuild();
}

$('btn-play').onclick = () => void start('play');
$('btn-auto').onclick = () => void start('autoplay');
$('btn-again').onclick = () => void start(lastMode);
$('btn-lobby').onclick = toLobby;
$('btn-copy').onclick = () => void navigator.clipboard.writeText($('res-json').textContent ?? '');

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && ['SELECT', 'INPUT'].includes((e.target as HTMLElement).tagName)) return;
  if (e.code === 'Escape') toLobby();
  else if (e.code === 'Backquote') statsEl.classList.toggle('hidden');
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    offsets.visualMs += (e.code === 'ArrowRight' ? 5 : -5) * (e.shiftKey ? 4 : 1);
    saveOffsets();
  } else if (e.code === 'Enter' && !session) void start('play');
});
window.addEventListener('resize', () => {
  mh.resize();
  teamHud.position();
});

// ── autostart (E2E / kiosk): ?start=play&waitPhones=3 ────────────────────────
let autostarted = false;
function maybeAutostart(): void {
  const mode = params.get('start') as Mode | null;
  if (!mode || autostarted || session || !index) return;
  const need = num('waitPhones', 0);
  const ready = onlinePhones().filter((p) => typeof p.status?.syncN === 'number' && p.status.syncN > 0);
  if (mode === 'play' && (ready.length < need || !link.sync.ready)) return;
  autostarted = true;
  void rebuild().then(() => window.setTimeout(() => void start(mode), num('startDelay', 1500)));
}

// ── render loop ─────────────────────────────────────────────────────────────
let lastIdle = performance.now();
let lastStats = 0;
let lastLobby = 0;
function loop(ts: number): void {
  requestAnimationFrame(loop);
  if (session) session.frame(ts);
  else {
    const dt = Math.min(0.1, (ts - lastIdle) / 1000);
    lastIdle = ts;
    mh.frame(ts / 1000 + 1e4, dt, ts / 1000);
    if (ts - lastLobby > 1000) {
      lastLobby = ts;
      if (!$('lobby').classList.contains('hidden')) {
        const sel = ['SELECT', 'INPUT'].includes(document.activeElement?.tagName ?? '');
        if (!sel) renderLobby();
      }
    }
  }
  if (session && !statsEl.classList.contains('hidden') && ts - lastStats > 500) {
    lastStats = ts;
    const m = session.metrics() as Record<string, any>;
    const inp = hgpInput?.stats;
    statsEl.textContent = [
      `${m.render.width}×${m.render.height} (${mh.count} highways)  ${m.fps} fps  frame p95 ${m.frameMs.p95} ms`,
      `audio out ${m.audio.outputLatencyMs} ms  base ${m.audio.baseLatencyMs} ms  outTS ${m.audio.getOutputTimestamp}`,
      `host clock ±${link.sync.estimate?.errBound.toFixed(2)} ms  rtt ${link.sync.estimate?.rttP50.toFixed(2)} ms`,
      `phone rings ${inp?.rings} (unsynced ${inp?.unsynced}, unmapped ${inp?.unmapped})`,
      `ring→page p50 ${summarize(inp?.latencyMs ?? []).p50} ms   hit offset mean ${m.input.hitOffsetMs.mean} p95 ${m.input.hitOffsetMs.p95} ms`,
    ].join('\n');
  }
}
requestAnimationFrame(loop);

// ── boot ────────────────────────────────────────────────────────────────────
fetch('charts/index.json')
  .then((r) => {
    if (!r.ok) throw new Error(`charts/index.json: ${r.status} — run "npm run charts"`);
    return r.json() as Promise<SongIndex>;
  })
  .then(async (ix) => {
    index = ix;
    if (!ix.songs.some((s) => s.id === songId)) songId = ix.songs[0].id;
    if (!ringerCount) ringerCount = 3;
    await rebuild();
    maybeAutostart();
  })
  .catch((e) => ($('lobby-msg').textContent = String(e)));

(window as unknown as Record<string, unknown>).__i2 = {
  link,
  get team() {
    return team;
  },
  get slots() {
    return slots;
  },
  get session() {
    return session;
  },
};
