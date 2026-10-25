// Smoke test against the compute node: health, status, models, one short chat, and the shared
// `smoke-file` batch workload. Writes results/smoke.json (no token material).
//   node scripts/smoke.ts            # live node (CUCCIA_AI_BASE_URL / CUCCIA_AI_TOKEN)
//   node scripts/smoke.ts --mock     # offline mock node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiNodeClient } from '../src/client.ts';
import { describe, loadConfig } from '../src/env.ts';
import { startMockNode } from '../src/mock-node.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mock = process.argv.includes('--mock');
const mockNode = mock ? await startMockNode({ chat: () => 'X:1\nL:1/4\nM:4/4\nK:C\n"C"C E G c |]' }) : null;
const cfg = mockNode ? { baseUrl: mockNode.url, token: 'mock-token', tokenSource: 'process' as const } : loadConfig();
const client = new AiNodeClient(cfg, { onRetry: (r) => console.log(`  retry ${r.attempt} ${r.path}: ${r.reason}, waiting ${r.waitMs} ms`) });
const out: Record<string, unknown> = { date: new Date().toISOString(), mode: mock ? 'mock' : 'live', node: describe(cfg) };
console.log(`node: ${describe(cfg)}`);

try {
  out.awake = await client.ensureAwake({ onWake: (w) => console.log(`  node asleep: sent Wake-on-LAN to ${w.broadcast}, waiting…`) }).catch((e) => `no: ${(e as Error).message}`);
  out.health = await client.health();
  console.log('healthz:', JSON.stringify(out.health));
  if (!(out.health as { ok: boolean }).ok) throw new Error('node unreachable (asleep, off-LAN, or down)');
  if (!client.hasToken) throw new Error('CUCCIA_AI_TOKEN missing: only /healthz could be checked');

  const st = await client.status();
  out.status = { mode: st.mode, gpu_lease: st.gpu_lease ?? st.lease ?? null, queue: Array.isArray(st.queue) ? st.queue.length : st.queue, resident_models: st.resident_models ?? st.models ?? null };
  console.log('status:', JSON.stringify(out.status));
  out.models = await client.models();
  console.log('models:', out.models);

  const prompt = 'Write a 4-bar C major melody in ABC notation (L:1/4, M:4/4, K:C). Reply with only the ABC.';
  const chats = [];
  for (let i = 0; i < 2; i++) {
    const r = await client.chat({ messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 200 });
    chats.push({ latencyMs: r.latencyMs, totalMs: r.totalMs, attempts: r.attempts, retries: r.retries, usage: r.usage, tokPerSec: r.usage?.completion_tokens ? Math.round((r.usage.completion_tokens / r.latencyMs) * 1000) : null, finish: r.finishReason, contentChars: r.content.length });
    console.log(`chat ${i + 1}: ${r.latencyMs} ms (${i === 0 ? 'may include cold load' : 'warm'}), ${r.usage?.completion_tokens ?? '?'} tokens, attempts ${r.attempts}`);
    if (i === 0) out.sample = r.content.slice(0, 400);
  }
  out.chat = chats;

  const t0 = performance.now();
  const id = await client.submitJob('smoke-file', { purpose: 'go-go-harmoniyo S6 smoke' }, [{ name: 'hello.txt', data: 'Go Go HarmoniYo S6\n' }]);
  const j = await client.waitJob(id, { pollMs: 1000, timeoutMs: 5 * 60000 });
  const outputs = await client.outputs(id);
  out.job = { workload: 'smoke-file', state: j.state, exit_code: j.exit_code, roundTripMs: Math.round(performance.now() - t0), outputs };
  console.log('job:', JSON.stringify(out.job));
  out.ok = j.state === 'succeeded';
} catch (e) {
  out.ok = false;
  out.error = (e as Error).message;
  console.error(`SMOKE FAILED: ${out.error}`);
} finally {
  await mockNode?.close();
}
mkdirSync(join(root, 'results'), { recursive: true });
mkdirSync(join(root, 'results', 'mock'), { recursive: true });
writeFileSync(join(root, 'results', mock ? 'mock/smoke-mock.json' : 'smoke.json'), JSON.stringify(out, null, 2) + '\n');
console.log(out.ok ? 'SMOKE OK' : 'SMOKE NOT OK');
process.exitCode = out.ok ? 0 : 1;
