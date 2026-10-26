// Web Audio voices for the procedural backing: kick, brushy snare, brush, hi-hat, toms, soft
// crash, sleigh bells, bass, organ / warm pad / strings, celesta, glockenspiel and the count-in
// woodblock. Everything is synthesised live (no samples), so the sound is ours (MIT code, no
// media to register). Works on any BaseAudioContext, including OfflineAudioContext for render
// tests. Voices are independent methods: add a timbre here and reference it from styles.ts.
import type { BackingEvent, PadTone } from './patterns';

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export class BackingSynth {
  /** Backing bus (style volume). Connect it into the mix. */
  readonly output: GainNode;
  /** Count-in clicks: their own level, so a count-in works with the backing off. */
  readonly clickOutput: GainNode;
  private readonly drums: GainNode;
  private readonly sleighBus: AudioNode;
  private readonly bassBus: AudioNode;
  private readonly padBus: AudioNode;
  /** Celesta + glockenspiel: kept quiet and a little dark so they never sound like the handbells. */
  private readonly keysBus: AudioNode;
  private readonly noise: AudioBuffer;
  private jingle = 0;

  constructor(readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
    this.clickOutput = ctx.createGain();
    this.drums = ctx.createGain();
    this.drums.connect(this.output);

    // Sleigh bells live above the handbells' strong partials: band-limited to ~5–12 kHz.
    const sleighHp = ctx.createBiquadFilter();
    sleighHp.type = 'highpass';
    sleighHp.frequency.value = 4800;
    sleighHp.Q.value = 0.7;
    sleighHp.connect(this.output);
    this.sleighBus = sleighHp;

    const bassLp = ctx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 750;
    bassLp.Q.value = 0.6;
    bassLp.connect(this.output);
    this.bassBus = bassLp;

    // Pad stays under the bells: low-passed and slightly scooped where bell fundamentals sit.
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 1700;
    padLp.Q.value = 0.5;
    const padDip = ctx.createBiquadFilter();
    padDip.type = 'peaking';
    padDip.frequency.value = 900;
    padDip.Q.value = 0.8;
    padDip.gain.value = -4;
    padLp.connect(padDip).connect(this.output);
    this.padBus = padLp;

    const keysLp = ctx.createBiquadFilter();
    keysLp.type = 'lowpass';
    keysLp.frequency.value = 6000;
    keysLp.Q.value = 0.5;
    const keysGain = ctx.createGain();
    keysGain.gain.value = 0.7;
    keysLp.connect(keysGain).connect(this.output);
    this.keysBus = keysLp;

    // Deterministic white noise (same render every time).
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
  }

  /** Backing volume 0..1 (perceptual: squared; 0.5 → 0.5 gain, 1 → 2). */
  setVolume(v: number, at = 0): void {
    this.output.gain.setValueAtTime(2 * Math.max(0, Math.min(1, v)) ** 2, at);
  }

  setClickVolume(v: number, at = 0): void {
    this.clickOutput.gain.setValueAtTime(Math.max(0, Math.min(1, v)), at);
  }

  play(e: BackingEvent, when: number): void {
    switch (e.inst) {
      case 'kick':
        return this.kick(when, e.vel);
      case 'snare':
        return this.snare(when, e.vel);
      case 'brush':
        return this.brush(when, e.vel, e.dur);
      case 'hat':
        return this.hat(when, e.vel);
      case 'tom':
        return this.tom(when, e.vel, e.midi ?? 50);
      case 'crash':
        return this.crash(when, e.vel);
      case 'celesta':
        return this.celesta(when, e.dur ?? 0.5, e.midi ?? 72, e.vel);
      case 'glock':
        return this.glock(when, e.dur ?? 0.8, e.midi ?? 84, e.vel);
      case 'sleigh':
        return this.sleigh(when, e.vel, false);
      case 'shake':
        return this.sleigh(when, e.vel, true);
      case 'bass':
        return this.bass(when, e.dur ?? 0.5, e.midi ?? 40, e.vel);
      case 'pad':
      case 'stab':
        return this.pad(when, e.dur ?? 1, e.midis ?? [], e.vel, e.tone ?? 'organ');
    }
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private noiseSource(t: number, dur: number, offset: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, offset % 0.9);
    src.stop(t + dur);
    return src;
  }

  kick(t: number, vel: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = this.env(t, 0.75 * vel, 0.004, 0.3);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.36);
  }

  snare(t: number, vel: number): void {
    // Soft, brushy snare: band-passed noise plus a short body tone.
    const src = this.noiseSource(t, 0.22, t * 7.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.7;
    const g = this.env(t, 0.32 * vel, 0.003, 0.17);
    src.connect(bp).connect(g).connect(this.drums);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.07);
    const og = this.env(t, 0.18 * vel, 0.002, 0.08);
    o.connect(og).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** A brush stroke; with `swell` seconds, a long swirl that grows into the next downbeat (fill). */
  brush(t: number, vel: number, swell?: number): void {
    const long = swell !== undefined && swell > 0.25;
    const dur = long ? swell + 0.1 : 0.2;
    const src = this.noiseSource(t, dur, t * 3.1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3400;
    bp.Q.value = 0.5;
    const g = long ? this.env(t, 0.2 * vel, swell * 0.85, 0.12) : this.env(t, 0.16 * vel, 0.025, 0.14);
    src.connect(bp).connect(g).connect(this.drums);
  }

  /** Closed hi-hat: a tick of high-passed noise. */
  hat(t: number, vel: number): void {
    const src = this.noiseSource(t, 0.06, t * 5.7);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = this.env(t, 0.13 * vel, 0.001, 0.035);
    src.connect(hp).connect(g).connect(this.drums);
  }

  /** Tom: a pitched membrane drop (fills). */
  tom(t: number, vel: number, midi: number): void {
    const f = hz(midi);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = this.env(t, 0.5 * vel, 0.003, 0.22);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.28);
  }

  /** Soft cymbal swell on a phrase's first downbeat: high-passed, slow decay, kept low. */
  crash(t: number, vel: number): void {
    const src = this.noiseSource(t, 1.4, t * 2.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 8200;
    bp.Q.value = 0.4;
    const g = this.env(t, 0.1 * vel, 0.004, 1.3);
    src.connect(bp).connect(g).connect(this.sleighBus);
  }

  /** Celesta: a struck metal bar with a felt hammer (fundamental + weak 4th partial, ~1 s decay). */
  celesta(t: number, dur: number, midi: number, vel: number): void {
    const f = hz(midi);
    const decay = Math.max(0.5, Math.min(1.2, dur * 1.5));
    for (const [mult, amp, d] of [[1, 1, decay], [4, 0.18, decay * 0.3], [2, 0.08, decay * 0.5]] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f * mult;
      const g = this.env(t, 0.09 * vel * amp, 0.003, d);
      o.connect(g).connect(this.keysBus);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  /** Glockenspiel: a bright steel bar (inharmonic bar modes 1 : 2.76 : 5.4), quiet. */
  glock(t: number, dur: number, midi: number, vel: number): void {
    const f = hz(midi);
    const decay = Math.max(0.4, Math.min(2.5, dur));
    for (const [mult, amp, d] of [[1, 1, decay], [2.76, 0.25, decay * 0.35], [5.4, 0.1, decay * 0.15]] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f * mult;
      const g = this.env(t, 0.07 * vel * amp, 0.001, d);
      o.connect(g).connect(this.keysBus);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  /** A cluster of tiny jingles; `long` = a shake (more jingles, a little crescendo). */
  sleigh(t: number, vel: number, long: boolean): void {
    const k = this.jingle++;
    const n = long ? 7 : 3;
    const span = long ? 0.13 : 0.028;
    const dur = span + 0.09;
    const src = this.noiseSource(t, dur, k * 0.137);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7600 + (k % 3) * 450;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    const times = Array.from({ length: n }, (_, i) => t + (span * (i + 0.3 * ((((k + i) * 7) % 5) / 5))) / Math.max(1, n - 1));
    times.forEach((ti, i) => {
      const shape = long ? Math.sin(((i + 1) / (n + 1)) * Math.PI) : 1 - i * 0.25;
      const decay = i + 1 < n ? Math.min(0.045, (times[i + 1] - ti) * 0.9) : 0.06;
      g.gain.setValueAtTime(0.0001, ti);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.55 * vel * shape), ti + Math.min(0.002, decay / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, ti + decay);
    });
    src.connect(bp).connect(g).connect(this.sleighBus);
    // Metallic shimmer: a few inharmonic high partials ring briefly.
    for (const [f, a] of [[5230, 0.07], [6890, 0.05], [9120, 0.035]] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f * (1 + ((k % 5) - 2) * 0.004);
      const og = this.env(t, a * vel, 0.002, long ? 0.2 : 0.08);
      o.connect(og).connect(this.sleighBus);
      o.start(t);
      o.stop(t + (long ? 0.24 : 0.11));
    }
  }

  bass(t: number, dur: number, midi: number, vel: number): void {
    const f = hz(midi);
    const g = this.ctx.createGain();
    const peak = 0.42 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, t + 0.25);
    const end = t + Math.max(0.1, dur);
    const hold = Math.max(t + 0.25, end - 0.06);
    g.gain.setValueAtTime(peak * 0.55, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, hold + 0.08);
    g.connect(this.bassBus);
    for (const [type, mult, amp] of [['triangle', 1, 1], ['sine', 2, 0.25]] as const) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const og = this.ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(hold + 0.1);
    }
  }

  pad(t: number, dur: number, midis: number[], vel: number, tone: PadTone): void {
    if (!midis.length) return;
    const warm = tone === 'warm';
    const strings = tone === 'strings';
    const attack = warm ? Math.min(0.5, dur * 0.3) : strings ? Math.min(0.35, dur * 0.25) : 0.02;
    const release = warm ? 0.6 : strings ? 0.45 : 0.12;
    const peak = (0.16 * vel) / Math.sqrt(midis.length);
    const end = t + Math.max(attack + 0.02, dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, end - 0.01);
    g.gain.linearRampToValueAtTime(0, end + release);
    g.connect(this.padBus);
    const partials: readonly (readonly [OscillatorType, number, number, number])[] = warm
      ? [['sawtooth', 1, 0.5, -6], ['sawtooth', 1, 0.5, 6], ['sine', 0.5, 0.4, 0]]
      : strings
        ? [['sawtooth', 1, 0.4, -9], ['sawtooth', 1, 0.4, 0], ['sawtooth', 1, 0.4, 9]]
        : [['sine', 1, 1, 0], ['sine', 2, 0.45, 0], ['sine', 3, 0.18, 0], ['sine', 4, 0.1, 0]];
    // Strings: a slow, shallow vibrato shared by the section.
    let vib: AudioNode | null = null;
    if (strings) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(7, t + Math.min(0.6, dur));
      lfo.connect(depth);
      lfo.start(t);
      lfo.stop(end + release + 0.05);
      vib = depth;
    }
    for (const m of midis) {
      for (const [type, mult, amp, cents] of partials) {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(m) * mult;
        o.detune.value = cents;
        if (vib) vib.connect(o.detune);
        const og = this.ctx.createGain();
        og.gain.value = amp;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(end + release + 0.05);
      }
    }
  }

  /** Woodblock-like count-in click (accent = downbeat). */
  click(t: number, accent: boolean): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 1660 : 1180, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 1250 : 900, t + 0.04);
    const g = this.env(t, accent ? 0.6 : 0.42, 0.001, 0.07);
    o.connect(g).connect(this.clickOutput);
    o.start(t);
    o.stop(t + 0.1);
  }
}
