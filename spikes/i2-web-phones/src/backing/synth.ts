// Original procedural voices; no recorded samples. Also runs in OfflineAudioContext.
import type { BackingEvent, PadTone } from './patterns';

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const FLOOR = 0.0001;
const NOISE_SEC = 0.3;
const ACCOMPANIMENT_LEVEL = 0.76;

const spectra = {
  felt: [0, 1, 0.31, 0.13, 0.055, 0.022],
  nylon: [0, 1, 0.46, 0.24, 0.08, 0.045],
  bass: [0, 1, 0.63, 0.18, 0.08],
};
type Wave = keyof typeof spectra;
const tables = new WeakMap<BaseAudioContext, { waves: Partial<Record<Wave, PeriodicWave>>; noise?: AudioBuffer }>();

export class BackingSynth {
  readonly output: GainNode;
  readonly clickOutput: GainNode;
  private readonly table: { waves: Partial<Record<Wave, PeriodicWave>>; noise?: AudioBuffer };

  constructor(readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
    this.clickOutput = ctx.createGain();
    this.table = tables.get(ctx) ?? { waves: {} };
    tables.set(ctx, this.table);
  }

  setVolume(v: number, at = 0): void {
    this.output.gain.setValueAtTime(2 * ACCOMPANIMENT_LEVEL * Math.max(0, Math.min(1, v)) ** 2, at);
  }

  setClickVolume(v: number, at = 0): void {
    this.clickOutput.gain.setValueAtTime(Math.max(0, Math.min(1, v)), at);
  }

  play(e: BackingEvent, when: number): void {
    switch (e.inst) {
      case 'tap': return this.tap(when, e.vel);
      case 'brush': return this.brush(when, e.time, e.vel, e.dur);
      case 'shake': return this.brush(when, e.time, e.vel, undefined, true);
      case 'bass': return this.string(when, e.dur ?? 0.5, e.midi ?? 40, e.vel, 'bass');
      case 'tag': return this.string(when, e.dur ?? 0.5, e.midi ?? 60, e.vel, 'nylon');
      case 'pad':
      case 'stab': {
        const midis = e.midis ?? [];
        for (const midi of midis) this.string(when, e.dur ?? 0.5, midi, e.vel / Math.sqrt(midis.length), e.tone ?? 'felt');
      }
    }
  }

  private string(t: number, dur: number, midi: number, vel: number, tone: PadTone | 'bass'): void {
    const bass = tone === 'bass';
    const felt = tone === 'felt';
    const length = Math.min(dur, bass ? 1.65 : felt ? 1.9 : 1.05);
    const attack = bass ? 0.011 : felt ? 0.009 : 0.006;
    const pivot = Math.min(length * 0.5, bass ? 0.19 : felt ? 0.13 : 0.075);
    const peak = vel * (bass ? 0.53 : 0.30);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak * (bass ? 0.46 : felt ? 0.34 : 0.28)), t + pivot);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + length);

    const f = hz(midi);
    const o = this.ctx.createOscillator();
    const partials = spectra[tone];
    o.setPeriodicWave(this.table.waves[tone] ??= this.ctx.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials)));
    o.frequency.value = f;
    o.connect(g).connect(this.output);
    o.start(t);
    o.stop(t + length);

    // A very small, quickly damped body transient softens the periodic "organ" sound.
    const body = this.ctx.createOscillator();
    const bodyEnd = t + Math.min(length, bass ? 0.045 : 0.029);
    const bodyGain = this.ctx.createGain();
    body.frequency.value = bass ? 146 : f * (felt ? 2.003 : 3.005);
    bodyGain.gain.setValueAtTime(FLOOR, t);
    bodyGain.gain.linearRampToValueAtTime(peak * 0.12, t + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(FLOOR, bodyEnd);
    body.connect(bodyGain).connect(this.output);
    body.start(t);
    body.stop(bodyEnd);
  }

  private tap(t: number, vel: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(69, t + 0.053);
    o.connect(this.envelope(t, 0.23 * vel, 0.004, 0.12)).connect(this.output);
    o.start(t);
    o.stop(t + 0.12);
  }

  private brush(t: number, songTime: number, vel: number, dur = 0.17, shake = false): void {
    if (!this.table.noise) {
      const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * NOISE_SEC), this.ctx.sampleRate);
      const d = buffer.getChannelData(0);
      let n = 0x2545f491;
      for (let i = 0; i < d.length; i++) {
        n ^= n << 13;
        n ^= n >>> 17;
        n ^= n << 5;
        d[i] = (n >>> 0) / 2147483648 - 1;
      }
      this.table.noise = buffer;
    }
    const length = shake ? 0.11 : Math.min(dur, 0.42);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = shake ? 3400 : 1550;
    filter.Q.value = 0.9;
    const src = this.ctx.createBufferSource();
    src.buffer = this.table.noise;
    src.loop = true;
    src.connect(filter).connect(this.envelope(t, (shake ? 0.16 : 0.21) * vel, shake ? 0.006 : length * 0.35, length)).connect(this.output);
    src.start(t, (songTime * 3.1) % NOISE_SEC);
    src.stop(t + length);
  }

  private envelope(t: number, peak: number, attack: number, length: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(Math.max(FLOOR, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + length);
    return g;
  }

  click(t: number, accent: boolean): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 1660 : 1180, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 1250 : 900, t + 0.04);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.42, t + 0.001);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.071);
    o.connect(g).connect(this.clickOutput);
    o.start(t);
    o.stop(t + 0.1);
  }
}
