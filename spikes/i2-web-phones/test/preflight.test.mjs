// Preflight checks for `npm start` (#25). Ports use ephemeral (OS-assigned) numbers, never the defaults (18900/8443).
import net from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  argProblems,
  classifyAdapters,
  findCloudflared,
  firewallFinding,
  formatFindings,
  HOST_OPTIONS,
  needsInstall,
  networkHints,
  parseFirewallEnabled,
  parseFirewallRules,
  parseNetstatListeners,
  parseStartArgs,
  probePort,
  runPreflight,
} from '../scripts/preflight.mjs';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const __dirname = dirname(fileURLToPath(import.meta.url));
const v4 = (address) => [{ address, family: 'IPv4', internal: false }];

describe('parseStartArgs', () => {
  it('keeps its own flags away from the S1 host and reads ports, ip and tunnel', () => {
    const o = parseStartArgs(['--check', '--no-build', '--ip', '10.0.0.5', '--http-port=8091', '--port', '8491', '--tunnel', '--no-open']);
    expect(o).toMatchObject({ check: true, noBuild: true, ip: '10.0.0.5', httpPort: 8091, httpsPort: 8491, tunnel: true });
    expect(o.hostArgs).toEqual(['--ip', '10.0.0.5', '--http-port=8091', '--port', '8491', '--tunnel', '--no-open']);
  });
  it('defaults to 18900/8443 and flags a bad port', () => {
    expect(parseStartArgs([])).toMatchObject({ httpPort: 18900, httpPortGiven: false, httpsPort: 8443, tunnel: false });
    expect(parseStartArgs(['--http-port=18900']).httpPortGiven).toBe(true);
    expect(parseStartArgs(['--port', 'abc']).httpsPort).toBeNaN();
  });
  it('keeps the default TV port away from 8080 and the test scripts\' ports (#53)', () => {
    const { httpPort } = parseStartArgs([]);
    expect(httpPort).not.toBe(8080);
    // e2e 18080+ / 18443+, controller-check 18300/18663, seating-e2e 18500/18863, dropin-e2e 18600/18963,
    // webkit 18700/19063;
    // the fallback scans the next 49 ports.
    const taken = [[18080, 18099], [18443, 18462], [18300, 18300], [18663, 18663], [18500, 18500], [18863, 18863], [18600, 18600], [18963, 18963], [18700, 18700], [19063, 19063]];
    for (const [lo, hi] of taken) expect(httpPort + 49 < lo || httpPort > hi).toBe(true);
  });
});

describe('argProblems', () => {
  it('accepts the S1 host options', () => {
    expect(argProblems(['--check', '--tunnel', '--ip', '10.0.0.5', '--http-port=8091', '--no-open'], {})).toEqual([]);
  });
  it('rejects unknown options and stray values before the slow install and build', () => {
    expect(argProblems(['--typo'], {})[0].title).toContain("'--typo'");
    expect(argProblems(['10.9.8.7'], {})[0].fix?.join(' ')).toContain('npm start -- --ip');
  });
  it('explains options that npm swallowed because they came without --', () => {
    const [f] = argProblems(['10.9.8.7'], { npm_lifecycle_event: 'start', npm_config_tunnel: 'true', npm_config_ip: 'true' });
    expect(f.title).toBe('npm kept --tunnel, --ip for itself: put game options after --');
  });
  it('knows exactly the options of the S1 host (server.ts)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 's1-phone-bell', 'src', 'host', 'server.ts'), 'utf8');
    const block = /parseArgs\(\{\s*options:\s*\{([\s\S]*?)\r?\n  \},\r?\n\}\);/.exec(src)?.[1] ?? '';
    const names = [...block.matchAll(/^\s*'?([a-z-]+)'?:\s*\{\s*type:\s*'(string|boolean)'/gm)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(names.length).toBeGreaterThan(10);
    expect(names).toEqual(Object.entries(HOST_OPTIONS).map(([k, v]) => `${k}:${v.type}`).sort());
  });
});

describe('classifyAdapters', () => {
  it('prefers Wi-Fi over wired (phones are on Wi-Fi) and ignores virtual, VPN and link-local adapters', () => {
    const all = classifyAdapters({
      Ethernet: v4('192.168.1.20'),
      'Wi-Fi': v4('10.0.0.7'),
      'vEthernet (WSL (Hyper-V firewall))': v4('172.25.224.1'),
      NordLynx: v4('10.5.0.2'),
      'Wi-Fi 3': v4('169.254.161.215'),
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    });
    expect(all[0]).toMatchObject({ name: 'Wi-Fi', address: '10.0.0.7', kind: 'wifi', usable: true });
    expect(all.filter((c) => c.usable).map((c) => c.address)).toEqual(['10.0.0.7', '192.168.1.20']);
    expect(all.find((c) => c.name === 'NordLynx')?.kind).toBe('virtual');
    expect(all.find((c) => c.name === 'Wi-Fi 3')?.usable).toBe(false);
  });
  it('knows macOS and Linux Wi-Fi names', () => {
    expect(classifyAdapters({ en0: v4('192.168.0.3') })[0].kind).toBe('wifi');
    expect(classifyAdapters({ wlp2s0: v4('192.168.0.3') })[0].kind).toBe('wifi');
    expect(classifyAdapters({ enp3s0: v4('192.168.0.3') })[0].kind).toBe('wired');
  });
});

describe('runPreflight (network and ports)', () => {
  const free = async () => {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', () => r(null)));
    const port = s.address().port;
    await new Promise((r) => s.close(() => r(null)));
    return port;
  };
  const opts = async (extra = []) => parseStartArgs(['--http-port', String(await free()), '--port', String(await free()), ...extra]);

  it('lists the address used and the alternatives when there are several adapters', async () => {
    const r = await runPreflight(await opts(), { platform: 'linux', ifaces: { 'Wi-Fi': v4('192.168.70.107'), Ethernet: v4('10.1.2.3') } });
    expect(r.ip).toBe('192.168.70.107');
    const text = formatFindings(r.findings);
    expect(text).toContain('Several network adapters: phones will join at 192.168.70.107 (Wi-Fi)');
    expect(text).toContain('npm start -- --ip 10.1.2.3');
  });
  it('suggests --tunnel when there is no private IPv4 address', async () => {
    const r = await runPreflight(await opts(), { platform: 'linux', ifaces: { 'vEthernet (WSL)': v4('172.25.224.1'), 'Wi-Fi': v4('169.254.1.2') } });
    const text = formatFindings(r.findings);
    expect(text).toContain('No private network address found');
    expect(text).toContain('npm start -- --tunnel');
    expect(r.ip).toBeUndefined();
  });
  it('fails fast when a port is in use and suggests another port', async () => {
    const busy = net.createServer();
    await new Promise((r) => busy.listen(0, '127.0.0.1', () => r(null)));
    const port = busy.address().port;
    try {
      expect((await probePort(port, '127.0.0.1')).free).toBe(false);
      const r = await runPreflight(parseStartArgs(['--http-port', String(port), '--tunnel']), { platform: 'linux', env: { PATH: '' }, ifaces: {} });
      const portFinding = r.findings.find((f) => f.title.startsWith(`Port ${port}`));
      expect(portFinding?.level).toBe('error');
      expect(portFinding?.title).toContain('is already in use');
      expect(portFinding?.fix?.join('\n')).toMatch(/npm start -- --http-port \d+/);
      // --tunnel without cloudflared is an error too; with --tunnel the HTTPS port isn't checked.
      expect(r.findings.some((f) => f.level === 'error' && f.title.startsWith('cloudflared was not found'))).toBe(true);
      expect(r.findings.filter((f) => f.title.startsWith('Port'))).toHaveLength(1);
    } finally {
      busy.close();
    }
  }, 20000);
  it('moves the default TV port to the next free one, with a clear message (#53)', async () => {
    const busy = net.createServer();
    await new Promise((r) => busy.listen(0, '127.0.0.1', () => r(null)));
    const port = busy.address().port;
    try {
      // As if the default were busy: same options as no --http-port, with the busy port as the default.
      const o = { ...parseStartArgs(['--tunnel']), httpPort: port };
      const r = await runPreflight(o, { platform: 'linux', env: { PATH: '' }, ifaces: {} });
      const portFinding = r.findings.find((f) => f.title.startsWith(`Port ${port}`));
      expect(portFinding?.level).toBe('info');
      expect(portFinding?.title).toMatch(new RegExp(`^Port ${port} \\(TV page\\) is already in use.*: using port \\d+ instead$`));
      expect(r.httpPort).toBeGreaterThan(port);
      expect(portFinding?.lines?.join('\n')).toContain(`http://127.0.0.1:${r.httpPort}/game/`);
      expect((await probePort(r.httpPort, '127.0.0.1')).free).toBe(true);
    } finally {
      busy.close();
    }
  }, 20000);
  it('keeps the default TV port when it is free', async () => {
    const o = { ...parseStartArgs(['--tunnel']), httpPort: await free() };
    const r = await runPreflight(o, { platform: 'linux', env: { PATH: '' }, ifaces: {} });
    expect(r.httpPort).toBe(o.httpPort);
    expect(r.findings.find((f) => f.title.startsWith(`Port ${o.httpPort}`))?.level).toBe('ok');
  });
});

describe('cloudflared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('finds a portable install that is not on PATH and puts its folder on the host PATH', async () => {
    const exe = join(dir, 'Programs', 'cloudflared', 'cloudflared.exe');
    mkdirSync(join(dir, 'Programs', 'cloudflared'), { recursive: true });
    writeFileSync(exe, '');
    const env = { PATH: 'C:\\nowhere', LOCALAPPDATA: dir, PATHEXT: '.EXE' };
    expect(findCloudflared(env, 'win32')).toEqual({ path: exe, onPath: false });
    const r = await runPreflight(parseStartArgs(['--tunnel', '--http-port', '1']), { platform: 'win32', env, ifaces: {} });
    expect(r.env.PATH.startsWith(join(dir, 'Programs', 'cloudflared'))).toBe(true);
  });
  it('reports nothing when it is nowhere', () => {
    expect(findCloudflared({ PATH: '', LOCALAPPDATA: join(dir, 'none'), ProgramFiles: join(dir, 'none'), 'ProgramFiles(x86)': join(dir, 'none') }, 'win32')).toBeNull();
  });
});

describe('Windows firewall', () => {
  const reg = (data) => `\r\nHKEY_LOCAL_MACHINE\\...\\FirewallRules\r\n    TCP Query User{X}C:\\program files\\nodejs\\node.exe    REG_SZ    ${data}\r\n`;
  const wifi = (category) => ({ alias: 'Wi-Fi', name: 'Home', category });

  it('parses rules for this node.exe (env vars expanded, case-insensitive)', () => {
    const rules = parseFirewallRules(
      reg('v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Private|App=%ProgramFiles%\\nodejs\\node.exe|Name=Node.js JavaScript Runtime|') +
        reg('v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Public|App=C:\\other\\node.exe|Name=Other|'),
      NODE,
      { ProgramFiles: 'C:\\Program Files' },
    );
    expect(rules).toEqual([{ name: 'Node.js JavaScript Runtime', action: 'Allow', active: true, protocol: '6', profiles: ['Private'], ports: null }]);
  });
  it('reads which profiles have the firewall on', () => {
    const text = 'HKEY_LOCAL_MACHINE\\X\\FirewallPolicy\\DomainProfile\r\n    EnableFirewall    REG_DWORD    0x1\r\n\r\nHKEY_LOCAL_MACHINE\\X\\FirewallPolicy\\StandardProfile\r\n    EnableFirewall    REG_DWORD    0x0\r\n';
    expect(parseFirewallEnabled(text)).toEqual({ Domain: true, Private: false });
  });
  const rule = (action, profiles) => ({ name: 'Node.js JavaScript Runtime', action, active: true, protocol: '6', profiles, ports: null });
  const verdict = (net, rules, enabled = {}) => firewallFinding({ net, rules, enabled, ports: [8080, 8443], nodePath: NODE });

  it('warns when the Wi-Fi is Public but Node is allowed only on Private (owner pitfall)', () => {
    const f = verdict(wifi('Public'), [rule('Allow', ['Private'])]);
    expect(f.level).toBe('warn');
    expect(f.title).toContain('allows Node.js only on Private networks');
    expect(f.fix?.join('\n')).toContain("Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private");
  });
  it('is happy when Node is allowed on the network\'s profile or the firewall is off', () => {
    expect(verdict(wifi('Private'), [rule('Allow', ['Private'])]).level).toBe('ok');
    expect(verdict(wifi('Public'), [], { Public: false }).level).toBe('ok');
  });
  it('explains a Block rule (Cancel on the prompt)', () => {
    const f = verdict(wifi('Private'), [rule('Allow', ['Private']), rule('Block', ['Private'])]);
    expect(f.title).toContain('BLOCKS Node.js on Private networks');
  });
  it('reminds to allow Node on Private networks when there is no rule or nothing is known', () => {
    expect(verdict(wifi('Private'), []).lines?.join(' ')).toContain('tick Private networks');
    expect(verdict(null, null).title).toContain('allow Node.js on Private networks');
  });
  it('flags guest and work networks with --tunnel', () => {
    expect(networkHints({ alias: 'Wi-Fi', name: 'Contoso-Guest', category: 'Public' })[0].fix?.join(' ')).toContain('--tunnel');
    expect(networkHints({ alias: 'Ethernet', name: 'corp.contoso.com', category: 'DomainAuthenticated' })[0].title).toContain('work (domain) network');
    expect(networkHints({ alias: 'Wi-Fi', name: 'Home', category: 'Private' })).toEqual([]);
  });
  it('finds listening PIDs in netstat output', () => {
    const text = [
      '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       40868',
      '  TCP    [::1]:8080             [::]:0                 ABHÖREN         14376',
      '  TCP    127.0.0.1:50000        127.0.0.1:8080         ESTABLISHED     999',
      '  TCP    0.0.0.0:18080          0.0.0.0:0              LISTENING       5',
    ].join('\r\n');
    expect(parseNetstatListeners(text, 8080)).toEqual([40868, 14376]);
  });
});

describe('needsInstall', () => {
  it('installs when node_modules is missing or older than package-lock.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-npm-'));
    try {
      writeFileSync(join(dir, 'package-lock.json'), '{}');
      expect(needsInstall(dir)).toBe(true);
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', '.package-lock.json'), '{}');
      const t = Date.now() / 1000;
      utimesSync(join(dir, 'package-lock.json'), t - 60, t - 60);
      expect(needsInstall(dir)).toBe(false);
      utimesSync(join(dir, 'package-lock.json'), t + 60, t + 60);
      expect(needsInstall(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
