// Performance sound effects, synthesised live with Web Audio (no samples: MIT code, no media to
// register). Sparkle/chime (streak milestones), whoosh (multiplier up), a soft "boop" (miss),
// a brassy fanfare on the current chord (perfect phrase) and applause + cheers (end of song).
// Bells stay the hero: the SFX bus sits well under the bells and ducks further whenever a bell
// rings (duck()). Works on any BaseAudioContext, including OfflineAudioContext for render tests.
import { applauseShape, type SfxCue } from './director';

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const placeAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);

/** Sparkle pings: a bright major pentatonic above the handbells' strong partials. */
const SPARKLE = [100, 102, 104, 107, 109, 112];

export interface PlayOptions {
  /** Pitch classes of the chord sounding now (fanfare); default C major. */
  chord?: number[];
  /** Beat length (s) at the current tempo: the fanfare's pickup follows it (practice speed). */
  beatSec?: number;
}

export const DUCK_DB = -9;
/** Make-up gain: at the default volume the effects sit roughly 12–20 dB under one bell (npm run audio-check). */
const MAKEUP = 4;

export class SfxSynth {
  /** SFX bus (lobby volume). Connect it into the mix. */
  readonly output: GainNode;
  /** Ducking stage: dips while bells ring. */
  readonly duckGain: GainNode;
  private readonly noise: AudioBuffer;
  /** Effects still sounding, with their end time (hush() fades them). */
  private readonly groups = new Map<GainNode, number>();
  private seed = 0x9e3779b9;

  constructor(readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.output);
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x6c8e9cf5;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
  }

  /** SFX volume 0..1 (perceptual: squared; 0.5 → 0.5 gain, 1 → 2), like the backing slider. */
  setVolume(v: number, at = 0): void {
    this.output.gain.setValueAtTime(MAKEUP * 2 * Math.max(0, Math.min(1, v)) ** 2, at);
  }

  /** A bell rings at `at`: dip the SFX by DUCK_DB through the bell's attack, recover over ~0.35 s. */
  duck(at: number, depthDb = DUCK_DB, hold = 0.2, release = 0.35): void {
    const g = this.duckGain.gain;
    const depth = Math.pow(10, depthDb / 20);
    g.cancelScheduledValues(at);
    g.setTargetAtTime(depth, at, 0.006);
    g.setTargetAtTime(1, at + hold, release / 3);
  }

  /** Fade out everything playing (new song / back to the lobby). */
  hush(at = this.ctx.currentTime): void {
    for (const g of this.groups.keys()) {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0, at + 0.08);
    }
    this.groups.clear();
  }

  /** Plays a cue at context time `at`; returns its length in seconds. */
  play(cue: SfxCue, at: number, opts: PlayOptions = {}): number {
    switch (cue.kind) {
      case 'streak':
        return this.sparkle(at, cue.value >= 50 ? 3 : cue.value >= 25 ? 2 : 1);
      case 'multiplier':
        return this.whoosh(at, cue.value);
      case 'miss':
        return this.boop(at);
      case 'phrase':
        return this.fanfare(at, opts.chord ?? [0, 4, 7], opts.beatSec ?? 0.5);
      case 'applause':
        return this.applause(at, cue.value);
    }
  }

  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A gain node for one effect, tracked so hush() can fade it. */
  private group(at: number, length: number): GainNode {
    const g = this.ctx.createGain();
    g.connect(this.duckGain);
    for (const [k, end] of this.groups) if (end < this.ctx.currentTime) this.groups.delete(k);
    this.groups.set(g, at + length);
    return g;
  }

  private tone(dest: AudioNode, type: OscillatorType, f: number, at: number, peak: number, attack: number, decay: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
    return o;
  }

  private noiseBurst(dest: AudioNode, at: number, dur: number, offset: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(at, offset % 0.9);
    src.stop(at + dur);
    src.connect(dest);
    return src;
  }

  /** Streak milestone: rising sparkle pings; tiers 2–3 add a two-note chime. */
  sparkle(at: number, tier: number): number {
    const g = this.group(at, 1.2);
    const n = 3 + 2 * tier;
    for (let i = 0; i < n; i++) {
      const m = SPARKLE[Math.min(SPARKLE.length - 1, Math.floor((i * SPARKLE.length) / n))] + (this.rand() < 0.3 ? 2 : 0);
      this.tone(g, 'sine', hz(m), at + i * 0.045, 0.07, 0.002, 0.25 + 0.05 * tier);
    }
    if (tier >= 2) {
      this.tone(g, 'sine', hz(88), at + n * 0.045, 0.06, 0.002, 0.7);
      this.tone(g, 'sine', hz(92), at + n * 0.045 + 0.09, 0.06, 0.002, 0.8);
    }
    return n * 0.045 + 0.9;
  }

  /** Multiplier up: a filtered-noise sweep with a rising tone; higher multipliers sweep higher. */
  whoosh(at: number, mult: number): number {
    const g = this.group(at, 0.6);
    const len = 0.42;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(2500 + 1000 * Math.min(4, mult), at + len);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.45, at + len * 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.12);
    this.noiseBurst(bp, at, len + 0.15, at * 1.7);
    bp.connect(env).connect(g);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, at);
    o.frequency.exponentialRampToValueAtTime(660 * Math.min(4, mult) ** 0.5, at + len);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(0.025, at + len * 0.8);
    og.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.1);
    o.connect(og).connect(g);
    o.start(at);
    o.stop(at + len + 0.15);
    return len + 0.15;
  }

  /** Miss: a soft, friendly two-note "boop-boo" down a third, low and quiet. */
  boop(at: number): number {
    const g = this.group(at, 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g);
    this.tone(lp, 'triangle', hz(67), at, 0.05, 0.015, 0.14);
    this.tone(lp, 'triangle', hz(64), at + 0.13, 0.045, 0.015, 0.22);
    return 0.4;
  }

  /** Perfect phrase: a little brass "da-da-da DAA" on the current chord, under the bells' register. */
  fanfare(at: number, chord: number[], beatSec: number): number {
    const g = this.group(at, 2);
    const root = placeAbove(chord[0] ?? 0, 55);
    const tones = [...new Set(chord.map((pc) => placeAbove(pc, root)))].sort((a, b) => a - b).slice(0, 3);
    while (tones.length < 3) tones.push(tones[tones.length - 1] + 12);
    const step = Math.max(0.07, Math.min(0.13, beatSec / 4));
    const brass = (m: number, t: number, len: number, peak: number): void => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(2400, t + 0.04);
      lp.frequency.exponentialRampToValueAtTime(1100, t + len);
      const e = this.ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      e.gain.setValueAtTime(peak * 0.8, t + Math.max(0.03, len - 0.06));
      e.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.12);
      o.connect(lp).connect(e).connect(g);
      o.start(t);
      o.stop(t + len + 0.15);
    };
    tones.forEach((m, i) => brass(m, at + i * step, step * 0.8, 0.045));
    const hold = 0.55;
    for (const m of [tones[0], tones[1], tones[2], tones[0] + 12]) brass(m, at + 3 * step, hold, 0.028);
    return 3 * step + hold + 0.15;
  }

  /** End of song: claps (denser and longer with accuracy) and, for a great run, cheering whistles. */
  applause(at: number, accuracy: number): number {
    const shape = applauseShape(accuracy);
    const g = this.group(at, shape.seconds + 0.5);
    const total = Math.round(shape.claps * shape.seconds);
    for (let i = 0; i < total; i++) {
      // The first clap starts it; then swell in, thin out over the last third.
      const u = i === 0 ? 0 : this.rand();
      const t = at + u * shape.seconds;
      const x = (t - at) / shape.seconds;
      const density = i === 0 ? 1 : Math.min(1, x / 0.1) * (x > 0.66 ? (1 - x) / 0.34 : 1);
      if (this.rand() > density) continue;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + 1800 * this.rand();
      bp.Q.value = 1.2;
      const e = this.ctx.createGain();
      const peak = shape.gain * (0.1 + 0.12 * this.rand());
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(peak, t + 0.002);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      this.noiseBurst(bp, t, 0.035, i * 0.173);
      bp.connect(e).connect(g);
    }
    if (shape.cheer) {
      for (let k = 0; k < 3; k++) {
        const t = at + 0.3 + k * 0.55 + 0.2 * this.rand();
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(1400 + 200 * k, t);
        o.frequency.exponentialRampToValueAtTime(2300 + 150 * k, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(1900, t + 0.5);
        const e = this.ctx.createGain();
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(e).connect(g);
        o.start(t);
        o.stop(t + 0.6);
      }
    }
    return shape.seconds + 0.1;
  }
}
