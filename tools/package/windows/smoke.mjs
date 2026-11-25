#!/usr/bin/env node
// Smoke test of the built Windows package: starts go-go-harmoniyo.exe (as "Play Go Go HarmoniYo.cmd"
// would, with --no-open and a throwaway state folder), waits for the TV and phone URLs, checks
// that the game, QR code, controller page and API answer, then stops it.
//
//   node tools/package/windows/smoke.mjs [path\to\GoGoHarmoniYo]   (default: out/stage/GoGoHarmoniYo)
//
// Pass --tunnel-check to also start with --tunnel (needs internet; prints the tunnel URL).
import { execFileSync, spawn } from 'node:child_process';
import { Resolver } from 'node:dns';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(here, 'out', 'stage', 'GoGoHarmoniYo');
const exe = join(dir, 'go-go-harmoniyo.exe');
if (!existsSync(exe)) throw new Error(`${exe} not found; run build.mjs first`);
const state = mkdtempSync(join(tmpdir(), 'gogoharmoniyo-smoke-'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
function tunnelLookup(host, opts, cb) {
  resolver.resolve4(host, (err, addrs) => {
    if (err) return cb(err);
    if (opts?.all) cb(null, addrs.map((address) => ({ address, family: 4 })));
    else cb(null, addrs[0], 4);
  });
}

/** GET over http or https (the phone side uses the host's self-signed certificate). */
function get(url) {
  if (url.startsWith('http:')) return fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() }));
  // Windows caches the failed lookup of a brand-new tunnel name, so ask a public resolver instead.
  const lookup = new URL(url).hostname.endsWith('.trycloudflare.com') ? tunnelLookup : undefined;
  return new Promise((resolve, reject) => {
    request(url, { rejectUnauthorized: false, lookup }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', body }));
    }).on('error', reject).end();
  });
}

const t0 = Date.now();
const args = ['--no-open', '--http-port', '18950', '--port', '18951', ...(process.argv.includes('--tunnel-check') ? ['--tunnel'] : [])];
const child = spawn(exe, args, { cwd: dir, env: { ...process.env, GOGOHARMONIYO_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (c) => (log += c));
child.stderr.on('data', (c) => (log += c));
const urls = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 90_000);
  const poll = setInterval(() => {
    const plain = log.replace(/\x1b\[[0-9;]*m/g, '');
    const tv = /TV:\s+(http\S+)/.exec(plain)?.[1];
    const phones = /Phones:\s+(http\S+)/.exec(plain)?.[1];
    if (tv && phones) {
      clearInterval(poll);
      clearTimeout(timer);
      resolve({ tv, phones });
    }
  }, 200);
  child.on('exit', () => resolve(null));
});

try {
  if (!urls) {
    console.log(log);
    check('starts and prints the TV and phone URLs', false);
  } else {
    check('starts and prints the TV and phone URLs', true, `${((Date.now() - t0) / 1000).toFixed(1)} s  TV ${urls.tv}  phones ${urls.phones}`);
    const tv = new URL(urls.tv);
    const phones = new URL(urls.phones);
    const game = await get(urls.tv);
    check('TV: /game/ serves the game', game.status === 200 && /<script[^>]+src="\.\/assets\//.test(game.body), `HTTP ${game.status}`);
    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(game.body)?.[1];
    if (asset) {
      const js = await get(new URL(asset, urls.tv).href);
      check('TV: game script', js.status === 200 && js.body.length > 100_000, `${asset} ${(js.body.length / 1e3).toFixed(0)} kB`);
    }
    const charts = await get(new URL('charts/index.json', urls.tv).href);
    const songs = charts.status === 200 ? JSON.parse(charts.body).songs?.length : 0;
    check('TV: game charts', songs >= 16, `${songs} songs`);
    const qr = await get(`${tv.origin}/qr.svg`);
    check('QR code (/qr.svg)', qr.status === 200 && qr.body.includes('<svg'), `HTTP ${qr.status}`);
    const info = await get(`${tv.origin}/api/info`);
    const i = info.status === 200 ? JSON.parse(info.body) : {};
    check('host info: WebRTC (werift) bundled', i.rtcAvailable === true, `rtcAvailable ${i.rtcAvailable}, TLS ${i.tlsMode}`);
    // A fresh trycloudflare.com name can take a few seconds to resolve.
    let page;
    for (let tries = 0; !page; tries++) {
      try {
        page = await get(urls.phones);
      } catch (e) {
        if (tries >= 15 || !['ENOTFOUND', 'ENODATA'].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    check('phone: controller page', page.status === 200 && page.body.includes('dist/controller.js'), `HTTP ${page.status} (${phones.protocol})`);
    const ctl = await get(`${phones.origin}/dist/controller.js`);
    check('phone: controller script', ctl.status === 200 && ctl.body.length > 10_000, `${(ctl.body.length / 1e3).toFixed(0)} kB`);
    const logo = await get(`${phones.origin}/brand/yo/yo-ring.svg`);
    check('brand files', logo.status === 200 && logo.body.includes('<svg'), `HTTP ${logo.status}`);
    const written = readdirSync(state);
    const tunnel = phones.hostname.endsWith('.trycloudflare.com');
    check('state goes to GOGOHARMONIYO_STATE_DIR', written.includes('data') && (tunnel || written.includes('certs')), `wrote ${written.join(', ')}`);
    check('nothing written next to the exe', !existsSync(join(dir, 'certs')) && !existsSync(join(dir, 'data')));
  }
} finally {
  // The launcher's child (the host) is a second go-go-harmoniyo.exe: stop the whole tree.
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
  rmSync(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n✗ Smoke test: ${failed} check(s) failed.\n\n${log}` : '\n✓ Smoke test passed.');
process.exit(failed ? 1 : 0);
