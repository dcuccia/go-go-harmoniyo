/**
 * Web Audio helpers: unlock, handbell-ish additive synth, metronome click, and a pure test beep
 * (for the microphone latency meter). Includes perf-clock → audio-clock mapping.
 */

let ctx: AudioContext | null = null;

export function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

/**
 * Must be called from a user gesture. On iOS, `navigator.audioSession.type = 'playback'`
 * (Safari 16.4+/17) lets Web Audio play even when the ring/silent switch is on.
 */
export async function unlockAudio(): Promise<{ state: string; audioSession: string; baseLatency: number; outputLatency: number }> {
  const nav = navigator as unknown as { audioSession?: { type: string } };
  let audioSession = 'unsupported';
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
      audioSession = nav.audioSession.type;
    } catch (e) {
      audioSession = `error: ${String(e)}`;
    }
  }
  const c = audio();
  // a silent buffer kicks iOS into running state; start it synchronously inside the gesture
  const b = c.createBuffer(1, 1, c.sampleRate);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start();
  await c.resume();
  return { state: c.state, audioSession, baseLatency: c.baseLatency ?? NaN, outputLatency: (c as AudioContext & { outputLatency?: number }).outputLatency ?? NaN };
}

/** Audio-context time at which a sound must start to be *heard* at performance-time `tPerf` (ms). */
export function perfToCtx(tPerf: number): number {
  const c = audio();
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
    return ts.contextTime + (tPerf - ts.performanceTime) / 1000;
  }
  const out = (c as AudioContext & { outputLatency?: number }).outputLatency ?? c.baseLatency ?? 0;
  return c.currentTime + (tPerf - performance.now()) / 1000 - out;
}

// Handbell-like partials: strong fundamental and twelfth (3×), plus inharmonic upper modes.
const PARTIALS: [ratio: number, amp: number, decay: number][] = [
  [1, 1, 2.5],
  [3, 0.45, 1.2],
  [4.2, 0.12, 0.6],
  [5.4, 0.1, 0.4],
  [6.8, 0.05, 0.25],
];

export function bell(freq: number, when = 0, velocity = 0.8): void {
  const c = audio();
  const t = Math.max(c.currentTime, when);
  const master = c.createGain();
  master.gain.value = 0.25 * (0.4 + 0.6 * velocity);
  master.connect(c.destination);
  for (const [ratio, amp, decay] of PARTIALS) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

export function click(when = 0, accent = false): void {
  const c = audio();
  const t = Math.max(c.currentTime, when);
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1760 : 1320;
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.06);
}

export const TEST_BEEP_HZ = 2000;

/** Pure sine with a sharp attack: easy to find with the latency meter. */
export function testBeep(when = 0): void {
  const c = audio();
  const t = Math.max(c.currentTime, when);
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = TEST_BEEP_HZ;
  g.gain.setValueAtTime(0.5, t);
  g.gain.setValueAtTime(0.5, t + 0.08);
  g.gain.linearRampToValueAtTime(0, t + 0.09);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.1);
}
