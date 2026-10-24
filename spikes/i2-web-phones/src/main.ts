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
import { defaultHgpUrl, HgpLink, type LobbyParts, type PhoneInfo } from './hgp-link';
import { MultiHighway } from './multi-highway';
import { buildTeamChart, findPart, isChartFormat, partBellNotes, type Difficulty, type S5Chart, type TeamChart } from './team-chart';
import { partCards, type PartCard } from './parts';
import { KEYBOARD, Seating, seededRng, TV } from './seating';
import { SeatingView, type PlayerView } from './seating-view';
import type { PartCard as PartCardMsg } from '../../s1-phone-bell/src/core/hgp.ts';
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
/** Seating chart: part index → phone deviceId | KEYBOARD | TV (persists across songs). */
const seating = new Seating();
/** Part cards of the current arrangement (names, ranges, difficulty). */
let cards: PartCard[] = [];
/** Phones the lobby has seen online (to notice joins and leaves). */
const knownPhones = new Set<string>();
/** Accuracy per player over this page session's play rounds (for ⚖️ Balance). */
const accHistory = new Map<string, number[]>();
const rng: () => number = params.has('seed') ? seededRng(num('seed', 1)) : Math.random;
let soundMode: SoundMode = (params.get('sound') as SoundMode | null) ?? 'device';
let team: TeamChart | null = null;
let session: Session | null = null;
/** A song is running (the session object stays around on the results screen). */
let playing = false;
let lastMode: Mode = 'play';
const sentAssign = new Map<string, string>();
let sentParts = '';
/** Seats when the current/last round started (results rows → players). */
let roundSeats: string[] = [];

const onlinePhones = (): PhoneInfo[] => link.phones.filter((p) => p.online && p.kind !== 'dashboard');
const phoneName = (id: string): string => link.phones.find((p) => p.id === id)?.name ?? id;
const isPhone = (s: string): boolean => s !== TV && s !== KEYBOARD;
const slotName = (s: string, i: number): string => (s === TV ? `${cards[i]?.name ?? `Ringer ${i + 1}`} (TV)` : s === KEYBOARD ? 'Keyboard' : phoneName(s));
const slotKind = (s: string): string => (s === TV ? 'host plays' : s === KEYBOARD ? 'keyboard A S D F' : 'phone');

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

/**
 * Notice phones that joined or left since the last lobby update: a leaver's part falls back to the
 * TV (their home is kept, so a reconnect reclaims it). With the automatic ringer count, the count
 * follows the phones the host has seen this session (1–4), so a dropped phone's part stays.
 */
function syncPhones(): string[] {
  const online = new Set(onlinePhones().map((p) => p.id));
  for (const id of [...knownPhones]) {
    if (!online.has(id)) {
      knownPhones.delete(id);
      seating.leave(id);
    }
  }
  const joiners = [...online].filter((id) => !knownPhones.has(id));
  joiners.forEach((id) => knownPhones.add(id));
  if (ringersAuto) ringerCount = Math.max(1, Math.min(4, link.phones.length || ringerCount || 3));
  return joiners;
}

async function rebuild(forPlayMode: Mode = 'play'): Promise<void> {
  if (!index) return;
  const joiners = syncPhones();
  const s5 = await loadChart(songId);
  const part = findPart(s5, difficulty, ringerCount);
  if (!part) {
    joiners.forEach((id) => knownPhones.delete(id)); // seat them once there is an arrangement
    $('lobby-msg').textContent = `No ${difficulty} part for ${ringerCount} ringers in ${s5.song.title}.`;
    return;
  }
  $('lobby-msg').textContent = '';
  const transpose = num('octave', 1) ? 12 : 0;
  cards = partCards(s5, part, buildTeamChart(s5, part, { transpose }));
  seating.setParts(cards.map((c) => c.name));
  // Seat newcomers, reconnecting phones and anyone waiting for a part (not those who sat out).
  seating.fill(onlinePhones().map((p) => p.id));
  const seats = seating.seats;
  const active = seats.map((s) => forPlayMode === 'autoplay' || s !== TV);
  if (!active.some(Boolean)) active.fill(true); // lobby preview with no players: show every highway
  team = buildTeamChart(s5, part, { active, transpose });
  mh.setTeam(team);
  teamHud.setup(
    team,
    team.ringers.map((r) => slotName(seats[r.index], r.index)),
    team.ringers.map((r) => slotKind(seats[r.index])),
  );
  sendAssignments();
  sendParts();
  renderLobby();
}

/** After any seat change: rebuild in the lobby; on the results screen it applies when the next round starts. */
function seatingChanged(): void {
  if (playing) return;
  if (session) {
    sendParts();
    renderNext();
    return;
  }
  void rebuild();
}

/**
 * Each phone in a part gets its ringer's bells (sounding pitch, pitch-class colour) via the S1 host;
 * a phone on the bench keeps its bells but is told it is not playing.
 */
function sendAssignments(): void {
  if (!team) return;
  const songLabel = `${chartCache.get(songId)?.song.title ?? songId} (${difficulty})`;
  for (const r of team.ringers) {
    const dev = seating.seats[r.index];
    if (!dev || !isPhone(dev)) continue;
    const bells = r.bells.map((b) => ({ id: b.id, label: b.letter, midi: b.pitch, color: b.color }));
    const ringer = { slot: r.index, title: `${cards[r.index]?.name ?? `Ringer ${r.index + 1}`} · Ringer ${r.index + 1}`, song: songLabel };
    const key = JSON.stringify([bells, ringer]);
    if (sentAssign.get(dev) === key) continue;
    sentAssign.set(dev, key);
    link.assign(dev, bells, ringer);
  }
  for (const p of onlinePhones()) {
    if (seating.partOf(p.id) >= 0 || !p.bells?.length) continue;
    const ringer = { slot: -1, title: 'Not playing: pick a part', song: songLabel };
    const key = JSON.stringify([p.bells, ringer]);
    if (sentAssign.get(p.id) === key) continue;
    sentAssign.set(p.id, key);
    link.assign(p.id, p.bells, ringer);
  }
}

/** Lobby state for every phone's "Pick your part" list (HGP `parts`), sent when it changes. */
function sendParts(): void {
  if (!cards.length) return;
  const parts: PartCardMsg[] = cards.map((c, i) => {
    const s = seating.seats[i] ?? TV;
    const player: PartCardMsg['player'] = s === TV ? { kind: 'tv', name: 'TV' } : s === KEYBOARD ? { kind: 'keyboard', name: 'Keyboard' } : { kind: 'phone', id: s, name: phoneName(s) };
    return {
      index: i,
      name: c.name,
      range: c.range,
      bells: c.bells.map((b) => ({ id: b.id, label: b.letter, midi: b.midi, color: b.color })),
      notes: c.notes,
      perSec: c.perSec,
      level: c.level,
      player,
      ready: isPhone(s) && !!link.phones.find((p) => p.id === s)?.ready,
    };
  });
  const lobby: LobbyParts = { phase: playing ? 'play' : 'lobby', song: `${chartCache.get(songId)?.song.title ?? songId} (${difficulty})`, parts };
  const key = JSON.stringify(lobby);
  if (key === sentParts) return;
  sentParts = key;
  link.parts(lobby);
}

function laneMap(): Map<string, number> {
  const m = new Map<string, number>();
  if (!team) return m;
  const seats = playing ? roundSeats : seating.seats;
  for (const r of team.ringers) for (const b of r.bells) m.set(`${seats[r.index]}|${b.id}`, b.lane);
  return m;
}

const accuracyMap = (): Map<string, number> => new Map([...accHistory].map(([id, xs]) => [id, xs.reduce((a, b) => a + b, 0) / xs.length] as const));
const benchPhones = (): string[] => onlinePhones().map((p) => p.id).filter((id) => seating.partOf(id) < 0);

// ── lobby UI ────────────────────────────────────────────────────────────────
/** Set a control's value unless the user is on it (an open dropdown must never be reset). */
function setValue(el: HTMLSelectElement | HTMLInputElement, v: string): void {
  if (document.activeElement !== el && el.value !== v) el.value = v;
}
function setChecked(el: HTMLInputElement, v: boolean): void {
  if (document.activeElement !== el && el.checked !== v) el.checked = v;
}

const view = new SeatingView($('seating'), {
  assign: (part, player) => {
    seating.assign(part, player);
    seatingChanged();
  },
  swap: (a, b) => {
    seating.swap(a, b);
    seatingChanged();
  },
  unseat: (part) => {
    const p = seating.seats[part];
    if (p && p !== TV) seating.assign(-1, p);
    seatingChanged();
  },
});

function playerViews(): PlayerView[] {
  const seats = seating.seats;
  const phones: PlayerView[] = link.phones
    .filter((p) => p.online || seats.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, kind: 'phone', online: p.online, ready: !!p.ready, part: seats.indexOf(p.id) }));
  return [
    ...phones,
    { id: KEYBOARD, name: 'Keyboard', kind: 'keyboard', online: true, ready: false, part: seats.indexOf(KEYBOARD) },
    { id: TV, name: 'TV plays', kind: 'tv', online: true, ready: false, part: -1 },
  ];
}

/** Whole lobby, patched in place (safe to call on every device broadcast). */
function renderLobby(): void {
  const selSong = $<HTMLSelectElement>('sel-song');
  if (index && selSong.options.length !== index.songs.length && document.activeElement !== selSong) {
    selSong.innerHTML = index.songs.map((s) => `<option value="${s.id}">${s.title} (${Math.round(s.durationSec)} s, ${s.license ?? '?'})</option>`).join('');
  }
  setValue(selSong, songId);
  setValue($<HTMLSelectElement>('sel-diff'), difficulty);
  setValue($<HTMLSelectElement>('sel-ringers'), String(ringerCount));
  setValue($<HTMLSelectElement>('sel-sound'), soundMode);
  setChecked($<HTMLInputElement>('chk-backing'), backingSettings.enabled);
  setValue($<HTMLInputElement>('rng-backing'), String(Math.round(backingSettings.volume * 100)));
  $<HTMLInputElement>('rng-backing').disabled = !backingSettings.enabled;
  $('backing-vol').textContent = `${Math.round(backingSettings.volume * 100)}%`;
  setChecked($<HTMLInputElement>('chk-countin'), backingSettings.countIn);

  view.update(cards, seating.seats, playerViews());
  const s5 = chartCache.get(songId);
  const part = s5 ? findPart(s5, difficulty, ringerCount) : undefined;
  if (part) {
    const onPhones = cards.reduce((a, c) => a + c.bells.length, 0);
    $('part-info').textContent = `${part.notes.length} notes · ${onPhones} bells on phones${cards.some((c) => c.autoBells.length) ? ' · some bells exceed 4 per phone and are rung by the TV' : ''} · chart profile ${index?.profile}`;
  }
  $('backing-info').textContent = s5 ? `Backing: ${describeBacking(backingTimeline(s5))}` : '';
  const seated = seating.players.filter(isPhone);
  const ready = seated.filter((id) => link.phones.find((p) => p.id === id)?.ready).length;
  $('ready-info').textContent = seated.length ? `✓ Ready ${ready}/${seated.length}${ready < seated.length ? ' (you can start anyway)' : ''}` : '';
  renderStatus();
}

/** Phones list + host status: diagnostics only, patched in place per phone. */
function renderStatus(): void {
  const phones = link.phones;
  $('phone-count').textContent = `(${onlinePhones().length} online)`;
  const ul = $('phones');
  if (!phones.length) {
    setHtml(ul, '<li class="dim">No phones yet — scan the QR code.</li>');
  } else {
    ul.querySelector('li.dim')?.remove();
    shown.delete(ul);
    const want = phones.map((p) => `ph-${cssId(p.id)}`);
    for (const li of [...ul.children]) if (!want.includes(li.id)) li.remove();
    phones.forEach((p, k) => {
      let li = document.getElementById(want[k]);
      if (!li) {
        li = document.createElement('li');
        li.id = want[k];
      }
      if (ul.children[k] !== li) ul.insertBefore(li, ul.children[k] ?? null);
      const st = p.status ?? {};
      const part = seating.partOf(p.id);
      const sync = typeof st.rttP50 === 'number' ? `rtt ${st.rttP50.toFixed(0)} ms` : 'syncing…';
      const sensors = st.api ? `${st.api}${st.rateHz ? ` ${Math.round(st.rateHz)} Hz` : ''}` : 'no motion yet';
      const bells = p.bells?.map((b) => `<i class="${isAccidental(b.midi) ? 'acc' : ''}" style="background:${b.color}">${esc(b.label)}</i>`).join('') ?? '';
      li.classList.toggle('off', !p.online);
      setHtml(
        li,
        `<b>${esc(p.name)}</b>${p.ready ? ' <em class="rdy">✓ ready</em>' : ''} <span class="bells">${bells}</span><br><small>${p.online ? 'online' : 'offline'} · ${sync} · ${sensors}${st.axis ? '' : ' · uncalibrated'}${part >= 0 ? ` · ${esc(cards[part]?.name ?? `ringer ${part + 1}`)}` : ' · not playing'}</small>`,
      );
    });
  }
  const hostOk = link.state === 'open';
  $('host-state').textContent = hostOk ? `S1 host ${link.info.lanIp ?? ''} · ${link.info.tlsMode ?? ''} · clock sync ${link.sync.ready ? `±${(link.sync.estimate!.errBound).toFixed(2)} ms` : '…'}` : `Not connected to the phone host (${link.url}). Start it with "npm start" in spikes/i2-web-phones.`;
  $('host-state').classList.toggle('error', !hostOk);
  $('join-url').textContent = link.info.joinUrl ?? 'waiting for host…';
}

/** Results screen: who plays what next round (claims, swaps and 🔁 apply on Again). */
function renderNext(): void {
  const who = (s: string): string => (s === TV ? '🤖 TV' : s === KEYBOARD ? '⌨ Keyboard' : phoneName(s));
  $('res-next').textContent = cards.length ? `Next round: ${cards.map((c, i) => `${c.name} — ${who(seating.seats[i] ?? TV)}`).join(' · ')}` : '';
}

const shown = new WeakMap<Element, string>();
/** Replace an element's markup only when it changed. */
function setHtml(el: Element, html: string): void {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
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
  // Rebuild (arrangement, seats, highways) only when phones join, leave or are renamed. Everything
  // else in a device broadcast (Ready, sync, sensors, heartbeat) patches the lobby in place.
  if (!session) {
    const key = link.phones.map((p) => `${p.id}:${p.name}:${p.online}`).join();
    if (key !== lastPhoneKey) {
      lastPhoneKey = key;
      void rebuild();
    } else {
      sendParts();
      renderLobby();
    }
  } else if (!playing) sendParts(); // results screen: Ready flags to the phones
  maybeAutostart();
};
// A phone picked a part ("Pick your part"); a taken part is swapped (v0: no consent prompt).
link.onClaim = (deviceId, part) => {
  if (playing || !onlinePhones().some((p) => p.id === deviceId)) return;
  seating.assign(part, deviceId);
  seatingChanged();
};
link.onInfo = () => {
  $<HTMLImageElement>('qr').src = `${link.httpOrigin}/qr.svg?u=${encodeURIComponent(link.info.joinUrl ?? '')}`;
  renderLobby();
};
link.onState = (s) => {
  if (s === 'open') {
    // A (re)started host has forgotten assignments and lobby state: send them again.
    link.setSound(soundMode);
    sentAssign.clear();
    sentParts = '';
    lastPhoneKey = '';
  }
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
/**
 * How long past the good window a note waits for an in-flight ring before it counts as a miss.
 * Phone rings reach this page 30–40 ms after the strike on a quiet LAN, but Wi-Fi power save
 * delays some by up to ~200 ms (S1 report) and a busy host PC adds more; the ring still carries
 * its source time, so it is judged correctly as long as it arrives within the grace.
 */
const MISS_GRACE_MS = 250;
const MAX_MISS_GRACE_MS = 1000;
/** The grace, stretched to the slowest of the last 32 rings' arrival when the PC or Wi-Fi is slow. */
function missGrace(): number {
  let worst = 0;
  for (const l of hgpInput?.stats.latencyMs.slice(-32) ?? []) worst = Math.max(worst, l);
  return Math.min(MAX_MISS_GRACE_MS, Math.max(num('missGrace', MISS_GRACE_MS), worst + 20));
}
let players: PlayerStats[] = [];
let hgpInput: HgpInputSource | null = null;

async function start(mode: Mode): Promise<void> {
  await audio.resume();
  session?.stop();
  session = null;
  backing?.stop();
  backing = null;
  playing = false;
  await rebuild(mode);
  if (!team) return;
  roundSeats = [...seating.seats];
  if (mode === 'play' && !team.ringers.some((r) => roundSeats[r.index] !== TV)) {
    $('lobby-msg').textContent = 'No players: join with a phone (or give a part to Keyboard), or use Autoplay demo.';
    return;
  }
  lastMode = mode;
  (document.activeElement as HTMLElement | null)?.blur();
  const t = team;
  const lanes = laneMap();
  hgpInput = new HgpInputSource(link, (dev, bell) => lanes.get(`${dev}|${bell}`));
  const sources: InputSource[] = [hgpInput];
  const kbRinger = t.ringers.find((r) => roundSeats[r.index] === KEYBOARD);
  if (kbRinger) sources.push(keyboardRinger(kbRinger.laneStart, kbRinger.bells.length, (lane) => audio.bell(t.chart.lanes[lane].pitch, 0, 0.9, 0)));

  const hostRingSound = soundMode !== 'device';
  const s5 = chartCache.get(songId)!;
  const part = findPart(s5, difficulty, ringerCount)!;
  // Groove + pad from the chart's chords; bass/inner bells of this part are left out of it.
  backing = new BackingTrack(audio, s5, partBellNotes(s5, part), { ...backingSettings });
  const s = new Session(mode, t.chart, audio, mh, sessionHud, sources, offsets, { hostRingSound, extraEvents: backing.scheduled(), leadIn: backing.leadIn, missGraceMs: missGrace() });
  players = t.ringers.map((r) => newStats(slotName(roundSeats[r.index], r.index), r.noteIds.length));
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
    if (e) timing.rings.push({ p: ri, perf: round(e.hostTimeMs, 1), offMs: isJudgement(r) ? round(r.offset * 1000, 1) : null, latMs: round(e.receivedAtMs - e.hostTimeMs, 1) });
    teamHud.stats(ri, p);
  };
  s.onFinish = (r) => finish(r);
  const hostParts = t.autoRingers.map((i) => cards[i]?.name ?? `ringer ${i + 1}`).concat(t.ringers.filter((r) => r.autoBells.length).map((r) => r.autoBells.join(' ')));
  $('host-note').textContent = hostParts.length ? `Host rings: ${hostParts.join(' · ')}` : '';
  session = s;
  playing = true;
  resetTiming();
  s.start();
  sendCues(s);
  sendParts(); // phase "play": phones hide the part picker
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

// ── timing diagnostics (in the result JSON; the E2E prints them when a scenario fails) ──
/** S1 host time at which song time 0 is audible: what every cue and every judged ring hangs off. */
const songZeroHost = (s: Session): number => link.perfToHost(s.perfAtSong(0));
const timing = {
  cueSends: [] as { perf: number; anchorMs: number }[],
  samples: [] as { perf: number; songT: number; audioOffMs: number; hostOffMs: number; anchorMs: number }[],
  longFrames: [] as { perf: number; ms: number }[],
  rings: [] as { p: number; perf: number; offMs: number | null; latMs: number }[],
};
let lastTimingSample = 0;
let lastRafTs = NaN;
function resetTiming(): void {
  for (const k of ['cueSends', 'samples', 'longFrames', 'rings'] as const) timing[k].length = 0;
  lastTimingSample = 0;
  lastRafTs = NaN;
  cueAnchor = NaN;
}
function sampleTiming(s: Session, ts: number): void {
  if (Number.isFinite(lastRafTs) && ts - lastRafTs > 50 && timing.longFrames.length < 500) timing.longFrames.push({ perf: round(ts, 1), ms: round(ts - lastRafTs, 1) });
  lastRafTs = ts;
  const now = performance.now();
  if (now - lastTimingSample < 250) return;
  lastTimingSample = now;
  const anchor = songZeroHost(s);
  // The phones got their cues on the clock mapping of that moment; if the mapping has moved since
  // (host clock sync improved, audio clock re-anchored), send them again so phones stay on the beat.
  if (Number.isFinite(anchor) && Math.abs(anchor - cueAnchor) > CUE_RESEND_MS) sendCues(s);
  if (timing.samples.length > 4000) return;
  timing.samples.push({
    perf: round(now, 1),
    songT: round(s.songTimeAt(now), 3),
    audioOffMs: round(audio.clock.contextTimeAt(0) * 1000, 2),
    hostOffMs: round(link.sync.offsetAt(now), 2),
    anchorMs: round(anchor, 2),
  });
}

/** Re-send cues when the song→host-time mapping has moved by more than this (ms). */
const CUE_RESEND_MS = 2;
/** S1 host time of song time 0 that the phones' current cues were computed with. */
let cueAnchor = NaN;

/** Tell each phone when its notes are due (S1 host time) so it can glow the next zone. */
function sendCues(s: Session): void {
  if (!team || !link.sync.ready) return;
  cueAnchor = songZeroHost(s);
  timing.cueSends.push({ perf: round(performance.now(), 1), anchorMs: round(cueAnchor, 2) });
  for (const r of team.ringers) {
    const dev = roundSeats[r.index];
    if (!dev || !isPhone(dev)) continue;
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
  for (const s of roundSeats) if (s && isPhone(s)) link.cues(s, [], []);
}

function summarize(xs: number[]): { n: number; mean: number; p50: number; p95abs: number } {
  const n = xs.length;
  if (!n) return { n: 0, mean: NaN, p50: NaN, p95abs: NaN };
  const sorted = [...xs].sort((a, b) => a - b);
  const abs = xs.map(Math.abs).sort((a, b) => a - b);
  return { n, mean: round(xs.reduce((a, b) => a + b, 0) / n, 1), p50: round(sorted[Math.floor(n / 2)], 1), p95abs: round(abs[Math.min(n - 1, Math.floor(n * 0.95))], 1) };
}

function finish(r: SessionResult): void {
  playing = false;
  clearCues();
  if (r.mode === 'play' && team) {
    // Accuracy history for ⚖️ Balance (this page session only).
    players.forEach((p, i) => {
      const id = roundSeats[team!.ringers[i].index];
      if (!id || id === TV || !p.notes) return;
      accHistory.set(id, [...(accHistory.get(id) ?? []), accuracyOf(p)]);
    });
  }
  const playerRows = players.map((p, i) => ({
    ringer: team?.ringers[i].index,
    name: p.name,
    slot: team ? slotKind(roundSeats[team.ringers[i].index]) : '',
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
    timing: {
      ...timing,
      audioSnaps: audio.clock.snaps.map((x) => ({ perf: round(x.perf, 1), deltaMs: round(x.deltaMs, 2) })),
      hostSyncResets: link.sync.resets,
      hostSyncJumps: link.syncJumps,
    },
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
  sendParts(); // phones can pick parts for the next round
  renderNext();
}

function toLobby(): void {
  session?.stop();
  session = null;
  playing = false;
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
$('btn-rotate-again').onclick = () => {
  seating.rotate();
  void start(lastMode);
};
$('btn-shuffle').onclick = () => {
  seating.shuffle(rng, benchPhones());
  seatingChanged();
};
$('btn-rotate').onclick = () => {
  seating.rotate();
  seatingChanged();
};
$('btn-balance').onclick = () => {
  seating.balance(
    cards.map((c) => c.effort),
    accuracyMap(),
    rng,
  );
  seatingChanged();
};
$('btn-lobby').onclick = toLobby;
$('btn-copy').onclick = () => void navigator.clipboard.writeText($('res-json').textContent ?? '');

/**
 * TV-remote navigation in the lobby: rows [helpers] / [part cards] / [Play, Autoplay]; ↑/↓ between
 * rows, ←/→ within a row, Enter activates (a part card opens its picker). ↓ from nowhere enters.
 */
function lobbyNav(e: KeyboardEvent): boolean {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return false;
  const rows: HTMLElement[][] = [[...document.querySelectorAll<HTMLElement>('#seat-tools button')], view.cardEls, [$('btn-play'), $('btn-auto')]];
  const t = document.activeElement as HTMLElement | null;
  const r = rows.findIndex((row) => !!t && row.includes(t));
  if (r < 0) {
    if (e.key !== 'ArrowDown' || (t && t !== document.body)) return false;
    (view.cardEls[0] ?? $('btn-play')).focus();
    e.preventDefault();
    return true;
  }
  const row = rows[r];
  const c = row.indexOf(t!);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') row[(c + (e.key === 'ArrowLeft' ? -1 : 1) + row.length) % row.length]?.focus();
  else {
    const next = rows[r + (e.key === 'ArrowUp' ? -1 : 1)];
    if (next?.length) next[Math.min(c, next.length - 1)].focus();
  }
  e.preventDefault();
  return true;
}

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.code !== 'Escape' && ['SELECT', 'INPUT'].includes(target.tagName)) return;
  if (!session && lobbyNav(e)) return;
  if (e.code === 'Escape') toLobby();
  else if (e.code === 'Backquote') statsEl.classList.toggle('hidden');
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    offsets.visualMs += (e.code === 'ArrowRight' ? 5 : -5) * (e.shiftKey ? 4 : 1);
    saveOffsets();
  } else if (e.code === 'Enter' && !session && !target.closest('button, [role="button"], a, .picker')) void start('play');
});
window.addEventListener('resize', () => {
  mh.resize();
  teamHud.position();
});

// ── autostart (E2E / kiosk): ?start=play&waitPhones=3 ────────────────────────
let autostarted = false;
/** What autostart is still waiting for (E2E diagnostics). */
let autostartWaiting = '';
let autostartReadySince = 0;
function maybeAutostart(): void {
  const mode = params.get('start') as Mode | null;
  if (!mode || autostarted || session || !index) return;
  const need = num('waitPhones', 0);
  const ready = onlinePhones().filter((p) => typeof p.status?.syncN === 'number' && p.status.syncN > 0);
  // Also wait for a tight host clock sync (best exchange's error bound ≤ 2 ms; loopback is ~0.5 ms),
  // not just the first sample, which a busy page may have timed through a long task, and for the
  // audio output to have settled (no > 50 ms re-anchoring for 1 s: start-up underruns under load).
  const tight = (link.sync.estimate?.errBound ?? Infinity) <= 2;
  const clk = audio.clock;
  const audioSettled = clk.ready && !(performance.now() - clk.lastSnapPerf < 1000);
  autostartWaiting = [ready.length < need && `phones ${ready.length}/${need}`, !link.sync.ready && 'host sync', !tight && `host sync ±${link.sync.estimate?.errBound.toFixed(1)} ms`, !audioSettled && `audio clock (${clk.snaps.length} re-anchorings)`].filter(Boolean).join(', ');
  if (mode === 'play' && (ready.length < need || !link.sync.ready || !tight)) return;
  // An output that never settles (no audio device: Chrome's fake output) must not block forever;
  // cues are re-sent if the mapping moves during the song.
  autostartReadySince ||= performance.now();
  if (mode === 'play' && !audioSettled && performance.now() - autostartReadySince < 10_000) return;
  autostarted = true;
  void rebuild().then(() => window.setTimeout(() => void start(mode), num('startDelay', 1500)));
}

// ── render loop ─────────────────────────────────────────────────────────────
let lastIdle = performance.now();
let lastStats = 0;
let lastLobby = 0;
function loop(ts: number): void {
  requestAnimationFrame(loop);
  if (session) {
    session.missGraceMs = missGrace();
    session.frame(ts);
    sampleTiming(session, ts);
  } else {
    audio.clock.update(); // keep the audio↔performance mapping settled before a round starts
    const dt = Math.min(0.1, (ts - lastIdle) / 1000);
    lastIdle = ts;
    mh.frame(ts / 1000 + 1e4, dt, ts / 1000);
    if (ts - lastLobby > 1000) {
      lastLobby = ts;
      if (!$('lobby').classList.contains('hidden')) renderStatus(); // clock-sync text, in place
      maybeAutostart(); // its clock conditions settle without a device event
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
  get autostartWaiting() {
    return autostartWaiting;
  },
  get team() {
    return team;
  },
  /** Part index → deviceId | 'keyboard' | 'tv'. */
  get seats() {
    return seating.seats;
  },
  get cards() {
    return cards;
  },
  seating,
  view,
  get session() {
    return session;
  },
};
