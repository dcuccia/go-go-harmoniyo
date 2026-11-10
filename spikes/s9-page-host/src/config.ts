// Where the signalling service lives, and this TV's room code.
//
// Signal origin, first match wins:
//   ?signal=<origin>                       (also remembered, so a TV only needs it once)
//   localStorage 'gogoharmoniyo.s9.signal'
//   build-time VITE_SIGNAL_ORIGIN / S9_SIGNAL_ORIGIN (the APK/IPA bake in the deployed Worker URL)
//   location.origin when the page itself came from http(s) (Worker or dev server serve both)
// Inside the Capacitor shell the page origin is https://localhost or capacitor://localhost, which is
// not a signalling server, so the shell needs one of the first three.

const KEY_SIGNAL = 'gogoharmoniyo.s9.signal';
const KEY_ROOM = 'gogoharmoniyo.s9.room';
/** No 0/O/1/I: read off a TV across the room. */
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

declare const __S9_SIGNAL_ORIGIN__: string | undefined;

function bakedOrigin(): string {
  try {
    return typeof __S9_SIGNAL_ORIGIN__ === 'string' ? __S9_SIGNAL_ORIGIN__ : '';
  } catch {
    return '';
  }
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True inside the Capacitor shell serving bundled files (its bridge defines window.Capacitor; the origin is local). */
export function isAppShell(loc: Location = location): boolean {
  return !!(window as { Capacitor?: unknown }).Capacitor && (loc.protocol === 'capacitor:' || loc.hostname === 'localhost');
}

export function normalizeOrigin(s: string): string {
  const u = new URL(s.trim());
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('signal origin must be http(s)');
  return u.origin;
}

export function signalOrigin(params = new URLSearchParams(location.search)): string {
  const p = params.get('signal');
  if (p) {
    try {
      const o = normalizeOrigin(p);
      store()?.setItem(KEY_SIGNAL, o);
      return o;
    } catch {
      /* ignore a bad parameter */
    }
  }
  const saved = store()?.getItem(KEY_SIGNAL);
  if (saved) return saved;
  const baked = bakedOrigin();
  if (baked) return baked;
  if (!isAppShell() && /^https?:$/.test(location.protocol)) return location.origin;
  return '';
}

export function setSignalOrigin(origin: string): void {
  if (origin) store()?.setItem(KEY_SIGNAL, normalizeOrigin(origin));
  else store()?.removeItem(KEY_SIGNAL);
}

export function newRoomCode(n = 6, rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ROOM_CHARS[Math.floor(rand() * ROOM_CHARS.length)];
  return s;
}

/** This TV's room: stable across reloads so phones that saved the link can rejoin. `?room=` overrides. */
export function roomCode(params = new URLSearchParams(location.search)): string {
  const p = params.get('room')?.toUpperCase();
  if (p && /^[A-Z0-9]{4,12}$/.test(p)) return p;
  const s = store();
  let r = s?.getItem(KEY_ROOM);
  if (!r || !/^[A-Z0-9]{4,12}$/.test(r)) {
    r = newRoomCode();
    s?.setItem(KEY_ROOM, r);
  }
  return r;
}

export function wsUrl(origin: string, path: string): string {
  return origin.replace(/^http/, 'ws') + path;
}
