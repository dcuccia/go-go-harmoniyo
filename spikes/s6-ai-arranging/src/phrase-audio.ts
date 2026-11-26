import { createHash } from 'node:crypto';
import type { Evaluation, Excerpt } from './phrase-score.ts';

const RATE = 24000;
const TARGET_DBFS = -21;
const PARTIALS = [[1, 1, 0.62], [2.01, 0.32, 0.34], [2.76, 0.18, 0.22], [4.07, 0.10, 0.14]];

export function auditionOrder<T extends { id: string }>(song: string, variants: T[]) {
  const hash = (id: string) => createHash('sha256').update(`s6-audition-4152/${song}/${id}`).digest('hex');
  return [...variants].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
    .map((variant, i) => ({ ...variant, label: String.fromCharCode(65 + i) }));
}

export function renderWav(excerpt: Excerpt, candidate: Evaluation) {
  const { score, fixed } = excerpt;
  const secPerTick = score.tempos[0].usPerQuarter / (score.ppq * 1e6);
  const samples = new Float64Array(Math.ceil((score.endTick * secPerTick + 1.25) * RATE));
  for (const note of fixed.concat(candidate.line)) {
    const start = Math.round(note.tick * secPerTick * RATE);
    const duration = note.dur * secPerTick;
    const freq = 440 * 2 ** ((note.midi - 69) / 12);
    const gain = note.role === 'melody' ? 0.85 : note.role === 'descant' ? 0.49 : note.role === 'bass' ? 0.42 : 0.33;
    const length = Math.min(samples.length - start, Math.round((duration + 0.25) * RATE));
    for (let i = 0; i < length; i++) {
      const t = i / RATE;
      let sum = 0;
      for (const [ratio, amplitude, decay] of PARTIALS) {
        if (freq * ratio < RATE / 2) sum += amplitude * Math.sin(2 * Math.PI * freq * ratio * t) * Math.exp(-t / decay);
      }
      samples[start + i] += gain * sum * Math.min(1, t / 0.006) * Math.exp(-Math.max(0, t - duration) / 0.055);
    }
  }
  let square = 0;
  let peak = 0;
  for (const x of samples) { square += x * x; peak = Math.max(peak, Math.abs(x)); }
  if (!peak) throw new Error('Cannot normalize a silent excerpt');
  const rms = Math.sqrt(square / samples.length);
  const scale = 10 ** (TARGET_DBFS / 20) / rms;
  if (peak * scale > 10 ** (-1 / 20)) throw new Error('Cannot level-match this excerpt below the -1 dBFS peak ceiling');
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => wav.writeInt16LE(Math.round(v * scale * 32767), 44 + i * 2));
  return wav;
}
