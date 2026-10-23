# S2 — YARG.Core portability spike

Throwaway spike code for [S2](../../docs/spikes/README.md#s2--yargcore-portability). Report:
[docs/spikes/S2-report.md](../../docs/spikes/S2-report.md).

YARG.Core (LGPL-3.0-or-later) is **not vendored**. `fetch-yarg-core.ps1` clones
[YARC-Official/YARG.Core](https://github.com/YARC-Official/YARG.Core) at the pinned commit
`9dafd346aff908b6d5b1db250eaf3a2588810c70` (2026-10-19, "Lift mechanic for 5LK (#477)") into the
git-ignored `external/` folder and applies one small browser patch
([patches/0001-yarglogger-no-thread-on-browser.diff](patches/0001-yarglogger-no-thread-on-browser.diff)).
The `patches/` folder modifies LGPL code and is **LGPL-3.0-or-later**, not MIT; everything else
here is MIT. The diff carries an SPDX/notice header and is mapped in `REUSE.toml`. It is kept as
spike-only reference ([ADR-0008](../../docs/decisions/0008-assets-ip-and-attribution.md)
exception EX-005; copyleft adoption gate pending), so `git apply` still works on it.

## Layout

| Path | What |
|---|---|
| `fetch-yarg-core.ps1` | Clone YARG.Core at the pinned SHA; `-NoPatch` leaves it pristine to reproduce the WASM failure |
| `src/HandbellSpike.Core` | Shared code: self-generated sample charts, per-ringer split, synthetic-input engine driver, timings |
| `src/HandbellSpike.Console` | .NET console host (`net10.0`; `-p:S2TargetFramework=net9.0` also works) |
| `src/HandbellSpike.Wasm` | `Microsoft.NET.Sdk.WebAssembly` browser host (plain `wasmbrowser`-style, no Blazor) |

## Sample charts (licensing)

No third-party chart, MIDI, or audio file is used. `SampleSong.cs` contains a self-transcribed,
simplified refrain of *Jingle Bells* (J. L. Pierpont, 1857 — public-domain melody) with a
self-authored bass line, and generates from it:

- a Clone Hero/Moonscraper `.chart` (`[ExpertKeyboard]`, melody only, 5 lanes), and
- a Rock Band–style `.mid` with a `PART REAL_KEYS_X` (Pro Keys) track, melody + bass (8 bells).

Both are original work under this repo's MIT license. Run the console with `--write-samples` to
dump them to `bin/.../samples/`.

## Reproduce

Requires .NET SDK 10 (or 9) and git. No workloads needed (WASM runs in interpreter mode).

```powershell
cd spikes/s2-yarg-core
./fetch-yarg-core.ps1                          # pinned YARG.Core + browser patch
dotnet run --project src/HandbellSpike.Console -c Release -- --write-samples 20

dotnet publish src/HandbellSpike.Wasm -c Release -o out/wasm-patched
python -m http.server 8642 --directory out     # any static server works
# open http://127.0.0.1:8642/wasm-patched/wwwroot/index.html

# Reproduce the unpatched failure:
./fetch-yarg-core.ps1 -NoPatch
dotnet publish src/HandbellSpike.Wasm -c Release -o out/wasm-unpatched
```

Both hosts print the same report, ending in a result fingerprint; matching fingerprints mean
the YARG.Core scoring results are identical across runtimes.
