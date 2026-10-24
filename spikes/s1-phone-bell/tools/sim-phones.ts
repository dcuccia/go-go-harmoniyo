/**
 * Simulated phones + dashboard driving a running host over real WebSockets — an end-to-end
 * check of HGP framing, clock sync, test orchestration and analysis without hardware.
 *
 *   npm start -- --no-open          (in another terminal)
 *   npx tsx tools/sim-phones.ts [--url ws://127.0.0.1:8080/hgp] [--phones 2] [--bpm 150] [--count 40]
 *
 * Each fake phone has its own clock offset/drift, 60 Hz timestamp quantisation and a
 * detection delay; rings are human-jittered around the beats.
 */
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { ClockSync } from '../src/core/clock-sync.ts';
import { gauss, rng } from '../sim/synth.ts';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:8080/hgp' },
    phones: { type: 'string', default: '2' },
    bpm: { type: 'string', default: '150' },
    count: { type: 'string', default: '40' },
    clink: { type: 'string', default: '8' },
    /** Game mode: no scripted tests; ring the notes a game host cues (HGP `cues`), until --seconds. */
    game: { type: 'boolean', default: false },
    names: { type: 'string' },
    seconds: { type: 'string', default: '600' },
    miss: { type: 'string', default: '0.03' },
    jitter: { type: 'string', default: '20' },
    /** Systematic lateness of every ring, ms (to check that judging sees it). */
    late: { type: 'string', default: '0' },
    /** Game lobby (HGP `parts`): claim this part index once the lobby appears (swaps if taken). */
    claim: { type: 'string' },
    /** Game lobby: press ✓ Ready once the lobby appears. */
    ready: { type: 'boolean', default: false },
    /** Print clock diagnostics (`[diag] [...]` lines every 2 s): per phone the cue plan, rings sent, re-cues and clock-sync health. */
    diag: { type: 'boolean', default: false },
  },
});

const r = rng(99);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
/** FNV-1a: a stable 32-bit seed from a string. */
const hashSeed = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

class FakePhone {
  ws: WebSocket;
  sync = new ClockSync();
  seq = 0;
  syncId = 0;
  bells: string[] = [];
  offset = (r() - 0.5) * 1e6;
  drift = (r() - 0.5) * 100e-6;
  phase = r() * 16.7;
  timers: NodeJS.Timeout[] = [];
  constructor(readonly name: string) {
    this.ws = new WebSocket(a.url!);
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({ type: 'hello', v: 0, deviceId: `sim-${name}`, kind: 'phone', name, ua: 'sim-phone', gestures: ['ring', 'impact'] }));
      for (let i = 0; i < 10; i++) setTimeout(() => this.ping(), i * 50);
      this.timers.push(setInterval(() => this.ping(), 250));
      this.timers.push(setInterval(() => this.status(), 1000));
    });
    this.ws.on('message', (d) => this.onMessage(JSON.parse(d.toString())));
  }
  now(): number {
    return performance.now() * (1 + this.drift) + this.offset;
  }
  /** local time of a sample on this phone's 60 Hz grid at or after local time t */
  quantize(t: number): number {
    const T = 1000 / 60;
    return Math.ceil((t - this.phase) / T) * T + this.phase;
  }
  ping(): void {
    this.ws.send(JSON.stringify({ type: 'sync', id: ++this.syncId, t0: this.now() }));
  }
  status(): void {
    const e = this.sync.estimate;
    this.ws.send(JSON.stringify({ type: 'status', api: 'sim', rateHz: 60, rttMin: e?.rttMin, rttP50: e?.rttP50, syncN: e?.n, drift: e ? e.drift * 1e6 : undefined }));
  }
  gesture(g: string, hostTime: number, jitterMs: number, detMs: number, extra: Record<string, unknown> = {}, leadMs?: number, z = gauss(r), onSent?: () => void): NodeJS.Timeout {
    const tTrue = this.sync.toLocal(hostTime) + z * jitterMs;
    const t = this.quantize(tTrue) - 8; // detector back-dates to ~half a sample
    const delay = Math.max(0, (t - this.now()) / (1 + this.drift) + detMs);
    const thPlanned = this.sync.toHost(t);
    const timer = setTimeout(() => {
      const sel = leadMs !== undefined ? { sel: t - leadMs } : {};
      const th = this.sync.toHost(t);
      if (a.diag) {
        this.thShift.push(th - thPlanned);
        this.sendLate.push(this.now() - t - detMs);
      }
      this.ws.send(JSON.stringify({ type: 'gesture', seq: ++this.seq, g, t, th, det: this.now() - t, src: 'sim', ...extra, ...sel }));
      onSent?.();
    }, delay);
    this.timers.push(timer);
    return timer;
  }
  /** th at send − th planned when the cue arrived (sync estimate moving under a scheduled ring). */
  thShift: number[] = [];
  /** How late each ring left this process vs its intended send time (event-loop stalls), ms. */
  sendLate: number[] = [];
  diag(): Record<string, unknown> {
    const e = this.sync.estimate;
    const sh = this.thShift.map(Math.abs);
    const rung = this.plan.filter((p) => p.done).length;
    // Rings planned on the right bell: what a correct game must count as hits (wrong-zone rings are strays).
    const expectHits = this.plan.filter((p) => !p.skip && !(this.bells.length > 1 && p.wrong)).length;
    return { name: this.name, cues: this.plan.length, expectHits, rung, recued: this.recued, sendLateMaxMs: this.sendLate.length ? Math.round(Math.max(...this.sendLate)) : null, thShiftMaxAbs: sh.length ? Math.round(Math.max(...sh) * 100) / 100 : null, syncResets: this.sync.resets, rttMin: e ? Math.round(e.rttMin * 100) / 100 : null, used: e?.used };
  }
  onMessage(m: Record<string, unknown>): void {
    if (m.type === 'sync') {
      this.sync.add({ t0: m.t0 as number, t1: m.t1 as number, t2: m.t2 as number, t3: this.now() });
    } else if (m.type === 'assign') {
      this.bells = (m.bells as { id: string }[]).map((b) => b.id);
    } else if (m.type === 'cues' && a.game) {
      this.ringCues(m.at as number[], m.bells as string[]);
    } else if (m.type === 'parts') {
      this.onParts(m);
    } else if (m.type === 'test' && m.action === 'start') {
      if (m.test === 'metronome') {
        const expect = m.expect as string[] | undefined;
        for (let i = 0; i < (m.count as number); i++) {
          if (r() < 0.01) continue;
          const at = (m.start as number) + i * (m.period as number);
          if (!expect) {
            this.gesture('ring', at, 20, 25, { bell: this.bells[0] });
            continue;
          }
          // Thumb-zone model: touch the zone N(300, 120) ms before the strike; 3 % wrong zone.
          const wrong = r() < 0.03;
          const bell = wrong ? this.bells.find((b) => b !== expect[i]) : expect[i];
          this.gesture('ring', at, 20, 25, { bell }, 300 + gauss(r) * 120);
        }
      } else if (m.test === 'clink') {
        for (const h of clinkTimes) this.gesture('impact', h, 0, 15);
      }
    }
  }
  /** Game lobby state (HGP `parts`): optionally claim a part and press Ready, once each. */
  claimed = false;
  readied = false;
  lastPart: number | undefined;
  onParts(m: Record<string, unknown>): void {
    const you = Number(m.you);
    const parts = (m.parts as { name: string }[]) ?? [];
    if (you !== this.lastPart) {
      this.lastPart = you;
      console.log(`${this.name}: part ${you >= 0 ? `${you} ${parts[you]?.name ?? ''}` : '(none)'}`);
    }
    if (m.phase !== 'lobby') return;
    if (a.claim !== undefined && !this.claimed && you >= 0) {
      this.claimed = true;
      if (you !== Number(a.claim)) this.ws.send(JSON.stringify({ type: 'claim', part: Number(a.claim) }));
    }
    if (a.ready && !this.readied && you >= 0) {
      this.readied = true;
      this.ws.send(JSON.stringify({ type: 'ready', ready: true }));
    }
  }
  /**
   * Game mode: ring each cued note (host time) on its bell, with human jitter, misses and wrong
   * zones. The draws come from an RNG seeded by the part (its bell sequence), so a part gets the
   * same "performance" whichever phone plays it and whatever order the phones were cued in. A game
   * may re-send the cues (its clock mapping moved): notes not rung yet are rescheduled to the new
   * times with the same draws; rung ones are not repeated.
   */
  plan: { skip: boolean; wrong: boolean; z: number; lead: number; done: boolean; timer?: NodeJS.Timeout }[] = [];
  planKey = '';
  recued = 0;
  ringCues(at: number[], bells: string[]): void {
    const key = (bells ?? []).join(' ');
    if (!at?.length || key !== this.planKey) {
      for (const p of this.plan) clearTimeout(p.timer);
      this.plan = [];
      this.planKey = '';
      if (!at?.length) return;
      const pr = rng(hashSeed(key));
      this.plan = at.map(() => ({ skip: pr() < Number(a.miss), wrong: pr() < 0.03, z: gauss(pr), lead: gauss(pr), done: false }));
      this.planKey = key;
      console.log(`${this.name}: ${at.length} cues on [${[...new Set(bells)].join(' ')}], will ring ${this.plan.filter((p) => !p.skip).length}`);
    } else this.recued++;
    for (let i = 0; i < at.length; i++) {
      const p = this.plan[i];
      if (p.skip || p.done) continue;
      clearTimeout(p.timer);
      const wrong = this.bells.length > 1 && p.wrong;
      const bell = wrong ? this.bells.find((b) => b !== bells[i]) : bells[i];
      p.timer = this.gesture('ring', at[i] + Number(a.late), Number(a.jitter), 25, { bell }, this.bells.length > 1 ? 300 + p.lead * 120 : undefined, p.z, () => (p.done = true));
    }
  }
  close(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.ws.close();
  }
}

let clinkTimes: number[] = [];
const names = a.names ? a.names.split(',') : null;
const phones = Array.from({ length: names?.length ?? Number(a.phones) }, (_, i) => new FakePhone(names?.[i] ?? `sim${i + 1}`));
if (a.game) {
  console.log(`Game mode: ${phones.length} simulated phones (${phones.map((p) => p.name).join(', ')}) waiting for cues for ${a.seconds} s`);
  const end = () => {
    phones.forEach((p) => p.close());
    process.exit(0);
  };
  process.on('SIGINT', end);
  process.on('SIGTERM', end);
  setTimeout(end, Number(a.seconds) * 1000);
  if (a.diag) setInterval(() => console.log(`[diag] ${JSON.stringify(phones.map((p) => p.diag()))}`), 2000);
  await new Promise(() => {});
}
const dash = new WebSocket(a.url!);
const results: Record<string, string> = {};
let hostTime = 0;
dash.on('open', () => dash.send(JSON.stringify({ type: 'hello', v: 0, kind: 'dashboard', deviceId: 'dash-sim' })));
dash.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (typeof m.hostTime === 'number') hostTime = m.hostTime;
  if (m.type === 'results') {
    results[m.test.kind] = m.markdown;
    console.log(`\n### ${m.test.kind}\n\n${m.markdown}\n`);
  }
});

await sleep(4000);
const bpm = Number(a.bpm);
const count = Number(a.count);
dash.send(JSON.stringify({ type: 'cmd', cmd: 'test', test: 'metronome', bpm, count }));
await sleep(4000 + (count * 60_000) / bpm + 4000);

// Multi-bell: 4 bells per phone, random melody, thumb-zone selection model.
dash.send(JSON.stringify({ type: 'cmd', cmd: 'bells', n: 4 }));
await sleep(500);
dash.send(JSON.stringify({ type: 'cmd', cmd: 'test', test: 'metronome', multi: true, bpm, count }));
await sleep(4000 + (count * 60_000) / bpm + 4000);
const multiOk = results.metronome?.includes('Multi-bell selection') ?? false;
dash.send(JSON.stringify({ type: 'cmd', cmd: 'bells', n: 1 }));

// Clink: both fake phones "feel" the same impacts at known host times.
await sleep(500);
const n = Number(a.clink);
clinkTimes = Array.from({ length: n }, (_, i) => hostTime + 3000 + i * 700);
dash.send(JSON.stringify({ type: 'cmd', cmd: 'test', test: 'clink', durationMs: 2500 + n * 700 }));
await sleep(4000 + n * 700 + 4000);

phones.forEach((p) => p.close());
dash.close();
const ok = 'metronome' in results && 'clink' in results && multiOk;
console.log(ok ? 'E2E OK' : 'E2E FAILED: missing results');
process.exit(ok ? 0 : 1);
