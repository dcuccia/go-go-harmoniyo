// Preloaded by `npm test` (node --import): the unit tests must never reach the AI node or any
// other host. Drops CUCCIA_AI_* so nothing picks up real settings, and only allows TCP/UDP to
// loopback (the mock node and the wake-packet listener bind 127.0.0.1). Every outbound
// connection (fetch/undici, http, https/tls, net) goes through net.Socket#connect.
import dgram from 'node:dgram';
import net from 'node:net';

for (const k of Object.keys(process.env)) if (k.startsWith('CUCCIA_AI_')) delete process.env[k];
process.env.CUCCIA_AI_OFFLINE_GUARD = '1';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const isLoopback = (host: unknown) => typeof host === 'string' && (LOOPBACK.has(host) || /^127\./.test(host));
const refuse = (host: unknown) => {
  throw new Error(`offline-guard: unit tests may only connect to loopback, not ${String(host)}`);
};

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') {
    const o = first as { path?: string; host?: string };
    if (!o.path && !isLoopback(o.host ?? 'localhost')) refuse(o.host);
  } else if (typeof first === 'number' && !isLoopback(typeof args[1] === 'string' ? args[1] : 'localhost')) {
    refuse(args[1]);
  }
  return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (this: dgram.Socket, ...args: unknown[]) {
  const address = args.find((a, i) => i > 0 && typeof a === 'string');
  if (!isLoopback(address)) refuse(address);
  return (send as (...a: unknown[]) => void).apply(this, args);
} as typeof dgram.Socket.prototype.send;
