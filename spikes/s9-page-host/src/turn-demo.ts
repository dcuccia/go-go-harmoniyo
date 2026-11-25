import type { TrialRoom } from './turn-trial.ts';

const DEMO_ROOM = /^D[0-9A-F]{11}$/;
const TICKET = /^[0-9a-f]{64}$/;

export function demoProtocols(ticket: string): string[] {
  return ['s9-demo', `ticket.${ticket}`];
}

export function demoInvite(room: string, hash: string): string {
  const ticket = new URLSearchParams(hash.slice(1)).get('invite') ?? '';
  return DEMO_ROOM.test(room) && TICKET.test(ticket) ? ticket : '';
}

function request(origin: string, path: string, timeout: number, ticket?: string): Promise<Response> {
  if (origin !== location.origin) throw new Error('Demo relay must use the page origin.');
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: ticket ? { Authorization: `Bearer ${ticket}` } : undefined,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
  });
}

export async function openDemoRoom(origin: string): Promise<TrialRoom | undefined> {
  const response = await request(origin, '/turn-demo', 2000);
  if (!response.ok) return undefined;
  const j = await response.json() as TrialRoom;
  if (!DEMO_ROOM.test(j.room) || !TICKET.test(j.hostTicket) || !TICKET.test(j.invite) ||
      !Number.isFinite(j.expiresAt) || j.expiresAt <= Date.now()) throw new Error('Invalid demo room response.');
  return j;
}

export async function demoIce(origin: string, room: string, role: 'host' | 'phone', ticket: string): Promise<RTCIceServer[]> {
  if (!DEMO_ROOM.test(room) || !TICKET.test(ticket)) throw new Error('Invalid demo room or ticket.');
  const response = await request(origin, `/turn-demo/${room}/${role}`, 8000, ticket);
  if (!response.ok) throw new Error('Relay unavailable.');
  const j = await response.json() as { iceServers?: RTCIceServer[]; expiresAt?: number };
  if (!j.iceServers?.length || typeof j.expiresAt !== 'number' || j.expiresAt <= Date.now()) throw new Error('Relay unavailable.');
  return j.iceServers;
}
