export const TRIAL_ROOM = /^T[0-9A-F]{11}$/;
const TICKET = /^[0-9a-f]{64}$/;

export interface TrialRoom {
  room: string;
  hostTicket: string;
  invite: string;
  expiresAt: number;
}

export function trialProtocols(ticket: string): string[] {
  return ['s9-trial', `ticket.${ticket}`];
}

export function trialInvite(room: string, hash: string): string {
  const ticket = new URLSearchParams(hash.slice(1)).get('invite') ?? '';
  return TRIAL_ROOM.test(room) && TICKET.test(ticket) ? ticket : '';
}

export function isTrialOrigin(origin: string): boolean {
  return /^https:\/\/go-go-harmoniyo-turn-trial\.[a-z0-9-]+\.workers\.dev$/.test(origin) ||
    /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
}

async function request(origin: string, ticket: string, room = ''): Promise<Response> {
  if (!isTrialOrigin(origin) || !TICKET.test(ticket) || (room && !TRIAL_ROOM.test(room))) {
    throw new Error('Invalid relay trial service or ticket.');
  }
  return fetch(`${origin}/turn-trial${room ? `/${room}` : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ticket}` },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
}

export async function openTrialRoom(origin: string, secret: string): Promise<TrialRoom> {
  const r = await request(origin, secret);
  if (r.status === 401) throw new Error('The owner key was not accepted.');
  if (r.status === 429) throw new Error('Too many trial rooms are open. Try again later.');
  if (!r.ok) throw new Error('Relay trial is not available on this service.');
  const j = await r.json() as TrialRoom;
  if (!TRIAL_ROOM.test(j.room) || !TICKET.test(j.hostTicket) || !TICKET.test(j.invite) ||
      !Number.isFinite(j.expiresAt) || j.expiresAt <= Date.now()) throw new Error('Invalid relay trial response.');
  return j;
}

export async function trialIce(origin: string, room: string, ticket: string): Promise<RTCIceServer[]> {
  const r = await request(origin, ticket, room);
  if (!r.ok) throw new Error('Relay unavailable.');
  const j = await r.json() as { iceServers?: RTCIceServer[]; expiresAt?: number };
  if (!j.iceServers?.length || typeof j.expiresAt !== 'number' || j.expiresAt <= Date.now()) throw new Error('Relay unavailable.');
  return j.iceServers;
}
