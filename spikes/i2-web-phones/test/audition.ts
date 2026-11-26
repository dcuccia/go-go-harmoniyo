// Optional developer audition. Never imported by the game.
import { renderBell } from '../../s4-web-host/src/audio/bell';
import { generateBacking, type BackingEvent } from '../src/backing/patterns';
import { BackingSynth } from '../src/backing/synth';
import { backingTimeline } from '../src/backing/timeline';
import { findPart, type S5Chart } from '../src/team-chart';

const RATE = 48000;
const SAMPLE_RATE = 24000;
const SAMPLE_SECONDS = 1.6;
const TIME_PAD = 0.1;
const TARGET_DB = -30;
const rms = (p: Float32Array): number => Math.sqrt(p.reduce((sum, v) => sum + v * v, 0) / p.length);
const db = (v: number): number => Math.round(200 * Math.log10(Math.max(1e-9, v))) / 10;

async function samples() {
  const keys = [48, 60], bass = [40, 48];
  return Promise.all((['felt', 'nylon', 'bass'] as const).flatMap((tone) => (tone === 'bass' ? bass : keys).map(async (midi) => {
    const ctx = new OfflineAudioContext(1, SAMPLE_RATE * SAMPLE_SECONDS, SAMPLE_RATE);
    const synth = new BackingSynth(ctx);
    synth.output.connect(ctx.destination);
    synth.play(tone === 'bass' ? { time: 0, inst: 'bass', midi, vel: 1, dur: SAMPLE_SECONDS }
      : { time: 0, inst: 'pad', midis: [midi], tone, vel: 1, dur: SAMPLE_SECONDS }, 0);
    return { tone, midi, buffer: await ctx.startRendering() };
  })));
}

function playSample(ctx: OfflineAudioContext, bank: Awaited<ReturnType<typeof samples>>, e: BackingEvent, at: number) {
  const bass = e.inst === 'bass';
  const midis = bass ? [e.midi!] : e.midis!;
  const tone = bass ? 'bass' : e.tone;
  for (const midi of midis) {
    const sample = bank.filter((s) => s.tone === tone).reduce((a, b) => Math.abs(a.midi - midi) < Math.abs(b.midi - midi) ? a : b);
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = 2 ** ((midi - sample.midi) / 12);
    const duration = Math.min(e.dur!, sample.buffer.duration / src.playbackRate.value);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(e.vel / Math.sqrt(midis.length), at);
    gain.gain.setValueAtTime(gain.gain.value, at + duration * 0.92);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    src.connect(gain).connect(ctx.destination);
    src.start(at);
    src.stop(at + duration);
  }
}

function encode(p: Float32Array, bells: Float32Array) {
  const gain = 10 ** (TARGET_DB / 20) / rms(p);
  const bytes = new Uint8Array(44 + 2 * p.length);
  const v = new DataView(bytes.buffer);
  const str = (offset: number, s: string) => bytes.set(new TextEncoder().encode(s), offset);
  str(0, 'RIFF'); v.setUint32(4, bytes.length - 8, true);
  str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, p.length * 2, true);
  let peak = 0;
  let hi = 0;
  let lp = 0;
  const cutoff = 1 - Math.exp(-2 * Math.PI * 2000 / RATE);
  for (let i = 0; i < p.length; i++) {
    const x = p[i] * gain;
    lp += cutoff * (x - lp);
    hi += (x - lp) ** 2;
    const mixed = x + bells[i];
    peak = Math.max(peak, Math.abs(mixed));
    v.setInt16(44 + 2 * i, Math.round(32767 * Math.max(-1, Math.min(1, mixed))), true);
  }
  const wav = btoa(Array.from({ length: Math.ceil(bytes.length / 16384) }, (_, i) =>
    String.fromCharCode(...bytes.subarray(i * 16384, (i + 1) * 16384))).join(''));
  return { wav, matchedDb: db(rms(p) * gain), highPassDb: db(Math.sqrt(hi / p.length)), mixedPeak: +peak.toFixed(3) };
}

export async function audition() {
  type LegacySynth = {
    output: AudioNode;
    play: (e: Omit<BackingEvent, 'tone'> & { tone?: 'organ' | 'warm' | 'strings' }, time: number) => void;
  };
  const baseline = '/audition-baseline.js';
  const { BackingSynth: OldSynth } = await import(/* @vite-ignore */ baseline) as { BackingSynth: new (ctx: OfflineAudioContext) => LegacySynth };
  const start = performance.now();
  const bank = await samples();
  const bankMs = Math.round(performance.now() - start);
  const rows = [];
  for (const [id, seconds] of [['good-king-wenceslas', 6.1], ['the-holly-and-the-ivy', 8.9]] as const) {
    const c: S5Chart = await (await fetch(`/charts/short/${id}.json`)).json();
    const length = Math.ceil((seconds + TIME_PAD) * RATE);
    const bellContext = new OfflineAudioContext(1, length, RATE);
    const part = findPart(c, 'easy', 1)!;
    const notes = [...part.notes, ...(part.guide ?? [])].filter((n) => n.time < seconds && n.role !== 'bass' && n.role !== 'inner');
    for (const n of notes) {
      const midi = c.bells.find((b) => b.id === n.bell)!.midi + 12;
      const data = renderBell(RATE, 440 * 2 ** ((midi - 69) / 12));
      const src = bellContext.createBufferSource();
      src.buffer = bellContext.createBuffer(1, data.length, RATE);
      src.buffer.copyToChannel(data, 0);
      const g = bellContext.createGain();
      g.gain.value = 0.55;
      src.connect(g).connect(bellContext.destination);
      src.start(n.time + TIME_PAD);
    }
    const bells = (await bellContext.startRendering()).getChannelData(0);
    for (const mode of ['harmony-before', 'harmony-after', 'legacy-timbre', 'sample-bank'] as const) {
      const tl = backingTimeline(c, { scoreCorrections: mode !== 'harmony-before' })!;
      // Exactly the same post-fix bass and chord events for the three timbre variants.
      const events = generateBacking(tl).filter((e) => e.time < seconds && ['pad', 'stab', 'bass'].includes(e.inst));
      const ctx = new OfflineAudioContext(1, length, RATE);
      const synth = new BackingSynth(ctx);
      const legacy = mode === 'legacy-timbre' ? new OldSynth(ctx) : null;
      (legacy ?? synth).output.connect(ctx.destination);
      for (const e of events) {
        const at = e.time + TIME_PAD;
        if (mode === 'sample-bank') playSample(ctx, bank, e, at);
        else if (legacy) legacy.play({ ...e, tone: e.tone === 'nylon' && e.inst === 'pad' ? 'strings' : 'organ' }, at);
        else synth.play(e, at);
      }
      const t = performance.now();
      const audio = (await ctx.startRendering()).getChannelData(0);
      rows.push({ id, mode, events: events.length, renderMs: Math.round(performance.now() - t), ...encode(audio, bells) });
    }
  }
  return { bankMs, sampleCount: bank.length, pcm16Bytes: bank.length * (44 + SAMPLE_RATE * SAMPLE_SECONDS * 2), decodedBytes: bank.length * SAMPLE_RATE * SAMPLE_SECONDS * 4, rows };
}
