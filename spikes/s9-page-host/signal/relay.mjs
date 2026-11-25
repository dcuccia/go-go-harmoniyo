// Signalling relay for one room: introduces phones to the TV page, then gets out of the way (game
// traffic goes over WebRTC data channels). Shared by the Cloudflare Worker's Durable Object
// (worker/index.js) and the local Node stand-in (server/dev-server.ts), so both behave the same.
//
// Sockets join with a role and a peer id (WebSocket /signal/<ROOM>?role=host|phone&peer=<id>).
// Phone → host: {type:'signal', data} is forwarded to the host as {type:'signal', from, data}.
// Host → phone: {type:'signal', to, data} is forwarded to that phone as {type:'signal', from:'host', data}.
// The relay never looks inside `data` (SDP offers/answers, ICE candidates).

export const ROOM_RE = /^[A-Z0-9]{4,12}$/;
export const PEER_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Signalling messages are small (SDP ~ 1–4 KB); anything bigger is not ours. */
export const MAX_MESSAGE = 32 * 1024;
export const MAX_PEERS = 32;
/** Close code for a socket replaced by a newer one with the same role/peer. */
export const CLOSE_REPLACED = 4001;

/**
 * Validate a join request. Returns `{room, role, peer}` or an error string.
 * @param {URL} url
 */
export function parseJoin(url) {
  const m = /^\/signal\/([^/]+)$/.exec(url.pathname);
  if (!m) return 'not a signalling path';
  const room = m[1].toUpperCase();
  const role = url.searchParams.get('role');
  const peer = url.searchParams.get('peer') ?? '';
  if (!ROOM_RE.test(room)) return 'bad room code';
  if (role !== 'host' && role !== 'phone') return 'role must be host or phone';
  if (!PEER_RE.test(peer)) return 'bad peer id';
  return { room, role, peer };
}

/**
 * @typedef {{ role: 'host' | 'phone', peer: string, send: (text: string) => void, close: (code?: number, reason?: string) => void }} RelaySocket
 */

/**
 * A socket joined. `others` is every *other* socket in the room. Returns false if `me` was refused.
 * @param {RelaySocket} me
 * @param {RelaySocket[]} others
 */
export function onJoin(me, others) {
  if (me.role === 'host') {
    // Newest TV page wins (a reload, or the app reopened): drop the old one.
    for (const o of others) if (o.role === 'host') o.close(CLOSE_REPLACED, 'replaced by a newer host');
    const phones = others.filter((o) => o.role === 'phone');
    for (const p of phones) p.send(JSON.stringify({ type: 'host', online: true }));
    me.send(JSON.stringify({ type: 'joined', role: 'host', phones: phones.map((p) => p.peer) }));
    return true;
  }
  if (others.filter((o) => o.role === 'phone').length >= MAX_PEERS) {
    me.close(4029, 'room full');
    return false;
  }
  // Same phone id twice (a reload before the old socket closed): the newer one wins.
  for (const o of others) if (o.role === 'phone' && o.peer === me.peer) o.close(CLOSE_REPLACED, 'replaced');
  const host = others.find((o) => o.role === 'host');
  me.send(JSON.stringify({ type: 'joined', role: 'phone', host: !!host }));
  return true;
}

/**
 * Route one message.
 * @param {RelaySocket} me
 * @param {string} text
 * @param {RelaySocket[]} others
 */
export function onMessage(me, text, others) {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE) return;
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }
  if (!m || typeof m !== 'object') return;
  if (m.type === 'ping') {
    me.send(JSON.stringify({ type: 'pong', t: m.t }));
    return;
  }
  if (m.type !== 'signal') return;
  if (me.role === 'phone') {
    const host = others.find((o) => o.role === 'host');
    if (!host) {
      me.send(JSON.stringify({ type: 'error', reason: 'no-host' }));
      return;
    }
    host.send(JSON.stringify({ type: 'signal', from: me.peer, data: m.data }));
    return;
  }
  const to = others.find((o) => o.role === 'phone' && o.peer === m.to);
  if (to) to.send(JSON.stringify({ type: 'signal', from: 'host', data: m.data }));
}

/**
 * A socket left. `others` excludes it.
 * @param {RelaySocket} me
 * @param {RelaySocket[]} others
 */
export function onLeave(me, others) {
  if (me.role === 'host') {
    // Only announce if no newer host took over.
    if (others.some((o) => o.role === 'host')) return;
    for (const p of others) if (p.role === 'phone') p.send(JSON.stringify({ type: 'host', online: false }));
  } else {
    for (const h of others) if (h.role === 'host') h.send(JSON.stringify({ type: 'peer-left', peer: me.peer }));
  }
}
