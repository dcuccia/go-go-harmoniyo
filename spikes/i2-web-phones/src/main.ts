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
import type { Sensitivity } from '../../s1-phone-bell/src/core/ring-detector.ts';
import { HgpInputSource } from './hgp-input';
import { defaultHgpUrl, HgpLink, type LobbyParts, type PhoneInfo } from './hgp-link';
import { MultiHighway } from './multi-highway';
import { ARRANGEMENTS, buildTeamChart, findPart, isChartFormat, partBellNotes, shortestIoiMs, type Arrangement, type Difficulty, type S5Chart, type TeamChart } from './team-chart';
import { partCards, type PartCard } from './parts';
import { KEYBOARD, Seating, seededRng, TV } from './seating';
import { SeatingView, type PlayerView } from './seating-view';
import type { PartCard as PartCardMsg } from '../../s1-phone-bell/src/core/hgp.ts';
import { accuracyOf, newStats, TeamHud, type PlayerStats } from './team-hud';
import { isAccidental } from '../../shared/pitch-palette';
import { BackingTrack, DEFAULT_BACKING, type BackingSettings } from './backing/track';
import { backingTimeline } from './backing/timeline';
import { describe as describeBacking } from './backing/patterns';
import { clampSpeed, DEFAULT_SPEED, parseSpeedPercent, scaleChart, speedNote, speedPercent } from './speed';
import { JoinQueue, waitingLabel } from './join-queue';
import { beatAt } from './backing/phrases';
import { DEFAULT_SFX, PerformanceDirector, type SfxSettings } from './sfx/director';
import { SfxSynth } from './sfx/synth';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) !== '0' : d);
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
/** Brand files (docs/design/brand, copied by scripts/brand-assets.mjs). */
const BRAND = `${import.meta.env.BASE_URL}brand/`;
/** Results cheer: Y5 (cheer with hands) from this team accuracy, Y2 (joy) below it. Both celebrate. */
const BIG_CHEER_ACCURACY = 0.8;

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

// ── practice speed (lobby; remembered for this browser session, ?speed=50..100) ──
const SPEED_KEY = 'i2.speed';
let speed = parseSpeedPercent(params.get('speed')) ?? parseSpeedPercent(sessionStorage.getItem(SPEED_KEY)) ?? DEFAULT_SPEED;
const saveSpeed = (): void => sessionStorage.setItem(SPEED_KEY, String(speedPercent(speed)));

// ── always-visible join QR (?joinQr=0 hides it; ?joinQrCorner=tl|tr|bl|br; ?joinQrSize=px) ──
const cornerJoin = {
  show: flag('joinQr', true),
  corner: ['tl', 'tr', 'bl', 'br'].includes(params.get('joinQrCorner') ?? '') ? params.get('joinQrCorner')! : 'tl',
  size: num('joinQrSize', 0),
};
// ── performance sound effects (lobby; saved) ───────────────────────────────
const SFX_KEY = 'i2.sfx';
const sfxSettings: SfxSettings = { ...DEFAULT_SFX, ...JSON.parse(localStorage.getItem(SFX_KEY) ?? '{}') };
if (params.has('sfx')) sfxSettings.enabled = flag('sfx', true);
if (params.has('sfxVol')) sfxSettings.volume = Math.max(0, Math.min(1, num('sfxVol', 50) / 100));
const saveSfx = (): void => localStorage.setItem(SFX_KEY, JSON.stringify(sfxSettings));
let sfx: SfxSynth | null = null;
let director: PerformanceDirector | null = null;
/** SFX bus, created once on the game's AudioContext; a little hall reverb like the backing. */
function ensureSfx(): SfxSynth {
  if (!sfx) {
    sfx = new SfxSynth(audio.ctx);
    audio.connect(sfx.output, 0.15);
  }
  sfx.setVolume(sfxSettings.enabled ? sfxSettings.volume : 0, audio.ctx.currentTime);
  return sfx;
}
/** SFX start a beat-let after the ring that triggered them, so the bell's attack is heard first. */
const SFX_DELAY = 0.08;

// ── ring sensitivity per phone (lobby; saved): Normal or Quick, sent in HGP assign.ring ──
const SENS_KEY = 'i2.sens';
const phoneSens: Record<string, Sensitivity> = JSON.parse(localStorage.getItem(SENS_KEY) ?? '{}');
const sensOf = (id: string): Sensitivity => (phoneSens[id] === 'quick' ? 'quick' : 'normal');

// ── engine pieces (S4) ──────────────────────────────────────────────────────
const mh = new MultiHighway($('highways'), {
  bloom: flag('bloom', true),
  maxPixelRatio: num('dpr', 1.5),
  msaa: num('msaa', 0),
  particles: flag('particles', true),
});
mh.setSpeed(speed);
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
  songs: { id: string; title: string; composer?: string; license?: string; durationSec: number; parts: { difficulty: Difficulty; ringerCount: number; strikes: number; maxBellsPerRinger: number }[]; forms?: Partial<Record<SongForm, { durationSec: number }>> }[];
}
let index: SongIndex | null = null;
const chartCache = new Map<string, S5Chart>();
let songId = params.get('song') ?? 'jingle-bells';
let difficulty = (params.get('diff') ?? 'easy') as Difficulty;
/** Song length: full (intro, verses that develop, coda; charts/<id>.json) or short (once; charts/short/<id>.json). */
type SongForm = 'full' | 'short';
let songForm: SongForm = params.get('form') === 'short' ? 'short' : 'full';
/** How parts are split: balanced roles (default), chord split, or by range (S5 0.2). */
let arrangement: Arrangement = (ARRANGEMENTS as readonly string[]).includes(params.get('parts') ?? '') ? (params.get('parts') as Arrangement) : 'balanced';
const chartKey = (id: string = songId): string => `${songForm}:${id}`;
const songDuration = (s: SongIndex['songs'][number]): number => s.forms?.[songForm]?.durationSec ?? s.durationSec;
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
/** Phones that joined during the current round (or its results screen): seated when the next starts. */
const joinQueue = new JoinQueue();

const onlinePhones = (): PhoneInfo[] => link.phones.filter((p) => p.online && p.kind !== 'dashboard');
const phoneName = (id: string): string => link.phones.find((p) => p.id === id)?.name ?? id;
const isPhone = (s: string): boolean => s !== TV && s !== KEYBOARD;
const slotName = (s: string, i: number): string => (s === TV ? `${cards[i]?.name ?? `Ringer ${i + 1}`} (TV)` : s === KEYBOARD ? 'Keyboard' : phoneName(s));
const slotKind = (s: string): string => (s === TV ? 'host plays' : s === KEYBOARD ? 'keyboard A S D F' : 'phone');

async function loadChart(id: string): Promise<S5Chart> {
  let c = chartCache.get(chartKey(id));
  if (!c) {
    const url = `charts/${songForm === 'short' ? 'short/' : ''}${id}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} — run "npm run charts"`);
    c = (await res.json()) as S5Chart;
    if (!isChartFormat(c.format)) throw new Error(`${url}: unknown chart format "${c.format}"`);
    chartCache.set(chartKey(id), c);
  }
  return c;
}

/** The chart at the practice speed (cached per song and speed). */
const scaledCache = new Map<string, S5Chart>();
async function songChart(id: string): Promise<S5Chart> {
  const key = `${chartKey(id)}@${speed}`;
  let c = scaledCache.get(key);
  if (!c) {
    c = scaleChart(await loadChart(id), speed);
    scaledCache.set(key, c);
  }
  return c;
}
/** Current song at the current speed, once loaded. */
const currentChart = (): S5Chart | undefined => scaledCache.get(`${chartKey()}@${speed}`);
/** Song label for the phones: title, tier and (when slowed down) the practice speed. */
const songLabel = (): string => `${chartCache.get(chartKey())?.song.title ?? songId} (${difficulty.replace('-', ' ')}${arrangement !== 'balanced' ? `, ${arrangement.replace('-', ' ')}` : ''})${speed < 1 ? ` · ${speedNote(speed)}` : ''}`;

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
  const s5 = await songChart(songId);
  const part = findPart(s5, difficulty, ringerCount, arrangement);
  if (!part) {
    joiners.forEach((id) => knownPhones.delete(id)); // seat them once there is an arrangement
    $('lobby-msg').textContent = `No ${difficulty} part for ${ringerCount} ringers in ${s5.song.title}.`;
    return;
  }
  $('lobby-msg').textContent = '';
  const transpose = num('octave', 1) ? 12 : 0;
  cards = partCards(s5, part, buildTeamChart(s5, part, { transpose }));
  seating.setParts(cards.map((c) => c.name));
  // Phones that joined during the last round get their part first, in join order (drop-in).
  joinQueue.seat(seating);
  // Seat newcomers, reconnecting phones and anyone waiting for a part (not those who sat out).
  seating.fill(onlinePhones().map((p) => p.id));
  const seats = seating.seats;
  const active = seats.map((s) => forPlayMode === 'autoplay' || s !== TV);
  if (!active.some(Boolean)) active.fill(true); // lobby preview with no players: show every highway
  team = buildTeamChart(s5, part, { active, transpose });
  mh.setSpeed(speed);
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
  const song = songLabel();
  for (const r of team.ringers) {
    const dev = seating.seats[r.index];
    if (!dev || !isPhone(dev)) continue;
    const bells = r.bells.map((b) => ({ id: b.id, label: b.letter, midi: b.pitch, color: b.color }));
    const ringer = { slot: r.index, title: `${cards[r.index]?.name ?? `Ringer ${r.index + 1}`} · Ringer ${r.index + 1}`, song };
    // Fast-passage hint: the phone uses its cues during a song; this is the song-wide fallback.
    const ioi = shortestIoiMs(r.noteIds.map((id) => team!.chart.notes[id].time));
    const ring = { sens: sensOf(dev), ...(ioi !== null ? { ioi } : {}) };
    const key = JSON.stringify([bells, ringer, ring]);
    if (sentAssign.get(dev) === key) continue;
    sentAssign.set(dev, key);
    link.assign(dev, bells, ringer, ring);
  }
  for (const p of onlinePhones()) {
    if (seating.partOf(p.id) >= 0 || !p.bells?.length) continue;
    const ringer = { slot: -1, title: 'Not playing: pick a part', song };
    const ring = { sens: sensOf(p.id) };
    const key = JSON.stringify([p.bells, ringer, ring]);
    if (sentAssign.get(p.id) === key) continue;
    sentAssign.set(p.id, key);
    link.assign(p.id, p.bells, ringer, ring);
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
  const lobby: LobbyParts = { phase: playing ? 'play' : 'lobby', song: songLabel(), parts, waiting: [...joinQueue.waiting] };
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
  const songsKey = `${index?.songs.length}@${speed}:${songForm}`;
  if (index && selSong.dataset.key !== songsKey && document.activeElement !== selSong) {
    selSong.dataset.key = songsKey;
    selSong.innerHTML = index.songs.map((s) => `<option value="${s.id}">${s.title} (${Math.round(songDuration(s) / speed)} s, ${s.license ?? '?'})</option>`).join('');
  }
  setValue(selSong, songId);
  setValue($<HTMLSelectElement>('sel-diff'), difficulty);
  setValue($<HTMLSelectElement>('sel-ringers'), String(ringerCount));
  setValue($<HTMLSelectElement>('sel-parts'), arrangement);
  setValue($<HTMLSelectElement>('sel-form'), songForm);
  setValue($<HTMLSelectElement>('sel-sound'), soundMode);
  setChecked($<HTMLInputElement>('chk-backing'), backingSettings.enabled);
  setValue($<HTMLInputElement>('rng-backing'), String(Math.round(backingSettings.volume * 100)));
  $<HTMLInputElement>('rng-backing').disabled = !backingSettings.enabled;
  $('backing-vol').textContent = `${Math.round(backingSettings.volume * 100)}%`;
  setChecked($<HTMLInputElement>('chk-countin'), backingSettings.countIn);
  renderSpeed();
  setChecked($<HTMLInputElement>('chk-sfx'), sfxSettings.enabled);
  setValue($<HTMLInputElement>('rng-sfx'), String(Math.round(sfxSettings.volume * 100)));
  $<HTMLInputElement>('rng-sfx').disabled = !sfxSettings.enabled;
  $('sfx-vol').textContent = `${Math.round(sfxSettings.volume * 100)}%`;

  view.update(cards, seating.seats, playerViews());
  const s5 = currentChart();
  const part = s5 ? findPart(s5, difficulty, ringerCount, arrangement) : undefined;
  if (part) {
    const onPhones = cards.reduce((a, c) => a + c.bells.length, 0);
    $('part-info').textContent = `${part.notes.length} notes · ${onPhones} bells on phones${cards.some((c) => c.autoBells.length) ? ' · some bells exceed 4 per phone and are rung by the TV' : ''}${part.guide?.length ? ' · the TV plays the rest of the tune softly' : ''}${s5?.form && s5.form.sections.length > 1 ? ` · ${s5.form.sections.map((x) => x.label ?? x.kind).join(' → ')}` : ''} · chart profile ${index?.profile}`;
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
      const quick = sensOf(p.id) === 'quick';
      const sensBtn = `<button class="sens-btn${quick ? ' on' : ''}" data-sens="${esc(p.id)}" title="Ring sensitivity. Quick: smaller, faster strokes ring, for players who find fast notes hard (a few more stray rings). Fast passages adapt in both modes.">${quick ? '🐇 Quick' : 'Normal'}</button>`;
      setHtml(
        li,
        `${sensBtn}<b>${esc(p.name)}</b>${p.ready ? ' <em class="rdy">✓ ready</em>' : ''} <span class="bells">${bells}</span><br><small>${p.online ? 'online' : 'offline'} · ${sync} · ${sensors}${st.axis ? '' : ' · uncalibrated'}${part >= 0 ? ` · ${esc(cards[part]?.name ?? `ringer ${part + 1}`)}` : ' · not playing'}</small><img class="yo-rang" src="${BRAND}yo-ring.svg" alt="" />`,
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
  const joining = joinQueue.waiting.length ? ` · Joining: ${joinQueue.waiting.map(phoneName).join(', ')} (first part the TV plays)` : '';
  $('res-next').textContent = cards.length ? `Next round: ${cards.map((c, i) => `${c.name} — ${who(seating.seats[i] ?? TV)}`).join(' · ')}${joining}` : '';
}

/** Lobby speed control: value, label and the song length at this speed. */
function renderSpeed(): void {
  setValue($<HTMLInputElement>('rng-speed'), String(speedPercent(speed)));
  $('speed-val').textContent = `${speedPercent(speed)}%`;
  const dur = ((s) => (s ? songDuration(s) : undefined))(index?.songs.find((s) => s.id === songId));
  $('speed-info').textContent = speed < 1 ? `Slower for learning: ${dur ? `${Math.round(dur / speed)} s instead of ${Math.round(dur)} s; ` : ''}bells, backing and count-in slow down too, timing is judged the same.` : '';
}

/**
 * Corner QR + join URL while a round is on screen (song or results), so people can join at any
 * time; hidden in the lobby (it has the big QR), while there is no join URL yet (--tunnel still
 * starting) and while the phone host is unreachable. "+N waiting" lists phones that joined mid-round.
 */
function renderCornerJoin(): void {
  const el = $('corner-join');
  const url = link.info.joinUrl ?? '';
  const show = cornerJoin.show && !!session && link.state === 'open' && !!url;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.dataset.corner = cornerJoin.corner;
  if (cornerJoin.size > 0) el.style.setProperty('--cj-size', `${cornerJoin.size}px`);
  const img = $<HTMLImageElement>('corner-qr');
  if (img.dataset.u !== url) {
    img.dataset.u = url;
    img.src = `${link.httpOrigin}/qr.svg?u=${encodeURIComponent(url)}`;
  }
  $('corner-url').textContent = url.replace(/\/$/, '');
  $('corner-hint').textContent = /self-signed/i.test(link.info.tlsMode ?? '') ? 'scan · accept the warning once' : 'scan to join';
  const waiting = joinQueue.waiting;
  const w = $('corner-wait');
  w.classList.toggle('hidden', !waiting.length);
  w.querySelector('b')!.textContent = waitingLabel(waiting.length);
  w.querySelector('span')!.textContent = waiting.map(phoneName).join(', ');
}

/** During a round: phones that just joined wait for the next one (TV indicator + phone screen). */
function updateJoinQueue(): void {
  if (!session) return;
  if (!joinQueue.update(onlinePhones().map((p) => p.id), roundSeats, seating)) return;
  sendParts();
  renderCornerJoin();
  if (!playing) renderNext();
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
$<HTMLSelectElement>('sel-parts').onchange = (e) => {
  arrangement = (e.target as HTMLSelectElement).value as Arrangement;
  void rebuild();
};
$<HTMLSelectElement>('sel-form').onchange = (e) => {
  songForm = (e.target as HTMLSelectElement).value as SongForm;
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
$<HTMLInputElement>('rng-speed').oninput = (e) => {
  speed = clampSpeed(Number((e.target as HTMLInputElement).value) / 100);
  saveSpeed();
  renderSpeed();
};
// Rebuild (scaled chart, highways, part meters, phone labels) when the slider is let go.
$<HTMLInputElement>('rng-speed').onchange = () => void rebuild();
$<HTMLInputElement>('chk-sfx').onchange = (e) => {
  sfxSettings.enabled = (e.target as HTMLInputElement).checked;
  saveSfx();
  if (sfx) ensureSfx();
  renderLobby();
};
$<HTMLInputElement>('rng-sfx').oninput = (e) => {
  sfxSettings.volume = Number((e.target as HTMLInputElement).value) / 100;
  saveSfx();
  $('sfx-vol').textContent = `${Math.round(sfxSettings.volume * 100)}%`;
};
// Per-phone ring sensitivity (Normal ⇄ Quick): saved on this PC, applied at once via HGP assign.ring.
$('phones').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-sens]');
  const id = btn?.dataset.sens;
  if (!id) return;
  if (sensOf(id) === 'quick') delete phoneSens[id];
  else phoneSens[id] = 'quick';
  localStorage.setItem(SENS_KEY, JSON.stringify(phoneSens));
  sendAssignments();
  renderStatus();
});

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
  updateJoinQueue();
  maybeAutostart();
};
// A phone picked a part ("Pick your part"); a taken part is swapped (v0: no consent prompt).
link.onClaim = (deviceId, part) => {
  if (playing || !onlinePhones().some((p) => p.id === deviceId)) return;
  seating.assign(part, deviceId);
  if (joinQueue.remove(deviceId)) renderCornerJoin(); // results screen: a waiting phone chose for itself
  seatingChanged();
};
link.onInfo = () => {
  $<HTMLImageElement>('qr').src = `${link.httpOrigin}/qr.svg?u=${encodeURIComponent(link.info.joinUrl ?? '')}`;
  renderLobby();
  renderCornerJoin();
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
  renderCornerJoin();
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
/** Practice speed of the current/last round (for its results). */
let roundSpeed = 1;

async function start(mode: Mode): Promise<void> {
  await audio.resume();
  session?.stop();
  session = null;
  backing?.stop();
  backing = null;
  sfx?.hush();
  director = null;
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
  const s5 = currentChart()!;
  const part = findPart(s5, difficulty, ringerCount, arrangement)!;
  // Groove + pad from the chart's chords; bass/inner bells of this part are left out of it.
  backing = new BackingTrack(audio, s5, partBellNotes(s5, part), { ...backingSettings });
  const s = new Session(mode, t.chart, audio, mh, sessionHud, sources, offsets, { hostRingSound, extraEvents: backing.scheduled(), leadIn: backing.leadIn, missGraceMs: missGrace() });
  players = t.ringers.map((r) => newStats(slotName(roundSeats[r.index], r.index), r.noteIds.length));
  // Performance SFX: streaks, multiplier, misses, perfect phrases (phrases from the backing's
  // chord timeline), applause at the end. Play mode only.
  const fx = mode === 'play' && sfxSettings.enabled ? ensureSfx() : null;
  director = fx ? new PerformanceDirector({ phrases: backing.phrases, noteTimes: t.chart.notes.map((n) => n.time) }) : null;
  const bt = backing;
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
    if (fx && director) {
      const now = audio.ctx.currentTime;
      if (e) fx.duck(now); // a bell rings (on the phone or here): SFX step back
      const st = s.judge.state;
      const cues = director.judge(isJudgement(r) ? r.noteId : undefined, isJudgement(r) ? r.grade : 'stray', st.streak, st.multiplier, performance.now());
      if (cues.length) {
        const beat = bt.timeline ? beatAt(bt.timeline, s.songTimeAt(performance.now()) * bt.speed) : undefined;
        for (const cue of cues) fx.play(cue, now + SFX_DELAY, { chord: beat?.chord?.tones, beatSec: beat ? beat.dur / bt.speed : undefined });
      }
    }
    if (e) timing.rings.push({ p: ri, perf: round(e.hostTimeMs, 1), offMs: isJudgement(r) ? round(r.offset * 1000, 1) : null, latMs: round(e.receivedAtMs - e.hostTimeMs, 1) });
    teamHud.stats(ri, p);
  };
  s.onFinish = (r) => finish(r);
  const hostParts = t.autoRingers.map((i) => cards[i]?.name ?? `ringer ${i + 1}`).concat(t.ringers.filter((r) => r.autoBells.length).map((r) => r.autoBells.join(' ')));
  $('host-note').textContent = hostParts.length ? `Host rings: ${hostParts.join(' · ')}` : '';
  session = s;
  playing = true;
  roundSpeed = speed;
  joinQueue.startRound(onlinePhones().map((p) => p.id));
  resetTiming();
  s.start();
  sendCues(s);
  sendParts(); // phase "play": phones hide the part picker
  teamHud.position();
  $('speed-badge').textContent = speed < 1 ? `🐢 ${speedNote(speed)}` : '';
  $('speed-badge').classList.toggle('hidden', speed >= 1);
  $('lobby').classList.add('hidden');
  $('results').classList.add('hidden');
  renderCornerJoin();
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
  if (r.mode === 'play' && director && sfx) sfx.play(director.finish(r.accuracy, performance.now()), audio.ctx.currentTime + 0.3);
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
    form: songForm,
    arrangement,
    ringers: ringerCount,
    /** Practice speed (1 = written tempo); song times in this result are at this speed. */
    speed: roundSpeed,
    chartDurationSec: team ? round(team.chart.duration, 3) : null,
    soundMode,
    backing: backing
      ? { ...backing.settings, style: backing.style?.id ?? null, chords: backing.timeline?.source ?? null, events: backing.events.length, countInClicks: backing.clicks.length, leadInSec: round(backing.leadIn, 3) }
      : null,
    sfx: { ...sfxSettings, cues: director?.counts() ?? null },
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
  const yo = $<HTMLImageElement>('res-yo');
  const bigCheer = r.accuracy >= BIG_CHEER_ACCURACY;
  yo.src = `${BRAND}${bigCheer ? 'yo-cheer-hands' : 'yo-cheer'}.svg`;
  yo.dataset.state = bigCheer ? 'cheer-hands' : 'cheer';
  const speedLine = roundSpeed < 1 ? `<br><span class="res-speed">🐢 Practice speed ${speedPercent(roundSpeed)}%</span>` : '';
  $('res-body').innerHTML =
    r.mode === 'autoplay'
      ? `Autoplay demo finished.${speedLine}`
      : `Team score <span class="big">${r.score.toLocaleString()}</span><br>Accuracy ${(r.accuracy * 100).toFixed(1)}% · best team streak ${r.maxStreak}<br>Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss} · stray rings ${r.strays}${speedLine}`;
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
  renderCornerJoin();
}

function toLobby(): void {
  session?.stop();
  session = null;
  playing = false;
  backing?.stop();
  backing = null;
  sfx?.hush();
  clearCues();
  hud.show(false);
  $('results').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  renderCornerJoin();
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
  // Also wait for a tight host clock sync (best exchange's error bound ≤ 10 ms; loopback is ~0.5 ms,
  // a slow CI runner ~3 ms),
  // not just the first sample, which a busy page may have timed through a long task, and for the
  // audio output to have settled (no > 50 ms re-anchoring for 1 s: start-up underruns under load).
  const tight = (link.sync.estimate?.errBound ?? Infinity) <= 10;
  const clk = audio.clock;
  const audioSettled = clk.ready && !(performance.now() - clk.lastSnapPerf < 1000);
  autostartWaiting = [ready.length < need && `phones ${ready.length}/${need}`, !link.sync.ready && 'host sync', !tight && `host sync ±${link.sync.estimate?.errBound.toFixed(1)} ms`, !audioSettled && `audio clock (${clk.snaps.length} re-anchorings)`].filter(Boolean).join(', ');
  if (mode === 'play' && (ready.length < need || !link.sync.ready)) return;
  // Clock conditions that never settle (a PC too busy to time a clean sync exchange; no audio
  // device: Chrome's fake output) must not block a kiosk forever; cues are re-sent if the mapping
  // moves during the song.
  autostartReadySince ||= performance.now();
  const waited = performance.now() - autostartReadySince;
  if (mode === 'play' && ((!tight && waited < 20_000) || (!audioSettled && waited < 10_000))) return;
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
  joinQueue,
  get speed() {
    return speed;
  },
  get session() {
    return session;
  },
};
