import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoState, demoAdmit, demoExpiry, handleDemo } from '../worker/turn-demo.mjs';

const minute = 60_000;
const windowMs = 10 * minute;
const roomMs = 90 * minute;
const grantMs = 20 * minute;
// Cross midnight in the rolling-window tests, without aligning to a fixed bucket.
const start = Date.UTC(2026, 1, 28, 23, 58, 37);
const until = start + 3 * roomMs;
const source = (n) => (n + 1).toString(16).padStart(64, '0');
const iceServers = (mintNumber) => [{
  urls: ['turn:relay.example.test:3478'],
  username: `test-user-${mintNumber}`,
  credential: `test-credential-${mintNumber}`,
}];

class MemoryStorage {
  #data = new Map();
  #tail = Promise.resolve();

  async get(key) {
    return structuredClone(this.#data.get(key));
  }

  transaction(run) {
    const result = this.#tail.then(async () => {
      const draft = new Map(this.#data);
      const value = await run({
        get: async (key) => structuredClone(draft.get(key)),
        put: async (key, entry) => { draft.set(key, structuredClone(entry)); },
      });
      this.#data = draft;
      return value;
    });
    this.#tail = result.catch(() => {});
    return result;
  }
}

function demo(mint = async (_ttl, count) => iceServers(count)) {
  const storage = new MemoryStorage();
  const ttls = [];
  let time = start;
  const restart = () => new DemoState(storage, async (ttl) => {
    ttls.push(ttl);
    return mint(ttl, ttls.length);
  }, () => time);
  return { state: restart(), restart, ttls, setNow: (ms) => { time = ms; } };
}

async function openRoom(state, from = source(0)) {
  const { status, body } = await state.open(from, until);
  assert.equal(status, 201);
  return body;
}

function openRooms(state, count, sourceFor, offset = 0) {
  return Promise.all(Array.from({ length: count }, (_, i) => openRoom(state, sourceFor(i + offset))));
}

function grant(state, { room, hostTicket, invite }, role = 'host', deadline = until) {
  return state.grant(room, role, role === 'host' ? hostTicket : invite, deadline);
}

function assertGrant(result, now, ttl, mintNumber, latest = now + grantMs) {
  assert.ok(Number.isInteger(ttl) && ttl > 0, `expected a positive provider TTL in seconds, got ${ttl}`);
  const expiresAt = now + ttl * 1000;
  assert.ok(expiresAt <= latest, `provider expiry ${expiresAt} exceeds deadline ${latest}`);
  assert.deepEqual(result, { status: 200, body: { iceServers: iceServers(mintNumber), expiresAt } });
}

test('demoExpiry requires explicit opt-in, both TURN bindings, and an exact UTC deadline within 12 hours', () => {
  const latest = start + 12 * 60 * minute;
  const utcSeconds = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const env = {
    S9_TURN_DEMO: '1',
    S9_TURN_DEMO_UNTIL: utcSeconds(latest),
    TURN_KEY_ID: 'test-id',
    TURN_KEY_API_TOKEN: 'test-token',
  };
  assert.equal(demoExpiry(env, start), latest);
  assert.equal(demoExpiry({ ...env, S9_TURN_DEMO_UNTIL: utcSeconds(start + 1000) }, start), start + 1000);

  for (const [label, overrides] of [
    ['missing opt-in', { S9_TURN_DEMO: undefined }],
    ['disabled opt-in', { S9_TURN_DEMO: '0' }],
    ['non-string opt-in', { S9_TURN_DEMO: 1 }],
    ['missing key', { TURN_KEY_ID: undefined }],
    ['missing API token', { TURN_KEY_API_TOKEN: undefined }],
    ['missing deadline', { S9_TURN_DEMO_UNTIL: undefined }],
    ['over 12 hours', { S9_TURN_DEMO_UNTIL: utcSeconds(latest + 1000) }],
    ['deadline is now', { S9_TURN_DEMO_UNTIL: utcSeconds(start) }],
    ['past deadline', { S9_TURN_DEMO_UNTIL: utcSeconds(start - 1000) }],
    ['fractional seconds', { S9_TURN_DEMO_UNTIL: new Date(latest).toISOString() }],
    ['offset in place of Z', { S9_TURN_DEMO_UNTIL: utcSeconds(latest).replace('Z', '+00:00') }],
    ['normalized invalid date', { S9_TURN_DEMO_UNTIL: '2026-02-29T00:00:00Z' }],
  ]) {
    assert.ok(!demoExpiry({ ...env, ...overrides }, start), label);
  }
});

test('ongoing enablement needs no deadline but still requires the flag and both provider bindings', async () => {
  const env = {
    S9_TURN_DEMO: '1',
    S9_TURN_DEMO_UNTIL: 'ongoing',
    TURN_KEY_ID: 'test-id',
    TURN_KEY_API_TOKEN: 'test-token',
  };
  const endpoint = new Request('https://demo.example/turn-demo');
  const status = async (overrides = {}) => (await handleDemo(endpoint, { ...env, ...overrides })).json();
  assert.deepEqual(await status(), { enabled: true, expiresAt: null });
  assert.deepEqual(await status({ S9_TURN_DEMO: '0' }), { enabled: false, expiresAt: null });
  assert.deepEqual(await status({ TURN_KEY_API_TOKEN: undefined }), { enabled: false, expiresAt: null });

  const { state, ttls, setNow } = demo();
  const later = start + 24 * 60 * minute;
  const ongoing = demoExpiry(env, later);
  setNow(later);
  const { status: opened, body } = await state.open(source(0), ongoing);
  assert.equal(opened, 201);
  assert.equal(body.expiresAt, later + roomMs);
  assertGrant(await grant(state, body, 'host', ongoing), later, ttls[0], 1);
});

test('demo tickets are bound to a room and role; stateless admission does not imply a stored room', async () => {
  const { state, ttls, setNow } = demo();
  const { room, hostTicket, invite, expiresAt } = await openRoom(state);
  const other = await openRoom(demo().state);
  assert.notEqual(room, other.room);
  assert.notEqual(hostTicket, invite);
  assert.equal(expiresAt, start + roomMs);

  assert.equal(await demoAdmit(room, 'host', hostTicket), true);
  assert.equal(await demoAdmit(room, 'phone', invite), true);
  for (const [id, role, ticket] of [
    [room, 'phone', hostTicket],
    [room, 'host', invite],
    [room, 'guest', invite],
    [room, 'host', ''],
    [other.room, 'host', hostTicket],
    [other.room, 'phone', invite],
  ]) {
    assert.equal(await demoAdmit(id, role, ticket), false);
    assert.equal((await state.grant(id, role, ticket, until)).status, 401);
  }
  assert.equal(await demoAdmit(other.room, 'phone', other.invite), true);
  assert.equal((await grant(state, other, 'phone')).status, 401);

  setNow(expiresAt);
  assert.equal((await state.grant(room, 'host', hostTicket, until)).status, 401);
  assert.deepEqual(ttls, [], 'opening rooms and denied grants must not call the provider');
});

test('concurrent host and phone grants share a mint and reroll at credential expiry', { timeout: 5000 }, async () => {
  const started = Promise.withResolvers();
  const pendingMint = Promise.withResolvers();
  const { state, restart, ttls, setNow } = demo(async (_ttl, count) => {
    if (count !== 1) return iceServers(count);
    started.resolve();
    return pendingMint.promise;
  });
  const opened = await openRoom(state);

  const grants = Promise.all([grant(state, opened), grant(state, opened, 'phone')]);
  try {
    await Promise.race([started.promise, grants.then(() => assert.fail('grants settled without minting'))]);
    // Authentication must happen before joining an in-flight grant.
    assert.equal((await state.grant(opened.room, 'phone', opened.hostTicket, until)).status, 401);
  } finally {
    pendingMint.resolve(iceServers(1));
  }

  const [host, phone] = await grants;
  assertGrant(host, start, ttls[0], 1);
  assert.equal(host.body.expiresAt, start + grantMs);
  assert.deepEqual(phone, host);
  const reloaded = restart();
  setNow(host.body.expiresAt - 1);
  assert.deepEqual(await grant(reloaded, opened, 'phone'), host);
  assert.equal(ttls.length, 1);

  setNow(host.body.expiresAt);
  const fresh = await grant(reloaded, opened, 'phone');
  assert.equal(ttls.length, 2);
  assertGrant(fresh, host.body.expiresAt, ttls[1], 2);
});

test('an expired demo gate denies both cached and first-time grants without minting', async () => {
  const { state, ttls, setNow } = demo();
  const cached = await openRoom(state);
  const uncached = await openRoom(state);
  const result = await grant(state, cached);
  assertGrant(result, start, ttls[0], 1);

  const closedAt = start + 1000;
  assert.ok(result.body.expiresAt > closedAt, 'test requires a still-cached grant');
  setNow(closedAt);
  assert.equal((await grant(state, cached, 'phone', closedAt)).status, 503);
  assert.equal((await grant(state, uncached, 'host', closedAt)).status, 503);
  assert.equal((await state.open(source(0), closedAt)).status, 503);
  assert.equal(ttls.length, 1);
});

test('a provider response that arrives after the demo gate closes does not release credentials', { timeout: 5000 }, async () => {
  const started = Promise.withResolvers();
  const pendingMint = Promise.withResolvers();
  const { state, ttls, setNow } = demo(async () => {
    started.resolve();
    return pendingMint.promise;
  });
  const opened = await openRoom(state);
  const deadline = start + 5 * minute;
  const request = grant(state, opened, 'host', deadline);
  try {
    await Promise.race([started.promise, request.then(() => assert.fail('grant settled without minting'))]);
    setNow(deadline);
  } finally {
    pendingMint.resolve(iceServers(1));
  }

  const result = await request;
  assert.equal(result.status, 503);
  assert.ok(!result.body?.iceServers, 'a closed gate must not return provider credentials');
  assert.equal(ttls.length, 1);
});

test('a late mint cannot issue credentials past the room deadline', async () => {
  const { state, ttls, setNow } = demo();
  const opened = await openRoom(state);
  const late = opened.expiresAt - 8 * minute;
  setNow(late);

  assertGrant(await grant(state, opened), late, ttls[0], 1, opened.expiresAt);
  assert.equal(ttls.length, 1);
});

test('an ambiguous provider failure reserves the mint across restarts until its expected expiry', async () => {
  const privateError = 'private test provider response';
  const { state, restart, ttls, setNow } = demo(async (_ttl, count) => {
    if (count === 1) throw new Error(privateError);
    return iceServers(count);
  });
  const opened = await openRoom(state);
  const failure = await grant(state, opened);
  assert.equal(failure.status, 503);
  assert.ok(!JSON.stringify(failure).includes(privateError), 'failure must not disclose provider details');
  assert.equal(ttls.length, 1);
  const expectedExpiry = start + ttls[0] * 1000;
  // The rolling mint window has elapsed, but the provider might have issued credentials.
  assert.ok(expectedExpiry > start + windowMs);
  setNow(expectedExpiry - 1);
  const reloaded = restart();
  assert.equal((await grant(reloaded, opened, 'phone')).status, 503);
  assert.equal(ttls.length, 1);

  setNow(expectedExpiry);
  assertGrant(await grant(reloaded, opened, 'phone'), expectedExpiry, ttls[1], 2);
  assert.equal(ttls.length, 2);
});

for (const [scope, openLimit, mintLimit, activeLimit] of [
  ['per-source', 12, 8, 16],
  ['global', 96, 48, 128],
]) {
  const sourceFor = (i) => scope === 'per-source' ? source(0) : source(i % 9);
  const probe = source(scope === 'per-source' ? 0 : 9);

  test(`${scope} room opens release only the elapsed slot at the rolling boundary`, async () => {
    const { state, restart, setNow, ttls } = demo();
    await openRoom(state, sourceFor(0));
    setNow(start + minute);
    await openRooms(state, openLimit - 1, sourceFor, 1);
    assert.equal((await state.open(probe, until)).status, 429);
    if (scope === 'per-source') await openRoom(state, source(1));

    const reloaded = restart();
    setNow(start + windowMs - 1);
    assert.equal((await reloaded.open(probe, until)).status, 429);
    setNow(start + windowMs);
    await openRoom(reloaded, probe);
    assert.equal((await reloaded.open(probe, until)).status, 429);
    assert.deepEqual(ttls, []);
  });

  test(`${scope} mints charge failed attempts but not cached grants and roll one slot at a time`, async () => {
    const { state, restart, setNow, ttls } = demo(async (_ttl, count) => {
      if (count === 1) throw new Error('test provider rejection');
      return iceServers(count);
    });
    const rooms = await openRooms(state, mintLimit + 2, sourceFor);
    assert.equal((await grant(state, rooms[0])).status, 503);
    setNow(start + minute);
    const mints = await Promise.all(rooms.slice(1, mintLimit).map((room) => grant(state, room)));
    assert.deepEqual(mints.map(({ status }) => status), Array(mintLimit - 1).fill(200));
    const [next, last] = rooms.slice(mintLimit);
    assert.equal((await grant(state, next, 'phone')).status, 429);
    assert.deepEqual(await grant(state, rooms[1], 'phone'), mints[0]);
    assert.equal(ttls.length, mintLimit);
    if (scope === 'per-source') {
      const independent = await openRoom(state, source(1));
      assert.equal((await grant(state, independent)).status, 200);
    }
    const callsAtCap = ttls.length;

    const reloaded = restart();
    setNow(start + windowMs - 1);
    assert.equal((await grant(reloaded, next, 'phone')).status, 429);
    assert.equal(ttls.length, callsAtCap);
    setNow(start + windowMs);
    assertGrant(await grant(reloaded, next, 'phone'), start + windowMs, ttls[callsAtCap], callsAtCap + 1);
    assert.equal((await grant(reloaded, last)).status, 429);
    assert.equal(ttls.length, callsAtCap + 1);
  });

  test(`${scope} active rooms remain capped after the open window rolls and free a slot at expiry`, async () => {
    const { state, restart, setNow } = demo();
    const oldest = await openRoom(state, sourceFor(0));
    setNow(start + windowMs + minute);
    await openRooms(state, openLimit, sourceFor, 1);
    setNow(start + 2 * (windowMs + minute));
    await openRooms(state, activeLimit - 1 - openLimit, sourceFor, 1 + openLimit);

    const reloaded = restart();
    setNow(oldest.expiresAt - 1);
    assert.equal((await reloaded.open(probe, until)).status, 429);
    if (scope === 'per-source') await openRoom(reloaded, source(1));
    setNow(oldest.expiresAt);
    await openRoom(reloaded, probe);
    assert.equal((await reloaded.open(probe, until)).status, 429);
  });
}
