import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiNodeClient } from '../src/client.ts';
import { DEFAULT_BASE_URL, describe as describeConfig, loadConfig, loadVerifiedCa } from '../src/env.ts';
import { startMockNode } from '../src/mock-node.ts';
import { caFetch } from '../src/tls-fetch.ts';
import { magicPacket, readWakeCache } from '../src/wake.ts';

const tmp = mkdtempSync(join(tmpdir(), 's6-node-'));

test('HTTPS is the default base URL; the legacy HTTP URL still works via env', () => {
  const env = { CUCCIA_AI_TOKEN: 'x', CUCCIA_AI_BASE_URL: '' };
  if (process.platform !== 'win32') assert.equal(loadConfig(env).baseUrl, DEFAULT_BASE_URL);
  assert.equal(loadConfig({ ...env, CUCCIA_AI_BASE_URL: 'http://dcuccia-north.local:8790/' }).baseUrl, 'http://dcuccia-north.local:8790');
});

test('private CA is trusted only when its SHA-256 matches', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
  const p = join(tmp, 'ca.crt');
  writeFileSync(p, pem);
  const sha = createHash('sha256').update(pem).digest('hex');
  assert.equal(loadVerifiedCa(p, sha.toUpperCase()), pem);
  assert.throws(() => loadVerifiedCa(p), /does not match the published/);
  const cfg = loadConfig({ CUCCIA_AI_BASE_URL: 'https://north.local', CUCCIA_AI_TOKEN: 't', CUCCIA_AI_CA_CERT: p, CUCCIA_AI_CA_SHA256: sha });
  assert.equal(cfg.caPem, pem);
  assert.match(describeConfig(cfg), /private CA verified/);
  assert.throws(() => loadConfig({ CUCCIA_AI_BASE_URL: 'https://north.local', CUCCIA_AI_CA_CERT: p }), /refusing to trust/);
});

test('private CA also matches by certificate fingerprint (SHA-256 of the DER), the form cuccia-infra publishes', () => {
  // Throwaway self-signed P-256 certificate generated for this test; no private key exists anywhere.
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    'MIIBUDCB9qADAgECAgg5gO1lJmnY7jAKBggqhkjOPQQDAjAuMSwwKgYDVQQDEyNn',
    'by1nby1oYXJtb25peW8gdGVzdCBDQSAodGhyb3dhd2F5KTAeFw0yNjAxMDEwODAw',
    'MDBaFw00NjAxMDEwODAwMDBaMC4xLDAqBgNVBAMTI2dvLWdvLWhhcm1vbml5byB0',
    'ZXN0IENBICh0aHJvd2F3YXkpMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEcVcx',
    'y0vTVzgD8MQI0qfFJI2563aCI0hA8cDz9KFN9i52BIAu69J8jKHgIwLa9CqDZD48',
    'pmA3XzpELYFeVxTkUjAKBggqhkjOPQQDAgNJADBGAiEArkC+Ob4zAOoIpTn2hvzB',
    'NvsklJZWNty9sK+oZVsyNWYCIQDi6Udy3nYpMMcSRlUYbSTg9X8DXVRQ/u42LYZJ',
    'aM1XpQ==',
    '-----END CERTIFICATE-----',
    '',
  ].join('\n');
  const fingerprint = 'cc408a9de5b33e08ad524ef0f93c99d525a47526f8329359dba9eed9383adfbc';
  const p = join(tmp, 'real-ca.crt');
  writeFileSync(p, pem);
  assert.equal(loadVerifiedCa(p, fingerprint), pem);
  assert.equal(loadVerifiedCa(p, fingerprint.toUpperCase().match(/../g)!.join(':')), pem);
  assert.equal(loadVerifiedCa(p, createHash('sha256').update(pem).digest('hex')), pem);
  assert.throws(() => loadVerifiedCa(p), /certificate SHA-256 cc408a9d.*refusing to trust/);
});

test('caFetch (the CA-aware transport) carries JSON, multipart jobs and downloads', async () => {
  const node = await startMockNode({ chat: () => 'ok' });
  try {
    const c = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' }, { fetch: caFetch(null), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    assert.equal((await c.chat({ messages: [{ role: 'user', content: 'hi' }] })).content, 'ok');
    const id = await c.submitJob('smoke-file', { a: 1 }, [{ name: 'x.bin', data: new Uint8Array([9, 9]) }]);
    assert.equal((await c.waitJob(id, { pollMs: 5 })).state, 'succeeded');
    assert.match(new TextDecoder().decode(await c.download(id, 'sha256.txt')), /x\.bin/);
  } finally {
    await node.close();
  }
});

test('magic packet: 6 x FF + MAC x 16', () => {
  const p = magicPacket('00:11:22:aa:bb:cc');
  assert.equal(p.length, 102);
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  assert.equal(p.subarray(96).toString('hex'), '001122aabbcc');
  assert.throws(() => magicPacket('00:11'), /six octets/);
});

test('ensureAwake caches wake details while awake, then wakes a sleeping node', async () => {
  const udp = createSocket('udp4');
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', r));
  const port = udp.address().port;
  const got = new Promise<Buffer>((r) => udp.once('message', (m) => r(m)));
  const cache = join(tmp, 'wake.json');
  const node = await startMockNode({ wake: { mac: '00:11:22:aa:bb:cc', broadcast: '127.0.0.1', port } });
  const awake = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' });
  assert.equal(await awake.ensureAwake({ cachePath: cache }), true);
  assert.deepEqual(readWakeCache(cache), { mac: '00:11:22:aa:bb:cc', broadcast: '127.0.0.1', port });
  await node.close();
  const asleep = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' }, { sleep: async () => {} });
  assert.equal(await asleep.ensureAwake({ cachePath: cache, waitSeconds: 0.2, pollSeconds: 0.05 }), false);
  assert.equal((await got).subarray(96).toString('hex'), '001122aabbcc');
  udp.close();
  await assert.rejects(asleep.ensureAwake({ cachePath: join(tmp, 'none.json') }), /no cached wake details/);
});
