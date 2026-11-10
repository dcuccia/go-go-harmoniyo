# Windows download-and-play package

A portable zip that lets relatives and teachers play Go Go HarmoniYo on Windows **without git,
npm, Node.js or any install** ([#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43)).
They unzip it, double-click `Play Go Go HarmoniYo.cmd`, and the phones scan the QR code. It
does the same as `npm start` at the repo root (preflight checks, the S1 phone host, the I2
game), using prebuilt files.

```
GoGoHarmoniYo\
  Play Go Go HarmoniYo.cmd   what people double-click (runs the exe, pauses on errors)
  go-go-harmoniyo.exe        Node.js 22 single executable application: launcher + phone host
  cloudflared.exe            Cloudflare Tunnel client for --tunnel (pinned, Apache-2.0)
  app\game\                  the I2 game, built by Vite (served at /game/)
  app\controller\            the phone controller page and its esbuild bundle
  app\brand\                 logos served at /brand/
  app\build-info.json        version, commit, Node and cloudflared versions
  README.txt                 for players: start, Windows prompts, tunnel, uninstall
  LICENSE.txt                MIT (the repo's LICENSE)
  ATTRIBUTION.md             art, songs and charts (generated from attribution/register.json)
  THIRD_PARTY_NOTICES.md     everything bundled, with full license texts (bundle gate)
  LICENSES\                  license texts used by our own files (REUSE)
```

## Build and test

Needs Windows x64 and Node 22. Run from the repo root:

```powershell
npm ci --prefix spikes/i2-web-phones; npm ci --prefix spikes/s1-phone-bell; npm ci --prefix tools/package/windows
node tools/package/windows/build.mjs            # [--version 0.1.0] [--skip-zip]
node tools/package/windows/smoke.mjs            # [path\to\GoGoHarmoniYo] [--tunnel-check]
```

Output goes to `tools/package/windows/out/` (gitignored):
`go-go-harmoniyo-<version>-windows-x64.zip`, `SHA256SUMS.txt` and `stage/GoGoHarmoniYo/`
(the unzipped package). The version is `--version`, otherwise the tag (`v0.1.0` → `0.1.0`),
otherwise `0.0.0-dev.<commit>`.

`smoke.mjs` starts the exe as the `.cmd` would, with `--no-open`, ports 18950/18951 and a
throwaway state folder. It checks the TV game page and its script, the charts, the QR code,
WebRTC (werift) availability, the phone controller page and script, the brand files, and that
nothing was written next to the exe. `--tunnel-check` starts with `--tunnel` (needs internet)
and loads the phone page through the `trycloudflare.com` address.

CI: [`.github/workflows/windows-package.yml`](../../../.github/workflows/windows-package.yml)
runs on `windows-latest` when started by hand, for `v*` tags, and for PRs that touch the package.
It builds, smoke-tests, and uploads the zip and `SHA256SUMS.txt` as a workflow artifact. **It
doesn't publish a release.** The owner downloads the artifact, checks it on a clean account (below),
and attaches the zip and `SHA256SUMS.txt` to the GitHub release.

## How it works

`build.mjs`:

1. Downloads the pinned `node.exe` and `cloudflared.exe` ([`binaries.json`](binaries.json)) and
   license texts missing from npm packages ([`license-texts.json`](license-texts.json)) into
   `out/cache/`, and checks every SHA-256.
2. Builds the game with Vite (charts and brand assets first, as `npm run build` does) and the
   phone controller with esbuild.
3. Bundles [`sea-main.mjs`](sea-main.mjs), the launcher
   ([`launch.mjs`](../../../spikes/i2-web-phones/scripts/launch.mjs) and `preflight.mjs`) and the
   host ([`server.ts`](../../../spikes/s1-phone-bell/src/host/server.ts), with werift for WebRTC)
   into one CommonJS script with esbuild. A Node SEA can only `require` built-in modules, so
   everything else must be in the bundle. esbuild itself stays out because the host skips its
   controller build when packaged.
4. Runs the **bundle gate** ([`tools/licensing/lib/bundle.mjs`](../../licensing/lib/bundle.mjs)).
   Every npm package in the game, controller and SEA bundles (from the Vite/esbuild module
   graphs), plus every pinned binary, must be allowlisted (or covered by an exception scoped to
   `tools/package/windows`) and have a license text. It writes `THIRD_PARTY_NOTICES.md`. The
   build fails otherwise. MPL-2.0 mediabunny ([CG-001](../licensing/exceptions.json)) is not in
   any bundle today (the game doesn't import it), and the gate would stop the build if it were.
5. Makes the SEA blob with the pinned `node.exe --experimental-sea-config`, copies `node.exe` to
   `go-go-harmoniyo.exe`, removes Node's Authenticode signature (`signtool remove /s`, when the
   Windows SDK is present), and injects the blob with
   [postject](https://github.com/nodejs/postject).
6. Copies `cloudflared.exe`, the `.cmd`, `README.txt` (version filled in, CRLF), LICENSE,
   ATTRIBUTION.md and LICENSES, then zips with Windows' `tar.exe` and writes `SHA256SUMS.txt`.

At run time the one exe has two roles ([`sea-main.mjs`](sea-main.mjs)):

- **Launcher** (default): checks that `app\game` is there, then runs the same preflight and
  start-up as `npm start` (`launch.mjs main(argv, packaged)`). Its advice says
  `"Play Go Go HarmoniYo.cmd" --tunnel` instead of `npm start -- --tunnel`. It starts the
  exe again as the host.
- **Host** (`GOGOHARMONIYO_ROLE=host`): the S1 host, with `GOGOHARMONIYO_APP_DIR` (prebuilt
  `app\`) and `GOGOHARMONIYO_STATE_DIR`. It serves the game at `/game/`, the QR code, and the
  phone page over HTTPS.

**cloudflared:** the launcher sets `GOGOHARMONIYO_CLOUDFLARED` to the `cloudflared.exe` beside
the exe and puts the exe's folder first on `PATH`. The host's lookup order (agreed with the
auto-tunnel work) is `GOGOHARMONIYO_CLOUDFLARED` → beside `process.execPath` → `PATH` → known
install folders.

**Portable:** the package never writes inside its own folder or anywhere machine-wide. The
self-signed certificate (kept so each phone warns only once) and session logs go to
`%LOCALAPPDATA%\GoGoHarmoniYo` (or `GOGOHARMONIYO_STATE_DIR`). Uninstall means deleting both
folders. The only system change is a Windows Firewall rule, and only if the user clicks *Allow
access*.

## What Windows asks the first time

- **SmartScreen** ("Windows protected your PC"): the exe and `.cmd` are unsigned and new, so
  Windows warns when the downloaded file is run (Explorer's *Extract All* keeps the download
  mark). *More info* → *Run anyway*. The warning may come up for the `.cmd`, the exe, or both;
  the owner should note which.
- **Smart App Control** (Windows 11, on by default on some clean installs): it blocks unsigned,
  unknown apps outright, with no *Run anyway*. Only code signing fixes this.
- **Windows Defender Firewall** ("Windows Security Alert"): when the host starts listening. The
  dialog shows the exe's version resource, so it names **"Node.js JavaScript Runtime"**; its
  path is the package's `go-go-harmoniyo.exe`. Allowing it needs admin rights. Without them
  (Cancel), phones on the LAN can't connect; use `--tunnel`. Preflight finds the rule by the
  exe's full path, so it moves with the folder. Each new folder location means a new prompt.
- **Phones:** a one-time certificate warning on the LAN address (not with `--tunnel`).

## Updating the pins

- **Node:** change `node.exe` in `binaries.json` (`version`, `url`, `sha256` from
  `https://nodejs.org/dist/v<ver>/SHASUMS256.txt`, `win-x64/node.exe`). Also update the
  LICENSE URL and hash for that tag. Keep it on 22.x (the Node CI uses 22, and SEA flags change
  between majors).
- **cloudflared:** take `cloudflared-windows-amd64.exe` from a
  [release](https://github.com/cloudflare/cloudflared/releases). The release page lists its
  SHA-256; check it against the download too. Also update the LICENSE URL and hash for that tag.
- Then run `node tools/licensing/license-gate.mjs` (THIRD_PARTY_NOTICES lists the pinned
  binaries) and the build.

## Measurements (2026-11-09, Windows 11 x64, local dev PC)

| What | Value |
|---|---|
| `go-go-harmoniyo.exe` | 89.4 MB (Node 22.23.4 + 2.2 MB SEA script) |
| `cloudflared.exe` | 55.4 MB (2026.10.7) |
| Zip | 56.1 MB |
| Build, warm cache | 14–25 s (first run also downloads ~85 MB) |
| Double-click to URLs printed (LAN, smoke) | 1.8–3.9 s |
| Same with `--tunnel` (trycloudflare.com URL printed) | 5.0–8.8 s |
| npm packages in the bundles | ~37, all MIT, ISC, BSD, Apache-2.0, 0BSD or Unlicense |

Smoke tested on the dev account only (LAN and `--tunnel`, from the stage folder and from the zip
extracted to `%TEMP%`). **Not yet tested on a clean Windows account**; see the checklist.

## Owner checklist: clean Windows account

Use a fresh local *standard* (non-admin) user, or Windows Sandbox / a clean VM, with no Node.js on
`PATH`.

1. Download the zip from the workflow artifact (or the release) **with a browser**, so it gets the
   download mark. Check `certutil -hashfile <zip> SHA256` against `SHA256SUMS.txt`.
2. Explorer → *Extract All…*. Double-click `Play Go Go HarmoniYo.cmd`. Note every prompt
   (SmartScreen for the `.cmd` and/or exe, and Smart App Control if it's on), with screenshots.
3. The browser opens the game with the QR code. Note the firewall dialog: its name and whether it
   asks for admin. Try both *Allow* (with admin) and *Cancel*.
4. A phone on the same Wi-Fi scans the QR code, accepts the certificate warning, and rings.
   Play a song with 2 phones.
5. Close the black window: the game page stops responding. Check Task Manager: no
   `go-go-harmoniyo.exe` or `cloudflared.exe` is left.
6. Start again with `"Play Go Go HarmoniYo.cmd" --tunnel` (Command Prompt in the folder): a phone
   on mobile data joins.
7. Only the folder and `%LOCALAPPDATA%\GoGoHarmoniYo` changed (plus the firewall rule if allowed).
   Delete both: nothing is left behind.

## Open questions

- **Code signing.** Unsigned means a SmartScreen warning for each new build until it earns
  reputation, and Smart App Control blocks it outright. Options: an OV/EV certificate, Azure
  Trusted Signing (about $10/month; needs an identity-verified individual or organization), or
  SignPath's free tier for open source. All need owner action outside the repo. Signing would
  also give the exe our own name and publisher in the firewall dialog.
- **Exe icon and version resource.** The exe still shows Node's icon and "Node.js JavaScript
  Runtime" (Explorer, Task Manager, firewall). Changing them (e.g. rcedit) would break Node's
  signature anyway, so it's best done together with our own signing.
- **macOS and Linux.** The same SEA approach works with `node` for those platforms. macOS also
  needs ad-hoc or Developer ID signing (`codesign`), notarization and quarantine handling. Linux
  needs a tarball and a `.sh`. Not built yet. ChromeOS needs the hosted PWA instead.
- **cloudflared's own notices.** cloudflared is Apache-2.0 with no upstream NOTICE file. Its
  statically linked Go dependencies (mostly BSD/MIT/Apache) aren't listed in our notices yet.
- **WebRTC copyleft.** werift is MIT, but if MPL-2.0 code (e.g. mediabunny) is ever bundled, the
  bundle gate fails until there's an exception scoped to this package (ADR-0008 copyleft gate).
- **Zip size.** About 56 MB, mostly Node and cloudflared. UPX or a slimmer Node build could cut
  it, but those trip antivirus heuristics more often. Not worth it for now.
