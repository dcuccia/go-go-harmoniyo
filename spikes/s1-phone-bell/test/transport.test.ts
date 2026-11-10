import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { test } from 'node:test';
import {
  chooseJoinUrl,
  classifyWsRoute,
  cloudflaredCandidates,
  deviceRoute,
  findCloudflared,
  GestureDedupe,
  parseCloudflaredOutput,
  rtcPolicy,
  shouldOfferRtc,
  transportMode,
  TUNNEL_ENV,
  type TunnelState,
} from '../src/host/transport.ts';
import { internetReachable, QuickTunnel, waitTunnelReady, type TunnelReady, type TunnelReadyOptions } from '../src/host/tunnel.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('transportMode: auto by default, explicit opt-outs, --tunnel kept, contradictions rejected', () => {
  assert.equal(transportMode({}), 'auto');
  assert.equal(transportMode({ tunnel: true }), 'tunnel');
  assert.equal(transportMode({ 'lan-only': true }), 'lan');
  assert.equal(transportMode({ 'no-tunnel': true }), 'lan');
  // The owner's own join address or plain HTTP: no tunnel.
  assert.equal(transportMode({ 'no-https': true }), 'lan');
  assert.equal(transportMode({ 'public-url': 'https://bells.example/' }), 'lan');
  assert.equal(transportMode({ cert: 'c.pem' }), 'lan');
  assert.throws(() => transportMode({ tunnel: true, 'lan-only': true }), /contradict/);
  assert.throws(() => transportMode({ tunnel: true, 'no-tunnel': true }), /contradict/);
});

test('rtcPolicy accepts auto/on/off only', () => {
  assert.equal(rtcPolicy(undefined), 'auto');
  assert.equal(rtcPolicy('ON'), 'on');
  assert.equal(rtcPolicy('off'), 'off');
  assert.throws(() => rtcPolicy('yes'), /auto, on or off/);
});

test('cloudflared lookup order: flag, env, beside the executable, PATH, install folders', () => {
  const env = { [TUNNEL_ENV]: 'D:\\tools\\cf.exe', PATH: 'C:\\bin;C:\\other', PATHEXT: '.EXE;.CMD', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  const c = cloudflaredCandidates({ flag: 'E:\\cf.exe', env, platform: 'win32', execPath: 'C:\\GoGo\\go-go-harmoniyo.exe' });
  assert.deepEqual(
    c.slice(0, 5).map((x) => [x.source, x.path]),
    [
      ['flag', 'E:\\cf.exe'],
      ['env', 'D:\\tools\\cf.exe'],
      ['beside-exe', 'C:\\GoGo\\cloudflared.exe'],
      ['path', 'C:\\bin\\cloudflared.exe'],
      ['path', 'C:\\bin\\cloudflared.cmd'],
    ],
  );
  assert.ok(c.some((x) => x.source === 'install-folder' && x.path.includes('WinGet')));

  // The portable zip: cloudflared.exe next to go-go-harmoniyo.exe wins over a PATH copy.
  const beside = 'C:\\GoGo\\cloudflared.exe';
  const found = findCloudflared({ env: { PATH: 'C:\\bin' }, platform: 'win32', execPath: 'C:\\GoGo\\go-go-harmoniyo.exe', exists: (p) => p === beside || p === 'C:\\bin\\cloudflared.exe' });
  assert.deepEqual(found, { path: beside, source: 'beside-exe' });

  // The env var beats beside-exe; nothing found → null.
  assert.equal(findCloudflared({ env: { [TUNNEL_ENV]: '/x/cf' }, platform: 'linux', execPath: '/usr/bin/node', exists: () => true })?.source, 'env');
  assert.equal(findCloudflared({ env: { PATH: '/a:/b' }, platform: 'linux', execPath: '/usr/bin/node', exists: () => false }), null);

  // POSIX: no extension, ':' separated PATH, Homebrew folder.
  const posix = cloudflaredCandidates({ env: { PATH: '/a:/b', HOME: '/home/u' }, platform: 'darwin', execPath: '/opt/node/bin/node' });
  assert.deepEqual(posix.filter((x) => x.source === 'path').map((x) => x.path), ['/a/cloudflared', '/b/cloudflared']);
  assert.ok(posix.some((x) => x.path === '/opt/homebrew/bin/cloudflared'));
});

test('parseCloudflaredOutput finds the quick-tunnel URL and the registered connection', () => {
  const log = [
    '2026-11-20T18:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
    '2026-11-20T18:00:01Z INF |  https://quiet-bells-ring-loud.trycloudflare.com                                   |',
    '2026-11-20T18:00:02Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.1 location=sea01 protocol=quic',
  ].join('\n');
  assert.deepEqual(parseCloudflaredOutput(log), [{ kind: 'url', url: 'https://quiet-bells-ring-loud.trycloudflare.com/' }, { kind: 'registered' }]);
  assert.deepEqual(parseCloudflaredOutput('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"'), []);
});

test('chooseJoinUrl: tunnel when up, LAN fallback in auto, nothing while waiting', () => {
  const lanUrl = 'https://192.168.1.20:8443/';
  const tunnelUrl = 'https://a-b.trycloudflare.com/';
  const j = (mode: 'auto' | 'tunnel' | 'lan', tunnel: TunnelState, graceOver = false, url = tunnelUrl) => chooseJoinUrl({ mode, lanUrl: mode === 'tunnel' ? '' : lanUrl, tunnel, tunnelUrl: url, graceOver });
  // auto
  assert.equal(j('auto', 'starting'), '', 'waits for the tunnel instead of flashing the LAN QR');
  assert.equal(j('auto', 'starting', true), lanUrl, 'slow tunnel → LAN after the grace period');
  assert.equal(j('auto', 'up'), tunnelUrl);
  assert.equal(j('auto', 'up', false, ''), lanUrl, 'up without an address is not usable → LAN');
  assert.equal(j('auto', 'down'), lanUrl, 'no cloudflared / no internet / tunnel died → LAN at once');
  assert.equal(j('auto', 'off'), lanUrl);
  // tunnel only
  assert.equal(j('tunnel', 'starting'), '');
  assert.equal(j('tunnel', 'up'), tunnelUrl);
  assert.equal(j('tunnel', 'down', true), '');
  // lan only ignores any tunnel
  assert.equal(j('lan', 'up'), lanUrl);
});

test('classifyWsRoute / shouldOfferRtc / deviceRoute', () => {
  assert.equal(classifyWsRoute({ 'cf-ray': '8a1-SEA', 'cf-connecting-ip': '203.0.113.9' }, '127.0.0.1'), 'tunnel');
  assert.equal(classifyWsRoute({}, '::ffff:192.168.1.31'), 'lan');
  assert.equal(classifyWsRoute({}, '::1'), 'local');
  assert.equal(classifyWsRoute({}, undefined), 'local');

  assert.equal(shouldOfferRtc('auto', 'tunnel', true), true);
  assert.equal(shouldOfferRtc('auto', 'lan', true), false, 'a LAN phone already talks to the host directly');
  assert.equal(shouldOfferRtc('auto', 'tunnel', false), false, 'werift missing → stay on the WebSocket');
  assert.equal(shouldOfferRtc('on', 'lan', true), true);
  assert.equal(shouldOfferRtc('off', 'tunnel', true), false);

  assert.equal(deviceRoute(false, true, 'tunnel'), 'offline');
  assert.equal(deviceRoute(true, true, 'tunnel'), 'direct');
  assert.equal(deviceRoute(true, false, 'tunnel'), 'tunnel');
  assert.equal(deviceRoute(true, false, undefined), 'local');
});

test('GestureDedupe keeps the first copy from either path, not a reloaded page reusing seq', () => {
  const d = new GestureDedupe(30_000);
  assert.equal(d.first('p1', 7, 1000.5, 0), true, 'data channel copy');
  assert.equal(d.first('p1', 7, 1000.5, 3), false, 'WebSocket copy of the same gesture');
  assert.equal(d.first('p2', 7, 1000.5, 3), true, 'another phone');
  assert.equal(d.first('p1', 7, 5000.25, 10), true, 'page reload restarted seq: new source time');
  d.forget('p1');
  assert.equal(d.first('p1', 7, 1000.5, 20), true);
  assert.equal(d.first('p4', undefined, undefined, 0), true, 'no seq: never dropped');
  assert.equal(d.first('p4', undefined, undefined, 1), true);
  // Bounded memory: old entries go once there are many.
  for (let i = 0; i < 2000; i++) d.first('p3', i, i, i * 100);
  assert.equal(d.first('p3', 1999, 1999, 200_000), false, 'recent ones are remembered');
  assert.equal(d.first('p3', 0, 0, 200_000), true, 'old ones are forgotten');
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
  log(s: string): void {
    this.stderr.emit('data', Buffer.from(`${s}\n`));
  }
}

function fakeTunnel(extra: Partial<ConstructorParameters<typeof QuickTunnel>[0]> = {}) {
  const children: FakeChild[] = [];
  const changes: [TunnelState, string, string][] = [];
  const t = new QuickTunnel({
    cloudflared: 'cloudflared',
    originPort: 8080,
    onChange: (s, u, r) => changes.push([s, u, r]),
    spawnFn: (cmd, args) => {
      assert.equal(cmd, 'cloudflared');
      assert.deepEqual(args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8080']);
      const c = new FakeChild();
      children.push(c);
      return c as unknown as ChildProcess;
    },
    restartDelayMs: 5,
    registerFallbackMs: 30,
    ...extra,
  });
  return { t, children, changes };
}

test('QuickTunnel: up once the URL is registered, down + restart when cloudflared exits', async () => {
  const { t, children, changes } = fakeTunnel({ maxRestarts: 1 });
  t.start();
  assert.deepEqual(changes, [['starting', '', '']]);
  children[0]!.log('INF |  https://first-try.trycloudflare.com  |');
  assert.equal(t.state, 'starting', 'URL seen but not yet registered');
  children[0]!.log('INF Registered tunnel connection connIndex=0');
  assert.deepEqual(changes.at(-1), ['up', 'https://first-try.trycloudflare.com/', '']);

  children[0]!.log('2026-11-26T20:00:00Z ERR Connection terminated error="network is unreachable"');
  children[0]!.emit('exit', 1, null);
  assert.equal(t.state, 'down');
  assert.match(t.reason, /exited \(code 1\): Connection terminated/);
  await sleep(30);
  assert.equal(children.length, 2, 'restarted');
  assert.equal(t.state, 'starting');
  children[1]!.emit('exit', 1, null);
  await sleep(30);
  assert.equal(children.length, 2, 'gives up after maxRestarts');
  assert.equal(t.state, 'down');
  t.stop();
});

test('QuickTunnel: publishes the URL after a fallback delay if no "Registered" line appears', async () => {
  const { t, children } = fakeTunnel();
  t.start();
  children[0]!.log('INF https://quiet-one.trycloudflare.com');
  await sleep(60);
  assert.equal(t.state, 'up');
  assert.equal(t.url, 'https://quiet-one.trycloudflare.com/');
  t.stop();
  assert.ok(children[0]!.killed);
  await sleep(20);
  assert.equal(children.length, 1, 'stop() does not restart');
});

test('QuickTunnel: a missing binary reports down without restarting', async () => {
  const { t, children } = fakeTunnel();
  t.start();
  children[0]!.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
  assert.equal(t.state, 'down');
  assert.match(t.reason, /not found/);
  await sleep(30);
  assert.equal(children.length, 1);
  t.stop();
});

test('internetReachable: DNS answer → true, failure or timeout → false', async () => {
  assert.equal(await internetReachable(200, async () => ({ address: '104.16.0.1' })), true);
  assert.equal(await internetReachable(200, async () => Promise.reject(new Error('ENOTFOUND'))), false);
  // The helper's timer is unref'd (it must not hold the host open): keep the test's loop alive.
  const keep = setTimeout(() => {}, 1000);
  assert.equal(await internetReachable(20, () => new Promise(() => {})), false);
  clearTimeout(keep);
});

/** A fake clock: sleep() just advances it, so a 45 s budget runs instantly. */
function readyHarness(resolveScript: (server: string, t: number) => string[] | Error, probeScript: (t: number) => { status: number; body: string } | Error) {
  let t = 0;
  const queries: [number, string, string][] = [];
  const probes: [number, string, string][] = [];
  const o: TunnelReadyOptions = {
    expect: 'go-go-harmoniyo token-1',
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    resolve: async (server, host) => {
      queries.push([t, server, host]);
      t += 20;
      const r = resolveScript(server, t);
      if (r instanceof Error) throw r;
      return r;
    },
    probe: async (url, address) => {
      probes.push([t, url, address]);
      t += 300;
      const r = probeScript(t);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { o, queries, probes };
}
const nx = () => Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });

test('waitTunnelReady: no DNS query in the first 3 s, rotates public resolvers, then HTTPS must reach this host', async () => {
  // 1.1.1.1 cached an early NXDOMAIN; 8.8.8.8 has the name. The tunnel's origin answers 530 at first.
  let probeCount = 0;
  const { o, queries, probes } = readyHarness(
    (server) => (server === '1.1.1.1' ? nx() : ['104.16.230.132']),
    () => (++probeCount < 3 ? { status: 530, body: 'error 1033' } : { status: 200, body: 'go-go-harmoniyo token-1\n' }),
  );
  const r: TunnelReady = await waitTunnelReady('https://abc-def.trycloudflare.com/', o);
  assert.equal(r.ok, true, r.reason);
  assert.equal(queries[0]![0], 3000, 'first query waits 3 s (an earlier NXDOMAIN is cached for 60 s)');
  assert.deepEqual(queries.map((q) => q[1]), ['1.1.1.1', '8.8.8.8'], 'a resolver that said "no" does not block the next one');
  assert.equal(queries[0]![2], 'abc-def.trycloudflare.com');
  assert.equal(r.resolver, '8.8.8.8');
  assert.equal(r.address, '104.16.230.132');
  assert.deepEqual(probes.map((p) => [p[1], p[2]]), Array(3).fill(['https://abc-def.trycloudflare.com/tunnel-check', '104.16.230.132']), 'HTTPS pinned to the DNS answer');
  assert.equal(r.dnsMs, 3000 + 20 + 1000 + 20);
  assert.equal(r.httpMs, 3 * 300 + 2 * 1000);
  assert.equal(r.totalMs, r.dnsMs + r.httpMs);
});

test('waitTunnelReady: AAAA-only answer is used as is', async () => {
  const { o, probes } = readyHarness(() => ['2606:4700::6810:e684'], () => ({ status: 200, body: 'go-go-harmoniyo token-1' }));
  const r = await waitTunnelReady('https://v6-only.trycloudflare.com', o);
  assert.equal(r.ok, true);
  assert.equal(probes[0]![2], '2606:4700::6810:e684');
});

test('waitTunnelReady: gives up after the timeout, saying which step failed', async () => {
  const dnsDown = readyHarness(() => nx(), () => ({ status: 200, body: '' }));
  const a = await waitTunnelReady('https://never.trycloudflare.com/', dnsDown.o);
  assert.equal(a.ok, false);
  assert.match(a.reason, /no DNS answer for never\.trycloudflare\.com from 1\.1\.1\.1 or 8\.8\.8\.8 in 45 s \(last: ENOTFOUND\)/);
  assert.ok(a.totalMs <= 45_000, `stops within the budget (${a.totalMs} ms)`);
  assert.equal(dnsDown.probes.length, 0);

  const other = readyHarness(() => ['104.16.0.1'], () => ({ status: 200, body: 'someone else' }));
  const b = await waitTunnelReady('https://other.trycloudflare.com/', { ...other.o, timeoutMs: 10_000 });
  assert.equal(b.ok, false);
  assert.match(b.reason, /resolves but HTTPS through it failed for 10 s \(last: answered, but not by this host\)/);
  assert.ok(other.probes.length > 3, 'kept retrying HTTPS');

  const refused = readyHarness(() => ['104.16.0.1'], () => Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }));
  const c = await waitTunnelReady('https://reset.trycloudflare.com/', { ...refused.o, timeoutMs: 6_000 });
  assert.match(c.reason, /last: ECONNRESET/);
});

test('QuickTunnel: stays "starting" while the address is checked; up only once it is reachable', async () => {
  let finish!: (r: TunnelReady) => void;
  const checked: string[] = [];
  const { t, children, changes } = fakeTunnel({
    verify: (url) => {
      checked.push(url);
      return new Promise((r) => (finish = r));
    },
  });
  t.start();
  children[0]!.log('INF |  https://slow-dns.trycloudflare.com  |');
  children[0]!.log('INF Registered tunnel connection connIndex=0');
  children[0]!.log('INF Registered tunnel connection connIndex=1');
  assert.deepEqual(checked, ['https://slow-dns.trycloudflare.com/'], 'checked once');
  assert.equal(t.state, 'starting');
  assert.equal(t.reason, 'checking the address');
  assert.equal(t.url, '', 'the address is not published while unchecked');
  await sleep(40);
  assert.equal(checked.length, 1, 'the register fallback does not start a second check');
  const ready = { ok: true, dnsMs: 3020, httpMs: 300, totalMs: 3320, address: '104.16.0.1', resolver: '1.1.1.1', reason: '' };
  finish(ready);
  await sleep(0);
  assert.deepEqual(changes.at(-1), ['up', 'https://slow-dns.trycloudflare.com/', '']);
  assert.deepEqual(t.ready, ready);
  assert.ok(t.upAfterMs >= 0);
  t.stop();
});

test('QuickTunnel: an address that never becomes reachable restarts cloudflared for a new one', async () => {
  const results: TunnelReady[] = [
    { ok: false, dnsMs: 45_000, httpMs: 0, totalMs: 45_000, address: '', resolver: '', reason: 'no DNS answer' },
    { ok: true, dnsMs: 3000, httpMs: 400, totalMs: 3400, address: '104.16.0.2', resolver: '8.8.8.8', reason: '' },
  ];
  const { t, children, changes } = fakeTunnel({ verify: async () => results.shift()!, restartDelayMs: 100 });
  t.start();
  children[0]!.log('INF https://unlucky.trycloudflare.com');
  children[0]!.log('INF Registered tunnel connection connIndex=0');
  await sleep(0);
  assert.ok(children[0]!.killed, 'the unreachable tunnel is stopped');
  await sleep(0);
  assert.equal(t.state, 'down');
  assert.equal(t.reason, 'the address https://unlucky.trycloudflare.com/ did not become reachable (no DNS answer)');
  assert.equal(t.restartPending, true);
  assert.ok(!changes.some((c) => c[0] === 'up'), 'never published');
  await sleep(150);
  assert.equal(children.length, 2, 'restarted');
  children[1]!.log('INF https://lucky.trycloudflare.com');
  children[1]!.log('INF Registered tunnel connection connIndex=0');
  await sleep(0);
  assert.deepEqual(changes.at(-1), ['up', 'https://lucky.trycloudflare.com/', '']);
  t.stop();
});

test('QuickTunnel: a check for an address that was replaced meanwhile is ignored', async () => {
  const pending: ((r: TunnelReady) => void)[] = [];
  const ok = { ok: true, dnsMs: 1, httpMs: 1, totalMs: 2, address: 'x', resolver: 'y', reason: '' };
  const { t, children, changes } = fakeTunnel({ verify: () => new Promise((r) => pending.push(r)) });
  t.start();
  children[0]!.log('INF https://first.trycloudflare.com');
  children[0]!.log('INF Registered tunnel connection connIndex=0');
  children[0]!.emit('exit', 1, null);
  await sleep(30);
  children[1]!.log('INF https://second.trycloudflare.com');
  children[1]!.log('INF Registered tunnel connection connIndex=0');
  pending[0]!(ok);
  await sleep(0);
  assert.equal(t.state, 'starting', 'the old check does not publish the old (dead) address');
  pending[1]!(ok);
  await sleep(0);
  assert.deepEqual(changes.at(-1), ['up', 'https://second.trycloudflare.com/', '']);
  t.stop();
});
