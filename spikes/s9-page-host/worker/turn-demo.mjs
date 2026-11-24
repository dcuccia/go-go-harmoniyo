import { TurnProviderError } from './turn-trial.mjs';

export const DEMO_ROOM = /^D[0-9A-F]{11}$/;
export const DEMO_PROTOCOL = 's9-demo';
export const DEMO_WINDOW_MS = 10 * 60_000;
export const DEMO_ROOM_MS = 90 * 60_000;
export const DEMO_GRANT_MS = 20 * 60_000;
export const DEMO_OPEN_PER_SOURCE = 12;
export const DEMO_OPEN_GLOBAL = 96;
export const DEMO_MINT_PER_SOURCE = 8;
export const DEMO_MINT_GLOBAL = 48;
export const DEMO_ACTIVE_PER_SOURCE = 16;
export const DEMO_ACTIVE_GLOBAL = 128;
const MAX_ENABLE_MS = 12 * 60 * 60_000;
const STATE = 'demo-v1';
const TICKET = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = async (value) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const phoneTicket = (host) => digest(`s9-demo-phone:${host}`);
const roomKey = (phone) => digest(`s9-demo-room:${phone}`);
const roomCode = (key) => `D${key.slice(0, 11).toUpperCase()}`;
const result = (status, body) => ({ status, body });
const denied = () => result(401, { error: 'invalid-or-expired' });
const unavailable = () => result(503, { error: 'relay-unavailable' });
const limited = () => result(429, { error: 'demo-limit' });
const empty = () => ({ rooms: {}, opens: [], mints: [] });

export function demoUntil(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length !== 20 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return 0;
  const until = Date.parse(value);
  return until > now && until <= now + MAX_ENABLE_MS && new Date(until).toISOString().replace('.000Z', 'Z') === value ? until : 0;
}

export function demoExpiry(env, now = Date.now()) {
  return env.S9_TURN_DEMO === '1' && env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN
    ? demoUntil(env.S9_TURN_DEMO_UNTIL, now) : 0;
}

export function demoTicket(req) {
  const protocols = req.headers.get('Sec-WebSocket-Protocol')?.split(',').map((part) => part.trim()) ?? [];
  return protocols.length === 2 && protocols[0] === DEMO_PROTOCOL
    ? /^ticket\.([0-9a-f]{64})$/.exec(protocols[1])?.[1] ?? '' : '';
}

// Signalling remains usable after minting stops or the room's grant record is pruned.
// The phone can prove its room, but cannot derive the host ticket.
export async function demoRoomKey(room, role, ticket) {
  if (!DEMO_ROOM.test(room) || !TICKET.test(ticket) || (role !== 'host' && role !== 'phone')) return '';
  const key = await roomKey(role === 'host' ? await phoneTicket(ticket) : ticket);
  return room === roomCode(key) ? key : '';
}

export async function demoAdmit(room, role, ticket) {
  return !!await demoRoomKey(room, role, ticket);
}

function prune(state, now) {
  for (const [id, record] of Object.entries(state.rooms)) if (record.expiresAt <= now) delete state.rooms[id];
  state.opens = state.opens.filter(({ at }) => at > now - DEMO_WINDOW_MS);
  state.mints = state.mints.filter(({ at }) => at > now - DEMO_WINDOW_MS);
}

function capped(attempts, source, perSource, total) {
  return attempts.length >= total || attempts.filter((entry) => entry.source === source).length >= perSource;
}

export class DemoState {
  #inflight = new Map();

  constructor(storage, mint, now = Date.now) {
    this.storage = storage;
    this.mint = mint;
    this.now = now;
  }

  async open(source, until) {
    const hostTicket = hex(crypto.getRandomValues(new Uint8Array(32)));
    const invite = await phoneTicket(hostTicket);
    const key = await roomKey(invite);
    const room = roomCode(key);
    return this.storage.transaction(async (tx) => {
      const state = await tx.get(STATE) ?? empty();
      const now = this.now();
      if (until <= now) return unavailable();
      prune(state, now);
      const active = Object.values(state.rooms);
      if (state.rooms[room] || active.length >= DEMO_ACTIVE_GLOBAL ||
          active.filter((record) => record.source === source).length >= DEMO_ACTIVE_PER_SOURCE ||
          capped(state.opens, source, DEMO_OPEN_PER_SOURCE, DEMO_OPEN_GLOBAL)) return limited();
      const expiresAt = now + DEMO_ROOM_MS;
      state.rooms[room] = { key, source, expiresAt };
      state.opens.push({ source, at: now });
      await tx.put(STATE, state);
      return result(201, { room, hostTicket, invite, expiresAt });
    });
  }

  async grant(room, role, ticket, until) {
    if (until <= this.now()) return unavailable();
    const key = await demoRoomKey(room, role, ticket);
    if (!key) return denied();
    // Authenticate the full invitation before joining in-flight work addressed by the short code.
    const record = (await this.storage.get(STATE))?.rooms[room];
    if (record?.key !== key || record.expiresAt <= this.now()) return denied();
    let work = this.#inflight.get(room);
    if (!work) {
      work = this.#grant(room, key, until);
      this.#inflight.set(room, work);
    }
    try {
      const reply = await work;
      return until > this.now() ? reply : unavailable();
    } finally {
      if (this.#inflight.get(room) === work) this.#inflight.delete(room);
    }
  }

  async #grant(room, key, until) {
    const reservation = await this.storage.transaction(async (tx) => {
      const state = await tx.get(STATE) ?? empty();
      const now = this.now();
      if (until <= now) return unavailable();
      prune(state, now);
      const record = state.rooms[room];
      if (record?.key !== key) return denied();
      if (record.grant?.expiresAt > now) return result(200, record.grant);
      // A failure may still have created a grant at the provider. Don't retry while it could be valid.
      if (record.reservedUntil > now) return unavailable();
      if (capped(state.mints, record.source, DEMO_MINT_PER_SOURCE, DEMO_MINT_GLOBAL)) return limited();
      const ttl = Math.floor(Math.min(DEMO_GRANT_MS, record.expiresAt - now) / 1000);
      if (ttl < 60) return unavailable();
      const expiresAt = now + ttl * 1000;
      delete record.grant;
      record.reservedUntil = expiresAt;
      state.mints.push({ source: record.source, at: now });
      await tx.put(STATE, state);
      return { ttl, expiresAt };
    });
    if ('status' in reservation) return reservation;
    const { ttl, expiresAt } = reservation;
    let iceServers;
    try {
      iceServers = await this.mint(ttl);
    } catch (error) {
      console.warn('S9 demo TURN grant:', error instanceof TurnProviderError ? error.message : 'provider-failure');
      return unavailable();
    }
    if (!iceServers?.length || Math.min(expiresAt, until) <= this.now()) return unavailable();
    const grant = { iceServers, expiresAt };
    return this.storage.transaction(async (tx) => {
      const state = await tx.get(STATE);
      const record = state?.rooms[room];
      if (record?.key !== key || Math.min(expiresAt, until) <= this.now()) return unavailable();
      record.grant = grant;
      await tx.put(STATE, state);
      return result(200, grant);
    });
  }
}

export async function handleDemo(req, env) {
  const url = new URL(req.url);
  const until = demoExpiry(env);
  const headers = { 'cache-control': 'no-store' };
  if (req.method === 'GET' && url.pathname === '/turn-demo') {
    return Response.json({ enabled: !!until, expiresAt: until || null }, { headers });
  }
  const path = /^\/turn-demo\/(D[0-9A-F]{11})\/(host|phone)$/.exec(url.pathname);
  let reply;
  if (req.method !== 'POST') reply = result(405, { error: 'expected-post' });
  else if (!until) reply = unavailable();
  else if (req.headers.get('Origin') !== url.origin) reply = denied();
  else if (url.pathname === '/turn-demo') {
    // Use Cloudflare's connection metadata, not client-supplied forwarding headers.
    const ip = req.headers.get('CF-Connecting-IP');
    reply = ip ? await env.TURN_DEMO.getByName('deployment').open(
      await digest(`s9-demo-source:${env.TURN_KEY_API_TOKEN}:${ip}`), until,
    ) : unavailable();
  } else {
    const ticket = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    const key = path && ticket ? await demoRoomKey(path[1], path[2], ticket) : '';
    if (!path || !ticket || !key || !await env.ROOMS.getByName(`demo:${key}`).hasHost()) reply = denied();
    else reply = await env.TURN_DEMO.getByName('deployment').grant(path[1], path[2], ticket, until);
  }
  return Response.json(reply.body, { status: reply.status, headers });
}
