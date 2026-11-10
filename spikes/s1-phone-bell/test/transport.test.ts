import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
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
import { internetReachable, QuickTunnel } from '../src/host/tunnel.ts';

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
      ['beside-exe', join('C:\\GoGo', 'cloudflared.exe')],
      ['path', join('C:\\bin', 'cloudflared.exe')],
      ['path', join('C:\\bin', 'cloudflared.cmd')],
    ],
  );
  assert.ok(c.some((x) => x.source === 'install-folder' && x.path.includes('WinGet')));

  // The portable zip: cloudflared.exe next to go-go-harmoniyo.exe wins over a PATH copy.
  const beside = join('C:\\GoGo', 'cloudflared.exe');
  const found = findCloudflared({ env: { PATH: 'C:\\bin' }, platform: 'win32', execPath: 'C:\\GoGo\\go-go-harmoniyo.exe', exists: (p) => p === beside || p === join('C:\\bin', 'cloudflared.exe') });
  assert.deepEqual(found, { path: beside, source: 'beside-exe' });

  // The env var beats beside-exe; nothing found → null.
  assert.equal(findCloudflared({ env: { [TUNNEL_ENV]: '/x/cf' }, platform: 'linux', execPath: '/usr/bin/node', exists: () => true })?.source, 'env');
  assert.equal(findCloudflared({ env: { PATH: '/a:/b' }, platform: 'linux', execPath: '/usr/bin/node', exists: () => false }), null);

  // POSIX: no extension, ':' separated PATH, Homebrew folder.
  const posix = cloudflaredCandidates({ env: { PATH: '/a:/b', HOME: '/home/u' }, platform: 'darwin', execPath: '/opt/node/bin/node' });
  assert.deepEqual(posix.filter((x) => x.source === 'path').map((x) => x.path), [join('/a', 'cloudflared'), join('/b', 'cloudflared')]);
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
