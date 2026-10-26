import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';

const chain = (e: unknown): string => (e instanceof Error ? `${e.message} ${chain(e.cause)}` : '');

// `npm test` preloads test/offline-guard.ts; CI relies on it to never contact the AI node.
test('offline guard: no CUCCIA_AI_* settings and no non-loopback connections', async (t) => {
  if (process.env.CUCCIA_AI_OFFLINE_GUARD !== '1') return t.skip('run via `npm test` (preloads test/offline-guard.ts)');
  assert.deepEqual(Object.keys(process.env).filter((k) => k.startsWith('CUCCIA_AI_') && k !== 'CUCCIA_AI_OFFLINE_GUARD'), []);
  await assert.rejects(fetch('http://192.0.2.1/healthz'), (e) => /offline-guard/.test(chain(e)));
  await assert.rejects(fetch('https://north.local/healthz'), (e) => /offline-guard/.test(chain(e)));
  assert.throws(() => request('https://192.0.2.1/'), /offline-guard/);
});
