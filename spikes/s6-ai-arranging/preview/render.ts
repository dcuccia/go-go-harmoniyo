// Blind-listening preview renderer (runs in a real browser: Node has no Web Audio). Driven by
// scripts/render-previews.mjs, which passes the jobs in window.__jobs and collects WAVs from
// window.__out. Uses the S4 bell synth and the I2 procedural backing synth unchanged.
import { renderBell } from '../../s4-web-host/src/audio/bell';
import type { BackingEvent } from '../../i2-web-phones/src/backing/patterns';
import { BackingSynth } from '../../i2-web-phones/src/backing/synth';
import { BackingTrack, type Mixer } from '../../i2-web-phones/src/backing/track';
import { findPart, partBellNotes, type Difficulty, type S5Chart } from '../../i2-web-phones/src/team-chart';

interface Job {
  name: string;
  chart: S5Chart;
  difficulty: Difficulty;
  ringers: number;
  backing: boolean;
  amt?: { time: number; dur: number; midi: number; vel: number; program: number }[];
  maxSeconds: number;
}

const SR = 22050;
const LEAD = 0.5;

function wav16(data: Float32Array): string {
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), true);
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function render(job: Job): Promise<{ name: string; seconds: number; wav: string; rmsDb: number; peak: number; bellNotes: number; amtNotes: number; backingEvents: number }> {
  const c = job.chart;
  const part = findPart(c, job.difficulty, job.ringers) ?? c.parts[0];
  const seconds = Math.min(job.maxSeconds, LEAD + c.timing.durationSec + 2.5);
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  const mixer: Mixer = { ctx, connect: (n) => (n.connect(bus), () => n.disconnect()) };
  let backingEvents = 0;
  if (job.backing) {
    const track = new BackingTrack(mixer, c, partBellNotes(c, part), { enabled: true, volume: 0.5, countIn: false });
    for (const e of track.scheduled()) if (LEAD + e.time < seconds) { e.play(LEAD + e.time); backingEvents++; }
  }
  if (job.amt?.length) {
    const synth = new BackingSynth(ctx);
    synth.setVolume(0.5);
    synth.output.connect(bus);
    for (const n of job.amt) {
      if (LEAD + n.time >= seconds) continue;
      const vel = Math.min(1, 0.35 + n.vel / 160);
      const e: BackingEvent = n.midi < 52
        ? { time: n.time, inst: 'bass', vel, dur: Math.max(0.12, n.dur), midi: n.midi }
        : { time: n.time, inst: 'pad', vel, dur: Math.max(0.12, n.dur), midis: [n.midi], tone: 'warm' };
      synth.play(e, LEAD + n.time);
      backingEvents++;
    }
  }
  const cache = new Map<number, AudioBuffer>();
  let bellNotes = 0;
  for (const n of part.notes) {
    if (LEAD + n.time >= seconds) continue;
    const midi = (c.bells.find((b) => b.id === n.bell)?.midi ?? 60) + 12; // handbells sound an octave above written
    let b = cache.get(midi);
    if (!b) {
      const d = renderBell(SR, 440 * Math.pow(2, (midi - 69) / 12));
      b = ctx.createBuffer(1, d.length, SR);
      b.copyToChannel(d, 0);
      cache.set(midi, b);
    }
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(bus);
    src.start(LEAD + n.time);
    bellNotes++;
  }
  const out = (await ctx.startRendering()).getChannelData(0);
  // Loudness-match the clips (RMS −20 dBFS), then keep the peak under −0.5 dBFS.
  let ss = 0;
  let peak = 0;
  for (const x of out) { ss += x * x; peak = Math.max(peak, Math.abs(x)); }
  const rms = Math.sqrt(ss / out.length);
  let gain = 0.1 / Math.max(1e-6, rms);
  if (peak * gain > 0.94) gain = 0.94 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { name: job.name, seconds: Math.round(seconds * 10) / 10, wav: wav16(out), rmsDb: Math.round(20 * Math.log10(rms * gain) * 10) / 10, peak: Math.round(peak * gain * 1000) / 1000, bellNotes, amtNotes: job.amt?.length ?? 0, backingEvents };
}

async function main(): Promise<void> {
  const jobs = (window as unknown as { __jobs: Job[] }).__jobs;
  const results = [];
  for (const j of jobs) results.push(await render(j));
  (window as unknown as { __out: unknown }).__out = { userAgent: navigator.userAgent, sampleRate: SR, results };
  document.title = 'RENDER_DONE';
}

main().catch((e) => {
  (window as unknown as { __out: unknown }).__out = { error: String((e as Error)?.stack ?? e) };
  document.title = 'RENDER_DONE';
});
