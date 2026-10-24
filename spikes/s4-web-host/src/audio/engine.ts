import { pitchToHz } from '../core/chart';
import { renderBell, renderImpulse } from './bell';
import { AudioClock } from './clock';

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly clock: AudioClock;
  private readonly master: GainNode;
  private readonly dry: GainNode;
  private readonly send: GainNode;
  private readonly bells = new Map<number, AudioBuffer>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.clock = new AudioClock(this.ctx);
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp).connect(this.ctx.destination);
    this.dry = this.ctx.createGain();
    this.dry.connect(this.master);
    const reverb = this.ctx.createConvolver();
    const [l, r] = renderImpulse(this.ctx.sampleRate);
    const ir = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    ir.copyToChannel(l, 0);
    ir.copyToChannel(r, 1);
    reverb.buffer = ir;
    this.send = this.ctx.createGain();
    this.send.gain.value = 0.28;
    this.send.connect(reverb).connect(this.master);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /**
   * Mixes an external source (e.g. a backing-track bus) in with the bells: dry plus a `reverb`
   * send into the shared hall. Returns a function that disconnects it again.
   */
  connect(node: AudioNode, reverb = 0): () => void {
    node.connect(this.dry);
    const send = this.ctx.createGain();
    send.gain.value = reverb;
    if (reverb > 0) node.connect(send).connect(this.send);
    return () => {
      node.disconnect();
      send.disconnect();
    };
  }

  /** Pre-renders bell buffers so playback is a cheap BufferSource start. Returns ms spent. */
  prepare(pitches: Iterable<number>): number {
    const t0 = performance.now();
    for (const p of pitches) {
      if (this.bells.has(p)) continue;
      const data = renderBell(this.ctx.sampleRate, pitchToHz(p));
      const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.copyToChannel(data, 0);
      this.bells.set(p, buf);
    }
    return performance.now() - t0;
  }

  /** Plays a bell at context time `when` (0 = now). */
  bell(pitch: number, when = 0, gain = 1, pan = 0): void {
    let buf = this.bells.get(pitch);
    if (!buf) {
      this.prepare([pitch]);
      buf = this.bells.get(pitch)!;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p);
    p.connect(this.dry);
    p.connect(this.send);
    src.start(Math.max(when, 0));
  }

  /** Short woodblock-like click for calibration. */
  click(at: number, accent = false): void {
    const when = Math.max(at, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    osc.frequency.value = accent ? 1760 : 1320;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.6, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    osc.connect(g).connect(this.dry);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  info(): Record<string, number | string | boolean> {
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: Math.round((this.ctx.baseLatency || 0) * 1000 * 10) / 10,
      outputLatencyMs: Math.round((this.ctx.outputLatency || 0) * 1000 * 10) / 10,
      getOutputTimestamp: this.clock.usingOutputTimestamp,
    };
  }
}
