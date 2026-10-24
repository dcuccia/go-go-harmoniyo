// One backing track for one play-through: generated events + count-in, wrapped as Session
// `extraEvents` so they are scheduled on the AudioContext clock with the chart (one timeline:
// no drift between backing, bells, highways and judging).
import { exclusionsFrom, generateBacking, resolveStyle, type BackingEvent, type BellNote, type StylePreset } from './patterns';
import { BackingSynth } from './synth';
import { backingTimeline, countIn, type Click, type HarmonyChart, type Timeline } from './timeline';

/** What the track needs from the audio engine (S4 AudioEngine, or a stub over an OfflineAudioContext). */
export interface Mixer {
  readonly ctx: BaseAudioContext;
  connect(node: AudioNode, reverb?: number): () => void;
}

export interface BackingSettings {
  /** Backing groove on/off. */
  enabled: boolean;
  /** 0..1 (lobby slider / 100). */
  volume: number;
  /** Count-in clicks before the song. */
  countIn: boolean;
}

export const DEFAULT_BACKING: BackingSettings = { enabled: true, volume: 0.5, countIn: true };
export const MIN_LEAD_IN = 3;
const CLICK_LEVEL = 0.55;
const REVERB = 0.18;

export interface ScheduledEvent {
  time: number;
  play: (when: number) => void;
}

export class BackingTrack {
  readonly timeline: Timeline | null;
  readonly style: StylePreset | null;
  readonly events: BackingEvent[];
  readonly clicks: Click[];
  /** Seconds from start() to song time 0: room for the count-in. */
  readonly leadIn: number;
  private synth: BackingSynth | null = null;
  private disconnect: (() => void) | null = null;

  constructor(
    private readonly mixer: Mixer,
    chart: HarmonyChart & { song?: { id?: string } },
    bellNotes: BellNote[],
    readonly settings: BackingSettings,
  ) {
    this.timeline = backingTimeline(chart);
    this.style = this.timeline ? resolveStyle(this.timeline) : null;
    this.events = this.timeline && settings.enabled && settings.volume > 0
      ? generateBacking(this.timeline, { exclusions: exclusionsFrom(bellNotes), seed: chart.song?.id })
      : [];
    this.clicks = settings.countIn ? countIn(chart) : [];
    const first = this.clicks[0]?.time ?? 0;
    this.leadIn = Math.max(MIN_LEAD_IN, -first + 1);
  }

  /** Session extraEvents (song time → play at an exact context time). */
  scheduled(): ScheduledEvent[] {
    if (!this.events.length && !this.clicks.length) return [];
    const synth = this.ensureSynth();
    return [
      ...this.clicks.map((c) => ({ time: c.time, play: (w: number) => synth.click(w, c.accent) })),
      ...this.events.map((e) => ({ time: e.time, play: (w: number) => synth.play(e, w) })),
    ];
  }

  /** Fades out and disconnects (Esc to lobby / restart mid-song). */
  stop(): void {
    const s = this.synth;
    if (!s) return;
    const t = this.mixer.ctx.currentTime;
    for (const g of [s.output.gain, s.clickOutput.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.08);
    }
    const off = this.disconnect;
    this.synth = null;
    this.disconnect = null;
    setTimeout(() => off?.(), 150);
  }

  private ensureSynth(): BackingSynth {
    if (this.synth) return this.synth;
    const s = new BackingSynth(this.mixer.ctx);
    s.setVolume(this.settings.volume);
    s.setClickVolume(CLICK_LEVEL);
    const a = this.mixer.connect(s.output, REVERB);
    const b = this.mixer.connect(s.clickOutput, 0);
    this.disconnect = () => {
      a();
      b();
    };
    this.synth = s;
    return s;
  }
}
