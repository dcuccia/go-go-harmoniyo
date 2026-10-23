// One command for the owner: build the game, then run the S1 phone host serving it at /game/.
//   npm start [-- --ip 192.168.1.20] [--no-build] [any other S1 host flag, e.g. --tunnel]
// Phones join over HTTPS on the LAN (S1, self-signed cert); the TV page is http://127.0.0.1:8080/game/.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const s1 = join(root, '..', 's1-phone-bell');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const hostArgs = args.filter((a) => a !== '--no-build');

function run(cmd, a, cwd) {
  const r = spawnSync(cmd, a, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(join(s1, 'node_modules', 'tsx'))) {
  console.log('Installing the S1 phone host dependencies (first run)…');
  run(npm, ['install', '--no-audit', '--no-fund'], s1);
}
if (!noBuild || !existsSync(join(root, 'dist', 'index.html'))) run(npm, ['run', 'build'], root);

const tsx = join(s1, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, 'src/host/server.ts', '--game', join(root, 'dist'), ...hostArgs], { cwd: s1, stdio: 'inherit' });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
