// Go Go HarmoniYo S9 signalling Worker (Cloudflare Workers free plan).
//   /signal/<ROOM>?role=host|phone&peer=<id>  WebSocket → one Durable Object per room (relay only)
//   /ice                                      public STUN only
//   /turn-trial[/<ROOM>]                       protected, opt-in relay trial
//   anything else                             the static web build (TV page at /, phone controller at /c/)
// Owner deployment: see docs/spikes/S9-report.md. The initial rollout is STUN-only.
import { DurableObject } from 'cloudflare:workers';
import { onJoin, onLeave, onMessage, parseJoin } from '../signal/relay.mjs';
import { handleTrial, mintTurn, TrialState, TRIAL_PROTOCOL, TRIAL_ROOM, trialEnabled, trialStub, trialTicket } from './turn-trial.mjs';

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export default {
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/signal/')) {
      const j = parseJoin(url);
      if (typeof j === 'string') return new Response(j, { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
      const trial = url.searchParams.get('trial') === '1';
      if (trial) {
        const ticket = trialTicket(req);
        if (!trialEnabled(env) || !TRIAL_ROOM.test(j.room) || !ticket || !await trialStub(env).admit(j.room, j.role, ticket)) {
          return new Response('invalid or expired trial invitation', { status: 403 });
        }
      }
      return env.ROOMS.get(env.ROOMS.idFromName(trial ? `trial:${j.room}` : j.room)).fetch(req);
    }
    if (url.pathname === '/ice') return Response.json({ iceServers: STUN, turn: false }, {
      headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
    });
    if (url.pathname === '/turn-trial' || url.pathname.startsWith('/turn-trial/')) return handleTrial(req, env);
    return env.ASSETS.fetch(req);
  },
};

export class TurnTrial extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = new TrialState(ctx.storage, (ttl) => mintTurn(env, ttl));
  }

  open() { return this.state.open(); }
  admit(room, role, ticket) { return this.state.admit(room, role, ticket); }
  grant(room, ticket) { return this.state.grant(room, ticket); }
}

/** One room. Uses the WebSocket Hibernation API, so an idle room costs nothing. */
export class SignalRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The TV's keep-alive pings are answered without waking the object (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /** @param {Request} req */
  async fetch(req) {
    const url = new URL(req.url);
    const j = parseJoin(url);
    if (typeof j === 'string') return new Response(j, { status: 400 });
    const { 0: client, 1: server } = new WebSocketPair();
    const others = this.sockets();
    this.ctx.acceptWebSocket(server, [j.role, j.peer]);
    onJoin(this.wrap(server), others);
    const headers = url.searchParams.get('trial') === '1' ? { 'Sec-WebSocket-Protocol': TRIAL_PROTOCOL } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  /** @param {WebSocket} ws @param {string | ArrayBuffer} msg */
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    onMessage(this.wrap(ws), msg, this.sockets(ws));
  }

  /** @param {WebSocket} ws */
  async webSocketClose(ws) {
    onLeave(this.wrap(ws), this.sockets(ws));
  }

  /** @param {WebSocket} ws */
  async webSocketError(ws) {
    onLeave(this.wrap(ws), this.sockets(ws));
  }

  /** Every open socket in the room except `skip`. */
  sockets(skip) {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== skip && ws.readyState === WebSocket.OPEN)
      .map((ws) => this.wrap(ws));
  }

  /** @param {WebSocket} ws */
  wrap(ws) {
    const [role, peer] = this.ctx.getTags(ws);
    return {
      role,
      peer,
      send: (text) => {
        try {
          ws.send(text);
        } catch {
          /* closing */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };
  }
}
