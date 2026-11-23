import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentTarget, smoke, verifyCloudflareTarget } from '../scripts/deploy.mjs';

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
  const check = (subdomain, bindings, status = 200, code) => verifyCloudflareTarget(target, 'test-token', async (url, options) => {
    assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/`));
    assert.equal(options.headers.authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/subdomain')) return Response.json({ success: true, result: { subdomain } });
    assert.equal(url.split('/').slice(-2).join('/'), 'go-go-harmoniyo/settings');
    return Response.json({ success: status === 200, result: { bindings }, errors: [{ code }] }, { status });
  });
  await assert.rejects(check('wrong-account', []), /does not match/);
  await assert.rejects(check('owner-test', [], 403), /HTTP 403/);
  await assert.rejects(check('owner-test', [], 404, 10000), /HTTP 404/);
  await assert.rejects(check('owner-test', [{ name: 'TURN_KEY_ID' }]), /TURN binding/);
  await assert.rejects(check('owner-test', [{ name: 'S9_TURN_TRIAL' }]), /TURN binding/);
  await assert.rejects(check('owner-test', [{ name: 'S9_TURN_OWNER_SECRET' }]), /TURN binding/);
  await check('owner-test', [], 404, 10007);
  await check('owner-test', [{ name: 'OTHER_SECRET', type: 'secret_text' }]);
});

test('live smoke requires the current build, both entry points, signalling and STUN-only ICE', async () => {
  const builtAt = '2026-11-23T00:00:00.000Z';
  const check = (pathToBreak = '', wrongResponse = () => new Response('not found', { status: 404 })) =>
    smoke(origin, builtAt, async (url, options) => {
      assert.equal(url.origin, origin);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      if (url.pathname === pathToBreak) return wrongResponse();
      switch (url.pathname) {
        case '/': return new Response('<title>S9 · Go Go HarmoniYo</title>');
        case '/c/': return new Response('<script src="./controller.js"></script>');
        case '/s9-build.json': return Response.json({ builtAt, signal: '' });
        case '/ice': return Response.json({ turn: false, iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] });
        case '/turn-trial':
          assert.equal(options.method, 'POST');
          return Response.json({ error: 'relay-unavailable' }, { status: 503 });
        case '/signal/S9SMOKE': return new Response('expected a WebSocket', { status: 426 });
        default: assert.fail(`Unexpected URL: ${url}`);
      }
    });
  await check();
  await assert.rejects(check('/c/'), /expected HTTP 200/);
  await assert.rejects(check('/signal/S9SMOKE'), /expected HTTP 426/);
  await assert.rejects(check('/s9-build.json', () => Response.json({ builtAt: 'old', signal: '' })), /do not match/);
  await assert.rejects(check('/ice', () => Response.json({ turn: true })), /STUN-only/);
  await assert.rejects(check('/turn-trial', () => new Response(null, { status: 401 })), /expected HTTP 503/);
});
