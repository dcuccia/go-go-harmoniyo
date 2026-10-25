// Small client for the AI compute node (contract v0): /healthz, /node/status, OpenAI-compatible
// /v1 chat with retries, and the /jobs batch API (submit, poll, outputs, logs, cancel).
// Zero dependencies: Node's global fetch, FormData and Blob.
import { redact, type NodeConfig } from './env.ts';
import { caFetch } from './tls-fetch.ts';
import { DEFAULT_WAKE_CACHE, readWakeCache, sendWake, writeWakeCache, type WakeInfo } from './wake.ts';

export class NodeError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'NodeError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface RetryPolicy {
  /** Attempts after the first one. */
  maxRetries: number;
  /** Backoff base for errors without Retry-After (ms); doubles per attempt, ±25 % jitter. */
  baseDelayMs: number;
  /** Cap for any single wait, including Retry-After (ms). */
  maxDelayMs: number;
  /** Per-request timeout (ms). A cold qwen3:8b load takes ~40 s. */
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 6, baseDelayMs: 1000, maxDelayMs: 60000, timeoutMs: 180000 };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  /** qwen3: "none" turns off thinking (the node guide asks for it). */
  reasoning_effort?: string;
}

export interface ChatResult {
  content: string;
  model: string;
  finishReason: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  /** Wall time of the successful attempt (ms). */
  latencyMs: number;
  /** Wall time including retries and waits (ms). */
  totalMs: number;
  attempts: number;
  /** Retry reasons, e.g. ["503 retry-after 5", "ECONNREFUSED"]. */
  retries: string[];
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface JobInfo {
  job_id?: string;
  id?: string;
  state: JobState;
  exit_code?: number | null;
  error?: string | null;
  [k: string]: unknown;
}

export interface JobFile {
  name: string;
  data: Uint8Array | string;
  type?: string;
}

export interface ClientOptions {
  retry?: Partial<RetryPolicy>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called on every retry (for logging; never receives the token). */
  onRetry?: (info: { attempt: number; reason: string; waitMs: number; path: string }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']);

function networkCode(e: unknown): string | null {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'TIMEOUT';
  const code = err?.cause?.code || err?.code;
  return code && NETWORK_CODES.has(code) ? code : null;
}

export class AiNodeClient {
  readonly baseUrl: string;
  private readonly token: string | null;
  private readonly retry: RetryPolicy;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onRetry?: ClientOptions['onRetry'];

  constructor(config: NodeConfig, opts: ClientOptions = {}) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
    this.fetchFn = opts.fetch ?? (config.caPem ? caFetch(config.caPem) : fetch);
    this.sleep = opts.sleep ?? defaultSleep;
    this.onRetry = opts.onRetry;
  }

  get hasToken(): boolean {
    return !!this.token;
  }

  private headers(auth: boolean, extra: Record<string, string> = {}): Record<string, string> {
    if (auth && !this.token) throw new NodeError('CUCCIA_AI_TOKEN is not set (process or Windows User environment)', null, false);
    return auth ? { ...extra, Authorization: `Bearer ${this.token}` } : extra;
  }

  private backoff(attempt: number): number {
    const d = this.retry.baseDelayMs * 2 ** attempt;
    return Math.min(this.retry.maxDelayMs, Math.round(d * (0.75 + Math.random() * 0.5)));
  }

  /**
   * One HTTP call with the contract's retry rules: 503 waits Retry-After (the GPU lease or gaming
   * mode), 429/502/504 and network errors back off exponentially; other 4xx/5xx fail at once.
   */
  async request(method: string, path: string, init: { auth?: boolean; body?: BodyInit; json?: unknown; retry?: boolean } = {}): Promise<{ res: Response; latencyMs: number; totalMs: number; attempts: number; retries: string[] }> {
    const auth = init.auth ?? true;
    const retries: string[] = [];
    const started = performance.now();
    const maxRetries = init.retry === false ? 0 : this.retry.maxRetries;
    for (let attempt = 0; ; attempt++) {
      const headers = this.headers(auth, init.json !== undefined ? { 'Content-Type': 'application/json' } : {});
      const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
      const t0 = performance.now();
      let reason: string;
      let waitMs: number;
      try {
        const res = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(this.retry.timeoutMs) });
        const latencyMs = Math.round(performance.now() - t0);
        if (res.ok) return { res, latencyMs, totalMs: Math.round(performance.now() - started), attempts: attempt + 1, retries };
        const text = redact(await res.text().catch(() => ''), this.token).slice(0, 300);
        if (res.status === 503) {
          const ra = Number(res.headers.get('retry-after'));
          waitMs = Math.min(this.retry.maxDelayMs, Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.backoff(attempt));
          reason = `503 retry-after ${Number.isFinite(ra) ? ra : '?'}`;
        } else if ([429, 502, 504].includes(res.status)) {
          waitMs = this.backoff(attempt);
          reason = String(res.status);
        } else {
          throw new NodeError(`${method} ${path} → ${res.status} ${res.statusText}: ${text}`, res.status, false);
        }
        if (attempt >= maxRetries) throw new NodeError(`${method} ${path} → ${res.status} after ${attempt + 1} attempts: ${text}`, res.status, true);
      } catch (e) {
        if (e instanceof NodeError) throw e;
        const code = networkCode(e);
        if (!code) throw new NodeError(redact(`${method} ${path}: ${(e as Error).message}`, this.token), null, false);
        if (attempt >= maxRetries) throw new NodeError(`${method} ${path}: ${code} after ${attempt + 1} attempts (node asleep, off-LAN or in gaming mode?)`, null, true);
        reason = code;
        waitMs = this.backoff(attempt);
      }
      retries.push(reason);
      this.onRetry?.({ attempt: attempt + 1, reason, waitMs, path });
      await this.sleep(waitMs);
    }
  }

  private async json<T>(method: string, path: string, init: Parameters<AiNodeClient['request']>[2] = {}): Promise<T> {
    const { res } = await this.request(method, path, init);
    return (await res.json()) as T;
  }

  /** GET /healthz (no token). Single attempt with a short timeout: reports, never throws. */
  async health(timeoutMs = 8000): Promise<{ ok: boolean; busy?: boolean; latencyMs: number; error?: string }> {
    const t0 = performance.now();
    try {
      const res = await this.fetchFn(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; busy?: boolean };
      return { ok: res.ok && body.ok === true, busy: body.busy, latencyMs: Math.round(performance.now() - t0) };
    } catch (e) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), error: networkCode(e) ?? (e as Error).message };
    }
  }

  status(): Promise<Record<string, unknown>> {
    return this.json('GET', '/node/status');
  }

  /** Cache the node's Wake-on-LAN details (from /node/status) for when it is asleep. */
  async refreshWakeCache(cachePath = DEFAULT_WAKE_CACHE): Promise<WakeInfo | null> {
    const wake = (await this.status()).wake as WakeInfo | undefined;
    if (wake?.mac && wake?.broadcast) writeWakeCache(wake, cachePath);
    return wake ?? null;
  }

  /**
   * True when /healthz answers. If it doesn't, send a magic packet from the cached wake details
   * and poll until it does (the node sleeps after ~30 idle minutes).
   */
  async ensureAwake(opts: { waitSeconds?: number; pollSeconds?: number; cachePath?: string; onWake?: (w: WakeInfo) => void } = {}): Promise<boolean> {
    if ((await this.health(3000)).ok) {
      if (this.token) await this.refreshWakeCache(opts.cachePath).catch(() => null);
      return true;
    }
    const wake = readWakeCache(opts.cachePath);
    if (!wake) throw new NodeError('node unreachable and no cached wake details (run once while it is awake to cache them)', null, true);
    await sendWake(wake);
    opts.onWake?.(wake);
    const deadline = Date.now() + (opts.waitSeconds ?? 180) * 1000;
    while (Date.now() < deadline) {
      await this.sleep((opts.pollSeconds ?? 5) * 1000);
      if ((await this.health(3000)).ok) return true;
    }
    return false;
  }

  async models(): Promise<string[]> {
    const r = await this.json<{ data?: { id: string }[] }>('GET', '/v1/models');
    return (r.data ?? []).map((m) => m.id);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body = { model: 'qwen3:8b', reasoning_effort: 'none', ...req };
    const { res, latencyMs, totalMs, attempts, retries } = await this.request('POST', '/v1/chat/completions', { json: body });
    const r = (await res.json()) as { model?: string; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: ChatResult['usage'] };
    return {
      content: r.choices?.[0]?.message?.content ?? '',
      model: r.model ?? body.model,
      finishReason: r.choices?.[0]?.finish_reason ?? null,
      usage: r.usage ?? null,
      latencyMs,
      totalMs,
      attempts,
      retries,
    };
  }

  // --- batch jobs -----------------------------------------------------------------------------

  async submitJob(workload: string, args: Record<string, unknown> = {}, files: JobFile[] = []): Promise<string> {
    for (const f of files) if (!SAFE_NAME.test(f.name)) throw new NodeError(`upload name "${f.name}" must match [A-Za-z0-9._-]`, null, false);
    const form = new FormData();
    form.set('workload', workload);
    form.set('args', JSON.stringify(args));
    for (const f of files) form.append('file', new Blob([f.data], { type: f.type ?? 'application/octet-stream' }), f.name);
    const r = await this.json<{ job_id: string }>('POST', '/jobs', { body: form });
    return r.job_id;
  }

  job(id: string): Promise<JobInfo> {
    return this.json('GET', `/jobs/${encodeURIComponent(id)}`);
  }

  async waitJob(id: string, opts: { pollMs?: number; timeoutMs?: number; onState?: (j: JobInfo) => void } = {}): Promise<JobInfo> {
    const pollMs = opts.pollMs ?? 2000;
    const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60000);
    let last = '';
    for (;;) {
      const j = await this.job(id);
      if (j.state !== last) {
        last = j.state;
        opts.onState?.(j);
      }
      if (j.state === 'succeeded' || j.state === 'failed' || j.state === 'cancelled') return j;
      if (Date.now() > deadline) throw new NodeError(`job ${id} still ${j.state} after timeout`, null, true);
      await this.sleep(pollMs);
    }
  }

  async outputs(id: string): Promise<{ name: string; size: number }[]> {
    const r = await this.json<unknown>('GET', `/jobs/${encodeURIComponent(id)}/outputs`);
    const list = Array.isArray(r) ? r : ((r as { outputs?: unknown[]; files?: unknown[] }).outputs ?? (r as { files?: unknown[] }).files ?? []);
    return (list as ({ name?: string; path?: string; size?: number } | string)[]).map((x) => (typeof x === 'string' ? { name: x, size: -1 } : { name: x.name ?? x.path ?? '', size: x.size ?? -1 }));
  }

  async download(id: string, file: string): Promise<Uint8Array> {
    const { res } = await this.request('GET', `/jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(file)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async logs(id: string): Promise<string> {
    const { res } = await this.request('GET', `/jobs/${encodeURIComponent(id)}/logs`);
    return res.text();
  }

  async cancel(id: string): Promise<void> {
    await this.request('DELETE', `/jobs/${encodeURIComponent(id)}`, { retry: false });
  }
}
