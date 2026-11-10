// Prepares the stock `cap add ios` project for an iPad TestFlight build. Idempotent.
// Run after `npx cap add ios` (npm run add:ios). Building and signing need macOS + Xcode: see
// docs/spikes/S9-report.md (§ iPad / TestFlight) for the owner's steps and the CI options.
//  - keep the screen awake during songs (idle timer off)
//  - local-network usage string: WebRTC host candidates talk to phones on the same Wi-Fi
//  - export compliance: only OS-provided standard encryption (HTTPS, WebRTC DTLS), so no
//    per-upload encryption questionnaire in App Store Connect (owner to confirm)
//  - iPad-first: landscape, full screen
//  - brand icon and splash (make-art.mjs)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, 'ios', 'App', 'App');
if (!existsSync(app)) throw new Error('no ios project: run "npx cap add ios" first');

function edit(file, fn) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
}

edit(join(app, 'AppDelegate.swift'), (s) =>
  s.includes('isIdleTimerDisabled')
    ? s
    : s.replace(
        '// Override point for customization after application launch.',
        '// A song plays for minutes without touches: keep the iPad awake.\n        application.isIdleTimerDisabled = true',
      ),
);

const plistKeys = {
  NSLocalNetworkUsageDescription:
    '<string>Go Go HarmoniYo connects to the phones on your Wi-Fi that join your game, so they can ring bells with low latency.</string>',
  ITSAppUsesNonExemptEncryption: '<false/>',
  UIRequiresFullScreen: '<true/>',
};
edit(join(app, 'Info.plist'), (s) => {
  for (const [k, v] of Object.entries(plistKeys)) {
    if (!s.includes(`<key>${k}</key>`)) s = s.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t${v}\n</dict>\n</plist>\n`);
  }
  // iPad: landscape only (the highway is wide); iPhone keeps Capacitor's defaults.
  return s.replace(
    /(<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>)[\s\S]*?(<\/array>)/,
    '$1\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t$2',
  );
});

execFileSync(process.execPath, [join(here, 'make-art.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
console.log('S9 ios patch: idle timer off, local-network string, export compliance, iPad landscape, brand art');
