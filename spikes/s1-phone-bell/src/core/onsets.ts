import { summarize, type Summary } from './stats.ts';

/**
 * Offline onset analysis for the sound-latency test: a microphone records a physical knock
 * (broadband transient) followed by the bell/beep (pure tone at `toneHz`). Delay = beep − knock.
 */

export interface OnsetResult {
  knocks: number[];
  tones: number[];
  pairs: { knock: number; tone: number; delay: number }[];
  delay: Summary;
}

function goertzelTonality(x: Float32Array, start: number, n: number, coeff: number): { tonal: number; energy: number } {
  let s1 = 0;
  let s2 = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const v = x[start + i];
    e += v * v;
    const s0 = v + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return { tonal: e > 0 ? (2 * power) / (n * e) : 0, energy: e / n };
}

export function analyzeOnsets(x: Float32Array, sampleRate: number, toneHz = 2000, opts: { knockDb?: number; toneDb?: number; maxDelayMs?: number } = {}): OnsetResult {
  const hop = Math.max(1, Math.round(sampleRate / 1000));
  const toneWin = Math.round(sampleRate * 0.005);
  const coeff = 2 * Math.cos((2 * Math.PI * toneHz) / sampleRate);
  const frames = Math.floor((x.length - toneWin) / hop);
  const energy = new Float64Array(frames);
  const tonal = new Float64Array(frames);
  const toneEnergy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) e += x[f * hop + i] ** 2;
    energy[f] = e / hop;
    const g = goertzelTonality(x, f * hop, toneWin, coeff);
    tonal[f] = g.tonal;
    toneEnergy[f] = g.energy * g.tonal;
  }
  const floor = (a: Float64Array) => {
    const s = Array.from(a).sort((p, q) => p - q);
    return Math.max(1e-12, s[Math.floor(s.length * 0.5)] ?? 1e-12);
  };
  const eFloor = floor(energy);
  const tFloor = floor(toneEnergy);
  const knockThr = eFloor * 10 ** ((opts.knockDb ?? 20) / 10);
  const toneThr = tFloor * 10 ** ((opts.toneDb ?? 20) / 10);

  // A frame's tone window spans [f, f + 5 ms]; the energy crosses a low threshold as soon as the
  // tone enters the window, so the onset is at the window end. Validate tonality a bit later.
  const toneWinMs = toneWin / hop;
  const isTone = (f: number) => {
    if (toneEnergy[f] <= toneThr) return false;
    for (let k = f; k <= f + toneWinMs && k < frames; k++) if (tonal[k] > 0.5) return true;
    return false;
  };
  const tones: number[] = [];
  let last = -1e9;
  for (let f = 1; f < frames - toneWinMs; f++) {
    if (isTone(f) && !isTone(f - 1) && f - last > 250) {
      tones.push(f + toneWinMs);
      last = f;
    }
  }
  const nearTone = (f: number) => tones.some((t) => f >= t - 8 && f <= t + 120);
  const knocks: number[] = [];
  last = -1e9;
  for (let f = 1; f < frames; f++) {
    if (energy[f] > knockThr && energy[f - 1] <= knockThr && f - last > 250 && !nearTone(f)) {
      knocks.push(f);
      last = f;
    }
  }
  const maxDelay = opts.maxDelayMs ?? 500;
  const pairs: { knock: number; tone: number; delay: number }[] = [];
  for (const k of knocks) {
    const t = tones.find((x) => x > k && x - k <= maxDelay);
    if (t !== undefined) pairs.push({ knock: k, tone: t, delay: t - k });
  }
  // frame index == ms
  return { knocks, tones, pairs, delay: summarize(pairs.map((p) => p.delay)) };
}

/** 16-bit PCM mono WAV. */
export function encodeWav(x: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + x.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
  return buf;
}
