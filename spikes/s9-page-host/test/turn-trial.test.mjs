import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleTrial, TrialState } from '../worker/turn-trial.mjs';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const iceServers = [{ urls: ['turn:relay.example.test:3478'], username: 'test-user', credential: 'test-credential' }];

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

function trial(mint = async () => iceServers) {
  const storage = new MemoryStorage();
  const ttls = [];
  let time = Date.UTC(2026, 0, 1, 23, 50);
  const restart = () => new TrialState(storage, async (ttl) => {
    ttls.push(ttl);
    return mint(ttl);
  }, () => time);
  return { state: restart(), restart, ttls, now: () => time, advance: (ms) => { time += ms; } };
}

async function openRoom(state) {
  const { status, body } = await state.open();
  assert.equal(status, 201);
  return body;
}

test('trial room tickets authorize only the intended room and signalling role', async () => {
  const { state, ttls, now } = trial();
  const { room, hostTicket, invite, expiresAt } = await openRoom(state);
  const other = await openRoom(state);
  assert.notEqual(room, other.room);
  assert.notEqual(hostTicket, invite);
  assert.equal(expiresAt, now() + 30 * minute);

  assert.equal(await state.admit(room, 'host', hostTicket), true);
  assert.equal(await state.admit(room, 'phone', invite), true);
  assert.equal(await state.admit(room, 'phone', hostTicket), false);
  assert.equal(await state.admit(room, 'host', invite), false);
  assert.equal(await state.admit(room, 'guest', invite), false);
  assert.equal(await state.admit(other.room, 'host', hostTicket), false);
  assert.equal(await state.admit(other.room, 'phone', invite), false);
  assert.equal(await state.admit(room, 'host', ''), false);
  for (const ticket of ['', other.hostTicket, other.invite]) {
    assert.equal((await state.grant(room, ticket)).status, 401);
  }
  assert.deepEqual(ttls, []);
});

test('overlapping host and phone grants share a mint, and replay survives a restart', async () => {
  const started = Promise.withResolvers();
  const provider = Promise.withResolvers();
  const { state, restart, ttls, now } = trial(async () => {
    if (ttls.length !== 1) return iceServers;
    started.resolve();
    return provider.promise;
  });
  const { room, hostTicket, invite } = await openRoom(state);

  const grants = Promise.all([state.grant(room, hostTicket), state.grant(room, invite)]);
  await Promise.race([started.promise, grants.then(() => assert.fail('grants settled without a provider call'))]);
  try {
    // A fresh instance cannot join the pending promise; it must honor the durable reservation.
    assert.equal((await restart().grant(room, invite)).status, 503);
    assert.equal(ttls.length, 1);
  } finally {
    provider.resolve(iceServers);
  }

  const expected = { status: 200, body: { iceServers, expiresAt: now() + ttls[0] * 1000 } };
  assert.deepEqual(await grants, [expected, expected]);
  const reloaded = restart();
  assert.deepEqual(await reloaded.grant(room, hostTicket), expected);
  assert.deepEqual(await reloaded.grant(room, invite), expected);
  assert.equal((await reloaded.grant(room, '')).status, 401);
  assert.equal(ttls.length, 1);
});

test('a late mint expires before the room and cannot be refreshed by replay', async () => {
  const { state, ttls, now, advance } = trial();
  const { room, hostTicket, invite, expiresAt } = await openRoom(state);
  advance(10 * minute + 123);

  const grant = await state.grant(room, invite);
  assert.equal(grant.status, 200);
  assert.deepEqual(grant.body.iceServers, iceServers);
  const [ttl] = ttls;
  assert.ok(Number.isInteger(ttl) && ttl > 0, `expected a positive provider TTL in seconds, got ${ttl}`);
  assert.equal(grant.body.expiresAt, now() + ttl * 1000);
  assert.ok(grant.body.expiresAt < expiresAt, 'credentials must expire before the room');

  advance(grant.body.expiresAt - now() - 1);
  assert.deepEqual(await state.grant(room, hostTicket), grant);
  advance(1);
  assert.equal(await state.admit(room, 'host', hostTicket), true);
  assert.equal((await state.grant(room, hostTicket)).status, 503);

  advance(expiresAt - now());
  assert.equal(await state.admit(room, 'host', hostTicket), false);
  assert.equal(await state.admit(room, 'phone', invite), false);
  assert.equal((await state.grant(room, invite)).status, 401);
  assert.deepEqual(ttls, [ttl]);
});

test('a room with less than a minute left cannot start a mint', async () => {
  const { state, ttls, now, advance } = trial();
  const { room, invite, expiresAt } = await openRoom(state);
  advance(expiresAt - now() - (minute - 1));

  assert.equal(await state.admit(room, 'phone', invite), true);
  assert.equal((await state.grant(room, invite)).status, 503);
  assert.deepEqual(ttls, []);
});

test('a rejected provider call is not retried even after state reload', async () => {
  const { state, restart, ttls } = trial(async () => { throw new Error('private test provider error'); });
  const { room, hostTicket, invite } = await openRoom(state);
  const failure = await state.grant(room, hostTicket);
  assert.equal(failure.status, 503);
  assert.doesNotMatch(JSON.stringify(failure.body), /private test provider error/);
  assert.equal((await state.grant(room, invite)).status, 503);
  assert.equal((await restart().grant(room, invite)).status, 503);
  assert.equal(ttls.length, 1);
});

test('the rolling deployment quota counts failed attempts and allows only one replacement at 24 hours', async () => {
  let failFirst = true;
  const { state, restart, ttls, advance } = trial(async () => {
    if (failFirst) {
      failFirst = false;
      throw new Error('test provider rejection');
    }
    return iceServers;
  });
  const first = await openRoom(state);
  assert.equal((await state.grant(first.room, first.hostTicket)).status, 503);

  // The first room expires and midnight passes, but its mint slot is still occupied.
  advance(hour);
  const rooms = await Promise.all(Array.from({ length: 8 }, () => openRoom(state)));
  const results = await Promise.all(rooms.map(({ room, hostTicket }) => state.grant(room, hostTicket)));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 200, 200, 200, 200, 200, 200, 429]);
  assert.equal(ttls.length, 8);

  advance(day - hour - 1);
  const reloaded = restart();
  const waiting = await openRoom(reloaded);
  assert.equal((await reloaded.grant(waiting.room, waiting.invite)).status, 429);
  assert.equal(ttls.length, 8);
  advance(1);

  const next = await openRoom(reloaded);
  assert.equal((await reloaded.grant(waiting.room, waiting.invite)).status, 200);
  assert.equal((await reloaded.grant(next.room, next.hostTicket)).status, 429);
  assert.equal(ttls.length, 9);
});

test('trial routes require owner auth for creation and forward a room bearer only to grant RPC', async () => {
  const secret = 'a'.repeat(64);
  const invite = 'b'.repeat(64);
  const room = 'T123456789AB';
  const expiresAt = Date.UTC(2026, 0, 2);
  const opened = { room, invite, hostTicket: 'c'.repeat(64), expiresAt };
  const calls = [];
  const env = {
    S9_TURN_TRIAL: '1',
    S9_TURN_OWNER_SECRET: secret,
    TURN_KEY_ID: 'fake',
    TURN_KEY_API_TOKEN: 'fake',
    TURN_TRIAL: {
      getByName: (name) => {
        calls.push(['getByName', name]);
        return {
          open: async () => {
            calls.push(['open']);
            return { status: 201, body: opened };
          },
          grant: async (...args) => {
            calls.push(['grant', ...args]);
            return { status: 200, body: { iceServers, expiresAt } };
          },
        };
      },
    },
  };
  const post = (path, bearer, bindings = env) => handleTrial(new Request(`https://trial.example.test${path}`, {
    method: 'POST',
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  }), bindings);

  assert.equal((await post('/turn-trial', secret, { ...env, S9_TURN_TRIAL: '0' })).status, 503);
  assert.equal((await post('/turn-trial')).status, 401);
  assert.equal((await post('/turn-trial', invite)).status, 401);
  assert.equal((await post(`/turn-trial/${room}`)).status, 401);
  assert.deepEqual(calls, []);

  const creation = await post('/turn-trial', secret);
  assert.equal(creation.status, 201);
  assert.equal(creation.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await creation.json(), opened);
  const grant = await post(`/turn-trial/${room}`, invite);
  assert.equal(grant.status, 200);
  assert.equal(grant.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await grant.json(), { iceServers, expiresAt });
  assert.deepEqual(calls, [
    ['getByName', 'deployment'], ['open'],
    ['getByName', 'deployment'], ['grant', room, invite],
  ]);
});
