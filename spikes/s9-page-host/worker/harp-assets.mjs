const route = /^\/backing\/audio\/([a-f0-9]{24})\/(KSHarp_[A-G][2-4]_mf\.wav)$/;
const internal = '/backing/sample-files/';

function acceptance(value) {
  const qualities = new Map();
  for (const item of (value ?? '').toLowerCase().split(',')) {
    const [name, ...params] = item.trim().split(';');
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    const level = q === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q.slice(2)) ? Number(q.slice(2)) : 0;
    qualities.set(name.trim(), level);
  }
  const br = qualities.get('br') ?? qualities.get('*') ?? 0;
  const identity = qualities.get('identity') ?? (qualities.get('*') === 0 ? 0 : 1);
  return { br: br > 0 && br >= identity, identity: identity > 0, allowBr: br > 0 };
}

/** Serve the same prebuilt representation in workerd and the private Node rehearsal. */
export async function serveHarpAsset(req, file, asset) {
  if (file.startsWith(internal)) return new Response('Not found', { status: 404 });
  if (!file.startsWith('/backing/audio/')) return null;
  const match = route.exec(file);
  if (!match) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(req.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const accept = acceptance(req.cf?.clientAcceptEncoding ?? req.headers.get('accept-encoding'));
  if (!accept.identity && !accept.allowBr) return new Response(null, { status: 406, headers: { vary: 'Accept-Encoding' } });
  const [, version, sample] = match;
  const path = `${internal}${version}/${sample}`;
  let br = accept.br;
  let response = await asset(path + (br ? '.br' : ''));
  if (br && response.status === 404 && accept.identity) {
    br = false;
    response = await asset(path);
  }
  if (!response.ok) return new Response('Sample unavailable', { status: response.status, headers: { 'cache-control': 'no-store', vary: 'Accept-Encoding' } });
  if (response.headers.has('content-encoding')) {
    return new Response('Unexpected storage encoding', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const headers = new Headers({
    'content-type': 'audio/wav',
    'cache-control': 'public, max-age=31536000, immutable, no-transform',
    vary: 'Accept-Encoding',
    'x-content-type-options': 'nosniff',
  });
  if (br) headers.set('content-encoding', 'br');
  const length = response.headers.get('content-length');
  if (length) headers.set('content-length', length);
  // Workers otherwise treats a Content-Encoding header as a request to encode the body.
  return new Response(req.method === 'HEAD' ? null : response.body, { headers, encodeBody: 'manual' });
}
