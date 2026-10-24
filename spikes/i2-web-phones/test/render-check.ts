// Offline render sanity check for the procedural backing (runs in a real browser: Node has no
// Web Audio). Driven by scripts/backing-render-check.mjs; results land on window.__render.
import { renderBell } from '../../s4-web-host/src/audio/bell';
import { BackingTrack, type Mixer } from '../src/backing/track';
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
  };
}

async function main(): Promise<void> {
  const songs = (new URLSearchParams(location.search).get('songs') ?? 'jingle-bells,joy-to-the-world,we-wish-you-a-merry-christmas,silent-night').split(',');
  const rows: Row[] = [];
  for (const s of songs) rows.push(await renderOne(s, 20));
  (window as unknown as { __render: unknown }).__render = { sampleRate: SR, userAgent: navigator.userAgent, rows };
  document.title = 'RENDER_DONE';
}

main().catch((e) => {
  (window as unknown as { __render: unknown }).__render = { error: String(e?.stack ?? e) };
  document.title = 'RENDER_DONE';
});
