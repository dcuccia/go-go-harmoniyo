import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { deriveHarp } from '../scripts/harp-derivation.mjs';
import { serveHarpAsset } from '../worker/harp-assets.mjs';
import { assertBackingRelease, catalogDigest } from '../scripts/reviewed-backing.mjs';
import { test } from 'node:test';
import { demoDeployExpiry, deploymentTarget, smoke, verifyCloudflareTarget } from '../scripts/deploy.mjs';
import { ONGOING_DEMO } from '../worker/turn-demo.mjs';

const account = '0'.repeat(32);
const origin = 'https://go-go-harmoniyo.owner-test.workers.dev';
const target = deploymentTarget({ CLOUDFLARE_ACCOUNT_ID: account, S9_SIGNAL_ORIGIN: origin });

test('live target requires the account ID and exact stable Worker origin', () => {
  assert.throws(() => deploymentTarget({ S9_SIGNAL_ORIGIN: origin }), /account ID/);
  for (const invalid of [origin.replace('https:', 'http:'), origin.replace('go-go-harmoniyo', 'other'), `${origin}/`, `${origin}:443`, `${origin}?x=y`, `${origin}\n`]) {
    assert.throws(() => deploymentTarget({ CLOUDFLARE_ACCOUNT_ID: account, S9_SIGNAL_ORIGIN: invalid }), /S9_SIGNAL_ORIGIN/);
  }
});

test('Cloudflare target check rejects mismatched accounts, denied settings reads and TURN bindings', async () => {
  const check = (subdomain, bindings, status = 200, code, demo = false) => verifyCloudflareTarget(target, 'test-token', async (url, options) => {
    assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/`));
    assert.equal(options.headers.authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/subdomain')) return Response.json({ success: true, result: { subdomain } });
    assert.equal(url.split('/').slice(-2).join('/'), 'go-go-harmoniyo/settings');
    return Response.json({ success: status === 200, result: { bindings }, errors: [{ code }] }, { status });
  }, demo);
  await assert.rejects(check('wrong-account', []), /does not match/);
  await assert.rejects(check('owner-test', [], 403), /HTTP 403/);
  await assert.rejects(check('owner-test', [], 404, 10000), /HTTP 404/);
  await assert.rejects(check('owner-test', [{ name: 'TURN_KEY_ID' }]), /TURN binding/);
  await assert.rejects(check('owner-test', [{ name: 'S9_TURN_TRIAL' }]), /TURN binding/);
  await assert.rejects(check('owner-test', [{ name: 'S9_TURN_OWNER_SECRET' }]), /TURN binding/);
  await assert.rejects(check('owner-test', [{ name: 'S9_TURN_DEMO_UNTIL' }]), /TURN binding/);
  await check('owner-test', [], 404, 10007);
  await check('owner-test', [{ name: 'OTHER_SECRET', type: 'secret_text' }]);

  const secrets = ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN'].map((name) => ({ name, type: 'secret_text' }));
  const demo = (bindings, subdomain = 'owner-test') => check(subdomain, bindings, 200, undefined, true);
  await demo(secrets);
  await demo([...secrets, { name: 'S9_TURN_DEMO', type: 'plain_text' }]);
  await assert.rejects(demo(secrets, 'wrong-account'), /does not match/);
  await assert.rejects(demo(secrets.slice(0, 1)), /both TURN provider bindings/);
  await assert.rejects(demo([secrets[0], { ...secrets[1], type: 'plain_text' }]), /as Worker secrets/);
  await assert.rejects(demo([...secrets, { name: 'S9_TURN_TRIAL', type: 'plain_text' }]), /must not have protected-trial/);
  await assert.rejects(demo([...secrets, { name: 'S9_TURN_DEMO', type: 'secret_text' }]), /must be plain text/);
});

test('only an explicit ongoing mode or bounded UTC expiry opts deployment into demo mode', () => {
  const now = Date.parse('2026-11-26T17:00:00Z');
  assert.equal(demoDeployExpiry(undefined, now), 0);
  assert.equal(demoDeployExpiry('ongoing', now), ONGOING_DEMO);
  assert.equal(demoDeployExpiry('2026-11-27T02:00:00Z', now), Date.parse('2026-11-27T02:00:00Z'));
  for (const invalid of ['', '2026-11-26T17:00:00Z', '2026-11-27T05:00:01Z', '2026-11-26T19:00:00-05:00']) {
    assert.throws(() => demoDeployExpiry(invalid, now), /future UTC timestamp/);
  }
});

test('recorded backing requires an accepted decision and review for the exact asset bytes', () => {
  const adr = `# 0015 — Reviewed, fixed backing arrangements for public S9\n\n- Status: Accepted\n\n${catalogDigest}`;
  const review = { status: 'approved', reviewer: 'Fixture reviewer', date: '2026-11-25', notes: catalogDigest };
  const score = { id: 's9-reviewed-harp-backing', review, ai: { reviewer: review.reviewer, reviewDate: review.date } };
  const harp = { id: 's9-vsco2-harp', review: { status: 'approved' } };
  assert.doesNotThrow(() => assertBackingRelease(adr, [score, harp]));
  assert.throws(() => assertBackingRelease(adr.replace('Accepted', 'Proposed'), [score, harp]), /accepted ADR/);
  assert.throws(() => assertBackingRelease(adr, [{ ...score, candidate: true }, harp]), /recorded owner review/);
  assert.throws(() => assertBackingRelease(adr, [{ ...score, review: { ...review, notes: 'different digest' } }, harp]), /recorded owner review/);
  assert.throws(() => assertBackingRelease(adr, [score, { ...harp, credit: false }]), /approved sample/);
});

test('mono derivation preserves all required frames and Brotli expands to the identity WAV', () => {
  const original = readFileSync(new URL('../backing/samples/KSHarp_C3_mf.wav', import.meta.url));
  const { wave, br, requiredSec, emittedSec, fadeAtSec, originalSec } = deriveHarp(original, 1.5);
  const sourceData = original.indexOf('data');
  assert.ok(sourceData >= 12);
  assert.equal(wave.readUInt16LE(22), 1);
  assert.ok(emittedSec < originalSec && fadeAtSec > requiredSec);
  assert.equal(wave.readInt16LE(wave.length - 2), 0);
  for (let i = 0; i < 1.5 * 44100; i++) {
    assert.equal(wave.readInt16LE(44 + 2 * i),
      Math.round((original.readInt16LE(sourceData + 8 + 4 * i) + original.readInt16LE(sourceData + 10 + 4 * i)) / 2) || 0);
  }
  assert.deepEqual(brotliDecompressSync(br), wave);
});

test('harp delivery negotiates Brotli, identity and exclusions without exposing storage paths', async () => {
  const url = '/backing/audio/1234567890abcdef12345678/KSHarp_D4_mf.wav';
  const testRequest = (encoding, options = {}) => new Request(`http://localhost${url}`, {
    headers: { 'accept-encoding': encoding }, ...options,
  });
  const requests = [];
  const get = (path) => {
    requests.push(path);
    return new Response(path.endsWith('.br') ? 'compressed' : 'identity');
  };
  const compressed = await serveHarpAsset(testRequest('gzip, br'), url, get);
  assert.equal(compressed.headers.get('content-encoding'), 'br');
  assert.match(compressed.headers.get('cache-control'), /immutable, no-transform/);
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.match(requests[0], /\.wav\.br$/);
  assert.equal(await (await serveHarpAsset(testRequest('br;q=0.5, identity'), url, get)).text(), 'identity');
  assert.equal((await serveHarpAsset(testRequest('br;q=0, identity;q=0'), url, get)).status, 406);
  assert.equal((await serveHarpAsset(testRequest('br'), url, (p) => new Response(null, { status: p.endsWith('.br') ? 404 : 200 }))).headers.get('content-encoding'), null);
  assert.equal((await serveHarpAsset(testRequest('br', { method: 'HEAD' }), url, get)).body, null);
  assert.equal((await serveHarpAsset(testRequest('br'), requests[0], get)).status, 404);
});

test('live smoke requires the current build, both entry points, signalling and STUN-only ICE', async () => {
  const builtAt = '2026-11-23T00:00:00.000Z';
  const check = (pathToBreak = '', wrongResponse = () => new Response('not found', { status: 404 }), demoExpiresAt = 0, backing) =>
    smoke(origin, builtAt, async (url, options) => {
      assert.equal(url.origin, origin);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      if (url.pathname === pathToBreak) return wrongResponse();
      switch (url.pathname) {
        case '/': return new Response('<title>S9 · Go Go HarmoniYo</title>');
        case '/c/': return new Response('<script src="./controller.js"></script>');
        case '/s9-build.json': return Response.json({ builtAt, signal: '', backing, harpBank: backing ? '1234567890abcdef12345678' : undefined });
        case '/backing/short/carol-of-the-bells.json':
          assert.ok(backing);
          return Response.json({ sourceHash: 'fixture', events: [[0, 0, 1, 38, 'harp', 0.4]] });
        case '/backing/audio/1234567890abcdef12345678/KSHarp_D4_mf.wav':
          assert.ok(backing);
          assert.equal(options.method, 'HEAD');
          return new Response(null, { headers: { 'content-type': 'audio/wav' } });
        case '/ice': return Response.json({ turn: false, iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] });
        case '/turn-demo':
          assert.equal(options.method, 'GET', 'the deploy smoke must not open a room or mint');
          return Response.json({ enabled: false, expiresAt: null });
        case '/turn-trial':
          assert.equal(options.method, 'POST');
          return Response.json({ error: 'relay-unavailable' }, { status: 503 });
        case '/signal/S9SMOKE': return new Response('expected a WebSocket', { status: 426 });
        default: assert.fail(`Unexpected URL: ${url}`);
      }
    }, demoExpiresAt, backing);
  await check();
  await assert.rejects(check('/c/'), /expected HTTP 200/);
  await assert.rejects(check('/signal/S9SMOKE'), /expected HTTP 426/);
  await assert.rejects(check('/s9-build.json', () => Response.json({ builtAt: 'old', signal: '' })), /do not match/);
  await assert.rejects(check('/ice', () => Response.json({ turn: true })), /STUN-only/);
  await assert.rejects(check('/turn-trial', () => new Response(null, { status: 401 })), /expected HTTP 503/);
  const expiry = Date.parse('2026-11-26T23:00:00Z');
  const enabled = () => Response.json({ enabled: true, expiresAt: expiry });
  const ongoing = () => Response.json({ enabled: true, expiresAt: null });
  await check('/turn-demo', enabled, expiry);
  await check('/turn-demo', ongoing, ONGOING_DEMO);
  await assert.rejects(check('/turn-demo', ongoing), /did not match/);
  await assert.rejects(check('/turn-demo', enabled, ONGOING_DEMO), /did not match/);
  await assert.rejects(check('/turn-demo', enabled), /did not match/);
  await assert.rejects(check('/turn-demo', enabled, expiry + 1000), /did not match/);
  await check('', undefined, 0, catalogDigest);
  await assert.rejects(check('/backing/short/carol-of-the-bells.json', undefined, 0, catalogDigest), /expected HTTP 200/);
  await assert.rejects(check('/s9-build.json', () => Response.json({ builtAt, signal: '' }), 0, catalogDigest), /do not match/);
});
