// Entry point of the portable Windows package (go-go-harmoniyo.exe, a Node.js single executable
// application). tools/package/windows/build.mjs bundles this file, the launcher and the phone host
// into one CommonJS script; see tools/package/windows/README.md.
//
// One exe, two roles:
// - launcher (default): preflight checks, then start the exe again as the host and print the URLs
//   (the same flow as `npm start`, spikes/i2-web-phones/scripts/launch.mjs);
// - host (GOGOHARMONIYO_ROLE=host): the S1 phone host serving the prebuilt game at /game/.
//
// Files: the app is read from app\ next to the exe; certificates and session logs go to
// %LOCALAPPDATA%\GoGoHarmoniYo (or GOGOHARMONIYO_STATE_DIR). Nothing is written machine-wide.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// How people start it (README.txt); the launcher's advice ("… --tunnel") uses this name.
const LAUNCHER = '"Play Go Go HarmoniYo.cmd"';

const exeDir = dirname(process.execPath);
const appDir = process.env.GOGOHARMONIYO_APP_DIR || join(exeDir, 'app');
const stateDir = process.env.GOGOHARMONIYO_STATE_DIR ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'GoGoHarmoniYo');

async function host() {
  // Bundled by esbuild; the host picks it up from globalThis (server.ts, WebRTC section).
  globalThis.__gogoharmoniyoWerift = await import('werift').catch(() => null);
  await import('../../../spikes/s1-phone-bell/src/host/server.ts');
}

async function launcher(argv) {
  if (!existsSync(join(appDir, 'game', 'index.html'))) {
    console.error(`\n  ✗ The game files are missing (${join(appDir, 'game')}).\n` +
      '    Unzip the whole download (not just the exe) and run "Play Go Go HarmoniYo.cmd" from that folder.\n');
    return 1;
  }
  mkdirSync(stateDir, { recursive: true });
  const env = { GOGOHARMONIYO_ROLE: 'host', GOGOHARMONIYO_APP_DIR: appDir, GOGOHARMONIYO_STATE_DIR: stateDir };
  const cloudflared = join(exeDir, 'cloudflared.exe');
  if (!process.env.GOGOHARMONIYO_CLOUDFLARED && existsSync(cloudflared)) {
    env.GOGOHARMONIYO_CLOUDFLARED = cloudflared;
    // Preflight and older hosts look for cloudflared on PATH; put the bundled one first.
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    process.env[pathKey] = `${exeDir};${process.env[pathKey] ?? ''}`;
  }
  const { main } = await import('../../../spikes/i2-web-phones/scripts/launch.mjs');
  if (!argv.some((a) => a === '--help' || a === '-h')) console.log(`\n  Files: game ${appDir}\n         logs and certificates ${stateDir}`);
  return main(argv, {
    name: LAUNCHER,
    command: process.execPath,
    args: [],
    cwd: stateDir,
    env,
    gameDir: join(appDir, 'game'),
  });
}

if (process.env.GOGOHARMONIYO_ROLE === 'host') {
  host().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  launcher(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
