// Go Go HarmoniYo S9 signalling Worker (Cloudflare Workers free plan).
//   /signal/<ROOM>?role=host|phone&peer=<id>  WebSocket → one Durable Object per room (relay only)
//   /ice                                      ICE servers for RTCPeerConnection (STUN; TURN if configured)
//   anything else                             the static web build (TV page at /, phone controller at /c/)
// Owner deploy (S9 report): `npx wrangler login`, then `npx wrangler deploy` from spikes/s9-page-host.
import { DurableObject } from 'cloudflare:workers';
import { onJoin, onLeave, onMessage, parseJoin } from '../signal/relay.mjs';

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export default {
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/signal/')) {
      const j = parseJoin(url);
      if (typeof j === 'string') return new Response(j, { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(j.room)).fetch(req);
    }
    if (url.pathname === '/ice') return iceServers(env);
    return env.ASSETS.fetch(req);
  },
};

/**
 * STUN only by default. If the owner adds a Cloudflare Realtime TURN key (`npx wrangler secret put
 * TURN_KEY_ID` and `TURN_KEY_API_TOKEN`), mint short-lived TURN credentials per request.
 */
async function iceServers(env) {
  // CORS: the app shells load the TV page from https://localhost (Android) / capacitor://localhost (iOS).
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return new Response(JSON.stringify({ iceServers: STUN, turn: false }), { headers });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 4 * 3600 }),
  });
  if (!r.ok) return new Response(JSON.stringify({ iceServers: STUN, turn: false, error: r.status }), { headers });
  const { iceServers } = await r.json();
  // Port 53 alternates are blocked by browsers and only add timeouts.
  for (const s of iceServers) if (Array.isArray(s.urls)) s.urls = s.urls.filter((u) => !/:53\b/.test(u));
  return new Response(JSON.stringify({ iceServers, turn: true }), { headers });
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
    const j = parseJoin(new URL(req.url));
    if (typeof j === 'string') return new Response(j, { status: 400 });
    const { 0: client, 1: server } = new WebSocketPair();
    const others = this.sockets();
    this.ctx.acceptWebSocket(server, [j.role, j.peer]);
    onJoin(this.wrap(server), others);
    return new Response(null, { status: 101, webSocket: client });
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
