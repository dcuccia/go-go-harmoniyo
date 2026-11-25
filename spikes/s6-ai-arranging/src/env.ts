// Compute-node connection settings (contract v0, cuccia-infra docs/ai-node-consumers.md).
// Reads CUCCIA_AI_BASE_URL / CUCCIA_AI_TOKEN / CUCCIA_AI_CA_CERT from the process environment,
// falling back to the Windows *User* environment (HKCU\Environment) so values set with
// [Environment]::SetEnvironmentVariable(..., 'User') work without restarting the shell.
// The token is never printed or logged: use `describe()` for a safe summary.
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Current contract default: HTTPS with the node's private CA. */
export const DEFAULT_BASE_URL = 'https://north.local';
/** Pre-TLS address (contract v0 as first published); still accepted via CUCCIA_AI_BASE_URL. */
export const LEGACY_BASE_URL = 'http://dcuccia-north.local:8790';
/** SHA-256 fingerprint (DER) of the node's ca.crt as published by cuccia-infra (2026-10-24). Override: CUCCIA_AI_CA_SHA256. */
export const EXPECTED_CA_SHA256 = '78f6aa75a55be33103768a58764c986f9ed8b0114dcf4f623cbfd0b9a13357cc';

export interface NodeConfig {
  baseUrl: string;
  token: string | null;
  tokenSource: 'process' | 'windows-user' | 'none';
  /** PEM of the verified private CA (HTTPS base URLs), or null to use the system store. */
  caPem?: string | null;
  caPath?: string | null;
}

function windowsUserEnv(name: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'm').exec(out);
    return m ? m[1].trim() || null : null;
  } catch {
    return null;
  }
}

const envOrUser = (env: NodeJS.ProcessEnv, name: string) => env[name] || windowsUserEnv(name) || null;

/**
 * Read a CA file and check it against the published SHA-256; throws on mismatch. cuccia-infra
 * publishes the certificate fingerprint (SHA-256 of the DER), which differs from a hash of the
 * PEM file's bytes; either matches.
 */
export function loadVerifiedCa(path: string, expected = EXPECTED_CA_SHA256): string {
  const bytes = readFileSync(path);
  const want = expected.replace(/:/g, '').toLowerCase();
  let fingerprint: string | null = null;
  try {
    fingerprint = new X509Certificate(bytes).fingerprint256.replace(/:/g, '').toLowerCase();
  } catch {}
  const fileSha = createHash('sha256').update(bytes).digest('hex');
  if (want !== fingerprint && want !== fileSha) {
    throw new Error(`CUCCIA_AI_CA_CERT ${path}: certificate SHA-256 ${fingerprint ?? '(not a certificate)'} (file ${fileSha}) does not match the published ${want}; refusing to trust it`);
  }
  return bytes.toString('utf8');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const baseUrl = (envOrUser(env, 'CUCCIA_AI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const caPath = envOrUser(env, 'CUCCIA_AI_CA_CERT');
  const caPem = caPath && baseUrl.startsWith('https:') ? loadVerifiedCa(caPath, env.CUCCIA_AI_CA_SHA256 || EXPECTED_CA_SHA256) : null;
  const base = { baseUrl, caPem, caPath };
  if (env.CUCCIA_AI_TOKEN) return { ...base, token: env.CUCCIA_AI_TOKEN, tokenSource: 'process' };
  const user = windowsUserEnv('CUCCIA_AI_TOKEN');
  if (user) return { ...base, token: user, tokenSource: 'windows-user' };
  return { ...base, token: null, tokenSource: 'none' };
}

/** Safe one-line summary (no token material, not even a prefix). */
export function describe(c: NodeConfig): string {
  const tls = c.baseUrl.startsWith('https:') ? (c.caPem ? ', private CA verified' : ', system CA store') : '';
  return `${c.baseUrl} (token: ${c.token ? `present, from ${c.tokenSource}` : 'MISSING'}${tls})`;
}

/** Replace any occurrence of the token in a string (error messages, logged bodies). */
export function redact(text: string, token: string | null): string {
  return token ? text.split(token).join('[REDACTED]') : text;
}
