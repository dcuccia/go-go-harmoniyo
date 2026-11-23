export const ROOM_MS = 30 * 60_000;
export const DAILY_MINTS = 8;
export const TRIAL_ROOM = /^T[0-9A-F]{11}$/;
export const TRIAL_PROTOCOL = 's9-trial';
const TICKET = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60_000;
const STATE = 'trial-v1';
const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const random = (size) => hex(crypto.getRandomValues(new Uint8Array(size)));
const digest = async (s) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))));
const result = (status, body) => ({ status, body });
const denied = () => result(401, { error: 'invalid-or-expired' });
const unavailable = () => result(503, { error: 'relay-unavailable' });
const limited = () => result(429, { error: 'trial-limit' });
const emptyState = () => ({ rooms: {}, attempts: [] });

class TurnProviderError extends Error {}

export class TrialState {
  #inflight = new Map();

  constructor(storage, mint, now = Date.now) {
    this.storage = storage;
    this.mint = mint;
    this.now = now;
  }

  async open() {
    const hostTicket = random(32);
    const invite = random(32);
    const [host, phone] = await Promise.all([digest(hostTicket), digest(invite)]);
    return this.storage.transaction(async (tx) => {
      const state = await tx.get(STATE) ?? emptyState();
      const now = this.now();
      for (const [id, room] of Object.entries(state.rooms)) if (room.expiresAt <= now) delete state.rooms[id];
      if (Object.keys(state.rooms).length >= DAILY_MINTS) return limited();
      let room;
      do room = `T${random(6).slice(0, 11).toUpperCase()}`; while (state.rooms[room]);
      const expiresAt = now + ROOM_MS;
      state.rooms[room] = { host, phone, expiresAt };
      await tx.put(STATE, state);
      return result(201, { room, hostTicket, invite, expiresAt });
    });
  }

  async admit(room, role, ticket) {
    if (!TRIAL_ROOM.test(room) || !TICKET.test(ticket) || (role !== 'host' && role !== 'phone')) return false;
    const hash = await digest(ticket);
    const record = (await this.storage.get(STATE))?.rooms[room];
    return !!record && record.expiresAt > this.now() && record[role] === hash;
  }

  async grant(room, ticket) {
    if (!TRIAL_ROOM.test(room) || !TICKET.test(ticket)) return denied();
    const hash = await digest(ticket);
    const record = (await this.storage.get(STATE))?.rooms[room];
    if (!record || record.expiresAt <= this.now() || (record.host !== hash && record.phone !== hash)) return denied();
    let work = this.#inflight.get(room);
    if (!work) {
      work = this.#grant(room);
      this.#inflight.set(room, work);
    }
    try {
      return await work;
    } finally {
      if (this.#inflight.get(room) === work) this.#inflight.delete(room);
    }
  }

  async #grant(room) {
    // Reserve durably before contacting the provider. Timeouts, resets and failed mints
    // still consume the attempt; retrying an ambiguous provider write could mint twice.
    const reservation = await this.storage.transaction(async (tx) => {
      const state = await tx.get(STATE) ?? emptyState();
      const record = state.rooms[room];
      const now = this.now();
      if (!record || record.expiresAt <= now) return denied();
      if (record.grant?.expiresAt > now) return result(200, record.grant);
      if (record.attempted) return unavailable();
      const ttl = Math.floor((record.expiresAt - now - 5000) / 1000);
      if (ttl < 60) return unavailable();
      state.attempts = state.attempts.filter((at) => at > now - DAY_MS);
      if (state.attempts.length >= DAILY_MINTS) return limited();
      state.attempts.push(now);
      record.attempted = true;
      await tx.put(STATE, state);
      return { ttl, expiresAt: now + ttl * 1000 };
    });
    if ('status' in reservation) return reservation;
    const { ttl, expiresAt } = reservation;
    let iceServers;
    try {
      iceServers = await this.mint(ttl);
    } catch (error) {
      // Never log arbitrary exception text: it may contain a provider URL, token or response.
      console.warn('S9 TURN grant:', error instanceof TurnProviderError ? error.message : 'provider-failure');
      return unavailable();
    }
    if (!Array.isArray(iceServers) || !iceServers.length || expiresAt <= this.now()) {
      console.warn('S9 TURN grant:', expiresAt <= this.now() ? 'grant-expired' : 'no-usable-servers');
      return unavailable();
    }
    const grant = { iceServers, expiresAt };
    try {
      await this.storage.transaction(async (tx) => {
        const state = await tx.get(STATE);
        state.rooms[room].grant = grant;
        await tx.put(STATE, state);
      });
      return result(200, grant);
    } catch {
      console.warn('S9 TURN grant:', 'storage-failure');
      return unavailable();
    }
  }
}

export function trialEnabled(env) {
  return env.S9_TURN_TRIAL === '1' && TICKET.test(env.S9_TURN_OWNER_SECRET ?? '') &&
    !!env.TURN_KEY_ID && !!env.TURN_KEY_API_TOKEN;
}

export function trialStub(env) {
  return env.TURN_TRIAL.getByName('deployment');
}

export function trialTicket(req) {
  const protocols = req.headers.get('Sec-WebSocket-Protocol')?.split(',').map((s) => s.trim()) ?? [];
  const ticket = protocols[1]?.slice('ticket.'.length);
  return protocols.length === 2 && protocols[0] === TRIAL_PROTOCOL &&
    protocols[1].startsWith('ticket.') && TICKET.test(ticket) ? ticket : '';
}

async function ownerMatches(ticket, secret) {
  if (!TICKET.test(ticket)) return false;
  const settings = { name: 'HMAC', hash: 'SHA-256' };
  const [expected, offered] = await Promise.all(
    [secret, ticket].map((s) => crypto.subtle.importKey('raw', encoder.encode(s), settings, false, ['sign', 'verify'])),
  );
  const context = encoder.encode('s9-turn-trial');
  return crypto.subtle.verify('HMAC', expected, await crypto.subtle.sign('HMAC', offered, context), context);
}

export async function handleTrial(req, env) {
  const headers = {
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(req.url).pathname;
  const room = /^\/turn-trial\/([^/]+)$/.exec(path)?.[1];
  const ticket = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  let reply;
  if (req.method !== 'POST') reply = result(405, { error: 'expected-post' });
  else if (!trialEnabled(env)) reply = unavailable();
  else if (path === '/turn-trial') {
    reply = await ownerMatches(ticket, env.S9_TURN_OWNER_SECRET) ? await trialStub(env).open() : denied();
  } else if (room && TRIAL_ROOM.test(room) && ticket) reply = await trialStub(env).grant(room, ticket);
  else reply = denied();
  return Response.json(reply.body, { status: reply.status, headers });
}

export async function mintTurn(env, ttl, request = fetch) {
  const id = encodeURIComponent(env.TURN_KEY_ID);
  const deadline = AbortSignal.timeout(4000);
  let response;
  try {
    response = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
      redirect: 'error',
      signal: deadline,
    });
  } catch {
    throw new TurnProviderError(deadline.aborted ? 'provider-timeout' : 'provider-request-failure');
  }
  if (!response.ok) throw new TurnProviderError(`provider-http-${response.status}`);
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload?.iceServers)) {
    throw new TurnProviderError(deadline.aborted ? 'provider-timeout' : 'provider-invalid-response');
  }
  return payload.iceServers.flatMap((server) => {
    if (!server || typeof server !== 'object') return [];
    const { urls, username, credential } = server;
    const turn = (Array.isArray(urls) ? urls : [urls]).filter((u) =>
      typeof u === 'string' && /^turns?:/.test(u) && !/:53\b/.test(u));
    return turn.length && typeof username === 'string' && username && typeof credential === 'string' && credential
      ? [{ urls: turn, username, credential }] : [];
  });
}
