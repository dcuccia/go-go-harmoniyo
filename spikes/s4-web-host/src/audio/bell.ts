// Additive handbell synthesis, rendered once per pitch into an AudioBuffer.
// English handbells are tuned so the fundamental and the twelfth (3rd harmonic) dominate;
// higher partials are inharmonic and decay fast. Partial ratios/decays below are hand-tuned
// by ear (self-made, no samples).

interface Partial {
  ratio: number;
  amp: number;
  /** Decay time constant (s) at C5; scaled by pitch. */
  tau: number;
  detune?: number;
}

const PARTIALS: Partial[] = [
  { ratio: 1, amp: 1.0, tau: 1.6, detune: 0.0012 },
  { ratio: 2.0, amp: 0.08, tau: 0.8 },
  { ratio: 3.0, amp: 0.55, tau: 0.9, detune: 0.0008 },
  { ratio: 4.18, amp: 0.14, tau: 0.35 },
  { ratio: 5.43, amp: 0.16, tau: 0.25 },
  { ratio: 6.79, amp: 0.08, tau: 0.16 },
  { ratio: 8.21, amp: 0.05, tau: 0.1 },
];

export function renderBell(sampleRate: number, freq: number, seconds = 3.2): Float32Array<ArrayBuffer> {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const pitchScale = Math.min(2, Math.max(0.35, Math.sqrt(523.25 / freq)));
  for (const p of PARTIALS) {
    const f = freq * p.ratio;
    if (f > sampleRate * 0.45) continue;
    const tau = p.tau * pitchScale;
    const voices = p.detune ? [1 - p.detune, 1 + p.detune] : [1];
    for (const v of voices) {
      const w = (2 * Math.PI * f * v) / sampleRate;
      const amp = p.amp / voices.length;
      const decay = Math.exp(-1 / (tau * sampleRate));
      let env = amp;
      // Recursive sine oscillator (cheaper than Math.sin per sample).
      let s1 = Math.sin(-w);
      let s2 = Math.sin(-2 * w);
      const k = 2 * Math.cos(w);
      for (let i = 0; i < n; i++) {
        const s = k * s1 - s2;
        s2 = s1;
        s1 = s;
        out[i] += s * env;
        env *= decay;
        if (env < 1e-5) break;
      }
    }
  }
  // Strike transient: short band-limited noise click.
  const clickLen = Math.floor(sampleRate * 0.012);
  let lp = 0;
  for (let i = 0; i < clickLen; i++) {
    lp += 0.35 * (Math.random() * 2 - 1 - lp);
    out[i] += lp * 0.35 * (1 - i / clickLen) ** 2;
  }
  // 2 ms attack ramp to avoid a hard edge.
  const attack = Math.floor(sampleRate * 0.002);
  for (let i = 0; i < attack; i++) out[i] *= i / attack;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.8 / peak;
  return out;
}

/** Stereo exponential-noise impulse response for a small hall. */
export function renderImpulse(sampleRate: number, seconds = 2.2, decay = 3.2): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.floor(sampleRate * seconds);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = Math.pow(1 - i / n, decay);
    l[i] = (Math.random() * 2 - 1) * e;
    r[i] = (Math.random() * 2 - 1) * e;
  }
  return [l, r];
}
