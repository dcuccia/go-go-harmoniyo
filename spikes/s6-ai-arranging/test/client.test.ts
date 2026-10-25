import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiNodeClient, NodeError } from '../src/client.ts';
import { describe as describeConfig, loadConfig, redact } from '../src/env.ts';
import { startMockNode } from '../src/mock-node.ts';

const noSleep = async () => {};

test('health needs no token; other routes need the bearer token', async () => {
  const node = await startMockNode({ token: 't0k' });
  try {
    const anon = new AiNodeClient({ baseUrl: node.url, token: null, tokenSource: 'none' });
    assert.equal((await anon.health()).ok, true);
    await assert.rejects(anon.models(), /CUCCIA_AI_TOKEN is not set/);
    const bad = new AiNodeClient({ baseUrl: node.url, token: 'wrong', tokenSource: 'process' });
    await assert.rejects(bad.models(), (e: NodeError) => e.status === 401 && !e.retryable);
    const ok = new AiNodeClient({ baseUrl: node.url, token: 't0k', tokenSource: 'process' });
    assert.deepEqual(await ok.models(), ['qwen3:8b']);
  } finally {
    await node.close();
  }
});

test('chat retries 503 using Retry-After, sends reasoning_effort none and model qwen3:8b', async () => {
  let seen: Record<string, unknown> | null = null;
  const node = await startMockNode({
    busyFirst: 2,
    retryAfterSec: 7,
    chat: (req) => {
      seen = req as unknown as Record<string, unknown>;
      return 'X:1\nK:C\nC D E F|';
    },
  });
  const waits: number[] = [];
  try {
    const c = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' }, { sleep: async (ms) => void waits.push(ms) });
    const r = await c.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0 });
    assert.equal(r.content, 'X:1\nK:C\nC D E F|');
    assert.equal(r.attempts, 3);
    assert.deepEqual(r.retries, ['503 retry-after 7', '503 retry-after 7']);
    assert.deepEqual(waits, [7000, 7000]);
    assert.equal(seen!.reasoning_effort, 'none');
    assert.equal(seen!.model, 'qwen3:8b');
  } finally {
    await node.close();
  }
});

test('gives up after maxRetries and reports a retryable error', async () => {
  const node = await startMockNode({ busyFirst: 10 });
  try {
    const c = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' }, { sleep: noSleep, retry: { maxRetries: 2 } });
    await assert.rejects(c.chat({ messages: [{ role: 'user', content: 'x' }] }), (e: NodeError) => e.status === 503 && e.retryable);
  } finally {
    await node.close();
  }
});

test('network errors are retried, then reported (node asleep / off-LAN)', async () => {
  const closed = await startMockNode();
  await closed.close();
  const c = new AiNodeClient({ baseUrl: closed.url, token: 'x', tokenSource: 'process' }, { sleep: noSleep, retry: { maxRetries: 1, timeoutMs: 2000 } });
  const h = await c.health(1000);
  assert.equal(h.ok, false);
  await assert.rejects(c.models(), (e: NodeError) => e.retryable && /after 2 attempts/.test(e.message));
});

test('jobs: submit multipart, poll, list and download outputs, logs', async () => {
  const node = await startMockNode();
  try {
    const c = new AiNodeClient({ baseUrl: node.url, token: 'mock-token', tokenSource: 'process' }, { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    const id = await c.submitJob('smoke-file', { purpose: 'test' }, [{ name: 'melody.mid', data: new Uint8Array([1, 2, 3]) }]);
    const states: string[] = [];
    const j = await c.waitJob(id, { pollMs: 5, onState: (s) => states.push(s.state) });
    assert.equal(j.state, 'succeeded');
    const outs = await c.outputs(id);
    assert.ok(outs.some((o) => o.name === 'sha256.txt'));
    const sha = new TextDecoder().decode(await c.download(id, 'sha256.txt'));
    assert.match(sha, /^039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81 {2}melody\.mid/);
    assert.match(await c.logs(id), /smoke-file/);
    await assert.rejects(c.submitJob('smoke-file', {}, [{ name: '../evil', data: 'x' }]), /must match/);
  } finally {
    await node.close();
  }
});

test('config never exposes the token', () => {
  const cfg = loadConfig({ CUCCIA_AI_TOKEN: 'sekret-123', CUCCIA_AI_BASE_URL: 'http://x:1/' });
  assert.equal(cfg.baseUrl, 'http://x:1');
  assert.equal(cfg.tokenSource, 'process');
  assert.ok(!describeConfig(cfg).includes('sekret'));
  assert.equal(redact('Bearer sekret-123 failed', cfg.token), 'Bearer [REDACTED] failed');
});
