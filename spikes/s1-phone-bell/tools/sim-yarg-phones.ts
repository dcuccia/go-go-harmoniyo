/**
 * I1: simulated phones ringing YARG lanes through the host's YARG sidecar — an end-to-end check
 * without phones (host `npm run yarg -- --no-https --no-open` + YARG.exe -hgp running).
 *
 *   npx tsx tools/sim-yarg-phones.ts [--phones 4] [--seconds 30] [--bpm 120] [--churn] [--extra]
 *     [--url ws://127.0.0.1:8080/hgp] [--require-yarg]
 *
 * Each fake phone has its own clock offset/drift, clock-syncs like the real controller, waits for
 * its `assign` (ringer seat + bells), then rings its bells in turn on a metronome with human
 * jitter and a 25 ms detection delay. `--churn` drops phone 2 for a third of the run and brings it
 * back (it must get the same seat); `--extra` adds one more phone than there are seats (it must
 * get free play, not a seat).
 */
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { ClockSync } from '../src/core/clock-sync.ts';
import { gauss, rng } from '../sim/synth.ts';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:8080/hgp' },
    phones: { type: 'string', default: '4' },
    seconds: { type: 'string', default: '30' },
    bpm: { type: 'string', default: '120' },
    churn: { type: 'boolean', default: false },
    extra: { type: 'boolean', default: false },
    'require-yarg': { type: 'boolean', default: false },
  },
});

const r = rng(7);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const infoUrl = a.url!.replace(/^ws/, 'http').replace(/\/hgp$/, '/api/info');

interface Assign {
  bells: { id: string }[];
  ringer?: { slot: number; title: string; song?: string };
}

class FakePhone {
  ws!: WebSocket;
  sync = new ClockSync();
  seq = 0;
  syncId = 0;
  assign: Assign | null = null;
  assigns = 0;
  rings = 0;
  offset = (r() - 0.5) * 1e6;
  drift = (r() - 0.5) * 100e-6;
  timers: NodeJS.Timeout[] = [];
  constructor(readonly name: string) {}
  connect(): Promise<void> {
    this.sync = new ClockSync();
    this.ws = new WebSocket(a.url!);
    this.ws.on('message', (d) => this.onMessage(JSON.parse(d.toString())));
    return new Promise((res) =>
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: 'hello', v: 0, deviceId: `sim-${this.name}`, kind: 'phone', name: this.name, ua: 'sim-phone', gestures: ['ring'] }));
        for (let i = 0; i < 10; i++) this.timers.push(setTimeout(() => this.ping(), i * 30));
        this.timers.push(setInterval(() => this.ping(), 250));
        res();
      }),
    );
  }
  now(): number {
    return performance.now() * (1 + this.drift) + this.offset;
  }
  ping(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'sync', id: ++this.syncId, t0: this.now() }));
  }
  onMessage(m: Record<string, unknown>): void {
    if (m.type === 'sync') this.sync.add({ t0: m.t0 as number, t1: m.t1 as number, t2: m.t2 as number, t3: this.now() });
    else if (m.type === 'assign') {
      this.assign = m as unknown as Assign;
      this.assigns++;
    }
  }
  /** Ring bell `i` at host time `hostAt` (± jitter); the event is sent after a detection delay. */
  ring(i: number, hostAt: number): void {
    if (!this.assign || !this.sync.estimate || this.ws.readyState !== WebSocket.OPEN) return;
    const bell = this.assign.bells[i % this.assign.bells.length].id;
    const t = this.sync.toLocal(hostAt) + gauss(r) * 15;
    const det = 25 + Math.abs(gauss(r)) * 10;
    const delay = Math.max(0, (t - this.now()) / (1 + this.drift) + det);
    this.timers.push(
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'gesture', seq: ++this.seq, g: 'ring', t, th: this.sync.toHost(t), det: this.now() - t, bell, src: 'sim' }));
        this.rings++;
      }, delay),
    );
  }
  close(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.ws.close();
  }
}

async function info(): Promise<Record<string, any>> {
  return (await (await fetch(infoUrl)).json()) as Record<string, any>;
}

const n = Number(a.phones) + (a.extra ? 1 : 0);
const phones = Array.from({ length: n }, (_, i) => new FakePhone(`sim${i + 1}`));
for (const p of phones) await p.connect();
await sleep(1500);

const describe = () => phones.map((p) => `${p.name}: ${p.assign?.ringer?.title ?? 'no seat'} [${p.assign?.bells.map((b) => b.id).join(' ') ?? '-'}]`).join('\n  ');
console.log(`Seats:\n  ${describe()}`);

let hostNow = (await info()).hostTime as number;
const t0 = performance.now();
const hostTime = () => hostNow + (performance.now() - t0);
const period = 60_000 / Number(a.bpm);
const beats = Math.floor((Number(a.seconds) * 1000) / period);
const churner = a.churn ? phones[1] : null;
let churnSlot: number | undefined;
console.log(`Ringing ${beats} beats at ${a.bpm} bpm${churner ? `; ${churner.name} leaves at beat ${Math.floor(beats / 3)} and rejoins at ${Math.floor((2 * beats) / 3)}` : ''}…`);
const start = hostTime() + 500;
for (let k = 0; k < beats; k++) {
  const at = start + k * period;
  while (hostTime() < at - 200) await sleep(20);
  if (churner && k === Math.floor(beats / 3)) {
    churnSlot = churner.assign?.ringer?.slot;
    churner.close();
    console.log(`  beat ${k}: ${churner.name} disconnected`);
  }
  if (churner && k === Math.floor((2 * beats) / 3)) {
    churner.assign = null;
    await churner.connect();
    console.log(`  beat ${k}: ${churner.name} reconnected`);
  }
  // Every phone rings every beat (staggered within the beat), walking through its lanes.
  phones.forEach((p, i) => p.ring(k + i, at + (i * period) / phones.length));
}
await sleep(1500);

const y = (await info()).yarg as Record<string, any> | null;
phones.forEach((p) => p.close());
const seated = phones.filter((p) => (p.assign?.ringer?.slot ?? -1) >= 0);
const sent = phones.reduce((s, p) => s + (p.assign?.ringer && p.assign.ringer.slot >= 0 ? p.rings : 0), 0);
console.log(`\nSeats at the end:\n  ${describe()}`);
console.log(`\nPhones ${phones.length}, seated ${seated.length}, rings from seated phones ${sent}, host forwarded to YARG ${y?.ringsSent ?? 'n/a'}`);
if (y) {
  console.log(`YARG bridge ${y.connected ? 'connected' : 'NOT connected'} (round trip ${Number(y.bridgeRtt).toFixed(2)} ms); source→host age p50 ${Number(y.ageP50).toFixed(1)} ms, p95 ${Number(y.ageP95).toFixed(1)} ms`);
  for (const s of y.seats) if (s) console.log(`  Ringer ${s.slot + 1} (${s.device}) ${s.name} ${s.online ? 'online' : 'offline'}: ${s.rings} rings, ${s.partName} ${s.tier}, lanes ${s.bells.map((b: { id: string }) => b.id).join(' ')}`);
}

const problems: string[] = [];
if (!y) problems.push('host is not in --yarg mode');
if (seated.length !== Math.min(phones.length, y?.seats.length ?? 0)) problems.push('not every phone that should have a seat got one');
if (a.extra && phones[phones.length - 1].assign?.ringer?.slot !== -1) problems.push('the extra phone should have no seat');
if (churner && churner.assign?.ringer?.slot !== churnSlot) problems.push(`${churner.name} came back to a different seat`);
if (y && y.ringsSent < sent * 0.95) problems.push('host forwarded fewer rings than seated phones sent');
if (a['require-yarg'] && !y?.connected) problems.push('YARG bridge not connected');
console.log(problems.length ? `\nSIM FAILED: ${problems.join('; ')}` : '\nSIM OK');
process.exit(problems.length ? 1 : 0);
