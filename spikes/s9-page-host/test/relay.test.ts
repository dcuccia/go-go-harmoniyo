import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOSE_REPLACED, MAX_MESSAGE, MAX_PEERS, onJoin, onLeave, onMessage, parseJoin } from '../signal/relay.mjs';

interface Fake {
  role: 'host' | 'phone';
  peer: string;
  sent: any[];
  closed?: [number | undefined, string | undefined];
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

function sock(role: 'host' | 'phone', peer: string): Fake {
  const s: Fake = {
    role,
    peer,
    sent: [],
    send: (text) => s.sent.push(JSON.parse(text)),
    close: (code, reason) => {
      s.closed = [code, reason];
    },
  };
  return s;
}

const u = (path: string) => new URL(`https://x.test${path}`);

test('parseJoin validates room, role and peer', () => {
  assert.deepEqual(parseJoin(u('/signal/abc123?role=host&peer=tv-1')), { room: 'ABC123', role: 'host', peer: 'tv-1' });
  assert.equal(typeof parseJoin(u('/signal/AB?role=host&peer=x')), 'string');
  assert.equal(typeof parseJoin(u('/signal/ABCD?role=admin&peer=x')), 'string');
  assert.equal(typeof parseJoin(u('/signal/ABCD?role=phone&peer=bad%20id')), 'string');
  assert.equal(typeof parseJoin(u('/signal/ABCD/x?role=phone&peer=p')), 'string');
  assert.equal(typeof parseJoin(u('/other')), 'string');
});

test('phone joining before the host learns when the host arrives', () => {
  const phone = sock('phone', 'p1');
  assert.equal(onJoin(phone, []), true);
  assert.deepEqual(phone.sent.at(-1), { type: 'joined', role: 'phone', host: false });
  const host = sock('host', 'tv');
  onJoin(host, [phone]);
  assert.deepEqual(phone.sent.at(-1), { type: 'host', online: true });
  assert.deepEqual(host.sent.at(-1), { type: 'joined', role: 'host', phones: ['p1'] });
});

test('signals are routed phone → host and host → that phone only', () => {
  const host = sock('host', 'tv');
  const a = sock('phone', 'a');
  const b = sock('phone', 'b');
  onMessage(a, JSON.stringify({ type: 'signal', data: { kind: 'offer', sdp: 'X' } }), [host, b]);
  assert.deepEqual(host.sent.at(-1), { type: 'signal', from: 'a', data: { kind: 'offer', sdp: 'X' } });
  assert.equal(b.sent.length, 0);
  onMessage(host, JSON.stringify({ type: 'signal', to: 'a', data: { kind: 'answer', sdp: 'Y' } }), [a, b]);
  assert.deepEqual(a.sent.at(-1), { type: 'signal', from: 'host', data: { kind: 'answer', sdp: 'Y' } });
  assert.equal(b.sent.length, 0);
});

test('phone signal with no host gets an error; junk and oversize messages are ignored', () => {
  const a = sock('phone', 'a');
  onMessage(a, JSON.stringify({ type: 'signal', data: {} }), []);
  assert.deepEqual(a.sent.at(-1), { type: 'error', reason: 'no-host' });
  const host = sock('host', 'tv');
  onMessage(a, 'not json', [host]);
  onMessage(a, JSON.stringify({ type: 'signal', data: 'x'.repeat(MAX_MESSAGE) }), [host]);
  onMessage(a, JSON.stringify({ type: 'other' }), [host]);
  assert.equal(host.sent.length, 0);
});

test('ping gets pong', () => {
  const a = sock('phone', 'a');
  onMessage(a, JSON.stringify({ type: 'ping', t: 5 }), []);
  assert.deepEqual(a.sent.at(-1), { type: 'pong', t: 5 });
});

test('newest host and newest same-id phone win', () => {
  const oldHost = sock('host', 'tv1');
  const oldPhone = sock('phone', 'a');
  onJoin(sock('host', 'tv2'), [oldHost, oldPhone]);
  assert.equal(oldHost.closed?.[0], CLOSE_REPLACED);
  onJoin(sock('phone', 'a'), [oldPhone]);
  assert.equal(oldPhone.closed?.[0], CLOSE_REPLACED);
});

test('room full refuses the next phone', () => {
  const phones = Array.from({ length: MAX_PEERS }, (_, i) => sock('phone', `p${i}`));
  const extra = sock('phone', 'extra');
  assert.equal(onJoin(extra, phones), false);
  assert.equal(extra.closed?.[0], 4029);
});

test('leaving: host offline is announced unless replaced; phones leaving are announced to the host', () => {
  const host = sock('host', 'tv');
  const a = sock('phone', 'a');
  onLeave(host, [a]);
  assert.deepEqual(a.sent.at(-1), { type: 'host', online: false });
  const b = sock('phone', 'b');
  onLeave(host, [b, sock('host', 'tv2')]);
  assert.equal(b.sent.length, 0);
  onLeave(a, [host]);
  assert.deepEqual(host.sent.at(-1), { type: 'peer-left', peer: 'a' });
});
