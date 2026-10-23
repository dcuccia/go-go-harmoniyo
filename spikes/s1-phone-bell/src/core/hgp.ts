/**
 * Handbell Gesture Protocol (HGP) v0 — message types as implemented by the S1 spike.
 * Normative-ish description: docs/protocol/hgp-v0.md. JSON text frames; unknown fields ignored.
 *
 * Clocks:
 *  - "device time" (t, t0, t3): device monotonic ms (browser performance.now()).
 *  - "host time" (th, t1, t2, start, at): host monotonic ms. The host maps host time to its
 *    audio clock internally; devices never see the audio clock.
 */

export const HGP_VERSION = 0;

export type DeviceKind = 'phone' | 'bell' | 'keyboard' | 'midi' | 'listener' | 'dashboard' | 'meter' | 'sim';

/** Gesture vocabulary (v0 implements ring + tap/impact; the rest are reserved names). */
export type GestureType =
  | 'ring'
  | 'damp'
  | 'tap'
  | 'impact'
  | 'lv'
  | 'shake'
  | 'martellato'
  | 'martellato-lift'
  | 'pluck'
  | 'thumb-damp'
  | 'echo'
  | 'swing'
  | 'gyro'
  | 'mallet';

export type SoundMode = 'device' | 'host' | 'both' | 'none';
export type TestKind = 'metronome' | 'idle' | 'clink' | 'latency';
export type DetectMode = 'ring' | 'impact';

export interface Bell {
  /** Stable id, e.g. scientific pitch "C5" or "C5+D5" for a pair. */
  id: string;
  label: string;
  midi: number;
  color: string;
}

// ── device → host ────────────────────────────────────────────────────────────

export interface Hello {
  type: 'hello';
  v: number;
  deviceId: string;
  kind: DeviceKind;
  name?: string;
  app?: string;
  ua?: string;
  sensors?: { api: 'devicemotion' | 'generic-sensor' | 'none'; rateHz?: number; gyro?: boolean };
  gestures?: GestureType[];
  /** Device can play sound locally. */
  sound?: boolean;
}

export interface SyncReq {
  type: 'sync';
  id: number;
  t0: number;
}

export interface Gesture {
  type: 'gesture';
  /** Per-connection sequence number (loss detection). */
  seq: number;
  g: GestureType;
  /** Source timestamp of the physical gesture, device time. */
  t: number;
  /** Same instant mapped to host time by the device's clock sync. */
  th?: number;
  /** Device's estimate of |th| uncertainty, ms. */
  err?: number;
  bell?: string;
  /** Device time at which `bell` became the selected bell (multi-bell devices). */
  sel?: number;
  /** 0..1 */
  vel?: number;
  /** Detection delay = (time the event was emitted) - t, ms. */
  det?: number;
  /** Which input produced it: 'motion' | 'touch' | 'key' | ... */
  src?: string;
}

export interface Status {
  type: 'status';
  api?: string;
  rateHz?: number;
  offset?: number;
  drift?: number;
  rttMin?: number;
  rttP50?: number;
  syncN?: number;
  transport?: string;
  visible?: boolean;
  mode?: DetectMode;
  axis?: number[] | null;
  battery?: number;
}

export interface Raw {
  type: 'raw';
  /** offset (host - device) at batch time, for offline mapping. */
  off: number;
  cols: string[];
  s: number[][];
}

export interface Result {
  type: 'result';
  test: string;
  data: unknown;
}

export interface RtcSignal {
  type: 'rtc';
  sdp: string;
  kind: 'offer' | 'answer';
}

export type DeviceToHost = Hello | SyncReq | Gesture | Status | Raw | Result | RtcSignal;

// ── host → device ────────────────────────────────────────────────────────────

export interface Welcome {
  type: 'welcome';
  v: number;
  deviceId: string;
  session: string;
  hostTime: number;
}

export interface SyncRes {
  type: 'sync';
  id: number;
  t0: number;
  t1: number;
  t2: number;
}

export interface Assign {
  type: 'assign';
  /** 1–4 bells for this device, low to high. */
  bells: Bell[];
  sound: SoundMode;
  /**
   * How the device chooses among several bells: 'zones' = on-screen thumb zones select the bell,
   * the swing gives the timing (sticky: the last touched zone stays selected).
   */
  select?: 'single' | 'zones';
  /**
   * I1 YARG mode: the device's ringer seat (slot -1 = no free seat, free play). Bell i is lane i
   * of that ringer's YARG highway.
   */
  ringer?: { slot: number; title: string; song?: string };
}

export interface Config {
  type: 'config';
  mode?: DetectMode;
  record?: boolean;
  detector?: Record<string, unknown>;
  calibrate?: boolean;
}

export interface TestCmd {
  type: 'test';
  action: 'start' | 'stop';
  id: string;
  test: TestKind;
  /** metronome: first beat, host time */
  start?: number;
  period?: number;
  count?: number;
  durationMs?: number;
  /** metronome: expected bell id per beat for this device (multi-bell test). */
  expect?: string[];
}

export type HostToDevice = Welcome | SyncRes | Assign | Config | TestCmd | RtcSignal;

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function parseMessage(data: string): Record<string, unknown> & { type: string } | null {
  try {
    const m: unknown = JSON.parse(data);
    if (isObject(m) && typeof m.type === 'string') return m as Record<string, unknown> & { type: string };
  } catch {
    // ignore malformed frames
  }
  return null;
}

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEPS = [0, 2, 4, 5, 7, 9, 11];

/**
 * Default bell palette: the diatonic naturals G4–A6 (16 bells), the range most carol charts
 * need (S5). Colours walk the hue wheel so neighbours on one phone are distinct.
 */
export const DEFAULT_BELLS: Bell[] = Array.from({ length: 16 }, (_, i) => {
  const k = i + 4; // start at G4
  const octave = 4 + Math.floor(k / 7);
  const step = k % 7;
  const midi = 12 * (octave + 1) + STEPS[step];
  return { id: `${NAMES[step]}${octave}`, label: NAMES[step], midi, color: `hsl(${(i * 67) % 360} 75% 52%)` };
});

/** `n` consecutive bells starting at palette index `start` (wraps). */
export function bellBlock(start: number, n: number): Bell[] {
  return Array.from({ length: n }, (_, i) => DEFAULT_BELLS[(start + i) % DEFAULT_BELLS.length]);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
