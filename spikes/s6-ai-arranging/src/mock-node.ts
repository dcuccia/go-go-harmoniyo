// Offline mock of the compute node (contract v0) for tests and for running the experiments
// without the LAN node or a token. Implements /healthz, /node/status, /v1/models,
// /v1/chat/completions, and /jobs (submit, status, outputs, logs, cancel) with instant jobs.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Readable } from 'node:stream';
import type { ChatRequest } from './client.ts';

export interface MockOptions {
  token?: string;
  /** Chat reply for a request (default: echo the last user message length). */
  chat?: (req: ChatRequest) => string | Promise<string>;
  /** Return 503 + Retry-After for the first N /v1 chat calls (GPU lease / gaming mode). */
  busyFirst?: number;
  retryAfterSec?: number;
  /** Workload runners: files in, files out. */
  /** Wake-on-LAN details reported by /node/status. */
  wake?: { mac: string; broadcast: string; port?: number };
  workloads?: Record<string, (inputs: Map<string, Uint8Array>, args: Record<string, unknown>) => Map<string, Uint8Array> | Promise<Map<string, Uint8Array>>>;
}

interface MockJob {
  id: string;
  workload: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  created: number;
  finished: number | null;
  exit_code: number | null;
  error: string | null;
  outputs: Map<string, Uint8Array>;
  logs: string;
}

export interface MockNode {
  url: string;
  calls: { method: string; path: string; status: number }[];
  close(): Promise<void>;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export const DEFAULT_WORKLOADS: Required<MockOptions>['workloads'] = {
  'smoke-file': (inputs, args) => {
    const lines = [...inputs].filter(([n]) => n !== 'args.json').map(([n, b]) => `${sha256(b)}  ${n}`);
    return new Map([['sha256.txt', new TextEncoder().encode(lines.join('\n') + '\n')], ['args.json', new TextEncoder().encode(JSON.stringify(args))]]);
  },
};

export async function startMockNode(opts: MockOptions = {}): Promise<MockNode> {
  const token = opts.token ?? 'mock-token';
  const workloads = { ...DEFAULT_WORKLOADS, ...opts.workloads };
  const jobs = new Map<string, MockJob>();
  const calls: MockNode['calls'] = [];
  let busy = opts.busyFirst ?? 0;
  let seq = 0;

  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      calls.push({ method: req.method ?? 'GET', path, status });
      const isBytes = body instanceof Uint8Array;
      res.writeHead(status, { 'Content-Type': isBytes ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
      res.end(isBytes ? body : typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      if (path === '/healthz') return send(200, { ok: true, busy: false });
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
      if (path === '/node/status') return send(200, { mode: 'normal', gpu_lease: null, queue: [], mock: true, ...(opts.wake ? { wake: opts.wake } : {}) });
      if (path === '/v1/models') return send(200, { object: 'list', data: [{ id: 'qwen3:8b', object: 'model', owned_by: 'mock' }] });
      if (path === '/v1/chat/completions' && req.method === 'POST') {
        const body = JSON.parse(await text(req)) as ChatRequest;
        if (body.model && body.model !== 'qwen3:8b') return send(403, { error: `model ${body.model} not allowed` });
        if (busy > 0) {
          busy--;
          return send(503, { error: 'gpu busy' }, { 'Retry-After': String(opts.retryAfterSec ?? 1) });
        }
        const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        const content = opts.chat ? await opts.chat(body) : `mock reply (${last.length} chars)`;
        const ct = Math.ceil(content.length / 4);
        const pt = Math.ceil(body.messages.reduce((s, m) => s + m.content.length, 0) / 4);
        return send(200, { id: `mock-${++seq}`, object: 'chat.completion', model: 'qwen3:8b', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
      }
      if (path === '/jobs' && req.method === 'POST') {
        const form = await new Request('http://mock/jobs', { method: 'POST', headers: req.headers as Record<string, string>, body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } as RequestInit).formData();
        const workload = String(form.get('workload') ?? '');
        const run = workloads[workload];
        if (!run) return send(404, { error: `unknown workload ${workload}` });
        const args = JSON.parse(String(form.get('args') ?? '{}')) as Record<string, unknown>;
        const inputs = new Map<string, Uint8Array>([['args.json', new TextEncoder().encode(JSON.stringify(args))]]);
        for (const [, v] of form.entries()) if (v instanceof Blob) inputs.set((v as File).name, new Uint8Array(await v.arrayBuffer()));
        const id = `job-${++seq}`;
        const job: MockJob = { id, workload, state: 'queued', created: Date.now() / 1000, finished: null, exit_code: null, error: null, outputs: new Map(), logs: '' };
        jobs.set(id, job);
        setTimeout(async () => {
          if (job.state === 'cancelled') return;
          job.state = 'running';
          try {
            job.outputs = await run(inputs, args);
            job.state = 'succeeded';
            job.exit_code = 0;
            job.logs = `mock ${workload}: ${inputs.size - 1} input file(s) → ${job.outputs.size} output(s)\n`;
          } catch (e) {
            job.state = 'failed';
            job.exit_code = 1;
            job.error = (e as Error).message;
          }
          job.finished = Date.now() / 1000;
        }, 20);
        return send(202, { job_id: id });
      }
      const m = /^\/jobs\/([^/]+)(?:\/(outputs|logs)(?:\/(.+))?)?$/.exec(path);
      if (m) {
        const job = jobs.get(decodeURIComponent(m[1]));
        if (!job) return send(404, { error: 'no such job' });
        if (req.method === 'DELETE') {
          if (job.state === 'queued' || job.state === 'running') job.state = 'cancelled';
          return send(200, { job_id: job.id, state: job.state });
        }
        if (!m[2]) return send(200, { job_id: job.id, workload: job.workload, state: job.state, created: job.created, finished: job.finished, exit_code: job.exit_code, error: job.error });
        if (m[2] === 'logs') return send(200, job.logs);
        if (!m[3]) return send(200, { outputs: [...job.outputs].map(([name, b]) => ({ name, size: b.length })) });
        const f = job.outputs.get(decodeURIComponent(m[3]));
        return f ? send(200, f) : send(404, { error: 'no such output' });
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    }),
  };
}

function text(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (s += c));
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
