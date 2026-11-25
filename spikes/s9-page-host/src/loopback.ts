// The game page's own HGP link when the host runs in the same page: a socket-shaped pair whose
// messages are delivered on a microtask. Same JSON as over the network, so the game code is
// unchanged; the host and the game share performance.now(), so the game's clock sync converges on
// an offset of ~0 with an RTT of ~0.
import type { HostConn } from '../../s1-phone-bell/src/core/host-session.ts';

export interface LoopbackSocket {
  readyState: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface HostSide {
  /** Called with the host end once the pair is open. */
  accept(conn: HostConn): { message(text: string, rx: number): void; closed(): void };
  now(): number;
}

const OPEN = 1;
const CLOSED = 3;

/** Create the game end; the host end is handed to `host.accept` when it opens. */
export function loopback(host: HostSide): LoopbackSocket {
  let handler: ReturnType<HostSide['accept']> | null = null;
  const game: LoopbackSocket = {
    readyState: 0,
    send(text) {
      if (game.readyState !== OPEN) return;
      queueMicrotask(() => handler?.message(text, host.now()));
    },
    close(code = 1000, reason = '') {
      if (game.readyState === CLOSED) return;
      game.readyState = CLOSED;
      queueMicrotask(() => {
        handler?.closed();
        handler = null;
        game.onclose?.({ code, reason });
      });
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const conn: HostConn = {
    get open() {
      return game.readyState === OPEN;
    },
    send(text) {
      if (game.readyState === OPEN) queueMicrotask(() => game.readyState === OPEN && game.onmessage?.({ data: text }));
    },
    close(code, reason) {
      game.close(code, reason);
    },
  };
  // The caller assigns onopen right after creating the socket, as with a WebSocket.
  setTimeout(() => {
    if (game.readyState !== 0) return;
    game.readyState = OPEN;
    handler = host.accept(conn);
    game.onopen?.({});
  }, 0);
  return game;
}
