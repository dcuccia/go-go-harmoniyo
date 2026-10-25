// LLM experiment harness: prompt templates, one chat with validation and up to N repair turns
// (the validator's errors are sent back), latency/usage capture, and a JSONL run log that is
// the AI-provenance record for every candidate asset (full prompts and replies).
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiNodeClient, type ChatMessage, type ChatRequest } from './client.ts';
import { describe, loadConfig } from './env.ts';
import { startMockNode, type MockNode } from './mock-node.ts';

export const S6_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS = join(S6_DIR, 'src', 'prompts');

export function template(name: string): { text: string; path: string; sha256: string } {
  const path = join(PROMPTS, `${name}.md`);
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return { text, path: `spikes/s6-ai-arranging/src/prompts/${name}.md`, sha256: createHash('sha256').update(text).digest('hex') };
}

export function render(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`template variable {{${k}}} missing`);
    return String(vars[k]);
  });
}

export interface Attempt { reply: string; latencyMs: number; totalMs: number; retries: string[]; usage: unknown; errors: string[] }
export interface AskResult<T> { ok: boolean; value: T | null; attempts: Attempt[]; errors: string[] }

export interface Harness {
  mode: 'mock' | 'local' | 'node';
  model: string;
  client: AiNodeClient;
  /** Set the mock's answer for the next calls (mock mode only). */
  setMock(fn: ((req: ChatRequest) => string) | null): void;
  ask<T>(o: { exp: string; song: string; label: string; template: string; system: string; user: string; temperature: number; seed: number; maxTokens: number; validate: (reply: string) => { value: T | null; errors: string[] }; maxRepairs?: number }): Promise<AskResult<T>>;
  close(): Promise<void>;
}

export async function openHarness(opts: { mock: boolean; log: string }): Promise<Harness> {
  const tag = runTag(opts.mock);
  let mockFn: ((req: ChatRequest) => string) | null = null;
  let mock: MockNode | null = null;
  if (opts.mock) mock = await startMockNode({ chat: (req) => (mockFn ? mockFn(req) : 'no mock answer') });
  const cfg = mock ? { baseUrl: mock.url, token: 'mock-token', tokenSource: 'process' as const } : loadConfig();
  const client = new AiNodeClient(cfg, { onRetry: (r) => console.log(`    retry ${r.attempt}: ${r.reason}, wait ${r.waitMs} ms`) });
  console.log(`[${tag.toUpperCase()}] ${describe(cfg)}`);
  if (!opts.mock) {
    const h = await client.health();
    if (!h.ok) throw new Error(`node not reachable: ${h.error ?? JSON.stringify(h)}`);
    if (!client.hasToken) throw new Error('CUCCIA_AI_TOKEN missing (process or Windows User env); use --mock to run offline');
  }
  mkdirSync(dirname(opts.log), { recursive: true });
  writeFileSync(opts.log, '');
  return {
    mode: tag,
    model: 'qwen3:8b',
    client,
    setMock: (fn) => void (mockFn = fn),
    async ask(o) {
      const messages: ChatMessage[] = [{ role: 'system', content: o.system }, { role: 'user', content: o.user }];
      const attempts: Attempt[] = [];
      let value: unknown = null;
      let errors: string[] = [];
      const maxRepairs = o.maxRepairs ?? 2;
      for (let a = 0; a <= maxRepairs; a++) {
        let reply = '';
        let r;
        try {
          r = await client.chat({ messages, temperature: o.temperature, seed: o.seed + a, max_tokens: o.maxTokens, reasoning_effort: 'none' });
          reply = r.content;
          const v = o.validate(reply);
          value = v.value;
          errors = v.errors;
        } catch (e) {
          errors = [`request failed: ${(e as Error).message}`];
          value = null;
        }
        attempts.push({ reply, latencyMs: r?.latencyMs ?? -1, totalMs: r?.totalMs ?? -1, retries: r?.retries ?? [], usage: r?.usage ?? null, errors });
        appendFileSync(opts.log, JSON.stringify({ t: new Date().toISOString(), mode: tag, backend: tag === 'node' ? 'cuccia AI node /v1 (Ollama qwen3:8b)' : tag === 'local' ? 'local llama.cpp shim, Qwen3-8B-Q4_K_M.gguf' : 'offline mock', model: 'qwen3:8b', exp: o.exp, song: o.song, label: o.label, template: o.template, attempt: a + 1, temperature: o.temperature, seed: o.seed + a, maxTokens: o.maxTokens, messages, reply, latencyMs: r?.latencyMs ?? null, retries: r?.retries ?? [], usage: r?.usage ?? null, errors }) + '\n');
        if (!errors.length || !r) break;
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `Your answer has these problems:\n- ${errors.slice(0, 8).join('\n- ')}\nReply again in exactly the requested format, fixing them.` });
      }
      return { ok: !errors.length, value: (errors.length ? null : value) as never, attempts, errors };
    },
    close: async () => void (await mock?.close()),
  };
}

/**
 * Result tag for file names: "mock" (offline mock), "local" (a stand-in /v1 on this machine, e.g.
 * scripts/local_llm_shim.py) or "node" (the AI compute node).
 */
export function runTag(mock: boolean): 'mock' | 'local' | 'node' {
  if (mock) return 'mock';
  const host = new URL(loadConfig().baseUrl).hostname;
  return ['127.0.0.1', 'localhost', '::1'].includes(host) ? 'local' : 'node';
}

export function backendLabel(tag: string): string {
  return tag === 'node' ? 'the cuccia AI node (/v1, Ollama qwen3:8b, reasoning_effort none)' : tag === 'local' ? 'a local stand-in (scripts/local_llm_shim.py: llama.cpp with the official Qwen3-8B Q4_K_M GGUF, thinking off; same model and quantization family as the node, different runtime and GPU)' : 'the offline mock';
}

export const median = (xs: number[]) => {
  const s = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
export const pct = (xs: number[], p: number) => {
  const s = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null;
};
