import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { demoUntil, ONGOING_DEMO } from '../worker/turn-demo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const worker = 'go-go-harmoniyo';
const providerBindings = ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN'];
const demoBindings = ['S9_TURN_DEMO', 'S9_TURN_DEMO_UNTIL'];
const trialBindings = ['S9_TURN_TRIAL', 'S9_TURN_OWNER_SECRET'];
const api = 'https://api.cloudflare.com/client/v4';
const stamp = join(root, 'dist', 's9-preflight.json');
const buildInfo = join(root, 'dist', 'web', 's9-build.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function deploymentTarget({ CLOUDFLARE_ACCOUNT_ID: account, S9_SIGNAL_ORIGIN: origin } = {}) {
  if (account?.length !== 32 || !/^[0-9a-f]+$/.test(account)) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the intended 32-character hex account ID.');
  const match = /^https:\/\/go-go-harmoniyo\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.workers\.dev$/.exec(origin ?? '');
  if (!match || match[0] !== origin) throw new Error('Set S9_SIGNAL_ORIGIN to https://go-go-harmoniyo.<account-subdomain>.workers.dev (no slash, port, path or query).');
  return { account, origin, subdomain: match[1] };
}

export function demoDeployExpiry(value, now = Date.now()) {
  if (value === undefined) return 0;
  const until = demoUntil(value, now);
  if (!until) throw new Error('--demo-until requires either ongoing or a future UTC timestamp (YYYY-MM-DDTHH:MM:SSZ), no more than 12 hours away.');
  return until;
}

export async function verifyCloudflareTarget({ account, subdomain }, token, request = fetch, demo = false) {
  const get = async (path, allowMissingWorker = false) => {
    const endpoint = `${api}/accounts/${account}/workers/${path}`;
    const response = await request(endpoint, {
      headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (allowMissingWorker && response.status === 404 && body?.errors?.some(({ code }) => code === 10007 || code === 10092)) return null;
    if (!response.ok || body?.success !== true || !body.result) {
      throw new Error(`Cloudflare could not read ${path} (HTTP ${response.status}); check the account, Workers token and workers.dev setup.`);
    }
    return body.result;
  };

  const registered = await get('subdomain');
  if (registered.subdomain !== subdomain) throw new Error('S9_SIGNAL_ORIGIN does not match the workers.dev subdomain registered to CLOUDFLARE_ACCOUNT_ID.');
  const settings = await get(`scripts/${worker}/settings`, true);
  if (settings && !Array.isArray(settings.bindings)) throw new Error('Could not verify existing Worker bindings.');
  const bindings = settings?.bindings ?? [];
  if (!demo) {
    if (bindings.some(({ name }) => [...trialBindings, ...providerBindings, ...demoBindings].includes(name))) {
      throw new Error('The existing Worker has a TURN binding or enablement setting. This rollout is STUN-only; no changes were made.');
    }
  } else {
    if (bindings.some(({ name }) => trialBindings.includes(name))) {
      throw new Error('The demo Worker must not have protected-trial bindings; no changes were made.');
    }
    if (!providerBindings.every((key) => bindings.some(({ name, type }) => name === key && type === 'secret_text'))) {
      throw new Error('Provision both TURN provider bindings as Worker secrets before the explicit demo deploy; no changes were made.');
    }
    if (bindings.some(({ name, type }) => demoBindings.includes(name) && type !== 'plain_text')) {
      throw new Error('Demo enablement settings must be plain text bindings; no changes were made.');
    }
  }
}

export async function smoke(origin, builtAt, request = fetch, demoExpiresAt = 0) {
  const get = async (path, status = 200, method = 'GET') => {
    const response = await request(new URL(path, origin), {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== status) throw new Error(`${path}: expected HTTP ${status}, got ${response.status}`);
    return response;
  };
  const [tv, controller, build, ice, signal, trial, demo] = await Promise.all([
    get('/').then((r) => r.text()),
    get('/c/').then((r) => r.text()),
    get('/s9-build.json').then((r) => r.json()),
    get('/ice').then((r) => r.json()),
    get('/signal/S9SMOKE?role=host&peer=deploy-smoke', 426).then((r) => r.text()),
    get('/turn-trial', 503, 'POST').then((r) => r.json()),
    get('/turn-demo').then((r) => r.json()),
  ]);
  if (!tv.includes('<title>S9 · Go Go HarmoniYo</title>') || !controller.includes('src="./controller.js"')) {
    throw new Error('Expected the S9 TV page at / and the phone controller at /c/.');
  }
  if (build.builtAt !== builtAt || build.signal !== '') throw new Error('Hosted assets do not match this S9 build.');
  if (signal !== 'expected a WebSocket') throw new Error('The signalling route did not return the expected WebSocket upgrade response.');
  if (trial.error !== 'relay-unavailable') throw new Error('The protected TURN trial must be disabled on the primary deployment.');
  const expectedExpiry = demoExpiresAt && demoExpiresAt !== ONGOING_DEMO ? demoExpiresAt : null;
  if (demo.enabled !== !!demoExpiresAt || demo.expiresAt !== expectedExpiry) {
    throw new Error('The TURN demo enablement or expiry did not match the requested deployment.');
  }
  if (
    ice.turn !== false || 'error' in ice || !Array.isArray(ice.iceServers) || ice.iceServers.length !== 1 ||
    ice.iceServers[0]?.urls?.length !== 1 || ice.iceServers[0].urls[0] !== 'stun:stun.cloudflare.com:3478'
  ) throw new Error('/ice did not return the expected STUN-only configuration.');
}

async function main() {
  const { values: { deploy, 'demo-until': demoDate } } = parseArgs({
    options: { deploy: { type: 'boolean' }, 'demo-until': { type: 'string' } },
  });
  if (!deploy && demoDate !== undefined) throw new Error('--demo-until is only for an explicit --deploy.');
  const demoExpiresAt = demoDeployExpiry(demoDate);
  if (!process.env.npm_execpath) throw new Error('Run npm run deploy:worker from spikes/s9-page-host.');
  const target = deploy ? deploymentTarget(process.env) : null;
  const token = deploy ? process.env.CLOUDFLARE_API_TOKEN?.trim() : '';
  if (deploy && !token) throw new Error('Set the account-scoped CLOUDFLARE_API_TOKEN for the explicit deploy step.');
  if (deploy && process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Live deployments in GitHub Actions must run from main.');
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLOUDFLARE_|CF_API_|WRANGLER_)/i.test(k)));
  Object.assign(env, {
    S9_SIGNAL_ORIGIN: '', CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_BASE_URL: api,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const revision = git('rev-parse', 'HEAD');
  const clean = !git('status', '--porcelain');
  const npm = (args, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root, env: { ...env, ...extraEnv }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed (${result.signal ?? `exit ${result.status}`}).`);
  };
  const runWrangler = (args, extraEnv = {}) => {
    // Do not load a local .env that could redirect Wrangler or supply unrelated settings.
    const emptyEnv = join(tmpdir(), 's9-wrangler-env-');
    const dir = mkdtempSync(emptyEnv);
    try {
      const file = join(dir, '.env');
      writeFileSync(file, '');
      npm(['run', 'wrangler', '--', 'deploy', '--config', 'wrangler.toml', '--name', worker, '--env-file', file, ...args], extraEnv);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  if (!deploy) {
    rmSync(stamp, { force: true });
    for (const prefix of ['.', '../i2-web-phones', '../s1-phone-bell']) npm(['ci', '--no-audit', '--no-fund', '--prefix', prefix]);
    npm(['run', 'charts', '--prefix', '../i2-web-phones']);
    npm(['run', 'brand', '--prefix', '../i2-web-phones']);
    npm(['run', 'build']);
    runWrangler(['--dry-run']);
    writeFileSync(stamp, JSON.stringify({ revision, clean, builtAt: readJson(buildInfo).builtAt }));
    console.log(`S9 dry run passed for ${revision}; no Cloudflare deployment.${clean ? '' : ' Run again from a clean checkout before deploying.'}`);
    return;
  }

  if (!clean) throw new Error('Live deployment requires a clean checkout.');
  if (!existsSync(stamp) || !existsSync(buildInfo)) throw new Error('Run npm run deploy:worker from this clean checkout before deploying.');
  const prepared = readJson(stamp);
  const built = readJson(buildInfo);
  if (!prepared.clean || prepared.revision !== revision || prepared.builtAt !== built.builtAt || built.signal !== '') {
    throw new Error('Run npm run deploy:worker from this clean checkout before deploying.');
  }
  await verifyCloudflareTarget(target, token, fetch, !!demoExpiresAt);

  const outputDir = mkdtempSync(join(tmpdir(), 's9-wrangler-'));
  const output = join(outputDir, 'deploy.jsonl');
  try {
    // Keep existing secrets; the only supplied bindings are the explicit, non-secret demo settings.
    const vars = demoExpiresAt ? ['--var', 'S9_TURN_DEMO:1', '--var', `S9_TURN_DEMO_UNTIL:${demoDate}`] : [];
    if (demoExpiresAt) demoDeployExpiry(demoDate); // Preflight may have crossed the cutoff.
    runWrangler(['--keep-vars', '--message', `git ${revision}`, ...vars], {
      CLOUDFLARE_ACCOUNT_ID: target.account, CLOUDFLARE_API_TOKEN: token,
      WRANGLER_OUTPUT_FILE_PATH: output, npm_config_offline: 'true',
    });
    const record = readFileSync(output, 'utf8').trim().split(/\r?\n/).map(JSON.parse).find((entry) => entry.type === 'deploy');
    if (record?.worker_name !== worker || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(record.version_id ?? '')) {
      throw new Error('Wrangler did not report the deployed Worker version. Check Cloudflare Deployments before retrying.');
    }
    const summary = `S9 Worker: ${target.origin}\nSource: ${revision}\nWorker version: ${record.version_id}`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.replaceAll('\n', '  \n')}\n`);
    if (!record.targets?.some((url) => url === target.origin || url === `${target.origin}/`)) {
      throw new Error('Wrangler did not report the expected public URL. A version was deployed; inspect the account before retrying.');
    }

    // Allow time for the new assets to propagate without deploying again.
    for (let attempt = 1; ; attempt++) {
      try {
        await smoke(target.origin, built.builtAt, fetch, demoExpiresAt);
        const demoStatus = demoExpiresAt === ONGOING_DEMO ? 'enabled (ongoing)' : demoDate ? `enabled until ${demoDate}` : 'off';
        console.log(`S9 live smoke passed: TV, controller, STUN-only /ice, signalling, demo ${demoStatus}.`);
        break;
      } catch (error) {
        if (attempt === 3) throw new Error(`Deployment completed, but live smoke failed: ${error.message} Check the recorded version before retrying.`);
        console.warn(`S9 smoke attempt ${attempt} failed: ${error.message}; retrying.`);
        await delay(5000);
      }
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`S9: ${error.message}`);
    process.exitCode = 1;
  });
}
