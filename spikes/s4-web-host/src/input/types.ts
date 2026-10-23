// Input layer. Every source (keyboard today; HGP phones / ESP32 bells / MIDI / mic later)
// emits GestureEvents whose `hostTimeMs` is the gesture time on the host's performance.now()
// timeline. Remote sources map *source* timestamps through clock sync — never arrival time
// (ADR-0002). The game converts hostTimeMs → song time via the audio clock.

export type Gesture = 'ring' | 'damp';

export interface GestureEvent {
  /** Adapter id, e.g. 'keyboard', 'hgp-ws', 'autoplay'. */
  source: string;
  deviceId: string;
  gesture: Gesture;
  /** Bell addressed by lane index (local adapters) ... */
  lane?: number;
  /** ... or by MIDI pitch (HGP bell assignment). The game resolves pitch → lane. */
  pitch?: number;
  /** Gesture time on the host performance.now() timeline (ms). */
  hostTimeMs: number;
  /** When the host processed the event (performance.now(), ms). Diagnostics only. */
  receivedAtMs: number;
  /** Raw device timestamp (device clock, ms) for remote sources. */
  sourceTimeMs?: number;
  seq?: number;
  intensity?: number;
}

export type GestureSink = (e: GestureEvent) => void;

export interface InputSource {
  readonly id: string;
  start(sink: GestureSink): void;
  stop(): void;
}
