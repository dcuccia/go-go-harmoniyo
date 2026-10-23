import type { GestureSink, InputSource } from './types';

/** Home-row keys, left to right. Digits 1–8 are an alternative. */
export const LANE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Semicolon') return ';';
  if (code === 'Space') return 'Space';
  return code;
}

export function laneKeys(laneCount: number): string[] {
  return laneCount === 1 ? ['Space'] : LANE_KEYS.slice(0, laneCount);
}

/**
 * Keyboard bells. `KeyboardEvent.timeStamp` is a DOMHighResTimeStamp on the same timeline as
 * performance.now(), so it is used directly as the gesture's source time (it is taken when the
 * browser received the OS event, before main-thread dispatch delay).
 */
export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private handler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly laneCount: number, private readonly anyKeyLane: number | null = null) {}

  start(sink: GestureSink): void {
    const keys = laneKeys(this.laneCount);
    this.handler = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      let lane = keys.indexOf(e.code);
      if (lane < 0) lane = DIGIT_KEYS.indexOf(e.code);
      if (lane < 0 && this.anyKeyLane !== null && (e.code === 'Space' || e.code.startsWith('Key'))) lane = this.anyKeyLane;
      if (lane < 0 || lane >= this.laneCount) return;
      e.preventDefault();
      sink({
        source: this.id,
        deviceId: 'keyboard-0',
        gesture: 'ring',
        lane,
        hostTimeMs: e.timeStamp,
        receivedAtMs: performance.now(),
      });
    };
    window.addEventListener('keydown', this.handler);
  }

  stop(): void {
    if (this.handler) window.removeEventListener('keydown', this.handler);
    this.handler = null;
  }
}
