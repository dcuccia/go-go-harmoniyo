// fetch() over node:http/https with a private CA (the AI node's internal CA), without disabling
// verification and without third-party packages: Node's global fetch has no per-call CA option
// unless undici is installed, and NODE_EXTRA_CA_CERTS only works when set at process start.
import http from 'node:http';
import https from 'node:https';

export function caFetch(caPem: string | null): typeof fetch {
  const agent = new https.Agent({ ca: caPem ?? undefined, keepAlive: true });
  const httpAgent = new http.Agent({ keepAlive: true });
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    let body: Buffer | undefined;
    if (init.body !== undefined && init.body !== null) {
      // Let the platform serialize FormData/Blob/string bodies (and pick the multipart boundary).
      const r = new Response(init.body as BodyInit);
      body = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type');
      if (ct && !headers['content-type']) headers['content-type'] = ct;
      headers['content-length'] = String(body.length);
    }
    const mod = url.protocol === 'https:' ? https : http;
    return await new Promise<Response>((resolve, reject) => {
      const req = mod.request(url, { method: init.method ?? 'GET', headers, agent: url.protocol === 'https:' ? agent : httpAgent, signal: init.signal ?? undefined }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
          const status = res.statusCode ?? 0;
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: h }));
        });
        res.on('error', reject);
      });
      req.on('error', (e) => reject(Object.assign(new TypeError('fetch failed'), { cause: e })));
      if (body) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
