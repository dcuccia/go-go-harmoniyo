# S8 — signing feasibility check for the Windows package

Throwaway spike code for [S8](../../docs/spikes/S8-store-delivery-and-signing.md). The report is
[docs/spikes/S8-report.md](../../docs/spikes/S8-report.md).

**Question:** can the portable package's `go-go-harmoniyo.exe` (a Node 22 single executable
app, [tools/package/windows](../../tools/package/windows/README.md)) be Authenticode-signed and
given our own name and icon, and still run?

`sign-sea-test.ps1` repeats the build's SEA steps on a copy, signs it with a **throwaway
self-signed certificate** (one day, `CurrentUser\My`, deleted at the end), then runs the
package smoke test on the signed copy. No certificate is bought, nothing is uploaded or
published.

## Run it

From the repo root, on Windows:

```powershell
node tools/package/windows/build.mjs --version 0.0.0-s8test   # once; reuses its cache
pwsh spikes/s8-store-delivery/sign-sea-test.ps1 -Rcedit       # -KeepCopy keeps %TEMP%\s8-sign-test
```

It needs `signtool.exe`, from the Windows SDK or the `Microsoft.Windows.SDK.BuildTools` NuGet
package. Pass `-Signtool <path>` to choose one. `-Rcedit` installs `rcedit@4.0.1` (MIT) into
`%TEMP%\s8-rcedit`, not into the repo.

Steps:

1. Copy the pinned `node.exe` and run `signtool remove /s`.
2. With `-Rcedit`, set the version strings and the icon.
3. `postject` the SEA blob.
4. `signtool sign /fd SHA256` with the throwaway certificate.
5. Check the signature and VersionInfo.
6. Run `tools/package/windows/smoke.mjs`.
7. Delete the certificate.

## Results (2026-11-09, Windows 11 x64, Node 22.23.4 in the exe, cloudflared 2026.10.7)

| Check | Result |
|---|---|
| Package build (`build.mjs`) | 79 s; exe 89.4 MB, zip 56.1 MB |
| Sign an exe built **without** removing Node's signature first | **Fails.** `signtool remove /s` → `0x00000057`; `signtool sign` → `0x800700C1` (bad exe format). The leftover certificate table no longer matches the file after injection. |
| Sign an exe with the signature removed **before** `postject` | Works. 2.4–2.6 s without a timestamp server. The status is `UnknownError` (untrusted root, expected for a self-signed certificate), not `HashMismatch`. |
| rcedit (before `postject`) | FileDescription / ProductName = "Go Go HarmoniYo", CompanyName = "Go Go HarmoniYo contributors", FileVersion and icon set (`spikes/i2-web-phones/public/brand/favicon.ico`) |
| Signed exe, full `smoke.mjs` | **Passed:** URLs, trycloudflare tunnel, WebRTC (werift) available, 16 charts, controller page, brand files, state in `GOGOHARMONIYO_STATE_DIR` |
| `cloudflared.exe` in the zip | Already signed **Valid** by "Cloudflare, Inc." (EV subject, DigiCert chain). Only our exe needs signing. |

## What this means for `build.mjs`

- **Order:** copy `node.exe` → `signtool remove /s` → rcedit → `postject` → sign → zip. Signing
  last is what Node's SEA docs describe.
- **Must not skip the removal.** `build.mjs` looks for signtool only under `Windows Kits`. On a
  PC without the SDK it warns and builds an exe that can never be signed afterwards. When signing
  is requested, the build should fail if signtool is missing, and accept a `SIGNTOOL`
  environment variable or flag. `windows-latest` runners have the SDK, so CI builds are fine.
- **The `.cmd` launcher can't carry a signature** (Authenticode covers PE files and some
  scripts, not batch files). Signed builds should tell people to double-click the exe.
