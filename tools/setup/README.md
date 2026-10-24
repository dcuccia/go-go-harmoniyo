# Setup scripts

Idempotent setup for the systems we carry forward after M2
([ADR-0004](../../docs/decisions/0004-host-strategy.md),
[ADR-0005](../../docs/decisions/0005-shared-core-language.md)).

Every script:
- Detects what is already in place and skips it, so it is safe to re-run.
- Supports `-DryRun` (or `-WhatIf`) to report what would change without changing anything.
- Prints a status table at the end.
- Exits with `0` (ok), `1` (a step failed), or `2` (an owner step is needed).
- Writes logs to `%TEMP%\handbell-setup`.
- **Stores no secrets.** Sign-ins (Unity) are done by the owner in their own apps; the scripts
  only check that they happened.

Steps that raise a UAC prompt (machine-wide installers) run only with `-AllowElevation` or
from an elevated shell. Otherwise they are reported as an owner action, with the command to
run.

Requires **PowerShell 7** (`winget install Microsoft.PowerShell`) on **Windows 10/11** with
`winget`. Run the scripts from any directory, e.g. `pwsh tools/setup/setup-web.ps1`.

| Script | Enables |
|---|---|
| [`setup-web.ps1`](setup-web.ps1) | **Product path (ADR-0004).** The S1 phone host and controller (`spikes/s1-phone-bell`), S5 chart pipeline, S4 web host, and the I2 web game (`spikes/i2-web-phones`) |
| [`setup-yarg.ps1`](setup-yarg.ps1) | **YARG community track.** The [`dcuccia/YARG@handbell-spike`](https://github.com/dcuccia/YARG/tree/handbell-spike) fork: toolchain, checkout, headless Win64 build, and the S5 carols as YARG songs. Phones reach it through the S1 host's `--yarg` sidecar ([I1](../../docs/spikes/I1-yarg-phones.md)), so run `setup-web.ps1` too |

## setup-web.ps1

| Step | Skipped when | Admin? |
|---|---|---|
| Node.js 22+ (`winget OpenJS.NodeJS.LTS`) | `node --version` ≥ 22 | Yes (MSI) |
| `npm ci` per project | `node_modules` matches `package-lock.json` (SHA-256 stamp, or npm's hidden lockfile is newer) | No |
| `npm run build` (S4, I2) | `dist/index.html` is newer than every tracked input. I2's inputs include the S1/S4/S5 code it imports | No |
| Smoke test: `typecheck` + `test` per project | `-SkipSmoke` | No |

Switches: `-Project <names>`, `-SkipBuild`, `-SkipSmoke`, `-Force`, `-AllowElevation`, `-DryRun`.
S5's `build.mjs` regenerates tracked chart files, so setup only runs its tests.

Expected time:
- Already set up: ~10 s (mostly the smoke tests).
- Fresh PC with Node: ~1–2 min (`npm ci` for 3 projects, 2 builds).
- Add a few minutes if Node itself must be installed.

Then, at the repo root: `npm start`
([runbook](../../spikes/i2-web-phones/README.md#owner-runbook-tv-playthrough-10-minutes)).
Its start-up checks explain firewall, adapter and port problems. Allow Node.js through Windows
Firewall for **Private networks** when asked. The phones and the PC must be on the same,
non-guest Wi-Fi (or use `npm start -- --tunnel`).

## setup-yarg.ps1

This encodes S3 Phase B's [B0/B1 tooling notes](../../docs/spikes/S3-report.md#b0b1--tooling-and-first-build).

| Step | Skipped when | Admin? | Fresh-PC time |
|---|---|---|---|
| Git, Git LFS (+ `git lfs install --skip-repo`) | found on PATH; global LFS filter set | Yes (installers) | 1–2 min |
| .NET SDK 10 | `dotnet --list-sdks` has 10.x | Yes | 2 min |
| Unity Hub (`winget Unity.UnityHub`). It's an **MSIX**: the CLI is `(Get-AppxPackage UnityTechnologies.UnityHub).InstallLocation\app\Unity Hub.exe` | package registered | No | 1 min |
| Unity editor **6000.3.5f2** (changeset `3fa8bc678cb0`), via `Unity Hub.exe --% -- --headless install …` | `Unity.exe` exists with that changeset | Yes (Program Files) | ~35 min, 8.2 GB |
| Unity license | an EDITOR entitlement (e.g. Unity Personal) is found | — | — |
| Blender 5.2.3 portable, per-user, from the Berkeley OCF mirror. SHA-256 is pinned and cross-checked against the mirror's checksum file. download.blender.org returned 403 in S3. Then `blender --register` | the pinned Blender exists, or any Blender is registered for `.blend` | No | 5 min (~400 MB) |
| NuGetForUnity.Cli 4.5.0 in `%LOCALAPPDATA%\yarg-handbell-tools` (the fork's `build.ps1` default `-ToolPath`) | that version is installed there | No | 15 s |
| Clone `dcuccia/YARG@handbell-spike` (`--filter=blob:none`, submodules, LFS) to `-ForkPath` (default `C:\Projects\YARG-handbell`), or fast-forward it | `HEAD` = `origin/handbell-spike`; submodules and LFS objects present. Local changes or other branches are reported, not touched | No | 1 min (405 MB) |
| Build via the fork's `scripts/handbell/build.ps1` (NuGet restore → batch import → Win64 player) to `-BuildOutput` (default `C:\Projects\YARG-handbell-build\YARG.exe`) | `-SkipBuild`, or the build's `Assembly-CSharp.dll` is newer than every fork code/settings file | No | 13 min first, ~2 min incremental |
| Songs: `S3Harness prepare` copies the S5 exports into `-SongsPath` (default `C:\Projects\YARG-handbell-songs`) and renders per-ringer bell stems | `-SkipSongs`, or every song's `notes.mid`/`song.ini` match and stems exist | No | 30 s |

**Owner step (cannot be scripted): the Unity license.** If no license is found, the script
prints this and stops with exit code 2:
1. Open Unity Hub and sign in.
2. Go to **Preferences → Licenses → Add → Get a free personal license**.
3. Re-run the script.

Batch-mode builds pick the license up with no file copy (S3).

Other notes:
- Keep the fork's LFS traffic low. Pushes to and pulls from a fork count against
  YARC-Official's LFS quota, so the script pulls LFS objects only when some are missing.
- YARG is LGPL-3.0 and BASS is free for **non-commercial** use only (S3). This track is
  community/experimental. The product does not depend on it.
- First launch of YARG shows its Anti-Piracy Statement. Accepting it is the owner's call.

Expected time:
- Already set up: ~5 s with `-SkipBuild`, ~2 min with an incremental build.
- Fresh PC: ~1 h, mostly the Unity editor download.

Then follow the [I1 owner runbook](../../docs/spikes/I1-yarg-phones.md#owner-runbook-phones--yarg).

## Validation run (owner PC, 2026-10-23)

Both scripts were run on the owner's PC (Windows 11, PowerShell 7.6, Node 22.18, .NET SDK
10.0.112), which S3/I1/I2 had already set up. Every setup step reported `ok`. A forced build
into a temp folder took 1 min 56 s, and a second run of the same command was a no-op. Full
output is in the PR that added these scripts.

## Follow-ups

- macOS/Linux:
  - `setup-web` needs `brew`/`apt` for Node; the rest is portable.
  - `setup-yarg` needs the Hub CLI path on macOS (`/Applications/Unity Hub.app/…`), the
    Blender tarball/dmg, and the fork's build for `StandaloneOSX`/`StandaloneLinux64`.
  - YARG has no ARM or ChromeOS host.
- CI: run `setup-web.ps1 -SkipBuild` on a Windows runner to catch drift.
