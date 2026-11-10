// The DOM-free parts of the page host: the game's in-page loopback link to the shared HostSession,
// the join link and host info. The WebRTC parts are covered by scripts/e2e.mjs in real Chrome.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newRoomCode, normalizeOrigin, wsUrl } from '../src/config.ts';
import { iceConfig } from '../src/ice.ts';
import { PageHost } from '../src/page-host.ts';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('the game connects to the page host over the loopback and gets welcome + sync', async () => {
  const host = new PageHost({ signalOrigin: '', room: 'TEST01' });
  host.start();
  try {
    assert.equal(host.signalState, 'no-service');
    const ws = host.gameSocket();
    const got: any[] = [];
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
    await new Promise<void>((r) => (ws.onopen = () => r()));
    ws.send(JSON.stringify({ type: 'hello', v: 1, kind: 'dashboard', deviceId: 'dashboard' }));
    await tick();
    const welcome = got.find((m) => m.type === 'welcome');
    assert.ok(welcome, 'welcome');
    assert.equal(welcome.info.transport.mode, 'page');
    assert.equal(welcome.info.joinUrl, '', 'no QR without a signalling service');
    const t0 = performance.now();
    ws.send(JSON.stringify({ type: 'sync', id: 1, t0 }));
    await tick();
    const s = got.find((m) => m.type === 'sync');
    assert.ok(s && s.t1 >= t0 && s.t2 >= s.t1, 'sync on the shared clock');
    let closed = false;
    ws.onclose = () => (closed = true);
    ws.close();
    await tick();
    assert.ok(closed);
  } finally {
    host.stop();
  }
});

test('join link carries the room and forwarded test switches only', () => {
  const host = new PageHost({
    signalOrigin: 'https://go-go-harmoniyo.example.workers.dev',
    room: 'ABC234',
    params: new URLSearchParams('ice=none&song=x&relay=1'),
    forward: ['ice', 'relay', 'turn'],
  });
  const u = new URL(host.joinUrl);
  assert.equal(u.origin + u.pathname, 'https://go-go-harmoniyo.example.workers.dev/c/');
  assert.equal(u.searchParams.get('r'), 'ABC234');
  assert.equal(u.searchParams.get('ice'), 'none');
  assert.equal(u.searchParams.get('relay'), '1');
  assert.equal(u.searchParams.get('song'), null);
  // Not open yet: info withholds the link so the TV doesn't show a QR that can't work.
  assert.equal(host.info().joinUrl, '');
});

test('config helpers', () => {
  assert.equal(normalizeOrigin(' https://a.example/x?y '), 'https://a.example');
  assert.throws(() => normalizeOrigin('ftp://a.example'));
  assert.equal(wsUrl('https://a.example', '/signal/R'), 'wss://a.example/signal/R');
  assert.equal(wsUrl('http://127.0.0.1:1', '/s'), 'ws://127.0.0.1:1/s');
  const code = newRoomCode(6);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
});

test('ICE config: /ice answer, overrides, and fallback', async () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
  const turn = { iceServers: [{ urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }] };
  const a = await iceConfig('https://s.example', new URLSearchParams(), ok(turn));
  assert.deepEqual(a.iceServers, turn.iceServers);
  assert.equal(a.iceTransportPolicy, 'all');
  const none = await iceConfig('https://s.example', new URLSearchParams('ice=none'), ok(turn));
  assert.deepEqual(none.iceServers, []);
  const relay = await iceConfig('https://s.example', new URLSearchParams('relay=1&turn=turn:127.0.0.1:1&tu=a&tc=b'), ok({ iceServers: [] }));
  assert.equal(relay.iceTransportPolicy, 'relay');
  assert.ok(relay.iceServers.some((s) => String(s.urls).includes('127.0.0.1')));
  const down = await iceConfig('https://s.example', new URLSearchParams(), (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch);
  assert.ok(down.iceServers.length > 0, 'falls back to default STUN');
});
