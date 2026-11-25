// S9 local stand-in for the Cloudflare Worker (worker/index.js): the same signalling relay
// (signal/relay.mjs), /ice, and the static web build. No account, no deploy.
//   npx tsx server/dev-server.ts [--port 18960] [--host 0.0.0.0] [--no-stun] [--turn-port 18962]
//                                [--tunnel] [--open]
// Open http://localhost:<port>/ on this PC (a secure context); phones need HTTPS on another device:
// --tunnel publishes the server on a cloudflared quick tunnel (https://…trycloudflare.com) and the
// TV page should then be opened at that address so the QR points there too.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { onJoin, onLeave, onMessage, parseJoin } from '../signal/relay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, '..', 'dist', 'web');

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '18960' },
    host: { type: 'string', default: '0.0.0.0' },
    'no-stun': { type: 'boolean', default: false },
    'turn-port': { type: 'string' },
    tunnel: { type: 'boolean', default: false },
    web: { type: 'string', default: WEB },
    quiet: { type: 'boolean', default: false },
  },
});

const port = Number(args.port);
const log = (...a: unknown[]): void => {
  if (!args.quiet) console.log(...a);
};

function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) return n.address;
  return '127.0.0.1';
}

// ── optional local TURN (node-turn), to test relayed paths without a Cloudflare TURN key ──────
const TURN_USER = 's9';
const TURN_PASS = 's9-local';
let turnUrl = '';
if (args['turn-port']) {
  const { default: Turn } = (await import('node-turn')) as { default: new (o: Record<string, unknown>) => { start(): void } };
  const turnPort = Number(args['turn-port']);
  new Turn({ listeningPort: turnPort, authMech: 'long-term', credentials: { [TURN_USER]: TURN_PASS }, debugLevel: 'OFF' }).start();
  turnUrl = `turn:${lanIp()}:${turnPort}?transport=udp`;
  log(`local TURN on udp ${turnPort}: add ?turn=${encodeURIComponent(turnUrl)}&tu=${TURN_USER}&tc=${TURN_PASS} (and &relay=1 to force it)`);
}

function iceBody(): string {
  const iceServers: RTCIceServer[] = args['no-stun'] ? [] : [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  return JSON.stringify({ iceServers, turn: false });
}

// ── static files ───────────────────────────────────────────────────────────
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mid': 'audio/midi',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(args.web!, p));
  if (!file.startsWith(normalize(args.web!) + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    // /c → /c/ (like Workers assets' auto-trailing-slash).
    if (existsSync(join(file, 'index.html'))) {
      res.writeHead(307, { location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/ice') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(iceBody());
    return;
  }
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (path.startsWith('/signal/')) {
    res.writeHead(426, { 'content-type': 'text/plain' }).end('expected a WebSocket');
    return;
  }
  serveStatic(req, res);
});

// ── signalling: the same relay as the Durable Object, one Set of sockets per room ─────────────
interface Member {
  ws: WebSocket;
  role: 'host' | 'phone';
  peer: string;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}
const rooms = new Map<string, Set<Member>>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const j = parseJoin(url);
  if (typeof j === 'string') {
    socket.end(`HTTP/1.1 400 Bad Request\r\n\r\n${j}`);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const set = rooms.get(j.room) ?? new Set<Member>();
    rooms.set(j.room, set);
    const me: Member = {
      ws,
      role: j.role as 'host' | 'phone',
      peer: j.peer,
      send: (text) => ws.readyState === ws.OPEN && ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };
    const others = (): Member[] => [...set].filter((m) => m !== me && m.ws.readyState === m.ws.OPEN);
    if (!onJoin(me, others())) return;
    set.add(me);
    log(`[signal] ${j.room} +${j.role} ${j.peer} (${set.size})`);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) onMessage(me, data.toString(), others());
    });
    ws.on('close', () => {
      set.delete(me);
      onLeave(me, others());
      if (!set.size) rooms.delete(j.room);
      log(`[signal] ${j.room} -${j.role} ${j.peer} (${set.size})`);
    });
  });
});

server.listen(port, args.host, () => {
  log(`S9 dev server: http://localhost:${port}/  (LAN http://${lanIp()}:${port}/ — phones need HTTPS: use --tunnel)`);
  if (!existsSync(join(args.web!, 'index.html'))) log(`  no build in ${args.web}: run "npm run build" first`);
});

if (args.tunnel) {
  const { findCloudflared } = await import('../../s1-phone-bell/src/host/transport.ts');
  const { QuickTunnel } = await import('../../s1-phone-bell/src/host/tunnel.ts');
  const cf = findCloudflared();
  if (!cf) log('cloudflared not found (install it or set GOGOHARMONIYO_CLOUDFLARED); serving locally only');
  else {
    const tunnel = new QuickTunnel({
      cloudflared: cf.path,
      originPort: port,
      onChange: (state, url, reason) => {
        log(`[tunnel] ${state}${url ? ` ${url}` : ''}${reason ? ` (${reason})` : ''}`);
        if (state === 'up') log(`  open the TV page at ${url} — its QR then points phones at ${new URL('c/', url).href}`);
      },
    });
    tunnel.start();
    process.on('SIGINT', () => {
      tunnel.stop();
      process.exit(0);
    });
  }
}
