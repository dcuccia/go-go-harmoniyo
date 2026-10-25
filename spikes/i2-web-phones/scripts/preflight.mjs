// Preflight checks for `npm start` (#25): explain common setup problems in plain words, each with
// a fix. Pure helpers are exported for test/preflight.test.mjs; the probes only read system state
// (sockets, os.networkInterfaces, `reg query`, `netstat`, `tasklist`, `lsof`, Get-NetConnectionProfile).
// Nothing here changes the system: fixes are printed for the owner to run.
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import net from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

export const MIN_NODE = 22;
// The TV page port is loopback-only (phones use the HTTPS port or the tunnel), so its number has no
// network or certificate meaning. 8080 is what Docker, WSL, dev servers and proxies grab first
// (#53), so the default is a rarely used port instead, away from the test scripts' ports (e2e
// 18080+ and 18443+, controller-check 18300/18663, seating-e2e 18500/18863, webkit 18700/19063).
// If it is busy anyway, npm start moves to the next free port (unless --http-port was given).
export const DEFAULT_HTTP_PORT = 18900;
export const DEFAULT_HTTPS_PORT = 8443;

// ── arguments ───────────────────────────────────────────────────────────────

/** Flags start.mjs handles itself; they are not passed to the S1 host (its parseArgs is strict). */
const OWN_FLAGS = new Set(['--check', '--no-build', '--help', '-h']);

/** The S1 host's options (spikes/s1-phone-bell/src/host/server.ts parseArgs; a test keeps them in sync). */
export const HOST_OPTIONS = Object.fromEntries([
  ...['port', 'http-port', 'ip', 'cert', 'key', 'hostname', 'public-url', 'yarg-port', 'yarg-phones', 'yarg-ringers', 'song', 'difficulty', 'charts', 'game'].map((k) => [k, { type: 'string' }]),
  ...['tunnel', 'no-open', 'no-https', 'yarg'].map((k) => [k, { type: 'boolean' }]),
]);

/** npm keeps `npm start --tunnel` (no `--`) for itself as npm_config_tunnel; map those back to our flags. */
const NPM_SWALLOWED = { tunnel: '--tunnel', ip: '--ip', port: '--port', http_port: '--http-port', check: '--check', build: '--no-build', open: '--no-open', https: '--no-https', public_url: '--public-url' };

/**
 * Options the S1 host would reject (it exits with a stack trace, after the install and build), or
 * that npm swallowed because they came without `--`. Returns error findings.
 */
export function argProblems(argv, env = process.env) {
  const out = [];
  const example = 'npm start -- --ip 192.168.1.20   or   npm start -- --tunnel';
  if (env.npm_lifecycle_event) {
    const lost = Object.entries(NPM_SWALLOWED).filter(([k]) => env[`npm_config_${k}`] !== undefined).map(([, flag]) => flag);
    if (lost.length) {
      out.push({ level: 'error', title: `npm kept ${lost.join(', ')} for itself: put game options after --`, fix: [`npm start -- ${lost.join(' ')} …   (e.g. ${example})`] });
      return out;
    }
  }
  try {
    parseArgs({ args: argv.filter((a) => !OWN_FLAGS.has(a)), options: HOST_OPTIONS, strict: true, allowPositionals: false });
  } catch (e) {
    out.push({ level: 'error', title: String(e.message).split(/\.\s|\n/)[0], fix: [`See npm start -- --help. Options go after --, e.g. ${example}`] });
  }
  return out;
}

/** Value of `--name v` or `--name=v` (last one wins, like parseArgs), else undefined. */
export function flagValue(args, name) {
  let v;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) v = args[i + 1];
    else if (args[i].startsWith(`--${name}=`)) v = args[i].slice(name.length + 3);
  }
  return v;
}

/** Split start.mjs's own flags from the S1 host's and read the options preflight needs. */
export function parseStartArgs(argv) {
  const hostArgs = argv.filter((a) => !OWN_FLAGS.has(a));
  const port = (name, def) => {
    const v = flagValue(hostArgs, name);
    if (v === undefined) return def;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : NaN;
  };
  return {
    check: argv.includes('--check'),
    noBuild: argv.includes('--no-build'),
    help: argv.includes('--help') || argv.includes('-h'),
    hostArgs,
    ip: flagValue(hostArgs, 'ip'),
    httpPort: port('http-port', DEFAULT_HTTP_PORT),
    httpPortGiven: flagValue(hostArgs, 'http-port') !== undefined,
    httpsPort: port('port', DEFAULT_HTTPS_PORT),
    tunnel: hostArgs.includes('--tunnel'),
    noHttps: hostArgs.includes('--no-https'),
    publicUrl: flagValue(hostArgs, 'public-url'),
  };
}

// ── network adapters ────────────────────────────────────────────────────────

const VIRTUAL = /vethernet|virtualbox|vmware|vmnet|wsl|hyper-v|docker|^br-|^veth|virbr|tailscale|zerotier|nordlynx|wireguard|openvpn|\btap\b|^tun\d|^utun|vpn|bluetooth|loopback|npcap|^lo\d*$/i;
const WIFI = /wi-?fi|wlan|wireless|^wl|^en0$|airport/i;
const WIRED = /ethernet|^eth\d|^en\d|^enp|^eno|^ens/i;

export function isPrivateIPv4(a) {
  return /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}

/**
 * Every external IPv4 address, best first. Phones are on Wi-Fi, so a Wi-Fi adapter beats a wired
 * one even in another private range (the owner's PC advertised its wired address before, #10).
 * `usable` = a private address on a real (not virtual/VPN) adapter that phones could reach.
 */
export function classifyAdapters(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      const fam = a.family;
      if ((fam !== 'IPv4' && fam !== 4) || a.internal) continue;
      const linkLocal = a.address.startsWith('169.254.');
      const kind = VIRTUAL.test(name) ? 'virtual' : WIFI.test(name) ? 'wifi' : WIRED.test(name) ? 'wired' : 'other';
      const priv = isPrivateIPv4(a.address);
      let score = { wifi: 5, wired: 2, other: 0, virtual: -10 }[kind];
      if (a.address.startsWith('192.168.')) score += 3;
      else if (a.address.startsWith('10.')) score += 2;
      else if (priv) score += 1;
      else score -= 5;
      if (linkLocal) score -= 20;
      out.push({ name, address: a.address, kind, private: priv, linkLocal, usable: priv && kind !== 'virtual', score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const KIND_LABEL = { wifi: 'Wi-Fi', wired: 'wired', other: 'network', virtual: 'virtual/VPN' };
const describe = (c) => `${c.address} (${c.name}${c.kind === 'virtual' ? ', virtual/VPN' : ''})`;

// ── ports ───────────────────────────────────────────────────────────────────

/**
 * Is `port` free for the S1 host? Like the host's own fail-fast check, something answering on
 * 127.0.0.1 counts as busy (on Windows a 0.0.0.0 bind can succeed next to it); then try the bind.
 * EACCES on Windows usually means a Hyper-V/WSL reserved range.
 */
export function probePort(port, bindHost) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const answered = (yes) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (yes) return resolve({ port, free: false, code: 'EADDRINUSE' });
      const srv = net.createServer();
      srv.once('error', (e) => resolve({ port, free: false, code: e.code ?? 'ERROR' }));
      srv.listen({ port, host: bindHost, exclusive: true }, () => srv.close(() => resolve({ port, free: true })));
    };
    sock.setTimeout(500);
    sock.once('connect', () => answered(true));
    sock.once('timeout', () => answered(false));
    sock.once('error', () => answered(false));
  });
}

export async function nextFreePort(from, bindHost, avoid = []) {
  for (let p = from + 1; p < from + 50 && p < 65536; p++) {
    if (avoid.includes(p)) continue;
    if ((await probePort(p, bindHost)).free) return p;
  }
  return null;
}

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err && !stdout ? null : String(stdout)));
  });
}

/** PIDs listening on `port` from `netstat -ano` (locale-proof: listening sockets have a *:0 peer). */
export function parseNetstatListeners(text, port) {
  const pids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || !/^TCP/i.test(f[0])) continue;
    if (f[1].endsWith(`:${port}`) && /:0$/.test(f[2]) && /^\d+$/.test(f[4]) && f[4] !== '0') pids.add(Number(f[4]));
  }
  return [...pids];
}

/** Best effort: which program listens on `port`? → [{ pid, name }] (empty if unknown). */
export async function portOwners(port, platform = process.platform) {
  if (platform === 'win32') {
    const ns = await run('netstat', ['-ano']);
    if (!ns) return [];
    const owners = [];
    for (const pid of parseNetstatListeners(ns, port)) {
      const tl = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      const m = tl && /^"([^"]+)","(\d+)"/m.exec(tl);
      owners.push({ pid, name: m ? m[1] : 'unknown program' });
    }
    return owners;
  }
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  if (!out) return [];
  const owners = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) owners.push({ pid: Number(line.slice(1)), name: 'unknown program' });
    else if (line.startsWith('c') && owners.length) owners[owners.length - 1].name = line.slice(1);
  }
  return owners;
}

// ── cloudflared (for --tunnel) ──────────────────────────────────────────────

export function findOnPath(cmd, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext.toLowerCase());
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** cloudflared on PATH, else in a usual install folder (the host then gets that folder on PATH). */
export function findCloudflared(env = process.env, platform = process.platform) {
  const onPath = findOnPath('cloudflared', env, platform);
  if (onPath) return { path: onPath, onPath: true };
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  const places = platform === 'win32'
    ? [
        join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'cloudflared', 'cloudflared.exe'),
        join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
        join(env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
        join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
      ]
    : ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared', join(home, '.local', 'bin', 'cloudflared')];
  const found = places.find((p) => existsSync(p));
  return found ? { path: found, onPath: false } : null;
}

// ── Windows: network profile and firewall ───────────────────────────────────

const PROFILE_OF_CATEGORY = { Public: 'Public', Private: 'Private', DomainAuthenticated: 'Domain' };

/** Parse `reg query … /f node.exe /d` output into inbound firewall rules for `exePath`. */
export function parseFirewallRules(text, exePath, env = process.env) {
  const want = exePath.toLowerCase();
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /\sREG_SZ\s+(v\d.*)$/.exec(line);
    if (!m) continue;
    const kv = { profiles: [] };
    for (const part of m[1].split('|')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (k === 'Profile') kv.profiles.push(v);
      else kv[k] = v;
    }
    const app = (kv.App ?? '').replace(/%([^%]+)%/g, (_, n) => env[n] ?? env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase())] ?? `%${n}%`);
    if (app.toLowerCase() !== want || kv.Dir !== 'In') continue;
    rules.push({
      name: kv.Name ?? '(unnamed rule)',
      action: kv.Action,
      active: kv.Active === 'TRUE',
      protocol: kv.Protocol ?? 'any',
      profiles: kv.profiles.length ? kv.profiles : ['Domain', 'Private', 'Public'],
      ports: kv.LPort ? kv.LPort.split(',') : null,
    });
  }
  return rules;
}

const portMatches = (spec, ports) => !spec || spec.some((s) => {
  const [lo, hi] = s.split('-').map(Number);
  return ports.some((p) => (hi ? p >= lo && p <= hi : p === lo));
});

/** Parse `reg query <FirewallPolicy> /s /v EnableFirewall` → { Domain, Private, Public } booleans. */
export function parseFirewallEnabled(text) {
  const out = {};
  let profile = null;
  for (const line of text.split(/\r?\n/)) {
    const key = /\\(Domain|Standard|Private|Public)Profile$/i.exec(line.trim());
    if (key) profile = key[1].toLowerCase() === 'standard' ? 'Private' : key[1][0].toUpperCase() + key[1].slice(1).toLowerCase();
    const v = /EnableFirewall\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(line);
    if (v && profile) out[profile] = parseInt(v[1], 16) !== 0;
  }
  return out;
}

/**
 * Turn the Windows facts into one finding for the network the phones will use.
 * net: { alias, name, category } | null; enabled: { Public: bool, … }; rules: parseFirewallRules().
 */
export function firewallFinding({ net: n, enabled = {}, rules = null, ports, nodePath }) {
  const allowCmd = (profile) => `New-NetFirewallRule -DisplayName 'Go Go HarmoniYo (Node.js)' -Direction Inbound -Action Allow -Protocol TCP -Program '${nodePath}' -Profile ${profile}`;
  const makePrivate = n ? [
    `Make this network Private: Settings → Network & internet → ${n.alias.startsWith('Wi') ? 'Wi-Fi' : 'Ethernet'} → "${n.name}" → Network profile type → Private`,
    `  (or in an admin PowerShell: Set-NetConnectionProfile -InterfaceAlias '${n.alias}' -NetworkCategory Private)`,
  ] : [];
  if (!n && rules) {
    const allowed = [...new Set(rules.filter((r) => r.action === 'Allow' && r.active && portMatches(r.ports, ports)).flatMap((r) => r.profiles))];
    const blocked = [...new Set(rules.filter((r) => r.action === 'Block' && r.active && portMatches(r.ports, ports)).flatMap((r) => r.profiles))];
    return {
      level: 'warn', title: `Windows Firewall: Node.js is allowed on ${allowed.length ? allowed.join('/') : 'no'} networks${blocked.length ? `, blocked on ${blocked.join('/')}` : ''}`,
      lines: ["Couldn't tell whether this PC's network is Private or Public. Phones connect only if Node.js is allowed on that type.",
        'Check: Settings → Network & internet → Wi-Fi → your network → Network profile type.'],
      fix: allowed.includes('Private') && !blocked.includes('Private') ? ['Home networks should be Private.'] : [`Allow Node.js on Private networks (admin PowerShell): ${allowCmd('Private')}`],
    };
  }
  if (!n) {
    return {
      level: 'warn', title: 'Windows Firewall: remember to allow Node.js on Private networks',
      lines: ['The first time, Windows asks whether Node.js may accept connections: tick Private networks and click Allow.',
        'Your home Wi-Fi must be a Private network too (Settings → Network & internet → Wi-Fi → your network → Private).'],
    };
  }
  const profile = PROFILE_OF_CATEGORY[n.category] ?? n.category;
  const where = `"${n.name}" (${n.alias}) is a ${profile} network`;
  if (enabled[profile] === false) return { level: 'ok', title: `Windows Firewall is off for ${profile} networks; ${where}` };
  if (!rules) {
    return {
      level: 'warn', title: `${where}; couldn't read the Windows Firewall rules for Node.js`,
      lines: [`If Windows asks, allow Node.js on ${profile} networks.${profile === 'Private' ? '' : ' Better: make this home network Private.'}`],
      fix: profile === 'Private' ? [] : makePrivate,
    };
  }
  const applies = (r) => r.active && (r.protocol === '6' || r.protocol === 'any') && r.profiles.includes(profile) && portMatches(r.ports, ports);
  const blocks = rules.filter((r) => r.action === 'Block' && applies(r));
  if (blocks.length) {
    return {
      level: 'warn', title: `Windows Firewall BLOCKS Node.js on ${profile} networks, and ${where}`,
      lines: [`Rule "${blocks[0].name}" (Block) — usually left by clicking Cancel on the "allow access" prompt. Phones won't connect.`],
      fix: [
        `Open "Windows Defender Firewall with Advanced Security" → Inbound Rules → "${blocks[0].name}" (the Block one) → Properties → Allow the connection`,
        `  (or in an admin PowerShell: Get-NetFirewallApplicationFilter -Program '${nodePath}' | Get-NetFirewallRule | Where-Object Action -eq Block | Remove-NetFirewallRule, then allow it when Windows asks)`,
        'Or use the cloud tunnel: npm start -- --tunnel',
      ],
    };
  }
  if (rules.some((r) => r.action === 'Allow' && applies(r))) {
    return { level: 'ok', title: `Windows Firewall allows Node.js on ${profile} networks; ${where}` };
  }
  const elsewhere = [...new Set(rules.filter((r) => r.action === 'Allow' && r.active).flatMap((r) => r.profiles))];
  if (elsewhere.length) {
    return {
      level: 'warn', title: `${where}, but Windows Firewall allows Node.js only on ${elsewhere.join('/')} networks`,
      lines: ['Phones will see the join page time out.'],
      fix: [
        ...(profile === 'Private' ? [] : makePrivate),
        `Or allow Node.js on ${profile} networks (admin PowerShell): ${allowCmd(profile)}`,
        'Or use the cloud tunnel: npm start -- --tunnel',
      ],
    };
  }
  return {
    level: 'warn', title: `Windows Firewall has no rule for Node.js yet; ${where}`,
    lines: [`When Windows asks whether Node.js may accept connections, tick ${profile === 'Private' ? 'Private networks' : `${profile} networks (or make the network Private first, below)`} and click Allow.`],
    fix: profile === 'Private' ? [] : makePrivate,
  };
}

/** Network names that suggest client isolation (phones can't reach other devices). */
export function networkHints(n) {
  const out = [];
  if (!n) return out;
  if (n.category === 'DomainAuthenticated') {
    out.push({ level: 'warn', title: `"${n.name}" is a work (domain) network`, lines: ['Work networks often stop phones from reaching a PC.'], fix: ['If phones can\'t open the join page: npm start -- --tunnel'] });
  }
  if (/guest|visitor|public|hotspot|free|xfinitywifi|cafe|hotel|airport/i.test(n.name)) {
    out.push({ level: 'warn', title: `"${n.name}" looks like a guest Wi-Fi`, lines: ['Guest Wi-Fi usually keeps devices apart, so phones can\'t reach this PC.'], fix: ['Use your home Wi-Fi on both, or the cloud tunnel: npm start -- --tunnel'] });
  }
  return out;
}

async function windowsNetworkProfiles() {
  const ps = "Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ alias = $_.InterfaceAlias; name = $_.Name; category = [string]$_.NetworkCategory } } | ConvertTo-Json -Compress";
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], 60000);
  if (!out || !out.trim()) return null;
  try {
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : [j];
  } catch {
    return null;
  }
}

/** Slow Windows probes (1–20 s on a busy PC): run them while packages install and the game builds. */
export async function windowsFindings({ adapter, ports, nodePath = process.execPath }) {
  const RULES = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy';
  const POLICY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall';
  const [profiles, local, gpo, state, gpoState] = await Promise.all([
    windowsNetworkProfiles(),
    run('reg', ['query', `${RULES}\\FirewallRules`, '/f', 'node.exe', '/d']),
    run('reg', ['query', `${POLICY}\\FirewallRules`, '/f', 'node.exe', '/d']),
    run('reg', ['query', RULES, '/s', '/v', 'EnableFirewall']),
    run('reg', ['query', POLICY, '/s', '/v', 'EnableFirewall']),
  ]);
  const n = adapter && profiles ? profiles.find((p) => p.alias === adapter.name) ?? null : null;
  const rules = local === null ? null : [...parseFirewallRules(local, nodePath), ...parseFirewallRules(gpo ?? '', nodePath)];
  const enabled = { ...parseFirewallEnabled(state ?? ''), ...parseFirewallEnabled(gpoState ?? '') };
  return [firewallFinding({ net: n, enabled, rules, ports, nodePath }), ...networkHints(n)];
}

// ── the checks ──────────────────────────────────────────────────────────────

/**
 * Fast checks (ports, adapters, cloudflared), then the slow Windows probes as a promise.
 * Returns { findings, later: Promise<findings[]>, ip, httpPort, env } — `ip` goes to the host as --ip,
 * `httpPort` is the TV page port to use (the default, or the next free one), and
 * `env` carries cloudflared's folder on PATH when it isn't there already.
 */
export async function runPreflight(opts, { platform = process.platform, env = process.env, ifaces } = {}) {
  const findings = [];
  const childEnv = { ...env };

  // Ports
  const bad = [opts.httpPort, opts.httpsPort].filter((p) => Number.isNaN(p));
  if (bad.length) findings.push({ level: 'error', title: '--port and --http-port take a number from 1 to 65535' });
  const httpBind = opts.noHttps ? '0.0.0.0' : '127.0.0.1';
  // The TV page port falls back to the next free one when it is the default and loopback-only (#53).
  const wanted = [{ port: opts.httpPort, bind: httpBind, flag: '--http-port', use: 'TV page', fallback: !opts.httpPortGiven && !opts.noHttps }];
  if (!opts.tunnel && !opts.noHttps) wanted.push({ port: opts.httpsPort, bind: '0.0.0.0', flag: '--port', use: 'phones, HTTPS' });
  let httpPort = opts.httpPort;
  for (const w of wanted.filter((x) => !Number.isNaN(x.port))) {
    const st = await probePort(w.port, w.bind);
    if (st.free) { findings.push({ level: 'ok', title: `Port ${w.port} is free (${w.use})` }); continue; }
    const owners = st.code === 'EADDRINUSE' ? await portOwners(w.port, platform) : [];
    const alt = await nextFreePort(w.port, w.bind, wanted.map((x) => x.port));
    const who = owners.length ? ` by ${owners.map((o) => `${o.name} (PID ${o.pid})`).join(', ')}` : '';
    const busy = st.code === 'EACCES' ? 'is reserved by the system' : `is already in use${who}`;
    if (w.fallback && alt) {
      findings.push({
        level: 'info', title: `Port ${w.port} (${w.use}) ${busy}: using port ${alt} instead`,
        lines: [`The TV page will be http://127.0.0.1:${alt}/game/ (only this PC uses it; phones are not affected).`,
          `To choose the port yourself: npm start -- --http-port <n>`],
      });
      w.port = alt;
      httpPort = alt;
      continue;
    }
    const stopCmd = (pid) => (platform === 'win32' ? `Stop-Process -Id ${pid}` : `kill ${pid}`);
    const fix = [];
    if (st.code === 'EACCES' && platform === 'win32') {
      fix.push('Windows reserves this port (Hyper-V/WSL/Docker). See: netsh interface ipv4 show excludedportrange protocol=tcp');
    } else if (owners.some((o) => /^node(\.exe)?$/i.test(o.name))) {
      fix.push(`Probably an earlier Go Go HarmoniYo host is still running: press Ctrl+C in its window (or ${stopCmd(owners.find((o) => /^node/i.test(o.name)).pid)})`);
    } else if (owners.some((o) => /docker|wslrelay|vpnkit/i.test(o.name))) {
      fix.push(`Docker or WSL is publishing port ${w.port}: stop that container (docker ps), or quit Docker Desktop`);
    } else {
      fix.push(owners.length ? `Close ${owners[0].name}, or stop it: ${stopCmd(owners[0].pid)}` : 'Close the program that uses it (another game host, a dev server, Docker…)');
    }
    if (alt) fix.push(`Or start on another port: npm start -- ${w.flag} ${alt}`);
    findings.push({ level: 'error', title: `Port ${w.port} (${w.use}) ${busy}`, fix });
  }

  // Network adapters
  const all = classifyAdapters(ifaces ?? networkInterfaces());
  const usable = all.filter((c) => c.usable);
  const ignored = all.filter((c) => !c.usable);
  let ip = opts.ip;
  let adapter = null;
  if (opts.tunnel) {
    findings.push({ level: 'ok', title: 'Network: cloud tunnel — phones can use any network with internet (Wi-Fi or mobile data)' });
  } else if (opts.ip) {
    adapter = all.find((c) => c.address === opts.ip) ?? null;
    if (adapter) findings.push({ level: 'ok', title: `Network: phones will join at ${describe(adapter)} (from --ip)` });
    else findings.push({ level: 'warn', title: `--ip ${opts.ip} is not an address of this PC`, lines: [`This PC has: ${all.map(describe).join(', ') || 'no IPv4 addresses'}`], fix: ['Use one of those, or leave out --ip'] });
  } else if (!usable.length) {
    findings.push({
      level: 'warn', title: 'No private network address found (192.168.x.x, 10.x.x.x or 172.16–31.x.x)',
      lines: [ignored.length ? `Found only: ${ignored.map(describe).join(', ')}` : 'This PC has no IPv4 network connection.', 'Phones on Wi-Fi will not be able to reach this PC.'],
      fix: ['Connect this PC to the same Wi-Fi as the phones, or use the cloud tunnel: npm start -- --tunnel'],
    });
  } else {
    adapter = usable[0];
    ip = adapter.address;
    if (usable.length === 1) {
      findings.push({ level: 'ok', title: `Network: phones will join at ${describe(adapter)}`, lines: ignored.length ? [`Ignored: ${ignored.map(describe).join(', ')}`] : [] });
    } else {
      findings.push({
        level: 'info', title: `Several network adapters: phones will join at ${describe(adapter)}`,
        lines: [`Phones must be on the same network as this address (${KIND_LABEL[adapter.kind]}). If the QR code doesn't open on a phone, try another:`,
          ...usable.slice(1).map((c) => `  npm start -- --ip ${c.address}    ${c.name}, ${KIND_LABEL[c.kind]}`),
          ...(ignored.length ? [`Ignored: ${ignored.map(describe).join(', ')}`] : [])],
      });
    }
  }

  // cloudflared
  if (opts.tunnel) {
    const cf = findCloudflared(env, platform);
    if (!cf) {
      findings.push({
        level: 'error', title: 'cloudflared was not found (needed for --tunnel)',
        fix: [platform === 'win32' ? 'Install it: winget install --id Cloudflare.cloudflared   (then open a new terminal)' : platform === 'darwin' ? 'Install it: brew install cloudflared' : 'Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
          'Or leave out --tunnel when the phones and this PC share a home Wi-Fi'],
      });
    } else if (cf.onPath) {
      findings.push({ level: 'ok', title: `cloudflared: ${cf.path}` });
    } else {
      const key = Object.keys(childEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      childEnv[key] = `${dirname(cf.path)}${delimiter}${childEnv[key] ?? ''}`;
      findings.push({ level: 'ok', title: `cloudflared: ${cf.path} (not on PATH; using it from there)` });
    }
  }

  // Firewall / network profile
  let later = Promise.resolve([]);
  if (!opts.tunnel) {
    if (platform === 'win32') {
      later = windowsFindings({ adapter, ports: wanted.map((w) => w.port) }).catch(() => [firewallFinding({ net: null, ports: [], nodePath: process.execPath })]);
    } else if (platform === 'darwin') {
      later = Promise.resolve([{ level: 'info', title: 'macOS firewall: if macOS asks whether "node" may accept incoming connections, click Allow' }]);
    } else {
      // Only the ports phones reach; the TV page port is loopback-only unless --no-https.
      const lan = wanted.filter((w) => w.bind !== '127.0.0.1').map((w) => w.port);
      later = Promise.resolve([{ level: 'info', title: `Linux firewall: if one is on (ufw, firewalld), allow TCP ${lan.join(' and ')} from your LAN, e.g. sudo ufw allow ${lan.join(',')}/tcp` }]);
    }
  }
  return { findings, later, ip, adapter, httpPort, env: childEnv };
}

// ── output ──────────────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const MARK = { ok: paint(32, '✓'), info: paint(36, 'i'), warn: paint(33, '!'), error: paint(31, '✗') };

export function formatFindings(findings) {
  const out = [];
  for (const f of findings) {
    out.push(`  ${MARK[f.level]} ${f.title}`);
    for (const l of f.lines ?? []) out.push(`      ${l}`);
    (f.fix ?? []).forEach((l, i) => out.push(`      ${i === 0 ? paint(1, 'Fix:') : '    '} ${l}`));
  }
  return out.join('\n');
}

/** Does a project need `npm ci`? Same freshness test as tools/setup/setup-web.ps1 (npm's hidden lockfile). */
export function needsInstall(dir) {
  const lock = join(dir, 'package-lock.json');
  const hidden = join(dir, 'node_modules', '.package-lock.json');
  if (!existsSync(lock)) return false;
  if (!existsSync(hidden)) return true;
  return statSync(hidden).mtimeMs < statSync(lock).mtimeMs;
}
