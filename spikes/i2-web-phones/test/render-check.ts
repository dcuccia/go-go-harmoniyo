// Offline render sanity check for the procedural backing and the performance SFX (runs in a real
// browser: Node has no Web Audio). Driven by scripts/backing-render-check.mjs; results land on
// window.__render.
import { renderBell } from '../../s4-web-host/src/audio/bell';
import { BackingTrack, type Mixer } from '../src/backing/track';
import type { SfxCue } from '../src/sfx/director';
import { SfxSynth } from '../src/sfx/synth';
import { scaleChart } from '../src/speed';
import { findPart, partBellNotes, type S5Chart } from '../src/team-chart';

const SR = 48000;

interface Row {
  song: string;
  style: string | null;
  seconds: number;
  events: number;
  clicks: number;
  leadInSec: number;
  renderMs: number;
  peak: number;
  backingRmsDb: number;
  bellsRmsDb: number;
  backingVsBellsDb: number;
  clickOnsetErrMs: number[];
  firstDownbeatOnsetErrMs: number;
  silentBeforeStart: boolean;
  silentAfterStop: boolean;
  /** Ending: ritardando tag + fermata, rendered from 2 s before the final downbeat. */
  ending: { peak: number; tagNotes: number; lastDingOnsetErrMs: number; tailRmsDb: number; seconds: number };
  /** Practice speed 0.75: first groove downbeat onset vs its stretched time. */
  slowDownbeatOnsetErrMs: number;
}

interface SfxRow {
  cue: string;
  peak: number;
  rmsDb: number;
  /** RMS over the effect vs one bell (G5, gain 0.9) over the same span. */
  vsBellDb: number;
  onsetErrMs: number;
  lengthSec: number;
}

const db = (x: number): number => Math.round(20 * Math.log10(Math.max(1e-9, x)) * 10) / 10;

function rms(ch: Float32Array[], from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (const d of ch) for (let i = Math.max(0, from); i < Math.min(d.length, to); i++, n++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, n));
}

/** First sample at/after `fromSec` whose |amplitude| exceeds `thr` (searching `windowSec`). */
function onset(d: Float32Array, fromSec: number, windowSec: number, thr: number): number {
  const a = Math.max(0, Math.floor((fromSec - 0.005) * SR));
  const b = Math.min(d.length, Math.floor((fromSec + windowSec) * SR));
  for (let i = a; i < b; i++) if (Math.abs(d[i]) > thr) return i / SR;
  return NaN;
}

/** Peak |amplitude| in [fromSec, toSec). */
function peakIn(d: Float32Array, fromSec: number, toSec: number): number {
  let p = 0;
  for (let i = Math.max(0, Math.floor(fromSec * SR)); i < Math.min(d.length, Math.floor(toSec * SR)); i++) p = Math.max(p, Math.abs(d[i]));
  return p;
}

// Onsets: first sample above −100 dBFS, and nothing audible before it (scheduling, not attack shape).
const ONSET = 1e-5;
const errMs = (found: number, expected: number): number => Math.round((found - expected) * 1e5) / 100;

async function chart(id: string): Promise<S5Chart> {
  const r = await fetch(`/charts/${id}.json`);
  if (!r.ok) throw new Error(`charts/${id}.json: ${r.status} (run "npm run charts")`);
  return (await r.json()) as S5Chart;
}

async function renderOne(id: string, seconds: number): Promise<Row> {
  const c = await chart(id);
  const part = findPart(c, 'easy', 1) ?? c.parts[0];
  const bellNotes = partBellNotes(c, part);

  // 1) Backing + count-in, scheduled exactly as the Session does: song time t → ctx time leadIn + t.
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const mixer: Mixer = {
    ctx,
    connect: (n) => {
      n.connect(ctx.destination);
      return () => n.disconnect();
    },
  };
  const track = new BackingTrack(mixer, c, bellNotes, { enabled: true, volume: 0.5, countIn: true });
  const lead = track.leadIn;
  for (const e of track.scheduled()) if (lead + e.time < seconds) e.play(lead + e.time);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = Math.round(performance.now() - t0);
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  let peak = 0;
  for (const d of ch) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));

  // 2) Count-in clicks only (backing off) → onset of every click vs its scheduled time.
  const cctx = new OfflineAudioContext(1, Math.ceil(SR * (lead + 0.5)), SR);
  const clickTrack = new BackingTrack({ ctx: cctx, connect: (n) => (n.connect(cctx.destination), () => n.disconnect()) }, c, bellNotes, { enabled: false, volume: 0.5, countIn: true });
  for (const e of clickTrack.scheduled()) e.play(clickTrack.leadIn + e.time);
  const cbuf = (await cctx.startRendering()).getChannelData(0);
  // Clicks are > 150 ms apart and ring for < 100 ms: search each one from 5 ms before its slot.
  const clickOnsetErrMs = clickTrack.clicks.map((k) => errMs(onset(cbuf, clickTrack.leadIn + k.time, 0.05, ONSET), clickTrack.leadIn + k.time));
  const silentBeforeCountIn = peakIn(cbuf, 0, clickTrack.leadIn + clickTrack.clicks[0].time - 0.001) < ONSET;

  // 3) First groove downbeat: onset of the backing alone (count-in off) vs the first beat with a chord.
  const fctx = new OfflineAudioContext(1, Math.ceil(SR * (lead + 3)), SR);
  const fTrack = new BackingTrack({ ctx: fctx, connect: (n) => (n.connect(fctx.destination), () => n.disconnect()) }, c, bellNotes, { enabled: true, volume: 0.5, countIn: false });
  for (const e of fTrack.scheduled()) if (fTrack.leadIn + e.time < lead + 3) e.play(fTrack.leadIn + e.time);
  const fbuf = (await fctx.startRendering()).getChannelData(0);
  const firstT = fTrack.leadIn + fTrack.events[0].time;
  const firstDownbeatOnsetErrMs = errMs(onset(fbuf, firstT, 0.1, ONSET), firstT);
  const silentBeforeGroove = peakIn(fbuf, 0, firstT - 0.001) < ONSET;

  // 4) The bells of the same part (S4 additive synth, autoplay gains) for the mix ratio.
  const bctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  const cache = new Map<number, AudioBuffer>();
  for (const n of part.notes) {
    const midi = (c.bells.find((b) => b.id === n.bell)?.midi ?? 60) + 12;
    if (lead + n.time >= seconds) continue;
    let b = cache.get(midi);
    if (!b) {
      const data = renderBell(SR, 440 * Math.pow(2, (midi - 69) / 12));
      b = bctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      cache.set(midi, b);
    }
    const src = bctx.createBufferSource();
    src.buffer = b;
    const g = bctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(bctx.destination);
    src.start(lead + n.time);
  }
  const bells = (await bctx.startRendering()).getChannelData(0);
  const songFrom = Math.floor(lead * SR);
  const songTo = Math.floor(seconds * SR);
  const backingRms = rms(ch, songFrom, songTo);
  const bellsRms = rms([bells], songFrom, songTo);

  // 5) stop(): the bus fades to silence (Esc mid-song).
  const sctx = new OfflineAudioContext(1, SR * 2, SR);
  const sTrack = new BackingTrack({ ctx: sctx, connect: (n) => (n.connect(sctx.destination), () => n.disconnect()) }, c, bellNotes, { enabled: true, volume: 0.5, countIn: false });
  for (const e of sTrack.scheduled()) if (e.time < 2) e.play(Math.max(0, e.time));
  const stopped = sctx.suspend(0.5).then(() => {
    sTrack.stop();
    return sctx.resume();
  });
  const sbuf = await sctx.startRendering();
  await stopped;
  const tail = rms([sbuf.getChannelData(0)], Math.floor(0.75 * SR), 2 * SR);

  // 6) Ending: the ritardando tag and fermata, from 2 s before the final downbeat.
  const tl = track.timeline!;
  const finalBar = tl.beats[tl.beats.length - 1].bar;
  const down = tl.beats.find((b) => b.bar === finalBar && b.beat === 0)!.time;
  const glocks = track.events.filter((e) => e.inst === 'glock' && e.time > down);
  const lastDing = glocks[glocks.length - 1]?.time ?? down;
  const from = down - 2;
  const endSec = lastDing - from + 4;
  const ectx = new OfflineAudioContext(1, Math.ceil(SR * endSec), SR);
  const eTrack = new BackingTrack({ ctx: ectx, connect: (n) => (n.connect(ectx.destination), () => n.disconnect()) }, c, bellNotes, { enabled: true, volume: 0.5, countIn: false });
  for (const e of eTrack.scheduled()) if (e.time >= from) e.play(e.time - from);
  const ebuf = (await ectx.startRendering()).getChannelData(0);
  const ding = lastDing - from;
  const ending = {
    peak: Math.round(peakIn(ebuf, 0, endSec) * 1000) / 1000,
    tagNotes: glocks.length,
    lastDingOnsetErrMs: NaN,
    tailRmsDb: db(rms([ebuf], Math.floor((endSec - 0.5) * SR), Math.floor(endSec * SR))),
    seconds: Math.round(endSec * 10) / 10,
  };

  // The closing ding alone (the fermata is sounding under it): onset on its scheduled sample.
  const dctx = new OfflineAudioContext(1, Math.ceil(SR * (ding + 1)), SR);
  const dTrack = new BackingTrack({ ctx: dctx, connect: (n) => (n.connect(dctx.destination), () => n.disconnect()) }, c, bellNotes, { enabled: true, volume: 0.5, countIn: false });
  const dSched = dTrack.scheduled(); // count-in off: index i is events[i]
  dTrack.events.forEach((e, i) => e.inst === 'glock' && e.time === lastDing && dSched[i].play(ding));
  const dbuf = (await dctx.startRendering()).getChannelData(0);
  ending.lastDingOnsetErrMs = errMs(onset(dbuf, ding, 0.05, ONSET), ding);

  // 7) Practice speed 0.75: the stretched groove's first downbeat still lands on its sample.
  const pctx = new OfflineAudioContext(1, Math.ceil(SR * 6), SR);
  // The game stretches the chart itself (src/speed.ts); the backing is generated from that.
  const slow = scaleChart(c, 0.75);
  const pTrack = new BackingTrack({ ctx: pctx, connect: (n) => (n.connect(pctx.destination), () => n.disconnect()) }, slow, partBellNotes(slow, findPart(slow, 'easy', 1) ?? slow.parts[0]), { enabled: true, volume: 0.5, countIn: false });
  for (const e of pTrack.scheduled()) if (pTrack.leadIn + e.time < 6) e.play(pTrack.leadIn + e.time);
  const pbuf = (await pctx.startRendering()).getChannelData(0);
  const pFirst = pTrack.leadIn + pTrack.events[0].time;
  const slowDownbeatOnsetErrMs = errMs(onset(pbuf, pFirst, 0.1, ONSET), pFirst);

  return {
    song: id,
    style: track.style?.id ?? null,
    seconds,
    events: track.events.length,
    clicks: track.clicks.length,
    leadInSec: Math.round(lead * 1000) / 1000,
    renderMs,
    peak: Math.round(peak * 1000) / 1000,
    backingRmsDb: db(backingRms),
    bellsRmsDb: db(bellsRms),
    backingVsBellsDb: db(backingRms / bellsRms),
    clickOnsetErrMs,
    firstDownbeatOnsetErrMs,
    silentBeforeStart: silentBeforeCountIn && silentBeforeGroove,
    silentAfterStop: tail < 1e-4,
    ending,
    slowDownbeatOnsetErrMs,
  };
}

/** One bell at autoplay gain, the yardstick for SFX levels. */
async function bellRef(seconds: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  const data = renderBell(SR, 440 * Math.pow(2, (79 - 69) / 12));
  const b = ctx.createBuffer(1, data.length, SR);
  b.copyToChannel(data, 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  src.connect(g).connect(ctx.destination);
  src.start(0);
  return (await ctx.startRendering()).getChannelData(0);
}

const SFX_AT = 0.5;

async function renderSfx(cue: SfxCue, label: string, bell: Float32Array, duckAt?: number): Promise<SfxRow & { buf: Float32Array }> {
  const ctx = new OfflineAudioContext(1, SR * 6, SR);
  const s = new SfxSynth(ctx);
  s.output.connect(ctx.destination);
  s.setVolume(0.5);
  if (duckAt !== undefined) s.duck(duckAt);
  const len = s.play(cue, SFX_AT, { chord: [7, 11, 2], beatSec: 0.5 });
  const buf = (await ctx.startRendering()).getChannelData(0);
  const a = Math.floor(SFX_AT * SR);
  const b = Math.floor((SFX_AT + len) * SR);
  const r = rms([buf], a, b);
  const br = rms([bell], 0, b - a);
  return {
    cue: label,
    peak: Math.round(peakIn(buf, 0, 6) * 1000) / 1000,
    rmsDb: db(r),
    vsBellDb: db(r / br),
    onsetErrMs: errMs(onset(buf, SFX_AT, 0.05, ONSET), SFX_AT),
    lengthSec: Math.round(len * 100) / 100,
    buf,
  };
}

async function sfxChecks(): Promise<{ rows: SfxRow[]; duckDb: number; silentBefore: boolean }> {
  const bell = await bellRef(6);
  const cues: [SfxCue, string][] = [
    [{ kind: 'streak', value: 10 }, 'streak 10 (sparkle)'],
    [{ kind: 'streak', value: 50 }, 'streak 50 (sparkle + chime)'],
    [{ kind: 'multiplier', value: 2 }, 'multiplier ×2 (whoosh)'],
    [{ kind: 'miss', value: 0 }, 'miss (soft boop)'],
    [{ kind: 'phrase', value: 8, phrase: 0 }, 'perfect phrase (fanfare, G major)'],
    [{ kind: 'applause', value: 0.3 }, 'applause, 30 % accuracy'],
    [{ kind: 'applause', value: 0.95 }, 'applause + cheers, 95 %'],
  ];
  const rows: SfxRow[] = [];
  let silentBefore = true;
  for (const [cue, label] of cues) {
    const { buf, ...row } = await renderSfx(cue, label, bell);
    silentBefore &&= peakIn(buf, 0, SFX_AT - 0.001) < ONSET;
    rows.push(row);
  }
  // Ducking: the same sparkle with a bell ringing 80 ms before it (as in play) vs alone.
  const plain = await renderSfx({ kind: 'streak', value: 10 }, '', bell);
  const ducked = await renderSfx({ kind: 'streak', value: 10 }, '', bell, SFX_AT - 0.08);
  const win = (x: Float32Array) => rms([x], Math.floor(SFX_AT * SR), Math.floor((SFX_AT + 0.12) * SR));
  return { rows, duckDb: db(win(ducked.buf) / win(plain.buf)), silentBefore };
}

async function main(): Promise<void> {
  const songs = (new URLSearchParams(location.search).get('songs') ?? 'jingle-bells,joy-to-the-world,we-wish-you-a-merry-christmas,silent-night').split(',');
  const rows: Row[] = [];
  for (const s of songs) rows.push(await renderOne(s, 20));
  const sfx = await sfxChecks();
  (window as unknown as { __render: unknown }).__render = { sampleRate: SR, userAgent: navigator.userAgent, rows, sfx };
  document.title = 'RENDER_DONE';
}

main().catch((e) => {
  (window as unknown as { __render: unknown }).__render = { error: String(e?.stack ?? e) };
  document.title = 'RENDER_DONE';
});
