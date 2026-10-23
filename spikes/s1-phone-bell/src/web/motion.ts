import type { MotionSample } from '../core/ring-detector.ts';
import { summarize } from '../core/stats.ts';

export type MotionApi = 'devicemotion' | 'generic-sensor';

/**
 * Motion sensor source. Prefers `DeviceMotionEvent` everywhere (iOS has nothing else);
 * on Chromium, `?api=generic` uses the Generic Sensor API whose readings carry the sensor
 * timestamp rather than the event-dispatch time.
 */
export class MotionSource {
  api: MotionApi | 'none' = 'none';
  hasGyro = false;
  onSample: (s: MotionSample) => void = () => {};
  private times: number[] = [];
  private intervals: number[] = [];
  private gravity: [number, number, number] | null = null;
  /** handler time − event timestamp, ms (event delivery delay on the main thread) */
  private dispatchLag: number[] = [];
  private stopFn: (() => void) | null = null;

  /** iOS 13+: must be called from a user gesture. */
  static async requestPermission(): Promise<string> {
    const DME = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DME) return 'unsupported';
    if (typeof DME.requestPermission === 'function') return DME.requestPermission();
    return 'not-required';
  }

  async start(prefer: 'auto' | 'devicemotion' | 'generic', hz = 60): Promise<MotionApi | 'none'> {
    this.stop();
    if (prefer === 'generic' && (await this.startGeneric(hz))) return this.api;
    if ('DeviceMotionEvent' in window) {
      this.startDeviceMotion();
      return this.api;
    }
    return 'none';
  }

  stop(): void {
    this.stopFn?.();
    this.stopFn = null;
  }

  private emit(s: MotionSample, handlerTime: number): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined) {
      this.intervals.push(s.t - last);
      if (this.intervals.length > 600) this.intervals.shift();
    }
    this.times.push(s.t);
    while (this.times.length > 0 && s.t - this.times[0] > 2000) this.times.shift();
    this.dispatchLag.push(handlerTime - s.t);
    if (this.dispatchLag.length > 600) this.dispatchLag.shift();
    if (Number.isFinite(s.gx)) this.hasGyro = true;
    this.onSample(s);
  }

  private startDeviceMotion(): void {
    this.api = 'devicemotion';
    const onMotion = (e: DeviceMotionEvent) => {
      const now = performance.now();
      // event.timeStamp is a DOMHighResTimeStamp on the performance.now() origin in current browsers.
      const t = Number.isFinite(e.timeStamp) && Math.abs(now - e.timeStamp) < 1000 ? e.timeStamp : now;
      let ax = NaN;
      let ay = NaN;
      let az = NaN;
      const a = e.acceleration;
      if (a && a.x !== null && a.y !== null && a.z !== null) {
        ax = a.x;
        ay = a.y;
        az = a.z;
      } else {
        const g = e.accelerationIncludingGravity;
        if (g && g.x !== null && g.y !== null && g.z !== null) {
          const cur: [number, number, number] = [g.x, g.y, g.z];
          this.gravity = this.gravity ? (this.gravity.map((v, i) => v + 0.1 * (cur[i] - v)) as [number, number, number]) : cur;
          ax = cur[0] - this.gravity[0];
          ay = cur[1] - this.gravity[1];
          az = cur[2] - this.gravity[2];
        }
      }
      const r = e.rotationRate;
      this.emit({ t, ax, ay, az, gx: r?.beta ?? NaN, gy: r?.gamma ?? NaN, gz: r?.alpha ?? NaN }, now);
    };
    window.addEventListener('devicemotion', onMotion);
    this.stopFn = () => window.removeEventListener('devicemotion', onMotion);
  }

  private async startGeneric(hz: number): Promise<boolean> {
    type Sensor = EventTarget & { x: number; y: number; z: number; timestamp: number; start(): void; stop(): void };
    const w = window as unknown as Record<string, (new (o: object) => Sensor) | undefined>;
    const Gyro = w.Gyroscope;
    const Lin = w.LinearAccelerationSensor;
    if (!Gyro || !Lin) return false;
    try {
      const gyro = new Gyro({ frequency: hz, referenceFrame: 'device' });
      const lin = new Lin({ frequency: hz, referenceFrame: 'device' });
      const ok = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 1500);
        gyro.addEventListener('reading', () => {
          window.clearTimeout(timer);
          resolve(true);
        }, { once: true });
        gyro.addEventListener('error', () => resolve(false), { once: true });
        gyro.start();
        lin.start();
      });
      if (!ok) {
        gyro.stop();
        lin.stop();
        return false;
      }
      const RAD = 180 / Math.PI;
      const onReading = () => {
        const now = performance.now();
        this.emit({ t: gyro.timestamp, ax: lin.x ?? NaN, ay: lin.y ?? NaN, az: lin.z ?? NaN, gx: gyro.x * RAD, gy: gyro.y * RAD, gz: gyro.z * RAD }, now);
      };
      gyro.addEventListener('reading', onReading);
      this.api = 'generic-sensor';
      this.stopFn = () => {
        gyro.removeEventListener('reading', onReading);
        gyro.stop();
        lin.stop();
      };
      return true;
    } catch {
      return false;
    }
  }

  get rateHz(): number {
    if (this.times.length < 2) return 0;
    return ((this.times.length - 1) * 1000) / (this.times[this.times.length - 1] - this.times[0]);
  }

  stats() {
    const iv = summarize(this.intervals);
    const lag = summarize(this.dispatchLag);
    return { rateHz: this.rateHz, intervalP50: iv.p50, intervalP95: iv.p95, intervalMax: iv.max, intervalSd: iv.sd, dispatchLagP50: lag.p50, dispatchLagP95: lag.p95 };
  }
}
