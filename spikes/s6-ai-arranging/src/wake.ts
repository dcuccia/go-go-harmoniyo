// Wake-on-LAN for the AI node (it sleeps after ~30 idle minutes). Re-implements, in TypeScript,
// the behaviour of cuccia-infra's services/ai-worker/cuccia_ai_client.py (no code copied): cache
// the node's wake details from /node/status while it is awake, and when /healthz stops
// answering send a magic packet and poll until it does. Shares the helper's cache file
// (~/.cache/cuccia-ai/wake.json) so either client can wake the node.
import { createSocket } from 'node:dgram';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_WAKE_CACHE = join(homedir(), '.cache', 'cuccia-ai', 'wake.json');

export interface WakeInfo { mac: string; broadcast: string; port?: number }

/** 6 × 0xFF followed by the MAC repeated 16 times. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[:-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) throw new Error('MAC must have six octets');
  const m = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => m)]);
}

export function sendWake(w: WakeInfo): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createSocket('udp4');
    s.once('error', (e) => (s.close(), reject(e)));
    s.bind(() => {
      s.setBroadcast(true);
      s.send(magicPacket(w.mac), w.port ?? 9, w.broadcast, (e) => (s.close(), e ? reject(e) : resolve()));
    });
  });
}

export function readWakeCache(path = DEFAULT_WAKE_CACHE): WakeInfo | null {
  try {
    const w = JSON.parse(readFileSync(path, 'utf8'));
    return w?.mac && w?.broadcast ? w : null;
  } catch {
    return null;
  }
}

export function writeWakeCache(w: WakeInfo, path = DEFAULT_WAKE_CACHE): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(w));
}
