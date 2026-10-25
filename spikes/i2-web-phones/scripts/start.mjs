// One command to play: `npm start` at the repo root (or in this folder).
//   npm start [-- --tunnel] [--ip 192.168.1.20] [--http-port 18901 --port 8444] [--check] [--no-build] [--help]
// Checks the setup (Node, ports, network adapters, firewall, cloudflared) and explains problems with
// a fix, installs missing packages, builds the game and runs the S1 phone host serving it at /game/.
// Phones join over HTTPS on the LAN (S1, self-signed cert) or a cloud tunnel; the TV page is
// http://127.0.0.1:18900/game/ (or the next free port, #53). Ctrl+C stops the host.
//
// This file must stay parseable by old Node versions so it can explain the version requirement.
const MIN_NODE = 22;
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  console.error(`
  ✗ Go Go HarmoniYo needs Node.js ${MIN_NODE} or newer; this is Node.js ${process.versions.node}.
    Fix: Windows: pwsh tools/setup/setup-web.ps1 -AllowElevation   (installs Node.js LTS, see tools/setup/README.md)
         or install the LTS from https://nodejs.org (macOS: brew install node@${MIN_NODE}; Linux: nvm install ${MIN_NODE}),
         then open a new terminal and run npm start again.
`);
  process.exit(1);
}

import('./launch.mjs')
  .then((m) => m.main(process.argv.slice(2)))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
