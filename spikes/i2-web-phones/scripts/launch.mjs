// Launcher behind `npm start` (repo root or this folder): preflight checks, install missing
// packages, build the game, then run the S1 phone host serving it at /game/. See start.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argProblems, formatFindings, needsInstall, parseStartArgs, runPreflight } from './preflight.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const spikes = join(root, '..');
const repo = join(spikes, '..');
const s1 = join(spikes, 's1-phone-bell');
// The host runs from S1; the game builds against S4's node_modules (three.js) and its own.
const PROJECTS = [s1, join(spikes, 's4-web-host'), root];

const USAGE = `Go Go HarmoniYo — start the game on this PC (the TV) and let phones join.

  npm start [-- options]

  --check              Run the preflight checks only, then exit (exit code 1 if something blocks the start)
  --ip <address>       Address phones use to reach this PC on the Wi-Fi (default: the best Wi-Fi/LAN address)
  --http-port <n>      TV page port, only used on this PC (default 18900; if it is busy, the next free one)
  --port <n>           Phone HTTPS port on the Wi-Fi (default 8443)
  --no-build           Reuse the last build (dist/) if there is one
  --no-open            Don't open the browser

  How phones connect (ADR-0012). By default, when cloudflared is installed and the internet is up,
  the QR code is a cloud-tunnel link (no certificate warning, works on guest Wi-Fi and mobile data);
  each phone then switches to a direct link to this PC when the Wi-Fi allows it, and stays on the
  tunnel otherwise. Without cloudflared or internet, the QR code is this PC's Wi-Fi address.
  --lan-only           Never use the tunnel: phones join on this Wi-Fi (alias: --no-tunnel)
  --tunnel             Tunnel only: fail if cloudflared is missing, never fall back to the Wi-Fi address
  --rtc auto|on|off    Direct link: auto (phones that joined via the tunnel; default), on (all phones), off
  --lan-qr-after <s>   While the tunnel is getting ready, wait this many seconds (default 60) before
                       showing the Wi-Fi QR code instead (certificate warning); "never": only if the
                       tunnel gives up
  --cloudflared <path> Use this cloudflared. Otherwise: $GOGOHARMONIYO_CLOUDFLARED, then next to the
                       program, then PATH, then the usual install folders
  Other S1 host flags (--cert/--key/--hostname, --public-url, --no-https) pass through; they imply --lan-only.
`;

const npmCli = process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : null;

/** Run npm without a shell when we know where npm-cli.js is (always the case under `npm start`). */
function npm(args, cwd) {
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

const rel = (p) => relative(repo, p).replace(/\\/g, '/') || '.';

/**
 * `packaged` (the portable Windows package, tools/package/windows): nothing to install or build;
 * `{ name, command, args, cwd, env, gameDir }` says how to run the prebuilt host, and `name`
 * replaces "npm start --" in the advice we print.
 */
export async function main(argv, packaged = null) {
  const say = packaged
    ? (s) => s.replace(/npm start -- /g, `${packaged.name} `).replace(/npm start \[-- options\]/g, `${packaged.name} [options]`).replace(/npm start/g, packaged.name).replace(/ \(then open a new terminal\)/g, '')
    : (s) => s;
  const fmt = (findings) => say(formatFindings(findings));
  const opts = parseStartArgs(argv);
  if (opts.help) {
    console.log(say(USAGE).replace(/\n  --no-build[^\n]*/, ''));
    return 0;
  }

  console.log(`\nGo Go HarmoniYo — preflight checks (${packaged ? 'portable package, ' : ''}Node.js ${process.versions.node})`);
  const argErrors = argProblems(argv);
  if (argErrors.length) {
    console.error(fmt(argErrors) + '\n');
    return 1;
  }
  const pre = await runPreflight(opts);
  const toInstall = packaged ? [] : PROJECTS.filter(needsInstall);
  const willBuild = !packaged && (!opts.noBuild || !existsSync(join(root, 'dist', 'index.html')));
  const steps = [];
  if (toInstall.length) steps.push(`install packages in ${toInstall.map(rel).join(', ')} (first run: about a minute)`);
  if (willBuild) steps.push('build the game');
  if (!packaged) pre.findings.unshift({ level: 'ok', title: `Node.js ${process.versions.node} (22 or newer)` });
  console.log(fmt(pre.findings));
  const errors = pre.findings.filter((f) => f.level === 'error').length;

  if (opts.check) {
    const later = await pre.later;
    if (later.length) console.log(fmt(later));
    const warns = [...pre.findings, ...later].filter((f) => f.level === 'warn').length;
    console.log(`\n  ${errors ? `${errors} problem(s) block the start.` : 'Ready to start.'}${warns ? ` ${warns} warning(s).` : ''}` +
      `${steps.length ? ` npm start will ${steps.join(', then ')}.` : ''}\n`);
    return errors ? 1 : 0;
  }
  if (errors) {
    console.error(say('\n  Fix the problem(s) marked ✗ above, then run npm start again.\n'));
    return 1;
  }

  for (const dir of toInstall) {
    console.log(`\nInstalling packages in ${rel(dir)}…`);
    if (!npm(['ci', '--no-audit', '--no-fund'], dir)) {
      console.error(`\n  ✗ npm ci failed in ${rel(dir)}. Close other Go Go HarmoniYo windows and dev servers (they lock files in node_modules), check the internet connection, and retry.\n`);
      return 1;
    }
  }
  if (willBuild) {
    console.log('\nBuilding the game…');
    if (!npm(['run', 'build'], root)) {
      console.error(`\n  ✗ The build failed (see above). Try: pwsh tools/setup/setup-web.ps1 -Force   (or delete node_modules folders and retry)\n`);
      return 1;
    }
  }

  // The Windows probes can take a while on a busy PC; don't hold the game back for them.
  const late = await Promise.race([pre.later, new Promise((r) => setTimeout(() => r(null), 10000).unref())]);
  if (late?.length) {
    console.log('\nNetwork and firewall:');
    console.log(fmt(late));
  } else if (!late) {
    console.log('\nStill checking the network profile and firewall; results will follow the host\'s start-up lines.');
    void pre.later.then((f) => {
      if (f.length) console.log(`\nNetwork and firewall (preflight):\n${fmt(f)}\n`);
    });
  }
  const warnings = [...pre.findings, ...(late ?? [])].filter((f) => f.level === 'warn').length;
  return startHost(opts, pre, warnings, packaged, say);
}

function startHost(opts, pre, warnings, packaged, say) {
  const hostArgs = [...opts.hostArgs];
  if (pre.ip && !opts.ip && opts.mode !== 'tunnel') hostArgs.push('--ip', pre.ip);
  // Hand the host the cloudflared preflight found, so both use the same one.
  if (pre.cloudflared && opts.mode !== 'lan' && !hostArgs.some((a) => a === '--cloudflared' || a.startsWith('--cloudflared='))) hostArgs.push('--cloudflared', pre.cloudflared);
  // The S1 host's own default is 8080; always pass the port preflight chose (#53).
  if (!opts.httpPortGiven) hostArgs.push('--http-port', String(pre.httpPort));
  const tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  console.log('\nStarting the phone host…');
  const child = packaged
    ? spawn(packaged.command, [...packaged.args, '--game', packaged.gameDir, ...hostArgs], {
      cwd: packaged.cwd,
      env: { ...pre.env, ...packaged.env },
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    : spawn(process.execPath, [tsx, 'src/host/server.ts', '--game', join(root, 'dist'), ...hostArgs], {
      cwd: s1,
      env: pre.env,
      stdio: ['inherit', 'pipe', 'inherit'],
    });

  // Pass the host's output through and watch it for the two URLs, then print a short summary.
  let tv = '';
  let phones = '';
  let shown = '';
  let buf = '';
  let bannerTimer;
  const banner = () => {
    const key = `${tv} ${phones}`;
    if (!tv || !phones || key === shown) return;
    shown = key;
    const line = '─'.repeat(64);
    process.stdout.write(`\n  ${line}\n  Go Go HarmoniYo is running\n` +
      `    TV:     ${tv}    (opens in the browser; drag it to the TV, F11 for full screen)\n` +
      `    Phones: ${phones}    (or scan the QR code on the TV)\n` +
      (/\.trycloudflare\.com/.test(phones)
        ? '    Phones join through the cloud tunnel, then switch to a direct Wi-Fi link when they can (the TV shows which).\n'
        : say('    Phones need the same Wi-Fi as this PC. If they can\'t connect: install cloudflared, or npm start -- --tunnel\n')) +
      (warnings ? `    Preflight: ${warnings} warning(s) above.\n` : '') +
      `    Stop:   Ctrl+C${packaged ? ' (or close this window)' : ''}\n  ${line}\n\n`);
  };
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const l = raw.replace(/\x1b\[[0-9;]*m/g, '');
      const p = /Phones: scan this or open (\S+)/.exec(l);
      if (p) phones = p[1];
      const g = /Game \(TV\): (\S+)/.exec(l);
      if (g) tv = g[1];
    }
    // After the host's burst of start-up lines (the QR code follows the join URL).
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(banner, 300);
  });
  if (opts.mode === 'tunnel') {
    setTimeout(() => {
      if (!phones) console.log('\n  ! No tunnel address from cloudflared after 45 s. Check this PC\'s internet connection, or start without --tunnel.\n');
    }, 45000).unref();
  }

  // Ctrl+C reaches the host directly (same console / process group), so let it shut down cleanly
  // and print where its logs are. On Windows, child.kill() is a hard kill, so only use it as a
  // fallback; on macOS/Linux forward the signal in case only this process got it.
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    if (process.platform !== 'win32') child.kill(sig);
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('SIGHUP'));
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (buf) process.stdout.write(buf);
      console.log(stopping ? 'Go Go HarmoniYo stopped.' : `The phone host exited (${signal ?? `code ${code}`}).`);
      resolve(stopping ? 0 : code ?? 1);
    });
  });
}
